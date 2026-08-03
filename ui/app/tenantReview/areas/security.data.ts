import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsEnabledCounts } from "../services/settingsService";
import type { EnabledCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";

/**
 * Security review area.
 *
 * Checks:
 * 1. Critical security events (Grail events, last 30d)
 * 2. High-severity security events manageable
 * 3. Attack protection configured (Settings 2.0)
 * 4. Security event monitoring active
 * 5. Audit log activity (config change trail, last 7d)
 * 6. Audit log change categories (diversity of audited actions)
 *
 * Migration metric: Application Security is Gen3-native.
 */
export function useSecurityReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "security",
    status: "unknown",
    score: { value: 0, weight: 1.0, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  // Query security events and audit logs from Grail
  const securityEvents = useDql(DQL_QUERIES.securityEvents);
  const auditVolume = useDql(DQL_QUERIES.auditLogVolume);
  const auditCategories = useDql(DQL_QUERIES.auditLogByCategory);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (securityEvents.isLoading || securityEvents.isPending) return;
    if (auditVolume.isLoading || auditVolume.isPending) return;
    if (auditCategories.isLoading || auditCategories.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        const settingsCounts = await getSettingsEnabledCounts([
          SETTINGS_SCHEMAS.attackProtection,
          SETTINGS_SCHEMAS.runtimeVulnDetection,
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        // --- Security Events ---
        const row = (securityEvents.data?.records?.[0] ?? {}) as Record<string, unknown>;
        const total = Number(row["total"] ?? 0);
        const critical = Number(row["critical"] ?? 0);
        const high = Number(row["high"] ?? 0);
        const medium = Number(row["medium"] ?? 0);
        const low = Number(row["low"] ?? 0);

        // Check 1: Critical security events
        if (config.criticalSecurityEvents.enabled) {
          checks.push({
            name: "No critical security events",
            weight: config.criticalSecurityEvents.weight,
            result: critical === 0 ? "pass" : "fail",
          });
          if (critical > 0) {
            findings.push({
              id: "sec-critical-events",
              title: `${critical} critical security event(s) in last 30 days`,
              description: "Critical security events require immediate attention.",
              severity: getGen2Severity(critical, config.criticalSecurityEvents),
              recommendation: "Review and remediate critical security events immediately.",
            });
          }
        }

        // Check 2: High-severity security events
        if (config.highSecurityEvents.enabled) {
          checks.push({
            name: "High-severity events manageable",
            weight: config.highSecurityEvents.weight,
            result: high === 0 ? "pass" : high <= 5 ? "partial" : "fail",
            partialValue: high <= 5 ? 1 - (high / 10) : undefined,
          });
          if (high > 0) {
            findings.push({
              id: "sec-high-events",
              title: `${high} high-severity security event(s) in last 30 days`,
              description: "High-severity security events should be prioritized for remediation.",
              severity: getGen2Severity(high, config.highSecurityEvents),
              recommendation: "Plan remediation for high-severity security events.",
            });
          }
        }

        // Check 3: Application Security configured and enabled
        const attackProtectionData = (settingsCounts.get(SETTINGS_SCHEMAS.attackProtection) as EnabledCounts | null | undefined) ?? null;
        const runtimeVulnData = (settingsCounts.get(SETTINGS_SCHEMAS.runtimeVulnDetection) as EnabledCounts | null | undefined) ?? null;
        const attackProtectionTotal = attackProtectionData?.total ?? 0;
        const attackProtection = attackProtectionData?.enabled ?? 0;
        const attackProtectionDisabled = attackProtectionData?.disabled ?? 0;
        const runtimeVulnTotal = runtimeVulnData?.total ?? 0;
        const runtimeVulnEnabled = runtimeVulnData?.enabled ?? 0;
        const runtimeVulnDisabled = runtimeVulnData?.disabled ?? 0;
        const appSecSettingsAccessible = attackProtectionData !== null || runtimeVulnData !== null;
        const appSecEnabled = attackProtection > 0 || runtimeVulnEnabled > 0;
        const appSecConfigured = attackProtectionTotal > 0 || runtimeVulnTotal > 0;
        const appSecDisabled = attackProtectionDisabled + runtimeVulnDisabled;
        checks.push({
          name: "Application Security enabled in settings",
          weight: 0.15,
          result: !appSecSettingsAccessible ? "partial" : appSecEnabled ? "pass" : appSecConfigured ? "fail" : "partial",
          partialValue: !appSecSettingsAccessible ? 0.3 : !appSecConfigured ? 0.3 : undefined,
        });
        if (!appSecSettingsAccessible) {
          findings.push({
            id: "sec-appsec-settings-inaccessible",
            title: "Cannot verify Application Security settings",
            description: "The app could not read AppSec Settings 2.0 objects, so enabled/disabled state could not be confirmed.",
            severity: "warning",
            recommendation: "Verify settings:objects:read access and review builtin:appsec.attack-protection-settings and builtin:appsec.runtime-vulnerability-detection manually.",
          });
        } else if (appSecConfigured && !appSecEnabled) {
          findings.push({
            id: "sec-appsec-disabled",
            title: "Application Security settings are configured but disabled",
            description: `Attack protection: ${attackProtection} enabled / ${attackProtectionDisabled} disabled. Runtime vulnerability detection: ${runtimeVulnEnabled} enabled / ${runtimeVulnDisabled} disabled.`,
            severity: "warning",
            recommendation: "Turn on Application Security for in-scope services, or mark AppSec out of scope before treating this tenant as actively protected.",
          });
        } else if (!appSecConfigured) {
          findings.push({
            id: "sec-no-attack-protection",
            title: "Application Security not explicitly configured",
            description: "No attack protection or runtime vulnerability detection settings were found.",
            severity: "info",
            recommendation: "Review AppSec settings: builtin:appsec.attack-protection-settings and builtin:appsec.runtime-vulnerability-detection.",
          });
        }

        // Check 4: Security event monitoring active
        checks.push({
          name: "Security event usage in last 30 days",
          weight: 0.1,
          result: securityEvents.error ? "partial" : total > 0 ? "pass" : "fail",
          partialValue: securityEvents.error ? 0.3 : undefined,
        });
        if (securityEvents.error) {
          findings.push({
            id: "sec-events-error",
            title: "Cannot query security events",
            description: "Security event analysis is unavailable, so Application Security utilization could not be confirmed.",
            severity: "warning",
            recommendation: "Verify the app has access to security events in Grail and that the tenant stores security signals in events.",
          });
        } else if (total === 0) {
          findings.push({
            id: "sec-no-events-30d",
            title: "No security events detected in the last 30 days",
            description: "The security event datasource is reachable, but no recent AppSec usage signal was found. Do not treat this as active utilization without separate configuration evidence.",
            severity: appSecEnabled ? "info" : "warning",
            recommendation: appSecEnabled
              ? "Confirm protected services have recent traffic and that vulnerability/attack events are routed to Grail."
              : "Enable and validate Application Security for in-scope services, then re-check after traffic has flowed.",
          });
        }

        // --- Audit Logs ---
        const auditRow = (auditVolume.data?.records?.[0] ?? {}) as Record<string, unknown>;
        const auditTotal = Number(auditRow["total"] ?? auditRow["count()"] ?? 0);
        const auditCatRecords = (auditCategories.data?.records ?? []) as Record<string, unknown>[];
        const auditCatCount = auditCatRecords.length;
        const auditAccessible = !auditVolume.error;

        // Check 5: Audit log activity (shows governance health)
        checks.push({
          name: "Audit log trail active",
          weight: 0.2,
          result: !auditAccessible ? "partial" : auditTotal > 0 ? "pass" : "fail",
          partialValue: !auditAccessible ? 0.3 : undefined,
        });
        if (auditVolume.error) {
          findings.push({
            id: "sec-audit-error",
            title: "Cannot access audit logs",
            description: "The app may not have the storage:audit-logs:read scope. Audit log analysis is unavailable.",
            severity: "warning",
            recommendation: "Verify storage:audit-logs:read scope is configured for this app.",
          });
        } else if (auditTotal === 0) {
          findings.push({
            id: "sec-no-audit",
            title: "No audit log entries found (last 7 days)",
            description: "No configuration changes detected. This could indicate a stale environment or audit logging issues.",
            severity: "info",
            recommendation: "Verify audit logging is enabled and review tenant activity.",
          });
        } else {
          findings.push({
            id: "sec-audit-volume",
            title: `${auditTotal.toLocaleString()} audit log entries (last 7 days)`,
            description: `${auditCatCount} distinct event categories. Active configuration changes indicate a maintained environment.`,
            severity: "info",
            recommendation: "Review audit logs periodically for unauthorized or unexpected configuration changes.",
          });
        }

        // Check 6: Audit category diversity (broad auditing coverage)
        checks.push({
          name: "Audit log category coverage",
          weight: 0.15,
          result: !auditAccessible ? "partial" : auditCatCount >= 5 ? "pass" : auditCatCount >= 2 ? "partial" : "fail",
          partialValue: !auditAccessible ? 0.3 : auditCatCount >= 2 ? Math.min(auditCatCount / 5, 0.8) : undefined,
        });
        if (auditAccessible && auditCatCount > 0 && auditCatCount < 5) {
          findings.push({
            id: "sec-audit-narrow",
            title: `Only ${auditCatCount} audit event categories detected`,
            description: `Audit categories: ${auditCatRecords.map((r) => `${String(r["event.type"])}: ${Number(r["eventCount"] ?? r["count()"] ?? 0).toLocaleString()}`).join(", ")}`,
            severity: "info",
            recommendation: "Ensure comprehensive audit logging across settings, tokens, user access, and integrations.",
          });
        } else if (auditAccessible && auditCatCount >= 5) {
          findings.push({
            id: "sec-audit-broad",
            title: `${auditCatCount} audit event categories — good coverage`,
            description: `Top categories: ${auditCatRecords.slice(0, 5).map((r) => `${String(r["event.type"])}: ${Number(r["eventCount"] ?? r["count()"] ?? 0).toLocaleString()}`).join(", ")}`,
            severity: "success",
            recommendation: "Continue monitoring audit logs for anomalous activity patterns.",
          });
        }

        // Check 7: Runtime attacks (AppSec)
        if (config.attacksDetected.enabled) {
          try {
            const attackResponse = await functions.call("attacks");
            const attackResult = (await attackResponse.json()) as {
              totalCount: number; typeCounts: Record<string, number>;
              exploitedCount: number; blockedCount: number; error?: string;
            };

            if (!attackResult.error) {
              const attackTotal = attackResult.totalCount;
              checks.push({
                name: "Runtime attack protection signal",
                weight: config.attacksDetected.weight,
                result: attackTotal > 0 ? "pass" : appSecEnabled ? "partial" : "fail",
                partialValue: attackTotal === 0 && appSecEnabled ? 0.6 : undefined,
              });

              if (attackTotal === 0) {
                findings.push({
                  id: "sec-no-attacks",
                  title: "No runtime attacks detected (30d)",
                  description: appSecEnabled
                    ? "Application Security is configured but no attacks were detected. This may be normal for low-traffic or internal applications."
                    : "No attacks detected and no attack protection configured. If you have web-facing applications, enable Application Security.",
                  severity: appSecEnabled ? "info" : "warning",
                  recommendation: appSecEnabled
                    ? "Continue monitoring. Review Application Security settings periodically."
                    : "Enable Runtime Application Protection to detect SQL injection, SSRF, command injection, and JNDI attacks.",
                });
              } else {
                const typeBreakdown = Object.entries(attackResult.typeCounts)
                  .map(([type, count]) => `${type}: ${count}`)
                  .join(", ");

                findings.push({
                  id: "sec-attacks-detected",
                  title: `${attackTotal} runtime attack(s) detected (30d)`,
                  description: `Types: ${typeBreakdown}. Blocked: ${attackResult.blockedCount}, Exploited: ${attackResult.exploitedCount}.`,
                  severity: attackResult.exploitedCount > 0 ? "critical" : "warning",
                  recommendation: attackResult.exploitedCount > 0
                    ? "URGENT: Exploited attacks detected. Review affected entities and remediate vulnerabilities immediately."
                    : "Attacks are being blocked. Review attack patterns and strengthen WAF rules or input validation.",
                });

                if (attackResult.exploitedCount > 0) {
                  findings.push({
                    id: "sec-exploited-attacks",
                    title: `${attackResult.exploitedCount} EXPLOITED attack(s) — immediate action required`,
                    description: "These attacks bypassed protection and reached the application. The affected services may be compromised.",
                    severity: "critical",
                    recommendation: "Investigate exploited attacks immediately. Patch affected applications, review input validation, and enable blocking mode in Application Security.",
                  });
                }
              }
            }
          } catch {
            // Attacks API not accessible — skip silently
          }
        }

        // Summary
        findings.push({
          id: "sec-summary",
          title: `Security: ${total} security events (${critical}C/${high}H/${medium}M/${low}L), ${auditTotal.toLocaleString()} audit entries`,
          description: `AppSec enabled configs: ${attackProtection + runtimeVulnEnabled}; disabled configs: ${appSecDisabled}. Audit categories: ${auditCatCount}. Security and audit data sourced from Grail and Settings 2.0.`,
          severity: "info",
          recommendation: "Maintain regular security reviews, audit log monitoring, and keep vulnerability count low.",
        });

        const area = REVIEW_AREA_MAP.get("security")!;
        const areaWeight = getAreaWeight(config, "security");
        const score = calculateAreaScore(checks, areaWeight);

        // Security + audit are Gen3-native
        const gen3Signals = (total > 0 || appSecEnabled ? 1 : 0) + (auditTotal > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          0,
          gen3Signals,
          "Application Security and Audit Logging are Gen3-native ({pct}%)"
        );

        setResult({
          areaId: "security",
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
            error: err instanceof Error ? err.message : "Failed to analyze security",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    securityEvents.isLoading, securityEvents.isPending, securityEvents.data, securityEvents.error,
    auditVolume.isLoading, auditVolume.isPending, auditVolume.data, auditVolume.error,
    auditCategories.isLoading, auditCategories.isPending, auditCategories.data,
  ]);

  return result;
}
