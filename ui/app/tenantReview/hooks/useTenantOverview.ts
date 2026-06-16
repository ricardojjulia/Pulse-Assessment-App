import type { TenantOverview, ReviewAreaResult } from "../types/review.types";
import { calculateOverallScore, calculateOverallMigration } from "../utils/scoring";
import { useSettingsReview } from "../areas/settings.data";
import { useExtensionsReview } from "../areas/extensions.data";
import { useDashboardsReview } from "../areas/dashboards.data";
import { useAlertingReview } from "../areas/alerting.data";
import { useMonitoringReview } from "../areas/monitoring.data";
import { useStorageReview } from "../areas/storage.data";
import { useAutomationReview } from "../areas/automation.data";
import { useTaggingReview } from "../areas/tagging.data";
import { useApiAccessReview } from "../areas/apiAccess.data";
import { useSecurityReview } from "../areas/security.data";
import { useSyntheticReview } from "../areas/synthetic.data";
import { useRumReview } from "../areas/rum.data";
import { useLogMonitoringReview } from "../areas/logs.data";
import { useMetricsReview } from "../areas/metrics.data";

/** Call all 14 review area hooks and collect results */
function useAllAreaResults(): ReviewAreaResult[] {
  const monitoring = useMonitoringReview();
  const settings = useSettingsReview();
  const storage = useStorageReview();
  const alerting = useAlertingReview();
  const dashboards = useDashboardsReview();
  const extensions = useExtensionsReview();
  const automation = useAutomationReview();
  const tagging = useTaggingReview();
  const apiAccess = useApiAccessReview();
  const security = useSecurityReview();
  const synthetic = useSyntheticReview();
  const rum = useRumReview();
  const logs = useLogMonitoringReview();
  const metrics = useMetricsReview();

  return [
    monitoring, settings, storage, alerting, dashboards, extensions,
    automation, tagging, apiAccess, security, synthetic, rum, logs, metrics,
  ];
}

export function useTenantOverview(): TenantOverview {
  const allResults = useAllAreaResults();

  const overallScore = calculateOverallScore(allResults);
  const overallMigrationPercentage = calculateOverallMigration(allResults);

  const criticalFindings = allResults
    .flatMap((r) => r.findings)
    .filter((f) => f.severity === "critical");

  const totalFindings = allResults.reduce(
    (sum, r) => sum + r.findings.length,
    0
  );

  const areasNeedingAttention = allResults
    .filter((r) => r.status === "critical" || r.status === "needs-attention")
    .map((r) => r.areaId);

  return {
    overallScore,
    overallMigrationPercentage,
    areaResults: allResults,
    criticalFindings,
    totalFindings,
    areasNeedingAttention,
  };
}
