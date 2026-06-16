import { metricsClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface MetricsCheckResult {
  calculatedServiceMetrics: number;
  extensionConfigurations: number;
  error?: string;
}

export default async function (): Promise<MetricsCheckResult> {
  let calculatedServiceMetrics = 0;
  let extensionConfigurations = 0;

  try {
    // Count calculated service metrics (calc:service.*)
    const calcResponse = await metricsClient.allMetrics({
      metricSelector: "calc:service.*",
      pageSize: 1,
      acceptType: "application/json; charset=utf-8",
    });
    calculatedServiceMetrics = calcResponse.totalCount ?? 0;
  } catch {
    // May not have permission
  }

  try {
    // Count extension monitoring configurations via SFM metric
    const extResponse = await metricsClient.allMetrics({
      metricSelector: "dsfm:extension.extensions_monitoring_configuration_count",
      pageSize: 1,
      acceptType: "application/json; charset=utf-8",
    });
    extensionConfigurations = extResponse.totalCount ?? 0;
  } catch {
    // May not have permission
  }

  return { calculatedServiceMetrics, extensionConfigurations };
}
