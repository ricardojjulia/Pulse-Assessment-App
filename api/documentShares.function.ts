/**
 * Fetch document sharing data via the Document SDK.
 * Returns share count and overshared documents.
 */
import { directSharesClient } from "@dynatrace-sdk/client-document";

interface DocumentShareResult {
  totalShares: number;
  oversharedCount: number;
  error?: string;
}

export default async function (): Promise<DocumentShareResult> {
  try {
    const response = await directSharesClient.listDirectShares({
      pageSize: 500,
    });

    const shares = response["direct-shares"] ?? [];
    let oversharedCount = 0;

    for (const share of shares) {
      if ((share.userCount ?? 0) > 20) {
        oversharedCount++;
      }
    }

    return {
      totalShares: response.totalCount,
      oversharedCount,
    };
  } catch (err) {
    return {
      totalShares: 0,
      oversharedCount: 0,
      error: err instanceof Error ? err.message : "Failed to query document shares",
    };
  }
}
