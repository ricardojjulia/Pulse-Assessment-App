// ui/app/perf/types.ts
//
// Schema of the performance report that the app emits at the end of every
// assessment run (real or demo). Stored in CoverageData.perfReport so that
// any consumer — the in-app download button, the next assessment's
// comparison view, an external analyzer — can read a single structured
// blob instead of scraping the live state.
//
// schemaVersion is bumped on breaking changes so an external analyzer
// (Claude, custom scripts, dashboards) can detect mismatches and refuse
// to interpret data it doesn't understand.

import type { ScaleTier } from '../scale-tier';
import type { EntityCounts, QueryStats } from '../hooks/useCoverageData';

/** One row per unique DQL query executed during a single assessment run. */
export interface PerfQueryEntry {
  /** Execution order within the run (0-based, after dedup). */
  index: number;
  /** The query string as defined in queries.ts. The Map<query,value> cache
   *  is keyed by this string, so consumers can join PerfQueryEntry back to
   *  criterion definitions on this field. */
  originalQuery: string;
  /** What Grail actually executed. Differs from originalQuery when the run
   *  was in Large/xLarge tier (windows narrowed, scanLimitGBytes injected).
   *  In Exact tier or in demo mode this equals originalQuery. */
  executedQuery: string;
  /** Coarse classification used for cost roll-ups and the analyzer's
   *  "queries by source" report. */
  source:
    | 'logs'
    | 'spans'
    | 'events'
    | 'bizevents'
    | 'metrics'
    | 'entity'
    | 'problems'
    | 'security'
    | 'other';
  /** The Scale Tier in effect when this query ran. Same for every entry in
   *  one run, but stored per-entry so a multi-run aggregation file would
   *  still be parseable without external joins. */
  tier: ScaleTier;
  /** Client-side wall-time for this query, in milliseconds. Includes
   *  network round-trip + Grail compute + JSON deserialisation. NOT the
   *  same as server-side scan time. */
  wallTimeMs: number;
  /** Grail-reported scanned bytes (the headline DPS metric). */
  scannedBytes: number;
  /** Grail-reported scanned records. */
  scannedRecords: number;
  /** Grail-reported scanned data points (for timeseries queries). */
  scannedDataPoints: number;
  /** The numeric value extracted from the result. -1 sentinel means the
   *  query failed or produced no numeric column. */
  resultValue: number;
  /** Whether the query succeeded. */
  ok: boolean;
  /** First line of the error message, when ok=false. */
  errorMessage: string | null;
  /** Criterion IDs that consumed this query as numerator or denominator.
   *  Lets the analyzer cross-reference scoring decisions with cost. */
  usedByCriteria: string[];
  /** True when the value came from the persistent 24h Document Store cache
   *  rather than a live Grail call. Cached queries report scannedBytes=0
   *  and a near-zero wallTimeMs — the savings show up directly in the
   *  bySource/totalScannedBytes roll-ups. */
  cached?: boolean;
  /** Cache age in seconds at the time of the run (0 for cache misses,
   *  positive for hits). Lets the analyzer judge how stale a cache hit
   *  was — a 23-hour-old cache hit is still served but flagged. */
  cacheAgeSec?: number;
  /** True when this entry represents a query that was NOT executed because
   *  its criterion's entity-count denominator returned 0 (e.g., tenant
   *  without Kubernetes → skip k8s log queries). Skipped entries report
   *  scannedBytes=0 and wallTimeMs=0; `resultValue` is the value that
   *  scoring will use (also 0). The analyzer can use this flag to tell
   *  apart "saved by skip" from "saved by cache". */
  skipped?: boolean;
  /** When skipped=true, the entity query whose 0 result triggered the
   *  skip. Lets the analyzer build a "tenant doesn't have X → saved Y MB"
   *  report. */
  skipReason?: string;
}

/** One row per capability. Lighter than CapabilityResult — only the metrics
 *  an external analyzer needs. */
export interface PerfCapabilitySummary {
  name: string;
  color: string;
  score: number;
  utilizationScore: number;
  maturityLevel: 0 | 1 | 2 | 3;
  criteriaCount: number;
  criteriaPassed: number;
  criteriaErrored: number;
}

export interface PerfReport {
  /** Bump on breaking shape changes. */
  schemaVersion: 1;
  /** ISO-8601 timestamp when the report was finalised. */
  generated: string;

  /** Identifies the app build that produced the report. */
  app: {
    name: 'Pulse Assessment';
    version: string;
  };

  /** Identifies the runtime context. */
  environment: {
    /** The short tenant identifier (e.g. "abc12345"). */
    tenant: string;
    /** Date as YYYY-MM-DD on which the run started. */
    date: string;
    /** True when the run was synthesised from a DemoScenario instead of
     *  hitting Grail. demoScenarioId carries which scenario was active. */
    demoActive: boolean;
    demoScenarioId: string | null;
    /** Browser UA — useful when the analyzer suspects browser-side stalls
     *  (background tab throttling, fetch cancellation, etc.). */
    userAgent: string;
  };

  /** Scale Tier metadata. Lets the analyzer compare "we're at 80k hosts but
   *  user forced tier=exact" vs. "user accepted auto-detected xlarge". */
  scale: {
    tier: ScaleTier;
    autoTier: ScaleTier | null;
    manualOverride: ScaleTier | null;
    hostCount: number | null;
  };

  /** Entity counts the app surfaces in the footer panel. Useful context for
   *  the analyzer: a tenant with 0 kubernetes_clusters explains why all K8s
   *  criteria are reporting 0 coverage, etc. */
  entityCounts: EntityCounts | null;

  /** Aggregate run metrics. */
  run: {
    startedAt: string;
    finishedAt: string;
    /** End-to-end client-side wall-time. */
    wallTimeMs: number;
    /** CONCURRENCY constant from useCoverageData at the time of the run. */
    concurrency: number;
    /** Number of unique query strings actually executed (after dedup). */
    totalUniqueQueries: number;
    /** Sum of scannedBytes across all unique queries. */
    totalScannedBytes: number;
    /** Sum of scannedRecords across all unique queries. */
    totalScannedRecords: number;
    /** Sum of scannedDataPoints (timeseries only). */
    totalScannedDataPoints: number;
    /** Estimated DPS cost in USD at $0.01/GB (upper-bound tier). */
    estimatedDpsUsdHigh: number;
    /** Same at $0.0065/GB (lower-bound tier). */
    estimatedDpsUsdLow: number;
    /** Number of unique queries that returned an error. */
    queriesFailed: number;
    /** Number of unique queries served from the 24h persistent cache. A
     *  high ratio (close to totalUniqueQueries) means this was a same-day
     *  re-run that paid ~zero DPS. Zero on cold starts or after a force
     *  refresh. */
    cacheHits: number;
    /** Number of unique queries that required a live Grail call. Equal to
     *  (totalUniqueQueries - cacheHits) on cache-load-OK paths. */
    cacheMisses: number;
    /** Bytes that WOULD have been scanned on cached queries (i.e., what
     *  the cache saved). Adds to the analyzer's "savings vs no-cache" story
     *  without requiring a baseline comparison. */
    cachedBytesSaved: number;
    /** Number of unique queries skipped because their criterion's
     *  entity-count denominator was 0 (C3 smart-skip). Independent of
     *  cacheHits — cache + skip can both contribute on the same run. */
    skippedQueries: number;
    /** Criterion IDs skipped because their entity-count denominator was 0. */
    skippedCriteria: string[];
  };

  /** Per-query roll-up by source. Computed during finalisation so external
   *  consumers don't need to re-aggregate.
   *
   *  wallTimeMs is the SUM across all queries in the source — useful for
   *  cost attribution but misleading for latency because queries run with
   *  CONCURRENCY=10. wallTimeP50 / wallTimeP95 / wallTimeMax give the
   *  per-query latency shape, which is what the analyzer actually needs
   *  to spot outliers. */
  bySource: Record<
    PerfQueryEntry['source'],
    {
      count: number;
      scannedBytes: number;
      wallTimeMs: number;
      wallTimeP50: number;
      wallTimeP95: number;
      wallTimeMax: number;
      failed: number;
    }
  >;

  /** Top-N most expensive queries — first half by raw scannedBytes (the
   *  biggest scans, regardless of how widely they're shared), second half
   *  by scanBytesPerCriterion (the WORST dedup offenders: huge scan serving
   *  only 1-2 criteria). The analyzer prioritises the latter when proposing
   *  optimisations, because shared denominators are already amortised. */
  topExpensiveQueries: Array<{
    originalQuery: string;
    source: string;
    scannedBytes: number;
    wallTimeMs: number;
    usedByCriteriaCount: number;
    /** scannedBytes / max(1, usedByCriteriaCount). A query scanning 600 GB
     *  for one criterion has cost-per-criterion 600 GB; one scanning the
     *  same 600 GB for 9 criteria has 67 GB/criterion — the dedup is doing
     *  its job. High values flag refactor candidates. */
    scanBytesPerCriterion: number;
    /** Why the entry made the cut: "raw" (top by scannedBytes) or "perCrit"
     *  (top by scanBytesPerCriterion). When a query qualifies on both, it
     *  appears once with rank: "both". */
    rank: 'raw' | 'perCrit' | 'both';
  }>;

  /** Per-capability summary keyed off the live assessment result. */
  capabilities: PerfCapabilitySummary[];

  /** Full per-query log. Verbose, but this is the raw material the analyzer
   *  needs to recommend changes. */
  queries: PerfQueryEntry[];
}

/** What the recorder collects during a run before finalisation. Same shape
 *  as PerfQueryEntry minus the index, which the recorder assigns at the end. */
export type InFlightPerfEntry = Omit<PerfQueryEntry, 'index'>;

/** Convenience: empty stats container shipped when a run is cancelled or
 *  has zero unique queries. Keeps the analyzer's interface uniform. */
export const EMPTY_BY_SOURCE: PerfReport['bySource'] = {
  logs:      { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  spans:     { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  events:    { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  bizevents: { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  metrics:   { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  entity:    { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  problems:  { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  security:  { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
  other:     { count: 0, scannedBytes: 0, wallTimeMs: 0, wallTimeP50: 0, wallTimeP95: 0, wallTimeMax: 0, failed: 0 },
};

/** Best-effort source classification. Same logic used in scale-tier.ts but
 *  with finer granularity (problems, security) for analyzer reporting. */
export function classifySource(query: string): PerfQueryEntry['source'] {
  const s = query.toLowerCase();
  if (/\bfetch\s+dt\.davis\.problems\b/.test(s)) return 'problems';
  if (/\bfetch\s+dt\.entity\./.test(s)) return 'entity';
  if (/\bfetch\s+dt\.security\./.test(s)) return 'security';
  if (/^\s*timeseries\b/.test(s)) return 'metrics';
  if (/\bfetch\s+logs\b/.test(s)) return 'logs';
  if (/\bfetch\s+spans\b/.test(s)) return 'spans';
  if (/\bfetch\s+events\b/.test(s)) return 'events';
  if (/\bfetch\s+bizevents\b/.test(s)) return 'bizevents';
  return 'other';
}

/** Re-export for convenience so a consumer can `import { QueryStats } from "./types"`. */
export type { QueryStats };
