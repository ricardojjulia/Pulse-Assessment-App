// ui/app/scale-tier.ts
//
// Scale Tier — adapts DQL queries to the size of the target tenant.
//
// Background ──────────────────────────────────────────────────────────────
// The Pulse Assessment app was originally calibrated for tenants up to ~5k
// hosts. Above that, the default "fetch logs | filter timestamp > now()-2h"
// pattern scans ingest-proportional volume and can exceed Grail's per-query
// timeout (~10 min). At 80k hosts a single log query projects to ~17 TB of
// scan / ~30 min wall-time per query — not viable.
//
// What this module does ───────────────────────────────────────────────────
// Introduces three execution modes that adapt the SCAN STRATEGY without
// changing scoring semantics or result column names:
//
//   - "exact"  — default. Queries are returned verbatim. Use for tenants
//                up to 5,000 hosts. Ground-truth coverage values.
//   - "large"  — for logs/spans/events/bizevents only, narrows the window
//                to 30 minutes and applies a 200 GB scanLimitGBytes cap.
//                Distinct-count accuracy preserved on typical workloads
//                (every active host emits at least one record per 30 min).
//   - "xlarge" — same shape as Large, but with a 5-minute window and 50 GB
//                cap. Coverage values become estimates (±5-10% on typical
//                workloads at 80k+ hosts). REQUIRED above 50k hosts to fit
//                inside Grail's query timeout.
//
// Entity, metrics, and Davis problems queries are NEVER scaled — they are
// already cheap (entity counts are metadata, metrics use timeseries which
// doesn't scan raw data, problems are 72h-windowed but sparse).
//
// Contract ────────────────────────────────────────────────────────────────
// scaleQuery() is a PURE function over (query, tier) → query. It does not
// allocate the network. The result is a syntactically-valid DQL string
// that returns the SAME column shape as the input. Downstream consumers
// (useCoverageData, components, scoring) operate on the original query
// string as the cache key, so swapping the executed string is transparent.
//
// Result fidelity caveat ──────────────────────────────────────────────────
// In "large" and "xlarge" modes, numeric values may differ from "exact"
// because the scan covers less data. This is INTENTIONAL — it is what
// makes the app runnable at xlarge. The UI surfaces this via the
// ScaleTierBanner and an "≈" prefix on each affected coverage score.

// Cost mode ───────────────────────────────────────────────────────────────
// Measured on a reference tenant (30 days, dt.system.events): a full run scanned
// 370 GiB — 5.98 TiB/month across 16 runs, ≈ US$ 60/month at $0.01/GiB.
// 81% of that was spans, 18% logs; entity and metric queries scanned
// literally zero. Two levers, both measured on the live tenant:
//
//   samplingRatio  — 2h of logs: 4.99 GB -> 0.003 GB (1600x) while the
//                    ratios held (trace_id share 8.78% -> 9.07%, host share
//                    51.75% -> 50.34%). But countDistinct COLLAPSES under
//                    sampling (log.source 63 -> 28; gen_ai providers 4 -> 1),
//                    so it is applied ONLY where every side of the criterion
//                    is a plain count and the ratio cancels the sampling out.
//   shorter window — the honest lever for distinct counts: 2h -> 15m cost
//                    0.61 GB instead of 3.87 GB and lost 6% of distinct log
//                    sources (63 -> 59).
//
// Applied at every tier, including "exact": the tier controls how much data
// the assessment looks at, this controls how much of it Grail has to read to
// answer the same question.

import { CAPABILITIES } from './queries';

export type ScaleTier = 'exact' | 'large' | 'xlarge';

export interface TierConfig {
  /** Window applied to fetch logs/spans/events/bizevents. */
  windowMinutes: number;
  /** scanLimitGBytes safety net for the same sources (undefined = no cap). */
  scanLimitGBytes?: number;
  /** True when results are estimates rather than ground truth. */
  sampled: boolean;
  /** Human-readable label shown in the UI banner. */
  label: string;
  /** Banner subtitle explaining the tradeoff. */
  description: string;
  /** Lower host-count bound for auto-selection (inclusive). */
  minHosts: number;
  /** Upper host-count bound for auto-selection (exclusive). Infinity = no cap. */
  maxHosts: number;
}

export const TIER_CONFIG: Record<ScaleTier, TierConfig> = {
  exact: {
    windowMinutes: 120,
    sampled: false,
    label: 'Exact',
    description:
      'Full 2-hour window, no sampling. Ground-truth coverage values. Recommended for tenants up to 5,000 hosts.',
    minHosts: 0,
    maxHosts: 5_000,
  },
  large: {
    windowMinutes: 30,
    scanLimitGBytes: 200,
    sampled: true,
    label: 'Large',
    description:
      '30-minute window with 200 GB scan cap. Suitable for tenants 5k–50k hosts. Coverage values may shift slightly for very sparse signals; otherwise indistinguishable from Exact.',
    minHosts: 5_000,
    maxHosts: 50_000,
  },
  xlarge: {
    windowMinutes: 5,
    scanLimitGBytes: 50,
    sampled: true,
    label: 'xLarge',
    description:
      '5-minute window with 50 GB scan cap. For tenants >50k hosts. Coverage values are sampled estimates (±5–10% on typical workloads with continuous ingest). Suitable for trend tracking, not formal audit.',
    minHosts: 50_000,
    maxHosts: Number.POSITIVE_INFINITY,
  },
};

/**
 * Auto-selects a tier from observed host count using the thresholds defined
 * in TIER_CONFIG (currently 5k / 50k). The user can override this via the
 * Scale Tier toggle in the header — the override is persisted in localStorage
 * by useScaleTier.
 */
export function tierFromHostCount(hostCount: number): ScaleTier {
  if (hostCount >= TIER_CONFIG.xlarge.minHosts) return 'xlarge';
  if (hostCount >= TIER_CONFIG.large.minHosts) return 'large';
  return 'exact';
}

/**
 * Hot sources are the high-cost streaming tables whose scan grows linearly
 * with ingest volume. Only these are scaled by tier. Davis problems are
 * intentionally excluded: they are sparse and Davis already deduplicates,
 * so reducing their 72h window would actually lose signal without saving
 * meaningful cost.
 */
function isHotSource(query: string): boolean {
  return (
    /\bfetch\s+logs\b/i.test(query) ||
    /\bfetch\s+spans\b/i.test(query) ||
    /\bfetch\s+events\b/i.test(query) ||
    /\bfetch\s+bizevents\b/i.test(query)
  );
}

/** Sampling ratio for criteria where it provably cancels out. 1000x was the
 *  measured sweet spot: ratio error stayed under 1.5 percentage points while
 *  scan dropped ~1600x. */
const SAMPLE_RATIO = 1000;
/** Window for hot queries that cannot be sampled, when the original window is
 *  short. Measured to keep 94% of distinct log sources at 16% of the cost. */
const DISTINCT_WINDOW_MIN = 15;
/** Longest window kept for hot queries that cannot be sampled.
 *  The AI checks author 72h because gen_ai spans are sparse, and their
 *  countDistinct cannot be sampled (measured: providers 4 -> 1 at 1000x), so
 *  the window is the only lever. 72h of spans costs ~97 GB on a mid-size
 *  tenant; 4h costs ~5 GB and still sees any service that called a model in
 *  the last four hours — which a live AI workload does continuously. */
const MAX_WINDOW_MIN = 4 * 60;
/** Hard ceiling so no single query can ever run away, whatever the tenant. */
const COST_SCAN_LIMIT_GB = 50;

/** True when the query's value is invariant under uniform sampling.
 *  count()/countIf() scale linearly and cancel in a ratio; countDistinct and
 *  group-counting (`by:`) do not — sampling drops whole groups. */
function isRatioSafe(query: string): boolean {
  if (/countDistinct\s*\(/i.test(query)) return false;
  if (/\bby\s*:/i.test(query)) return false;
  if (/\bdedup\b/i.test(query)) return false;
  return /count\s*\(\s*\)|countIf\s*\(/i.test(query);
}

/** Reads the window a hot query asks for, in minutes. */
function windowMinutesOf(query: string): number | null {
  const m =
    /\bfrom\s*:\s*now\(\)\s*-\s*(\d+)\s*([hmd])/i.exec(query) ??
    /\bfilter\s+timestamp\s*>\s*now\(\)\s*-\s*(\d+)\s*([hmd])/i.exec(query);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'h' ? n * 60 : m[2].toLowerCase() === 'd' ? n * 1440 : n;
}

/**
 * The set of query strings that may be sampled.
 *
 * The decision belongs to the CRITERION, not the string: sampling only
 * cancels out when numerator and denominator are sampled the same way. A
 * criterion qualifies only when it is a ratio of two hot-source counts —
 * if one side is an entity count (exact) or a distinct count, sampling the
 * other side would skew the score. A string shared with any criterion that
 * does not qualify loses the privilege too.
 */
let sampleableCache: Set<string> | null = null;
export function sampleableQueries(): Set<string> {
  if (sampleableCache) return sampleableCache;
  const safe = new Set<string>();
  const blocked = new Set<string>();
  for (const cap of CAPABILITIES) {
    for (const cr of cap.criteria) {
      const sides = [cr.query, cr.queryB].filter((s): s is string => !!s);
      const qualifies =
        sides.length === 2 &&
        sides.every(isHotSource) &&
        sides.every(isRatioSafe) &&
        // Both sides must read the same window, or the ratio compares
        // different amounts of data once sampled.
        windowMinutesOf(sides[0]) === windowMinutesOf(sides[1]);
      for (const s of sides) (qualifies ? safe : blocked).add(s);
    }
  }
  for (const s of blocked) safe.delete(s);
  sampleableCache = safe;
  return safe;
}

/** Window a non-sampleable hot query is narrowed to: short windows collapse
 *  to 15 minutes, long ones (the sparse gen_ai checks) are capped at 24h. */
function plainWindow(minutes: number): number {
  return minutes <= 4 * 60
    ? Math.min(minutes, DISTINCT_WINDOW_MIN)
    : Math.min(minutes, MAX_WINDOW_MIN);
}

/**
 * Target window per query string, for everything sampling cannot touch.
 *
 * Criteria whose two sides deliberately read DIFFERENT windows (l10 compares
 * 24h of log sources against 2h) encode their meaning in the ratio between
 * those windows, so both sides are divided by the same factor instead of
 * being clamped independently. When a string is shared by several criteria
 * the longest requested window wins — never scan less than some criterion
 * still needs.
 */
let windowPlanCache: Map<string, number> | null = null;
export function windowPlan(): Map<string, number> {
  if (windowPlanCache) return windowPlanCache;
  const plan = new Map<string, number>();
  const sampleable = sampleableQueries();
  const want = (q: string, minutes: number) => {
    const prev = plan.get(q);
    if (prev == null || minutes > prev) plan.set(q, minutes);
  };
  for (const cap of CAPABILITIES) {
    for (const cr of cap.criteria) {
      const hot = [cr.query, cr.queryB].filter(
        (s): s is string => !!s && isHotSource(s) && !sampleable.has(s),
      );
      if (hot.length === 0) continue;
      const windows = hot.map(q => windowMinutesOf(q) ?? TIER_CONFIG.exact.windowMinutes);
      if (windows.every(w => w === windows[0])) {
        hot.forEach((q, i) => want(q, plainWindow(windows[i])));
      } else {
        // Divide both sides by the same factor so the ratio they encode survives.
        const divisor = Math.max(1, Math.min(...windows) / DISTINCT_WINDOW_MIN);
        hot.forEach((q, i) =>
          want(q, Math.min(MAX_WINDOW_MIN, Math.max(5, Math.round(windows[i] / divisor)))),
        );
      }
    }
  }
  windowPlanCache = plan;
  return plan;
}

/** Rewrites a hot-source fetch clause with an explicit window and options,
 *  stripping whatever window/limit the original carried so the two cannot
 *  contradict each other. The window is ALWAYS emitted explicitly — leaving
 *  it off would hand the query whatever default timeframe the caller has. */
function rewriteFetch(query: string, windowMin: number, sampling?: number): string {
  let q = query.replace(/\|\s*filter\s+timestamp\s*>\s*now\(\)\s*-\s*\d+\s*[hmsd]\s*/gi, '| ');
  q = q.replace(/\|\s*\|/g, '| ');
  return q.replace(
    /\bfetch\s+(logs|spans|events|bizevents)\b((\s*,\s*(from\s*:\s*now\(\)\s*-\s*\d+\s*[hmsd]|scanLimitGBytes\s*:\s*-?\d+|samplingRatio\s*:\s*\d+))*)/i,
    (_m, src: string, params: string) => {
      // Preserve a deliberate "no limit" marker (l11 probes bucket spread and
      // must not be capped); everything else is rebuilt.
      const uncapped = /scanLimitGBytes\s*:\s*-1/i.test(params);
      const parts = [`fetch ${src}`, `from: now()-${windowMin}m`];
      if (sampling) parts.push(`samplingRatio: ${sampling}`);
      parts.push(uncapped ? 'scanLimitGBytes: -1' : `scanLimitGBytes: ${COST_SCAN_LIMIT_GB}`);
      return parts.join(', ');
    },
  );
}

/**
 * Cost mode — applied at every tier, after the tier's own windowing.
 *
 * Sampling where it cancels out, a shorter window where it does not, and a
 * scan ceiling on everything. Column shape is untouched, so scoring, the
 * cache key and every downstream consumer are unaffected.
 */
export function costOptimizeQuery(query: string, original = query): string {
  if (!isHotSource(query)) return query;
  // Sampleability and the window plan are properties of the CRITERION, so
  // they are looked up by the catalog string — `query` may already carry a
  // tier rewrite.
  const originalWindow = windowMinutesOf(original) ?? TIER_CONFIG.exact.windowMinutes;
  const currentWindow = windowMinutesOf(query) ?? originalWindow;

  if (sampleableQueries().has(original)) {
    // The ratio cancels the sampling out, so the window stays as authored —
    // that is what keeps sparse signals (gen_ai spans over 72h) observable.
    return rewriteFetch(query, currentWindow, SAMPLE_RATIO);
  }
  const target = Math.min(currentWindow, windowPlan().get(original) ?? plainWindow(originalWindow));
  return rewriteFetch(query, target);
}

/**
 * Returns the DQL string Grail will actually execute given a tier.
 *
 * In "exact" mode the input is returned verbatim — zero risk of regression
 * on tenants ≤ 5k hosts.
 *
 * In "large" / "xlarge" mode, for hot sources only, the function:
 *   1. Removes any "| filter timestamp > now() - N(h|m)" pipeline stage
 *      (the from: parameter would otherwise conflict).
 *   2. Replaces "fetch <src>" or "fetch <src>, from:now()-Xh" with
 *      "fetch <src>, from: now()-WINDOWm, scanLimitGBytes: CAP".
 *
 * Other clauses (field filters, summarize, fieldsAdd, fields) are preserved
 * bit-identical so the result column shape matches the original query.
 */
export function scaleQuery(query: string, tier: ScaleTier): string {
  // Cost mode runs at every tier. On "exact" it is the only transform: the
  // question the criterion asks is unchanged, Grail just reads far less to
  // answer it.
  if (tier === 'exact') return costOptimizeQuery(query);
  if (!isHotSource(query)) return query;

  const cfg = TIER_CONFIG[tier];
  const window = `now()-${cfg.windowMinutes}m`;
  const scanLimit =
    cfg.scanLimitGBytes != null ? `, scanLimitGBytes: ${cfg.scanLimitGBytes}` : '';

  // 1) Strip pipeline "filter timestamp > now() - Nh|m|s|d" stages — will be replaced by from:
  let q = query.replace(
    /\|\s*filter\s+timestamp\s*>\s*now\(\)\s*-\s*\d+\s*[hmsd]\s*/gi,
    '| ',
  );
  // Collapse any double pipes that may result from the strip above
  q = q.replace(/\|\s*\|/g, '| ');

  // 2) Inject from: + scanLimitGBytes into the fetch clause for the hot source.
  q = q.replace(
    /\bfetch\s+(logs|spans|events|bizevents)\b(\s*,\s*from\s*:\s*now\(\)\s*-\s*\d+\s*[hmsd])?/i,
    (_m, src) => `fetch ${src}, from: ${window}${scanLimit}`,
  );

  // Then sample the ratios, on top of the tier's narrower window.
  return costOptimizeQuery(q, query);
}
