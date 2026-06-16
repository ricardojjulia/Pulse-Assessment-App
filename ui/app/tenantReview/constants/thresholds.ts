import type { AreaStatus, MigrationLevel } from "../types/review.types";

/** Score thresholds for area health status */
export const SCORE_THRESHOLDS = {
  healthy: 80,
  needsAttention: 50,
} as const;

/** Migration percentage thresholds */
export const MIGRATION_THRESHOLDS = {
  complete: 90,
  mostly: 60,
  partial: 20,
} as const;

/** Map a 0-100 score to a status */
export function classifyStatus(score: number): AreaStatus {
  if (score >= SCORE_THRESHOLDS.healthy) return "healthy";
  if (score >= SCORE_THRESHOLDS.needsAttention) return "needs-attention";
  return "critical";
}

/** Map a 0-100 migration percentage to a level */
export function classifyMigration(percentage: number): MigrationLevel {
  if (percentage >= MIGRATION_THRESHOLDS.complete) return "complete";
  if (percentage >= MIGRATION_THRESHOLDS.mostly) return "mostly";
  if (percentage >= MIGRATION_THRESHOLDS.partial) return "partial";
  return "not-started";
}

/** Status display colors (Strato design token names) */
export const STATUS_COLORS: Record<AreaStatus, string> = {
  healthy: "success",
  "needs-attention": "warning",
  critical: "critical",
  unknown: "neutral",
};

/** Migration level display colors */
export const MIGRATION_COLORS: Record<MigrationLevel, string> = {
  complete: "success",
  mostly: "info",
  partial: "warning",
  "not-started": "neutral",
};

/** Migration level display labels */
export const MIGRATION_LABELS: Record<MigrationLevel, string> = {
  complete: "Gen3 Complete",
  mostly: "Mostly Migrated",
  partial: "Partially Migrated",
  "not-started": "Not Started",
};
