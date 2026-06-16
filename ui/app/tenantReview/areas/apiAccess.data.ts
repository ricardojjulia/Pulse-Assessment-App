import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getTokenSummary } from "../services/tokenService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";

export function useApiAccessReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "api-access",
    status: "unknown",
    score: { value: 0, weight: 0.9, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const tokenSummary = await getTokenSummary();
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const tokensAccessible = tokenSummary !== null;
        const { totalCount, enabledCount, tokens } = tokenSummary ?? { totalCount: 0, enabledCount: 0, tokens: [] };

        // Check 1: Token inventory accessible
        checks.push({
          name: "API token inventory accessible",
          weight: 0.2,
          result: tokensAccessible ? "pass" : "partial",
          partialValue: tokensAccessible ? undefined : 0,
        });
        if (!tokensAccessible) {
          findings.push({
            id: "api-no-access",
            title: "Cannot access API token inventory",
            description: "The app does not have permission to list API tokens. Review results may be incomplete.",
            severity: "warning",
            recommendation: "Grant the platform-token:tokens:read scope to this app.",
          });
        }

        // Check 2: Token count reasonable
        if (config.apiTokens.enabled) {
          checks.push({
            name: "API token count manageable",
            weight: config.apiTokens.weight,
            result: totalCount <= 20 ? "pass" : totalCount <= 50 ? "partial" : "fail",
            partialValue: totalCount <= 50 ? 1 - (totalCount / 100) : undefined,
          });
          if (totalCount > 50) {
            findings.push({
              id: "api-many-tokens",
              title: `${totalCount} API tokens found`,
              description: "A large number of API tokens increases the security surface area.",
              severity: getGen2Severity(totalCount, config.apiTokens),
              recommendation: "Audit tokens and remove unused ones. Consider migrating to OAuth 2.0 for Gen3 platform API access.",
            });
          }
        }

        // Check 3: Disabled tokens (should be cleaned up)
        const disabledCount = totalCount - enabledCount;
        if (config.disabledTokens.enabled) {
          checks.push({
            name: "Disabled tokens cleaned up",
            weight: config.disabledTokens.weight,
            result: disabledCount === 0 ? "pass" : disabledCount <= 5 ? "partial" : "fail",
            partialValue: disabledCount <= 5 ? 1 - (disabledCount / 10) : undefined,
          });
          if (disabledCount > 0) {
            findings.push({
              id: "api-disabled-tokens",
              title: `${disabledCount} disabled API token(s)`,
              description: "Disabled tokens should be deleted to maintain a clean token inventory.",
              severity: getGen2Severity(disabledCount, config.disabledTokens),
              recommendation: "Delete disabled API tokens that are no longer needed.",
            });
          }
        }

        // Check 4: Token scope analysis (v1 vs v2 scopes)
        const v1Scopes = ["ReadConfig", "WriteConfig", "DataExport", "MaintenanceWindows"];
        let tokensWithV1Scopes = 0;
        for (const token of tokens) {
          if (token.scopes.some((s) => v1Scopes.includes(s))) {
            tokensWithV1Scopes++;
          }
        }
        checks.push({
          name: "Tokens use v2 API scopes",
          weight: 0.25,
          result: tokensWithV1Scopes === 0 ? "pass" : tokensWithV1Scopes <= 3 ? "partial" : "fail",
          partialValue: tokensWithV1Scopes <= 3 ? 1 - (tokensWithV1Scopes / enabledCount || 0) : undefined,
        });
        if (tokensWithV1Scopes > 0) {
          findings.push({
            id: "api-v1-scopes",
            title: `${tokensWithV1Scopes} token(s) use v1 API scopes`,
            description: "Tokens with v1 scopes (ReadConfig, WriteConfig, etc.) target deprecated APIs.",
            severity: "warning",
            recommendation: "Migrate tokens to v2 API scopes. For Gen3 platform APIs, use OAuth 2.0 clients.",
          });
        }

        // Check 5: Credential vault inventory
        if (config.credentialVaultItems.enabled) {
          try {
            const vaultResponse = await functions.call("credentialVault");
            const vaultResult = (await vaultResponse.json()) as {
              totalCount: number; typeCounts: Record<string, number>; hasAwsKeyBased: boolean; error?: string;
            };

            if (!vaultResult.error) {
              const vaultCount = vaultResult.totalCount;
              checks.push({
                name: "Credential vault adoption",
                weight: config.credentialVaultItems.weight,
                result: vaultCount >= config.credentialVaultItems.criticalMax ? "pass" :
                  vaultCount >= config.credentialVaultItems.warningMax ? "partial" : "fail",
                partialValue: vaultCount > 0 ? Math.min(0.4 + (vaultCount * 0.1), 0.9) : undefined,
              });

              if (vaultCount === 0) {
                findings.push({
                  id: "api-no-vault",
                  title: "No credentials in vault",
                  description: "The credential vault is empty. Extensions and integrations using inline credentials are harder to rotate and audit.",
                  severity: "warning",
                  recommendation: "Store credentials in the vault for centralized management, rotation, and audit trails.",
                });
              } else {
                const typeBreakdown = Object.entries(vaultResult.typeCounts)
                  .map(([type, count]) => `${type}: ${count}`)
                  .join(", ");
                findings.push({
                  id: "api-vault-inventory",
                  title: `${vaultCount} credential(s) in vault`,
                  description: `Credential types: ${typeBreakdown}.`,
                  severity: getGen3Severity(vaultCount, config.credentialVaultItems),
                  recommendation: "Review credentials regularly. Rotate secrets on schedule and remove unused entries.",
                });
              }

              if (vaultResult.hasAwsKeyBased) {
                findings.push({
                  id: "api-aws-key-based",
                  title: "AWS key-based credentials found — consider role-based",
                  description: "Key-based AWS credentials require manual key rotation. Role-based authentication is more secure.",
                  severity: "warning",
                  recommendation: "Migrate to AWS role-based monitoring credentials (IAM roles) to eliminate key rotation overhead.",
                });
              }
            }
          } catch {
            // Credential vault not accessible — skip silently
          }
        }

        // Check 6: OAuth adoption guidance
        checks.push({
          name: "OAuth adoption assessment",
          weight: 0.2,
          result: "partial",
          partialValue: 0.5,
        });
        findings.push({
          id: "api-oauth",
          title: "Evaluate OAuth 2.0 adoption",
          description: "Gen3 platform APIs use OAuth 2.0 for authentication. API tokens are the classic approach.",
          severity: "info",
          recommendation: "For new integrations, use OAuth 2.0 clients instead of API tokens. This is required for Dynatrace App and platform API access.",
        });

        // Summary
        findings.push({
          id: "api-summary",
          title: `API access summary: ${enabledCount} active tokens, ${disabledCount} disabled`,
          description: `Total: ${totalCount} tokens. ${tokensWithV1Scopes} use v1 scopes.`,
          severity: "info",
          recommendation: "Regularly audit API tokens and migrate to OAuth 2.0 for Gen3 readiness.",
        });

        const area = REVIEW_AREA_MAP.get("api-access")!;
        const areaWeight = getAreaWeight(config, "api-access");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: API tokens are classic; OAuth is Gen3
        const migration = buildMigrationMetrics(
          enabledCount, // Classic API tokens
          0, // Can't count OAuth clients from this API
          "{classic} classic API tokens — OAuth 2.0 adoption recommended ({pct}%)"
        );

        setResult({
          areaId: "api-access",
          status: classifyStatus(score.value),
          score,
          migration,
          findings,
          lastUpdated: new Date(),
          isLoading: false,
        });
      } catch (err) {
        if (!cancelled) {
          setResult((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to analyze API access",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
