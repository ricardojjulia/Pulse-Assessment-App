// ═══════════════════════════════════════════════════════════
// shared/scoring.ts — Pure scoring helpers
//
// Extracted from ui/app/hooks/useCoverageData.ts so the same
// logic can be used from both the React UI hooks and the
// server-side API function (api/run-assessment.function.ts).
//
// Constraints:
//   - No React, no browser APIs.
//   - No imports from ui/ — only from SDK packages or built-ins.
// ═══════════════════════════════════════════════════════════

export type CriterionTier = "foundation" | "bestPractice" | "excellence";

/** Matches the Threshold interface in ui/app/queries.ts (structurally identical). */
export interface Threshold {
  min?: number;
  max?: number;
}

export interface TierResult {
  total: number;
  passed: number;
}

export interface CapabilityUtilizationResult {
  fPct: number;
  bPct: number;
  ePct: number;
  effB: number;
  effE: number;
  utilizationScore: number;
  utilizationBand: string;
  foundation: TierResult;
  bestPractice: TierResult;
  excellence: TierResult;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
}

// ── Tier weights (mirrors useCoverageData.ts) ──────────────────────────────
export const FOUNDATION_WEIGHT = 60;
export const BEST_PRACTICE_WEIGHT = 25;
export const EXCELLENCE_WEIGHT = 15;

// ── Internal helpers ───────────────────────────────────────────────────────

function extractNumeric(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  // timeseries aggregations return arrays (one value per time bin) — take last non-null element
  if (Array.isArray(v) && v.length > 0) {
    for (let i = v.length - 1; i >= 0; i--) {
      if (typeof v[i] === "number") return v[i] as number;
      if (typeof v[i] === "bigint") return Number(v[i]);
    }
  }
  return null;
}

function thresholdTarget(thresholds: Threshold[]): { direction: "min" | "max"; value: number } {
  const mins = thresholds.map(t => t.min).filter((v): v is number => typeof v === "number");
  if (mins.length > 0) return { direction: "min", value: Math.max(...mins) };
  const maxes = thresholds.map(t => t.max).filter((v): v is number => typeof v === "number");
  if (maxes.length > 0) return { direction: "max", value: Math.min(...maxes) };
  return { direction: "min", value: 1 };
}

// ── Public functions ───────────────────────────────────────────────────────

/**
 * Reads the first numeric value from a DQL query result.
 * Handles { records: [...] } shapes, bare arrays, and single records.
 */
export function extractValue(result: unknown): number {
  try {
    if (!result) return 0;
    let records: unknown[];
    if (Array.isArray(result)) {
      records = result;
    } else {
      const obj = result as Record<string, unknown>;
      records = Array.isArray(obj["records"]) ? (obj["records"] as unknown[]) : [result];
    }
    if (records.length === 0) return 0;
    const record = records[0];
    if (record == null) return 0;
    const direct = extractNumeric(record);
    if (direct !== null) return direct;
    if (typeof record === "object" && record !== null) {
      for (const v of Object.values(record as Record<string, unknown>)) {
        const n = extractNumeric(v);
        if (n !== null) return n;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Scores a numeric value against a threshold array.
 * Returns { score: 0–100, passed: boolean }.
 *
 * Mirrors scoreAgainstThreshold in useCoverageData.ts exactly.
 */
export function scoreAgainstThreshold(
  value: number,
  thresholds: Threshold[],
): { score: number; passed: boolean } {
  const target = thresholdTarget(thresholds);
  if (target.direction === "max") {
    const passed = value <= target.value;
    const score = passed
      ? 100
      : target.value <= 0
        ? 0
        : Math.max(0, Math.round((target.value / value) * 100));
    return { score, passed };
  }
  const passed = value >= target.value;
  const score =
    target.value <= 0
      ? passed ? 100 : 0
      : Math.min(100, Math.round((value / target.value) * 100));
  return { score, passed };
}

/**
 * Computes the weighted utilization score for a set of criteria results.
 * Extracted so API functions can call it without re-implementing the formula.
 *
 * Mirrors computeCapabilityUtilization in useCoverageData.ts exactly.
 */
export function computeCapabilityUtilization(
  criteriaResults: {
    score: number;
    points: number;
    error: boolean;
    notApplicable: boolean;
    tier: CriterionTier;
  }[],
): CapabilityUtilizationResult {
  const tierCounts = {
    foundation:   { total: 0, passed: 0 },
    bestPractice: { total: 0, passed: 0 },
    excellence:   { total: 0, passed: 0 },
  };
  const tierScores = {
    foundation:   { total: 0, score: 0 },
    bestPractice: { total: 0, score: 0 },
    excellence:   { total: 0, score: 0 },
  };

  for (const cr of criteriaResults) {
    if (cr.notApplicable) continue;
    const t = cr.tier;
    tierCounts[t].total++;
    tierScores[t].total++;
    tierScores[t].score += cr.score;
    if (!cr.error && cr.points > 0) tierCounts[t].passed++;
  }

  const fPct =
    tierScores.foundation.total > 0
      ? tierScores.foundation.score / tierScores.foundation.total / 100
      : 0;
  const bPct =
    tierScores.bestPractice.total > 0
      ? tierScores.bestPractice.score / tierScores.bestPractice.total / 100
      : 0;
  const ePct =
    tierScores.excellence.total > 0
      ? tierScores.excellence.score / tierScores.excellence.total / 100
      : 0;

  const fPassPct =
    tierCounts.foundation.total > 0
      ? tierCounts.foundation.passed / tierCounts.foundation.total
      : 0;
  const bPassPct =
    tierCounts.bestPractice.total > 0
      ? tierCounts.bestPractice.passed / tierCounts.bestPractice.total
      : 0;
  const ePassPct =
    tierCounts.excellence.total > 0
      ? tierCounts.excellence.passed / tierCounts.excellence.total
      : 0;

  let level: 0 | 1 | 2 | 3 = 0;
  let levelLabel = "Not Adopted";
  if (fPassPct >= 0.5) { level = 1; levelLabel = "Foundation"; }
  if (fPassPct >= 1.0 && bPassPct >= 0.5) { level = 2; levelLabel = "Operational"; }
  if (fPassPct >= 1.0 && bPassPct >= 1.0 && ePassPct >= 0.5) { level = 3; levelLabel = "Optimized"; }

  // Progressive: BP only counts when Foundation >= 80%, Excellence only when BP >= 60%
  const effB = fPct >= 0.8 ? bPct : 0;
  const effE = effB >= 0.6 ? ePct : 0;
  const utilizationScore = Math.round(
    fPct * FOUNDATION_WEIGHT + effB * BEST_PRACTICE_WEIGHT + effE * EXCELLENCE_WEIGHT,
  );
  const utilizationBand =
    utilizationScore >= 80
      ? "Excellent"
      : utilizationScore >= 60
        ? "Good"
        : utilizationScore >= 40
          ? "Moderate"
          : utilizationScore >= 20
            ? "Low"
            : "N/A";

  return {
    fPct, bPct, ePct, effB, effE,
    utilizationScore, utilizationBand,
    foundation:   tierCounts.foundation,
    bestPractice: tierCounts.bestPractice,
    excellence:   tierCounts.excellence,
    level,
    levelLabel,
  };
}
