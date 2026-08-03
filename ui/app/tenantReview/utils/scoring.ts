import type {
  AreaScore,
  AreaStatus,
  Check,
  MigrationLevel,
  MigrationMetrics,
  ReviewAreaResult,
} from "../types/review.types";
import { classifyMigration, classifyStatus } from "../constants/thresholds";

/** Calculate area score from an array of checks */
export function calculateAreaScore(
  checks: Check[],
  areaWeight: number
): AreaScore {
  if (checks.length === 0) {
    return { value: 0, weight: areaWeight, passedChecks: 0, totalChecks: 0 };
  }

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  let weightedSum = 0;
  let passedChecks = 0;

  for (const check of checks) {
    const normalizedWeight = check.weight / totalWeight;
    if (check.result === "pass") {
      weightedSum += normalizedWeight * 100;
      passedChecks++;
    } else if (check.result === "partial" && check.partialValue !== undefined) {
      weightedSum += normalizedWeight * check.partialValue * 100;
      if (check.partialValue >= 0.5) passedChecks++;
    }
  }

  return {
    value: Math.round(weightedSum),
    weight: areaWeight,
    passedChecks,
    totalChecks: checks.length,
  };
}

/** Calculate overall score from all area results (weighted average) */
export function calculateOverallScore(areas: ReviewAreaResult[]): number {
  const scored = areas.filter((a) => a.status !== "unknown");
  if (scored.length === 0) return 0;

  const totalWeight = scored.reduce((sum, a) => sum + a.score.weight, 0);
  const weightedSum = scored.reduce(
    (sum, a) => sum + a.score.value * a.score.weight,
    0
  );

  return Math.round(weightedSum / totalWeight);
}

/** Calculate overall migration percentage from all area results */
export function calculateOverallMigration(areas: ReviewAreaResult[]): number {
  const scored = areas.filter((a) => a.status !== "unknown");
  if (scored.length === 0) return 0;

  const totalWeight = scored.reduce((sum, a) => sum + a.score.weight, 0);
  const weightedSum = scored.reduce(
    (sum, a) => sum + a.migration.percentage * a.score.weight,
    0
  );

  return Math.round(weightedSum / totalWeight);
}

/** Build migration metrics from classic vs gen3 counts */
export function buildMigrationMetrics(
  classicCount: number,
  gen3Count: number,
  summaryTemplate: string
): MigrationMetrics {
  const total = classicCount + gen3Count;
  const percentage = total > 0 ? Math.round((gen3Count / total) * 100) : 0;

  return {
    level: classifyMigration(percentage),
    percentage,
    classicCount,
    gen3Count,
    summary: summaryTemplate
      .replace("{classic}", String(classicCount))
      .replace("{gen3}", String(gen3Count))
      .replace("{pct}", String(percentage)),
  };
}

/** Create an "unknown" result for areas not yet implemented */
export function createUnknownResult(areaId: string): ReviewAreaResult {
  return {
    areaId,
    status: "unknown",
    score: { value: 0, weight: 0, passedChecks: 0, totalChecks: 0 },
    migration: {
      level: "not-started",
      percentage: 0,
      classicCount: 0,
      gen3Count: 0,
      summary: "Analysis not yet implemented",
    },
    findings: [],
    lastUpdated: new Date(),
    isLoading: false,
  };
}

export { classifyStatus, classifyMigration };
export type { AreaStatus, MigrationLevel };
