/**
 * Fetch credential vault inventory via the Environment API v2 SDK.
 * Returns count and breakdown by credential type.
 */
import { credentialVaultClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface CredentialVaultResult {
  totalCount: number;
  typeCounts: Record<string, number>;
  hasAwsKeyBased: boolean;
  error?: string;
}

export default async function (): Promise<CredentialVaultResult> {
  try {
    const response = await credentialVaultClient.listCredentials({
      pageSize: 500,
    });

    const credentials = response.credentials ?? [];
    const typeCounts: Record<string, number> = {};
    let hasAwsKeyBased = false;

    for (const cred of credentials) {
      const type = cred.type ?? "UNKNOWN";
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      if (type === "AWS_MONITORING_KEY_BASED") {
        hasAwsKeyBased = true;
      }
    }

    return {
      totalCount: response.totalCount ?? credentials.length,
      typeCounts,
      hasAwsKeyBased,
    };
  } catch (err) {
    return {
      totalCount: 0,
      typeCounts: {},
      hasAwsKeyBased: false,
      error: err instanceof Error ? err.message : "Failed to query credential vault",
    };
  }
}
