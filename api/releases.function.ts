/**
 * Fetch release tracking data via the Environment API v2 SDK.
 * Returns release count and releases with problems.
 */
import { releasesClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface ReleaseResult {
  totalCount: number;
  releasesWithProblems: number;
  error?: string;
}

export default async function (): Promise<ReleaseResult> {
  try {
    const response = await releasesClient.getReleases({
      from: "now-30d",
      pageSize: 500,
    });

    return {
      totalCount: response.totalCount,
      releasesWithProblems: response.releasesWithProblems ?? 0,
    };
  } catch (err) {
    return {
      totalCount: 0,
      releasesWithProblems: 0,
      error: err instanceof Error ? err.message : "Failed to query releases",
    };
  }
}
