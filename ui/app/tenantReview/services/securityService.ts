import { securityProblemsClient } from "@dynatrace-sdk/client-classic-environment-v2";

export interface SecuritySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Get a summary of open security problems */
export async function getSecuritySummary(): Promise<SecuritySummary> {
  try {
    const response = await securityProblemsClient.getSecurityProblems({
      securityProblemSelector: "status(\"OPEN\")",
      pageSize: 1,
    });

    const total = response.totalCount ?? 0;

    // Get counts per risk level
    const [critical, high, medium, low] = await Promise.all([
      getCountByRisk("CRITICAL"),
      getCountByRisk("HIGH"),
      getCountByRisk("MEDIUM"),
      getCountByRisk("LOW"),
    ]);

    return { total, critical, high, medium, low };
  } catch {
    return { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
  }
}

async function getCountByRisk(riskLevel: string): Promise<number> {
  try {
    const response = await securityProblemsClient.getSecurityProblems({
      securityProblemSelector: `status("OPEN"),riskLevel("${riskLevel}")`,
      pageSize: 1,
    });
    return response.totalCount ?? 0;
  } catch {
    return 0;
  }
}
