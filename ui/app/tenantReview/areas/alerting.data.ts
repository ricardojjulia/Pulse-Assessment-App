import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts, getSettingsEnabledCounts } from "../services/settingsService";
import type { EnabledCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";

export function useAlertingReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "alerting",
    status: "unknown",
    score: { value: 0, weight: 1.0, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  // Fetch recent problem count and Davis events via DQL
  const recentProblems = useDql(DQL_QUERIES.recentProblems);
  const davisEventsResult = useDql(DQL_QUERIES.davisEvents);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (recentProblems.isLoading || recentProblems.isPending) return;
    if (davisEventsResult.isLoading || davisEventsResult.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        // Fetch enabled/disabled breakdown for Gen2 schemas, regular counts for Gen3
        const [enabledCounts, simpleCounts] = await Promise.all([
          getSettingsEnabledCounts([
            SETTINGS_SCHEMAS.alertingProfile,
            SETTINGS_SCHEMAS.problemNotifications,
            SETTINGS_SCHEMAS.metricEvents,
          ]),
          getSettingsObjectCounts([
            SETTINGS_SCHEMAS.davisAnomalyDetectors,
            SETTINGS_SCHEMAS.maintenanceWindow,
            SETTINGS_SCHEMAS.issueTracking,
            SETTINGS_SCHEMAS.frequentIssues,
          ]),
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        // Parse problem count
        let problemCount = 0;
        if (recentProblems.data?.records?.[0]) {
          const record = recentProblems.data.records[0] as Record<string, unknown>;
          problemCount = Number(record["count()"] ?? 0);
        }

        // Gen2 enabled/disabled breakdowns
        const profileData = enabledCounts.get(SETTINGS_SCHEMAS.alertingProfile) as EnabledCounts | null;
        const profileEnabled = profileData?.enabled ?? 0;
        const profileDisabled = profileData?.disabled ?? 0;
        const profileTotal = profileData?.total ?? 0;

        const notifData = enabledCounts.get(SETTINGS_SCHEMAS.problemNotifications) as EnabledCounts | null;
        const notifEnabled = notifData?.enabled ?? 0;
        const notifDisabled = notifData?.disabled ?? 0;
        const notifTotal = notifData?.total ?? 0;

        const metricEventData = enabledCounts.get(SETTINGS_SCHEMAS.metricEvents) as EnabledCounts | null;
        const metricEventEnabled = metricEventData?.enabled ?? 0;
        const metricEventDisabled = metricEventData?.disabled ?? 0;
        const metricEventTotal = metricEventData?.total ?? 0;

        // Gen3 simple counts
        const hasGen2Access = (schema: string) => enabledCounts.get(schema) !== null;
        const hasGen3Access = (schema: string) => simpleCounts.get(schema) !== null;
        const gen3CountOrZero = (schema: string) => simpleCounts.get(schema) ?? 0;

        // Check if Settings API is accessible at all
        const settingsAccessible = [...enabledCounts.values()].some((v) => v !== null) || [...simpleCounts.values()].some((v) => v !== null);
        if (!settingsAccessible) {
          findings.push({
            id: "alert-no-access",
            title: "Cannot access Settings 2.0 API",
            description: "The app does not have permission to read alerting settings. Review results may be incomplete.",
            severity: "warning",
            recommendation: "Grant the settings:objects:read scope to this app.",
          });
        }

        // Check 1: Alerting profiles — Gen2 pattern, should migrate to Workflows
        if (config.alertingProfiles.enabled) {
          checks.push({
            name: "Alerting profile migration",
            weight: config.alertingProfiles.weight,
            result: !hasGen2Access(SETTINGS_SCHEMAS.alertingProfile) ? "partial" :
              profileEnabled === 0 ? "pass" : profileEnabled <= 5 ? "partial" : "fail",
            partialValue: !hasGen2Access(SETTINGS_SCHEMAS.alertingProfile) ? 0 :
              profileEnabled <= 5 ? Math.max(0.3, 1 - (profileEnabled / 8)) : undefined,
          });
          if (hasGen2Access(SETTINGS_SCHEMAS.alertingProfile)) {
            if (profileTotal === 0) {
              findings.push({
                id: "alert-no-profiles",
                title: "No alerting profiles — clean",
                description: "No Gen2 alerting profiles found. Alert routing should be handled by AutomationEngine Workflows.",
                severity: "info",
                recommendation: "Use AutomationEngine Workflows for alert routing and notification management.",
              });
            } else if (profileEnabled === 0 && profileDisabled > 0) {
              findings.push({
                id: "alert-profiles-migrated",
                title: `${profileDisabled} alerting profile(s) disabled — migration complete`,
                description: `All ${profileDisabled} alerting profiles have been disabled, indicating migration is complete. Consider deleting the disabled profiles to clean up.`,
                severity: "success",
                recommendation: "Delete the disabled alerting profiles to finalize the migration.",
              });
            } else {
              const disabledNote = profileDisabled > 0 ? ` (${profileDisabled} disabled — migration in progress)` : "";
              findings.push({
                id: "alert-profiles-legacy",
                title: `${profileEnabled} enabled alerting profile(s) — Gen2 legacy${disabledNote}`,
                description: `${profileEnabled} active alerting profiles represent Gen2 debt.${profileDisabled > 0 ? ` ${profileDisabled} profiles have been disabled (migration progress).` : ""} Gen3 uses AutomationEngine Workflows with ownership-based routing.`,
                severity: getGen2Severity(profileEnabled, config.alertingProfiles),
                recommendation: "Migrate alerting profiles to AutomationEngine Workflows with conditional logic and ownership-based routing.",
              });
            }
          }
        }

        // Check 2: Problem notifications — Gen2 pattern, should migrate to Workflows
        if (config.classicNotifications.enabled) {
          checks.push({
            name: "Classic notification migration",
            weight: config.classicNotifications.weight,
            result: !hasGen2Access(SETTINGS_SCHEMAS.problemNotifications) ? "partial" :
              notifEnabled === 0 ? "pass" : notifEnabled <= 5 ? "partial" : "fail",
            partialValue: !hasGen2Access(SETTINGS_SCHEMAS.problemNotifications) ? 0 :
              notifEnabled <= 5 ? Math.max(0.3, 1 - (notifEnabled / 8)) : undefined,
          });
          if (hasGen2Access(SETTINGS_SCHEMAS.problemNotifications)) {
            if (notifTotal === 0) {
              findings.push({
                id: "alert-no-notifications",
                title: "No classic notification integrations — clean",
                description: "No Gen2 notification integrations found. Problem notifications should be handled by AutomationEngine Workflows.",
                severity: "info",
                recommendation: "Use AutomationEngine Workflows for problem notification routing.",
              });
            } else if (notifEnabled === 0 && notifDisabled > 0) {
              findings.push({
                id: "alert-notifications-migrated",
                title: `${notifDisabled} classic notification integration(s) disabled — migration complete`,
                description: `All ${notifDisabled} classic notification integrations have been disabled, indicating migration is complete. Consider deleting the disabled integrations to clean up.`,
                severity: "success",
                recommendation: "Delete the disabled notification integrations to finalize the migration.",
              });
            } else {
              const disabledNote = notifDisabled > 0 ? ` (${notifDisabled} disabled — migration in progress)` : "";
              findings.push({
                id: "alert-notifications-legacy",
                title: `${notifEnabled} enabled classic notification integration(s) — Gen2 legacy${disabledNote}`,
                description: `${notifEnabled} active notification integrations represent Gen2 debt.${notifDisabled > 0 ? ` ${notifDisabled} integrations have been disabled (migration progress).` : ""} AutomationEngine Workflows provide conditional logic, ownership-based routing, and multi-step remediation actions.`,
                severity: getGen2Severity(notifEnabled, config.classicNotifications),
                recommendation: "Migrate notification integrations to AutomationEngine Workflows.",
              });
            }
          }
        }

        // Check 3: Metric events (classic alerting)
        if (config.metricEvents.enabled) {
          checks.push({
            name: "Metric events assessment",
            weight: config.metricEvents.weight,
            result: !hasGen2Access(SETTINGS_SCHEMAS.metricEvents) ? "partial" :
              metricEventEnabled < 20 ? "pass" : metricEventEnabled < 50 ? "partial" : "fail",
            partialValue: !hasGen2Access(SETTINGS_SCHEMAS.metricEvents) ? 0 :
              metricEventEnabled < 50 ? 1 - (metricEventEnabled / 50) : undefined,
          });
          if (hasGen2Access(SETTINGS_SCHEMAS.metricEvents)) {
            if (metricEventTotal === 0) {
              findings.push({
                id: "alert-no-metric-events",
                title: "No classic metric events — clean",
                description: "No Gen2 metric events found. Use Davis Analyzers for Gen3 AI-powered alerting.",
                severity: "info",
                recommendation: "Use Davis Analyzers for anomaly detection on Grail timeseries data.",
              });
            } else if (metricEventEnabled === 0 && metricEventDisabled > 0) {
              findings.push({
                id: "alert-metric-events-migrated",
                title: `${metricEventDisabled} classic metric event(s) disabled — migration complete`,
                description: `All ${metricEventDisabled} classic metric events have been disabled, indicating migration is complete. Consider deleting the disabled events to clean up.`,
                severity: "success",
                recommendation: "Delete the disabled metric events to finalize the migration.",
              });
            } else {
              const disabledNote = metricEventDisabled > 0 ? ` (${metricEventDisabled} disabled — migration in progress)` : "";
              findings.push({
                id: "alert-many-metric-events",
                title: `${metricEventEnabled} enabled classic metric event(s)${disabledNote}`,
                description: `${metricEventEnabled} active classic metric events should be evaluated for migration to Davis Analyzers.${metricEventDisabled > 0 ? ` ${metricEventDisabled} events have been disabled (migration progress).` : ""}`,
                severity: getGen2Severity(metricEventEnabled, config.metricEvents),
                recommendation: "Review metric events and consider migrating to Davis Analyzers for Gen3 AI-powered alerting.",
              });
            }
          }
        }

        // Check 4: Davis Anomaly Detectors (Gen3 replacement for metric events)
        const davisDetectorCount = gen3CountOrZero(SETTINGS_SCHEMAS.davisAnomalyDetectors);
        if (config.davisAnomalyDetectors.enabled) {
          checks.push({
            name: "Davis Anomaly Detectors configured",
            weight: config.davisAnomalyDetectors.weight,
            result: !hasGen3Access(SETTINGS_SCHEMAS.davisAnomalyDetectors) ? "partial" :
              davisDetectorCount >= config.davisAnomalyDetectors.criticalMax ? "pass" :
              davisDetectorCount >= config.davisAnomalyDetectors.warningMax ? "partial" : "fail",
            partialValue: !hasGen3Access(SETTINGS_SCHEMAS.davisAnomalyDetectors) ? 0.3 :
              davisDetectorCount > 0 ? Math.min(0.4 + (davisDetectorCount * 0.1), 0.9) : undefined,
          });
          if (!hasGen3Access(SETTINGS_SCHEMAS.davisAnomalyDetectors)) {
            // Skip finding on access error
          } else if (davisDetectorCount === 0) {
            findings.push({
              id: "alert-no-davis-detectors",
              title: "No Davis Anomaly Detectors configured",
              description: "Davis Anomaly Detectors are the Gen3 replacement for classic metric events. They use Davis AI for intelligent threshold, baseline, and seasonal anomaly detection on Grail timeseries data.",
              severity: "warning",
              recommendation: "Create Davis Anomaly Detectors (builtin:davis.anomaly-detectors) to replace classic metric events with AI-powered alerting.",
            });
          } else {
            findings.push({
              id: "alert-davis-detectors",
              title: `${davisDetectorCount} Davis Anomaly Detector(s) — Gen3 alerting`,
              description: "Davis Anomaly Detectors provide AI-powered anomaly detection on Grail timeseries data, replacing classic metric event rules.",
              severity: getGen3Severity(davisDetectorCount, config.davisAnomalyDetectors),
              recommendation: davisDetectorCount >= config.davisAnomalyDetectors.criticalMax
                ? "Strong Davis Analyzer adoption. Continue migrating classic metric events to Davis Detectors."
                : "Expand Davis Anomaly Detector coverage to replace more classic metric events.",
            });
          }
        }

        // Check 5: Davis Events flowing to Grail (Gen3 alerting path active)
        const davisEventRow = (davisEventsResult.data?.records?.[0] ?? {}) as Record<string, unknown>;
        const davisEventCount = Number(davisEventRow["total"] ?? davisEventRow["count()"] ?? 0);
        if (config.davisEvents.enabled) {
          checks.push({
            name: "Davis Events in Grail",
            weight: config.davisEvents.weight,
            result: davisEventsResult.error ? "partial" :
              davisEventCount >= config.davisEvents.criticalMax ? "pass" :
              davisEventCount >= config.davisEvents.warningMax ? "partial" : "fail",
            partialValue: davisEventsResult.error ? 0.3 :
              davisEventCount > 0 ? Math.min(0.4 + (davisEventCount / 200), 0.9) : undefined,
          });
          if (davisEventsResult.error) {
            findings.push({
              id: "alert-davis-events-error",
              title: "Cannot access Davis event data in Grail",
              description: "The app may not have the required scope to query Davis events.",
              severity: "info",
              recommendation: "Verify storage:events:read scope is configured for this app.",
            });
          } else if (davisEventCount === 0) {
            findings.push({
              id: "alert-no-davis-events",
              title: "No Davis events in Grail (last 30d)",
              description: "No Davis events are flowing to Grail. Davis events in Grail indicate the Gen3 alerting path is active.",
              severity: "warning",
              recommendation: "Verify that Davis AI is enabled and events are being stored in Grail.",
            });
          } else {
            findings.push({
              id: "alert-davis-events",
              title: `${davisEventCount.toLocaleString()} Davis events in Grail (last 30d) — Gen3 alerting active`,
              description: "Davis events are flowing to Grail, confirming the Gen3 alerting pipeline is operational.",
              severity: getGen3Severity(davisEventCount, config.davisEvents),
              recommendation: "Continue leveraging Davis AI events in Grail for alerting workflows and root cause analysis.",
            });
          }
        }

        // Check 6: Maintenance windows
        const mwCount = gen3CountOrZero(SETTINGS_SCHEMAS.maintenanceWindow);
        checks.push({
          name: "Maintenance windows configured",
          weight: 0.15,
          result: "pass", // Having or not having MWs is fine
        });

        // Check 7: Recent problem activity (informational)
        checks.push({
          name: "Davis AI operational",
          weight: 0.1,
          result: recentProblems.error ? "fail" : "pass",
        });

        // Check 8: Issue Tracking Integration (Gen3)
        const issueTrackingCount = gen3CountOrZero(SETTINGS_SCHEMAS.issueTracking);
        if (config.issueTracking.enabled) {
          checks.push({
            name: "Issue Tracking Integration (Gen3)",
            weight: config.issueTracking.weight,
            result: issueTrackingCount >= config.issueTracking.criticalMax ? "pass" :
              issueTrackingCount >= config.issueTracking.warningMax ? "partial" : "fail",
            partialValue: issueTrackingCount > 0 ? Math.min(0.4 + (issueTrackingCount * 0.15), 0.9) : undefined,
          });
          findings.push({
            id: "alert-issue-tracking",
            title: issueTrackingCount === 0 ? "No issue tracking integration configured" : `${issueTrackingCount} issue tracking integration(s) — Gen3`,
            description: issueTrackingCount === 0
              ? "Issue tracking integration connects Davis problems to external ticket systems (Jira, ServiceNow, etc.)."
              : "Issue tracking integrations connect problems to external ticket systems for automated incident management.",
            severity: getGen3Severity(issueTrackingCount, config.issueTracking),
            recommendation: issueTrackingCount === 0
              ? "Configure issue tracking integration to automatically create tickets from Davis problems."
              : "Continue using issue tracking to connect problems to your ITSM platform.",
          });
        }

        // Check 9: Frequent Issues Detection (Gen3 noise reduction)
        const frequentIssuesCount = gen3CountOrZero(SETTINGS_SCHEMAS.frequentIssues);
        if (config.frequentIssues.enabled) {
          checks.push({
            name: "Frequent Issues Detection (Gen3)",
            weight: config.frequentIssues.weight,
            result: frequentIssuesCount >= config.frequentIssues.criticalMax ? "pass" :
              frequentIssuesCount >= config.frequentIssues.warningMax ? "partial" : "fail",
            partialValue: frequentIssuesCount > 0 ? Math.min(0.4 + (frequentIssuesCount * 0.15), 0.9) : undefined,
          });
          findings.push({
            id: "alert-frequent-issues",
            title: frequentIssuesCount === 0 ? "No frequent issues detection configured" : `${frequentIssuesCount} frequent issues detection config(s) — Gen3 noise reduction`,
            description: frequentIssuesCount === 0
              ? "Frequent issues detection identifies recurring problems to reduce alert noise and highlight systemic issues."
              : "Frequent issues detection is active, helping reduce alert noise by identifying recurring problems.",
            severity: getGen3Severity(frequentIssuesCount, config.frequentIssues),
            recommendation: frequentIssuesCount === 0
              ? "Enable frequent issues detection to reduce alert fatigue and identify recurring problems."
              : "Review detected frequent issues to address systemic problems.",
          });
        }

        // Check 10: Problem history analysis (via Environment API v2)
        let problemHistoryTotal = 0;
        let problemHistoryOpen = 0;
        try {
          const problemResponse = await functions.call("problems");
          const problemResult = (await problemResponse.json()) as {
            totalCount: number; openCount: number; impactCounts: Record<string, number>; error?: string;
          };
          problemHistoryTotal = problemResult.totalCount;
          problemHistoryOpen = problemResult.openCount;
          if (!problemResult.error) {
            // Check 10a: Open problems
            if (config.openProblems.enabled) {
              checks.push({
                name: "Open problem count",
                weight: config.openProblems.weight,
                result: problemHistoryOpen === 0 ? "pass" : problemHistoryOpen <= config.openProblems.criticalMax ? "partial" : "fail",
                partialValue: problemHistoryOpen > 0 ? Math.max(0.2, 1 - (problemHistoryOpen / 20)) : undefined,
              });
              if (problemHistoryOpen > 0) {
                findings.push({
                  id: "alert-open-problems",
                  title: `${problemHistoryOpen} open Davis problem(s)`,
                  description: "Unresolved problems may indicate ongoing issues or stale alerting that needs cleanup.",
                  severity: getGen2Severity(problemHistoryOpen, config.openProblems),
                  recommendation: "Review and resolve or close open problems. Suppress recurring false positives.",
                });
              }
            }

            // Check 10b: Problem frequency
            if (config.problemFrequency.enabled) {
              checks.push({
                name: "Problem frequency (30d)",
                weight: config.problemFrequency.weight,
                result: problemHistoryTotal <= config.problemFrequency.warningMax ? "pass" :
                  problemHistoryTotal <= config.problemFrequency.criticalMax ? "partial" : "fail",
                partialValue: problemHistoryTotal <= config.problemFrequency.criticalMax ?
                  Math.max(0.2, 1 - (problemHistoryTotal / 300)) : undefined,
              });
              if (problemHistoryTotal > config.problemFrequency.warningMax) {
                findings.push({
                  id: "alert-problem-frequency",
                  title: `${problemHistoryTotal} problems in the last 30 days`,
                  description: `High problem frequency suggests noisy alerting configuration. Impact breakdown: APP=${problemResult.impactCounts.application ?? 0}, SVC=${problemResult.impactCounts.services ?? 0}, INFRA=${problemResult.impactCounts.infrastructure ?? 0}, ENV=${problemResult.impactCounts.environment ?? 0}.`,
                  severity: getGen2Severity(problemHistoryTotal, config.problemFrequency),
                  recommendation: "Review alerting thresholds and anomaly detection settings to reduce alert noise. Use maintenance windows for planned changes.",
                });
              }
            }
          }
        } catch {
          // Problems API not accessible — skip
        }

        const gen2Enabled = profileEnabled + notifEnabled + metricEventEnabled;
        const gen2Disabled = profileDisabled + notifDisabled + metricEventDisabled;
        findings.push({
          id: "alert-problem-summary",
          title: `${problemCount} Davis problems in last 30 days`,
          description: `Alerting profiles: ${profileEnabled} enabled${profileDisabled > 0 ? ` / ${profileDisabled} disabled` : ""}, Notifications: ${notifEnabled} enabled${notifDisabled > 0 ? ` / ${notifDisabled} disabled` : ""}, Metric events: ${metricEventEnabled} enabled${metricEventDisabled > 0 ? ` / ${metricEventDisabled} disabled` : ""}, Maintenance windows: ${mwCount}, Davis events (30d): ${davisEventCount.toLocaleString()}.`,
          severity: "info",
          recommendation: "Review the alerting configuration to ensure coverage and reduce noise.",
        });

        // Score and migration
        const area = REVIEW_AREA_MAP.get("alerting")!;
        const areaWeight = getAreaWeight(config, "alerting");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: Gen2 alerting (enabled profiles, notifications, metric events) vs Gen3 (Davis Detectors + Workflows)
        const classicCount = gen2Enabled;
        const gen3Count = (problemCount > 0 ? 1 : 0) + (davisDetectorCount > 0 ? davisDetectorCount : 0) + (davisEventCount > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          classicCount > 0 ? classicCount : 0,
          gen3Count,
          `{classic} Gen2 alerting configs to migrate${gen2Disabled > 0 ? ` (${gen2Disabled} disabled)` : ""}, Davis AI {gen3} ({pct}% Gen3)`
        );

        setResult({
          areaId: "alerting",
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
            error: err instanceof Error ? err.message : "Failed to analyze alerting",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [recentProblems.isLoading, recentProblems.isPending, recentProblems.data, recentProblems.error,
    davisEventsResult.isLoading, davisEventsResult.isPending, davisEventsResult.data, davisEventsResult.error]);

  return result;
}
