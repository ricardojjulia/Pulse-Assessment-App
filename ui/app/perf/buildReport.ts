// ui/app/perf/buildReport.ts
//
// Pure functions that turn the in-flight perf data collected during a run
// into a serialisable PerfReport, and that drop the result on disk via a
// click-triggered Blob download.

import { APP_VERSION } from '../appVersion';
import type { CapabilityResult, EntityCounts } from '../hooks/useCoverageData';
import type { ScaleTier } from '../scale-tier';
import {
  EMPTY_BY_SOURCE,
  type InFlightPerfEntry,
  type PerfCapabilitySummary,
  type PerfReport,
} from './types';

/** Inputs the assembler needs that aren't on the in-flight entries themselves. */
export interface BuildReportArgs {
  startedAt: string;
  finishedAt: string;
  wallTimeMs: number;
  concurrency: number;
  tenant: string;
  date: string;
  demoActive: boolean;
  demoScenarioId: string | null;
  scale: {
    tier: ScaleTier;
    autoTier: ScaleTier | null;
    manualOverride: ScaleTier | null;
    hostCount: number | null;
  };
  entityCounts: EntityCounts | null;
  capabilities: CapabilityResult[];
  /** Pre-built map of query string → criterion IDs that consumed it. Built
   *  outside this function so we don't need to import the full criteria list
   *  here (keeps this module dependency-light). */
  queryConsumers: Map<string, string[]>;
  /** Per-query metrics captured during the run. */
  entries: InFlightPerfEntry[];
  /** Cache stats from the 24h persistent cache. Zero on cold start or in
   *  demo mode (demo bypasses cache). */
  cacheHits: number;
  cacheMisses: number;
  cachedBytesSaved: number;
  /** Smart-skip stats (C3). Numerators not executed because their entity
   *  denominator was 0. */
  skippedQueries: number;
  skippedCriteria: string[];
}

/** How many of the most expensive queries to surface in `topExpensiveQueries`. */
const TOP_N = 10;

export function buildReport(args: BuildReportArgs): PerfReport {
  const queries = args.entries
    .slice()
    // Stable ordering: highest scan first, then longest wall-time. Helpful
    // for the analyzer to spot outliers without re-sorting.
    .sort((a, b) => b.scannedBytes - a.scannedBytes || b.wallTimeMs - a.wallTimeMs)
    .map((e, i) => ({ ...e, index: i }));

  // bySource roll-up: per-source totals + latency percentiles.
  // We collect wall-times into arrays so we can compute p50/p95/max in a
  // second pass. Latency percentiles matter more than the sum because the
  // worker pool runs queries concurrently — a high sum can come from many
  // small queries (cheap) OR a few outliers (a real perf problem).
  const bySource: PerfReport['bySource'] = JSON.parse(JSON.stringify(EMPTY_BY_SOURCE));
  const walls: Record<string, number[]> = {};
  for (const q of queries) {
    const bucket = bySource[q.source];
    bucket.count++;
    bucket.scannedBytes += q.scannedBytes;
    bucket.wallTimeMs += q.wallTimeMs;
    if (!q.ok) bucket.failed++;
    (walls[q.source] ??= []).push(q.wallTimeMs);
  }
  const pct = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
  };
  for (const src of Object.keys(bySource) as Array<keyof typeof bySource>) {
    const arr = (walls[src] ?? []).slice().sort((a, b) => a - b);
    bySource[src].wallTimeP50 = pct(arr, 0.5);
    bySource[src].wallTimeP95 = pct(arr, 0.95);
    bySource[src].wallTimeMax = arr.length > 0 ? arr[arr.length - 1] : 0;
  }

  // Top-N expensive queries. We mix two ranking signals because both matter:
  //   1. Raw scannedBytes — the absolute cost outliers.
  //   2. scanBytesPerCriterion — the dedup-failure outliers (a 600 GB query
  //      serving 1 criterion is worse than 600 GB serving 9).
  // The first half of the list is dominated by (1); the second half pulls
  // in queries from (2) that didn't already make the raw cut.
  const perCritScore = (q: typeof queries[number]) =>
    q.scannedBytes / Math.max(1, q.usedByCriteria.length);
  const byPerCrit = queries.slice().sort((a, b) => perCritScore(b) - perCritScore(a));

  const rawTop = queries.slice(0, Math.ceil(TOP_N / 2));
  const rawSet = new Set(rawTop.map((q) => q.originalQuery));
  const perCritTopFiltered = byPerCrit
    .filter((q) => !rawSet.has(q.originalQuery))
    .slice(0, TOP_N - rawTop.length);

  const topExpensiveQueries = [
    ...rawTop.map((q) => ({
      originalQuery: q.originalQuery,
      source: q.source,
      scannedBytes: q.scannedBytes,
      wallTimeMs: q.wallTimeMs,
      usedByCriteriaCount: q.usedByCriteria.length,
      scanBytesPerCriterion: Math.round(perCritScore(q)),
      // Promote to "both" when the entry would also have shown up in the
      // perCrit ranking — useful flag in the JSON for the analyzer.
      rank: byPerCrit.indexOf(q) < TOP_N - rawTop.length ? ('both' as const) : ('raw' as const),
    })),
    ...perCritTopFiltered.map((q) => ({
      originalQuery: q.originalQuery,
      source: q.source,
      scannedBytes: q.scannedBytes,
      wallTimeMs: q.wallTimeMs,
      usedByCriteriaCount: q.usedByCriteria.length,
      scanBytesPerCriterion: Math.round(perCritScore(q)),
      rank: 'perCrit' as const,
    })),
  ];

  // Capability summary
  const capabilities: PerfCapabilitySummary[] = args.capabilities.map((cap) => ({
    name: cap.name,
    color: cap.color,
    score: cap.score,
    utilizationScore: cap.utilization.utilizationScore,
    maturityLevel: cap.utilization.level,
    criteriaCount: cap.criteriaResults.length,
    criteriaPassed: cap.criteriaResults.filter((c) => c.points > 0).length,
    criteriaErrored: cap.criteriaResults.filter((c) => c.error).length,
  }));

  // Run-level totals
  let totalScannedBytes = 0;
  let totalScannedRecords = 0;
  let totalScannedDataPoints = 0;
  let queriesFailed = 0;
  for (const q of queries) {
    totalScannedBytes += q.scannedBytes;
    totalScannedRecords += q.scannedRecords;
    totalScannedDataPoints += q.scannedDataPoints;
    if (!q.ok) queriesFailed++;
  }
  const totalGB = totalScannedBytes / (1024 * 1024 * 1024);
  const estimatedDpsUsdHigh = totalGB * 0.01;
  const estimatedDpsUsdLow = totalGB * 0.0065;

  return {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    app: { name: 'Pulse Assessment', version: APP_VERSION },
    environment: {
      tenant: args.tenant,
      date: args.date,
      demoActive: args.demoActive,
      demoScenarioId: args.demoScenarioId,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    },
    scale: args.scale,
    entityCounts: args.entityCounts,
    run: {
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      wallTimeMs: args.wallTimeMs,
      concurrency: args.concurrency,
      totalUniqueQueries: queries.length,
      totalScannedBytes,
      totalScannedRecords,
      totalScannedDataPoints,
      estimatedDpsUsdHigh: Math.round(estimatedDpsUsdHigh * 100) / 100,
      estimatedDpsUsdLow: Math.round(estimatedDpsUsdLow * 100) / 100,
      queriesFailed,
      cacheHits: args.cacheHits,
      cacheMisses: args.cacheMisses,
      cachedBytesSaved: args.cachedBytesSaved,
      skippedQueries: args.skippedQueries,
      skippedCriteria: args.skippedCriteria,
    },
    bySource,
    topExpensiveQueries,
    capabilities,
    queries,
  };
}

/**
 * Triggers a JSON file download in the browser. Filename embeds the tenant,
 * tier, and ISO timestamp so a directory of these is naturally sorted and
 * unambiguous.
 *
 * Returns the filename used, for callers that want to surface it to the UI.
 */
export function downloadReport(report: PerfReport): string {
  const json = JSON.stringify(report, null, 2);
  const safeTenant = report.environment.tenant.replace(/[^a-z0-9-]/gi, '_');
  const tierSlug = report.environment.demoActive
    ? `demo-${report.environment.demoScenarioId ?? 'unknown'}`
    : report.scale.tier;
  const ts = report.generated.replace(/[:.]/g, '-');
  const filename = `pulse-perf-${safeTenant}-${tierSlug}-${ts}.json`;

  if (typeof document === 'undefined') return filename; // SSR safety

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // The download attribute is honored only when the anchor is in the DOM in
  // older browsers. Appending+removing is harmless on modern ones too.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL on the next tick so the click has had a chance to
  // start the download. Without this, Firefox occasionally aborts the save.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}
