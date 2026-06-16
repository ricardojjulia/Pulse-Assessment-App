import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts } from "../services/settingsService";
import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";

/**
 * Automation & Workflows review area.
 *
 * Scoring philosophy: Classic alerting profiles and notification integrations
 * are Gen2 legacy. Workflows that send emails/notifications (especially with
 * Davis problem triggers) are the Gen3 replacement and should be rewarded.
 *
 * Checks:
 * 1. AutomationEngine workflows exist
 * 2. Davis-triggered notification workflows (direct replacement for classic alerting)
 * 3. Workflow trigger diversity
 * 4. Classic notification migration (Gen2 debt — warns)
 * 5. Workflow-to-notification migration ratio
 *
 * Migration metric: classic notifications vs Gen3 workflows.
 */
export function useAutomationReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "automation",
    status: "unknown",
    score: { value: 0, weight: 0.7, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        // Fetch workflows and notification settings in parallel
        const [workflowResult, counts] = await Promise.all([
          workflowsClient.getWorkflows().catch(() => null),
          getSettingsObjectCounts([
            SETTINGS_SCHEMAS.problemNotifications,
            SETTINGS_SCHEMAS.alertingProfile,
          ]),
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const notifCount = counts.get(SETTINGS_SCHEMAS.problemNotifications) ?? 0;
        const profileCount = counts.get(SETTINGS_SCHEMAS.alertingProfile) ?? 0;
        const classicAlertingTotal = notifCount + profileCount;

        // Parse workflow data
        const workflows = workflowResult?.results ?? [];
        const workflowCount = workflows.length;

        // Analyze trigger types and notification actions across workflows
        let eventTriggers = 0;
        let scheduleTriggers = 0;
        let davisTriggers = 0;
        let emailWorkflows = 0;
        let notificationWorkflows = 0;

        for (const wf of workflows) {
          const wfObj = wf as unknown as Record<string, unknown>;
          const trigger = wfObj.trigger as Record<string, unknown> | undefined;
          const tasks = wfObj.tasks as Record<string, unknown> | undefined;

          // Classify trigger type
          if (trigger) {
            const triggerType = typeof trigger.type === "string" ? trigger.type : "";
            if (triggerType.includes("event")) eventTriggers++;
            if (triggerType.includes("time") || triggerType.includes("schedule") || triggerType.includes("cron") || triggerType.includes("interval")) scheduleTriggers++;
            if (triggerType.includes("davis")) davisTriggers++;
          }

          // Check if workflow contains email/notification actions
          // Tasks is a record of task objects; check action types
          if (tasks && typeof tasks === "object") {
            const taskValues = Object.values(tasks) as Record<string, unknown>[];
            for (const task of taskValues) {
              const action = typeof task.action === "string" ? task.action : "";
              if (action.includes("email") || action.includes("send_message") ||
                  action.includes("slack") || action.includes("jira") ||
                  action.includes("webhook") || action.includes("notification") ||
                  action.includes("pagerduty") || action.includes("opsgenie") ||
                  action.includes("servicenow")) {
                notificationWorkflows++;
                if (action.includes("email") || action.includes("send_message")) {
                  emailWorkflows++;
                }
                break; // Count each workflow once
              }
            }
          }
        }

        const triggerTypes = [eventTriggers > 0, scheduleTriggers > 0, davisTriggers > 0].filter(Boolean).length;

        // Check 1: Workflows exist (Gen3 automation)
        if (config.workflows.enabled) {
          checks.push({
            name: "AutomationEngine workflows configured",
            weight: config.workflows.weight,
            result: workflowResult === null ? "partial" : workflowCount > 0 ? "pass" : "fail",
            partialValue: workflowResult === null ? 0.3 : undefined,
          });
          if (workflowCount === 0 && workflowResult !== null) {
            findings.push({
              id: "auto-no-workflows",
              title: "No AutomationEngine workflows found",
              description: "AutomationEngine Workflows are the Gen3 replacement for alerting profiles and notification integrations.",
              severity: "critical",
              recommendation: "Create Workflows with Davis problem triggers and email/notification actions to replace classic alerting profiles and notification integrations.",
            });
          } else if (workflowResult === null) {
            findings.push({
              id: "auto-workflow-error",
              title: "Cannot access AutomationEngine workflows",
              description: "The app may not have the automation:workflows:read scope, or AutomationEngine is not enabled.",
              severity: "warning",
              recommendation: "Verify automation:workflows:read scope and that AutomationEngine is activated.",
            });
          } else {
            findings.push({
              id: "auto-workflow-count",
              title: `${workflowCount} AutomationEngine workflow(s) found`,
              description: `Trigger types: ${eventTriggers} event, ${scheduleTriggers} schedule, ${davisTriggers} Davis problem. Notification workflows: ${notificationWorkflows} (${emailWorkflows} email).`,
              severity: getGen3Severity(workflowCount, config.workflows),
              recommendation: "Continue building workflows to replace classic alerting profiles and notification integrations.",
            });
          }
        }

        // Check 2: Davis-triggered notification workflows — direct replacement for classic alerting
        // This is heavily rewarded: Davis trigger + email/notification action = Gen3 alerting
        const davisNotifWorkflows = Math.min(davisTriggers, notificationWorkflows);
        if (config.davisNotifWorkflows.enabled) {
          checks.push({
            name: "Davis notification workflows (replaces classic alerting)",
            weight: config.davisNotifWorkflows.weight,
            result: workflowResult === null ? "partial" :
              davisNotifWorkflows >= 3 ? "pass" :
              davisNotifWorkflows >= 1 ? "partial" : "fail",
            partialValue: workflowResult === null ? 0.3 :
              davisNotifWorkflows >= 1 ? Math.min(0.4 + (davisNotifWorkflows * 0.2), 0.9) : undefined,
          });
          if (workflowResult !== null && davisNotifWorkflows === 0 && workflowCount > 0) {
            findings.push({
              id: "auto-no-davis-notif",
              title: "No Davis-triggered notification workflows",
              description: "Workflows exist but none combine a Davis problem trigger with email/notification actions. This combination is the Gen3 replacement for alerting profiles + classic notifications.",
              severity: "warning",
              recommendation: "Create workflows with Davis problem triggers that send emails or notifications — this directly replaces classic alerting profiles and notification integrations.",
            });
          } else if (workflowResult !== null && davisNotifWorkflows > 0) {
            findings.push({
              id: "auto-davis-notif",
              title: `${davisNotifWorkflows} Davis notification workflow(s) — Gen3 alerting`,
              description: `${davisNotifWorkflows} workflow(s) combine Davis problem triggers with notification actions (${emailWorkflows} email). These are the Gen3 replacement for classic alerting profiles and notification integrations.`,
              severity: getGen3Severity(davisNotifWorkflows, config.davisNotifWorkflows),
              recommendation: davisNotifWorkflows < classicAlertingTotal
                ? `Create more Davis notification workflows to replace the remaining ${classicAlertingTotal} classic alerting configurations.`
                : "Excellent coverage. Review workflow conditions and routing logic periodically.",
            });
          }
        }

        // Check 3: Trigger diversity
        checks.push({
          name: "Workflow trigger diversity",
          weight: 0.1,
          result: workflowResult === null ? "partial" :
            triggerTypes >= 2 ? "pass" : triggerTypes === 1 ? "partial" : "fail",
          partialValue: workflowResult === null ? 0.3 : triggerTypes === 1 ? 0.5 : undefined,
        });

        // Check 4: Classic notification/alerting profile migration debt
        checks.push({
          name: "Classic alerting migration",
          weight: 0.2,
          result: classicAlertingTotal === 0 ? "pass" :
            classicAlertingTotal <= 5 ? "partial" : "fail",
          partialValue: classicAlertingTotal <= 5 ? Math.max(0.2, 1 - (classicAlertingTotal / 8)) : undefined,
        });
        if (config.classicNotifications.enabled && notifCount > 0) {
          findings.push({
            id: "auto-notifications-legacy",
            title: `${notifCount} classic notification integration(s) — Gen2 legacy`,
            description: "Classic notification integrations should be replaced by Workflows with email/notification actions.",
            severity: getGen2Severity(notifCount, config.classicNotifications),
            recommendation: "Create a Davis-triggered Workflow with email action to replace each classic notification integration.",
          });
        }
        if (config.alertingProfiles.enabled && profileCount > 0) {
          findings.push({
            id: "auto-profiles-legacy",
            title: `${profileCount} alerting profile(s) — Gen2 legacy`,
            description: "Alerting profiles are Gen2 notification filtering. Workflow conditions and ownership-based routing replace this functionality.",
            severity: getGen2Severity(profileCount, config.alertingProfiles),
            recommendation: "Replace alerting profiles with Workflow conditions and ownership-based routing.",
          });
        }
        if (classicAlertingTotal === 0) {
          findings.push({
            id: "auto-no-classic-debt",
            title: "No classic alerting debt — fully migrated",
            description: "No legacy alerting profiles or notification integrations found. Alerting is handled by Gen3 Workflows.",
            severity: "success",
            recommendation: "Continue using Workflows for all alert routing and notification management.",
          });
        }

        // Check 5: Workflow-to-classic ratio
        const totalAutomation = workflowCount + classicAlertingTotal;
        const workflowRatio = totalAutomation > 0 ? workflowCount / totalAutomation : 0;
        checks.push({
          name: "Workflow adoption ratio",
          weight: 0.2,
          result: workflowRatio >= 0.7 ? "pass" : workflowRatio >= 0.3 ? "partial" : "fail",
          partialValue: workflowRatio >= 0.3 ? workflowRatio : undefined,
        });

        // Check 6: Workflow execution health (30d)
        if (config.workflowExecutionHealth.enabled) {
          try {
            const execResponse = await functions.call("workflowExecutions");
            const execResult = (await execResponse.json()) as {
              totalCount: number; successCount: number; errorCount: number; cancelledCount: number;
              triggerTypeCounts: Record<string, number>; workflowsWithExecutions: number; error?: string;
            };

            if (!execResult.error && execResult.totalCount > 0) {
              const successRate = Math.round((execResult.successCount / execResult.totalCount) * 100);
              const errorRate = Math.round((execResult.errorCount / execResult.totalCount) * 100);

              checks.push({
                name: "Workflow execution health (30d)",
                weight: config.workflowExecutionHealth.weight,
                result: errorRate <= 5 ? "pass" : errorRate <= 20 ? "partial" : "fail",
                partialValue: errorRate <= 20 ? Math.max(0.3, 1 - (errorRate / 30)) : undefined,
              });

              if (errorRate > 20) {
                findings.push({
                  id: "auto-exec-errors",
                  title: `${errorRate}% workflow execution error rate (${execResult.errorCount}/${execResult.totalCount})`,
                  description: `${execResult.totalCount} executions in 30d: ${execResult.successCount} success, ${execResult.errorCount} errors, ${execResult.cancelledCount} cancelled.`,
                  severity: "critical",
                  recommendation: "Investigate failing workflows. Check action configurations, input parameters, and target system availability.",
                });
              } else if (errorRate > 5) {
                findings.push({
                  id: "auto-exec-warnings",
                  title: `${errorRate}% workflow execution error rate — review needed`,
                  description: `${execResult.totalCount} executions in 30d: ${successRate}% success rate. Trigger types: ${Object.entries(execResult.triggerTypeCounts).map(([t, c]) => `${t}: ${c}`).join(", ")}.`,
                  severity: "warning",
                  recommendation: "Review workflows with errors and fix root causes to improve reliability.",
                });
              } else {
                findings.push({
                  id: "auto-exec-healthy",
                  title: `${successRate}% workflow success rate (${execResult.totalCount} executions in 30d)`,
                  description: `Trigger types: ${Object.entries(execResult.triggerTypeCounts).map(([t, c]) => `${t}: ${c}`).join(", ")}. ${execResult.workflowsWithExecutions} workflows had executions.`,
                  severity: "success",
                  recommendation: "Workflow execution health is good. Monitor for regressions.",
                });
              }

              // Check for manual-only triggers
              const manualCount = execResult.triggerTypeCounts["Manual"] ?? 0;
              if (manualCount > 0 && execResult.totalCount > 0) {
                const manualPct = Math.round((manualCount / execResult.totalCount) * 100);
                if (manualPct > 80) {
                  findings.push({
                    id: "auto-mostly-manual",
                    title: `${manualPct}% of workflow executions are manual`,
                    description: "Most workflows are triggered manually. Automated triggers (event, schedule) improve response time and consistency.",
                    severity: "info",
                    recommendation: "Add event or schedule triggers to frequently-executed workflows to reduce manual intervention.",
                  });
                }
              }

              // Check for unused workflows
              if (workflowCount > 0 && execResult.workflowsWithExecutions < workflowCount) {
                const unused = workflowCount - execResult.workflowsWithExecutions;
                findings.push({
                  id: "auto-unused-workflows",
                  title: `${unused} workflow(s) with no executions in 30 days`,
                  description: `${workflowCount} workflows exist but only ${execResult.workflowsWithExecutions} had executions.`,
                  severity: "info",
                  recommendation: "Review unused workflows — they may be abandoned or misconfigured.",
                });
              }
            } else if (!execResult.error && execResult.totalCount === 0 && workflowCount > 0) {
              findings.push({
                id: "auto-no-executions",
                title: "No workflow executions in the last 30 days",
                description: `${workflowCount} workflows exist but none have been executed. Workflows may be misconfigured or their triggers inactive.`,
                severity: "warning",
                recommendation: "Verify workflow triggers are active and correctly configured.",
              });
            }
          } catch {
            // Execution API not accessible — skip silently
          }
        }

        // Summary
        findings.push({
          id: "auto-summary",
          title: `Automation: ${workflowCount} workflows (${davisNotifWorkflows} Davis notification) vs ${classicAlertingTotal} Gen2 configs`,
          description: `Workflow ratio: ${Math.round(workflowRatio * 100)}%. Gen2: ${profileCount} alerting profiles, ${notifCount} classic notifications. Gen3 replacement: Workflows with Davis triggers + email/notification actions.`,
          severity: workflowRatio >= 0.7 && classicAlertingTotal === 0 ? "success" :
            classicAlertingTotal > 0 ? "warning" : "info",
          recommendation: "Replace all classic alerting profiles and notifications with Davis-triggered Workflows.",
        });

        const area = REVIEW_AREA_MAP.get("automation")!;
        const areaWeight = getAreaWeight(config, "automation");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: classic alerting configs vs Gen3 workflows
        const migration = buildMigrationMetrics(
          classicAlertingTotal,
          workflowCount,
          "{gen3} workflows vs {classic} classic alerting configs ({pct}% migrated)"
        );

        setResult({
          areaId: "automation",
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
            error: err instanceof Error ? err.message : "Failed to analyze automation",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
