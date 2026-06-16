/** Severity level for a finding */
export type FindingSeverity = "critical" | "warning" | "info" | "success";

/** Gen3 migration status for an area */
export type MigrationLevel = "not-started" | "partial" | "mostly" | "complete";

/** Overall status for a review area */
export type AreaStatus = "healthy" | "needs-attention" | "critical" | "unknown";

/** A single finding within a review area */
export interface Finding {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  recommendation: string;
  /** Link to Dynatrace UI for remediation */
  actionUrl?: string;
  /** The data point that generated this finding */
  detail?: string;
}

/** Score result for one review area */
export interface AreaScore {
  /** 0-100 overall score for this area */
  value: number;
  /** Weighted importance of this area (0-1) */
  weight: number;
  /** How many checks passed vs total */
  passedChecks: number;
  totalChecks: number;
}

/** Migration metrics for one review area */
export interface MigrationMetrics {
  level: MigrationLevel;
  /** Percentage migrated to Gen3 (0-100) */
  percentage: number;
  classicCount: number;
  gen3Count: number;
  /** Human-readable summary */
  summary: string;
}

/** Complete result for one review area */
export interface ReviewAreaResult {
  areaId: string;
  status: AreaStatus;
  score: AreaScore;
  migration: MigrationMetrics;
  findings: Finding[];
  /** Timestamp of last data fetch */
  lastUpdated: Date;
  /** Is data currently loading? */
  isLoading: boolean;
  /** Error from data fetching */
  error?: string;
}

/** Metadata definition for a review area (static) */
export interface ReviewAreaDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  route: string;
  /** Relative weight for overall score (0-1) */
  weight: number;
}

/** Aggregated tenant overview */
export interface TenantOverview {
  overallScore: number;
  overallMigrationPercentage: number;
  areaResults: ReviewAreaResult[];
  criticalFindings: Finding[];
  totalFindings: number;
  areasNeedingAttention: string[];
}

/** A single scored check within a review area */
export interface Check {
  name: string;
  /** Weight of this check relative to others in the area (0-1) */
  weight: number;
  result: "pass" | "fail" | "partial";
  /** For partial results, the fractional value (0-1) */
  partialValue?: number;
}
