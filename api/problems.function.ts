/**
 * Fetch recent problems via the Environment API v2 SDK.
 * Returns open count, total count (30d), and impact distribution.
 */
import { problemsClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface ProblemSummary {
  totalCount: number;
  openCount: number;
  impactCounts: {
    application: number;
    services: number;
    infrastructure: number;
    environment: number;
  };
  error?: string;
}

export default async function (): Promise<ProblemSummary> {
  try {
    // Fetch all problems from last 30 days
    const allProblems = await problemsClient.getProblems({
      from: "now-30d",
      pageSize: 500,
      fields: "+impactLevel,+status",
    });

    // Fetch open problems specifically
    const openProblems = await problemsClient.getProblems({
      problemSelector: "status(\"OPEN\")",
      pageSize: 1,
    });

    const problems = allProblems.problems ?? [];
    const impactCounts = { application: 0, services: 0, infrastructure: 0, environment: 0 };

    for (const p of problems) {
      const impact = p.impactLevel ?? "";
      if (impact === "APPLICATION") impactCounts.application++;
      else if (impact === "SERVICES") impactCounts.services++;
      else if (impact === "INFRASTRUCTURE") impactCounts.infrastructure++;
      else if (impact === "ENVIRONMENT") impactCounts.environment++;
    }

    return {
      totalCount: allProblems.totalCount,
      openCount: openProblems.totalCount,
      impactCounts,
    };
  } catch (err) {
    return {
      totalCount: 0,
      openCount: 0,
      impactCounts: { application: 0, services: 0, infrastructure: 0, environment: 0 },
      error: err instanceof Error ? err.message : "Failed to query problems",
    };
  }
}
