/**
 * Fetch workflow execution history via the Automation SDK.
 * Returns execution counts by state and trigger type.
 */
import { executionsClient } from "@dynatrace-sdk/client-automation";

interface ExecutionResult {
  totalCount: number;
  successCount: number;
  errorCount: number;
  cancelledCount: number;
  triggerTypeCounts: Record<string, number>;
  workflowsWithExecutions: number;
  error?: string;
}

export default async function (): Promise<ExecutionResult> {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const response = await executionsClient.getExecutions({
      startedAtGte: thirtyDaysAgo.toISOString(),
      limit: 500,
    });

    const executions = response.results ?? [];
    let successCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;
    const triggerTypeCounts: Record<string, number> = {};
    const workflowIds = new Set<string>();

    for (const exec of executions) {
      if (exec.state === "SUCCESS") successCount++;
      else if (exec.state === "ERROR") errorCount++;
      else if (exec.state === "CANCELLED") cancelledCount++;

      const triggerType = exec.triggerType ?? "Unknown";
      triggerTypeCounts[triggerType] = (triggerTypeCounts[triggerType] ?? 0) + 1;

      if (exec.workflow) workflowIds.add(exec.workflow);
    }

    return {
      totalCount: response.count,
      successCount,
      errorCount,
      cancelledCount,
      triggerTypeCounts,
      workflowsWithExecutions: workflowIds.size,
    };
  } catch (err) {
    return {
      totalCount: 0,
      successCount: 0,
      errorCount: 0,
      cancelledCount: 0,
      triggerTypeCounts: {},
      workflowsWithExecutions: 0,
      error: err instanceof Error ? err.message : "Failed to query workflow executions",
    };
  }
}
