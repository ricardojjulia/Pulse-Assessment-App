/**
 * Fetch runtime application attacks via the Environment API v2 SDK.
 * Returns total count and breakdown by attack type and state.
 */
import { attacksClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface AttackResult {
  totalCount: number;
  typeCounts: Record<string, number>;
  exploitedCount: number;
  blockedCount: number;
  error?: string;
}

export default async function (): Promise<AttackResult> {
  try {
    const response = await attacksClient.getAttacks({
      from: "now-30d",
      pageSize: 500,
    });

    const attacks = response.attacks ?? [];
    const typeCounts: Record<string, number> = {};
    let exploitedCount = 0;
    let blockedCount = 0;

    for (const attack of attacks) {
      const type = attack.attackType ?? "UNKNOWN";
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;

      const state = (attack as Record<string, unknown>).state as string | undefined;
      if (state === "EXPLOITED") exploitedCount++;
      else if (state === "BLOCKED") blockedCount++;
    }

    return {
      totalCount: response.totalCount,
      typeCounts,
      exploitedCount,
      blockedCount,
    };
  } catch (err) {
    return {
      totalCount: 0,
      typeCounts: {},
      exploitedCount: 0,
      blockedCount: 0,
      error: err instanceof Error ? err.message : "Failed to query attacks",
    };
  }
}
