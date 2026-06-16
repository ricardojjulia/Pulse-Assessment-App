/**
 * Placeholder for classic dashboard counting.
 *
 * The Config API v1 (/api/config/v1/dashboards) is NOT accessible from
 * Dynatrace Apps. The platform proxy does not expose Config API v1 endpoints,
 * and direct calls to live.dynatrace.com require an API token (not OAuth).
 *
 * Returns -1 to indicate the count is unavailable.
 */

interface ClassicDashboardResult {
  totalCount: number;
  error: string;
}

export default async function (): Promise<ClassicDashboardResult> {
  return {
    totalCount: -1,
    error: "Config API v1 is not accessible from Dynatrace Apps (no platform proxy, OAuth not supported on live API)",
  };
}
