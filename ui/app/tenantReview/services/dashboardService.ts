import { documentsClient, environmentSharesClient } from "@dynatrace-sdk/client-document";
import { functions } from "@dynatrace-sdk/app-utils";
import { getCached, setCache } from "../utils/cache";

export interface DashboardSummary {
  grailDashboardCount: number;
  notebookCount: number;
  classicDashboardCount: number;
  classicError?: string;
  sharedDocumentCount: number;
}

/** Count documents of a given type. Returns 0 on error. */
async function countDocumentsByType(type: string): Promise<number> {
  try {
    const response = await documentsClient.listDocuments({
      filter: `type=='${type}'`,
      pageSize: 1,
    });
    return response.totalCount ?? response.documents?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Count classic dashboards via Config API v1 app function. Returns { count, error }. Timeout after 5s. */
async function countClassicDashboards(): Promise<{ count: number; error?: string }> {
  try {
    const timeout = new Promise<Response>((_, reject) =>
      setTimeout(() => { reject(new Error("timeout")); }, 5000)
    );
    const response = await Promise.race([
      functions.call("classicDashboards"),
      timeout,
    ]);
    const result = (await response.json()) as { totalCount: number; error?: string };
    return { count: result.totalCount ?? -1, error: result.error };
  } catch (err) {
    return { count: -1, error: err instanceof Error ? err.message : "Function call failed" };
  }
}

/** Count environment shares. Returns totalCount or 0 on error. */
async function countEnvironmentShares(): Promise<number> {
  try {
    const response = await environmentSharesClient.listEnvironmentShares({
      pageSize: 1,
    });
    return response.totalCount ?? 0;
  } catch {
    return 0;
  }
}

/** Count Grail dashboards, notebooks, classic dashboards, and shared documents. Cached for 5 minutes. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const cacheKey = "dashboards:summary";
  const cached = getCached<DashboardSummary>(cacheKey);
  if (cached) return cached;

  const [grailDashboardCount, notebookCount, classicResult, sharedDocumentCount] = await Promise.all([
    countDocumentsByType("dashboard"),
    countDocumentsByType("notebook"),
    countClassicDashboards(),
    countEnvironmentShares(),
  ]);

  const summary: DashboardSummary = {
    grailDashboardCount,
    notebookCount,
    classicDashboardCount: classicResult.count,
    classicError: classicResult.error,
    sharedDocumentCount,
  };
  setCache(cacheKey, summary);
  return summary;
}
