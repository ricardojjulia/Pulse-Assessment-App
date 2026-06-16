import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts, getSettingsEnabledCounts, listSettingsSchemas } from "../services/settingsService";
import type { EnabledCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";

/**
 * Settings Framework review area.
 *
 * Scoring philosophy: Settings 2.0 API access is good, but Gen2 constructs
 * within Settings 2.0 (auto-tags, management zones, classic metric events,
 * alerting profiles) are legacy and their presence should warn, not reward.
 * Gen3 features (ownership) should be rewarded.
 *
 * Checks:
 * 1. Settings 2.0 schemas available (API accessibility)
 * 2. Gen2 config debt (auto-tags + MZs — warn if present)
 * 3. Ownership teams configured (Gen3 — rewarded)
 * 4. Problem notifications in Settings 2.0 (warn to migrate to Workflows)
 * 5. Classic metric events count (warn if high)
 */

/** Gen2 schemas — use enabled/disabled counts */
const GEN2_SCHEMAS = [
  SETTINGS_SCHEMAS.autoTagging,
  SETTINGS_SCHEMAS.managementZones,
  SETTINGS_SCHEMAS.problemNotifications,
  SETTINGS_SCHEMAS.metricEvents,
];

/** Gen3 / informational schemas — use simple counts */
const GEN3_SCHEMAS = [
  SETTINGS_SCHEMAS.alertingProfile,
  SETTINGS_SCHEMAS.maintenanceWindow,
  SETTINGS_SCHEMAS.processGroupDetection,
  SETTINGS_SCHEMAS.logStorageSettings,
  SETTINGS_SCHEMAS.ownershipTeams,
];

export function useSettingsReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "settings",
    status: "unknown",
    score: { value: 0, weight: 1.0, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const [schemas, enabledCounts, simpleCounts] = await Promise.all([
          listSettingsSchemas(),
          getSettingsEnabledCounts(GEN2_SCHEMAS),
          getSettingsObjectCounts(GEN3_SCHEMAS),
        ]);

        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        // Check 1: Settings 2.0 schemas available
        const schemasAccessible = schemas !== null;
        const schemaCount = schemas?.length ?? 0;

        if (!schemasAccessible) {
          checks.push({
            name: "Settings 2.0 schemas available",
            weight: 0.25,
            result: "partial",
            partialValue: 0,
          });
          findings.push({
            id: "settings-no-access",
            title: "Cannot access Settings 2.0 API",
            description: "The app does not have permission to read Settings 2.0 schemas. Review results may be incomplete.",
            severity: "warning",
            recommendation: "Grant the settings:objects:read scope to this app.",
          });
        } else {
          checks.push({
            name: "Settings 2.0 schemas available",
            weight: 0.25,
            result: schemaCount > 50 ? "pass" : schemaCount > 20 ? "partial" : "fail",
            partialValue: Math.min(schemaCount / 50, 1),
          });

          if (schemaCount === 0) {
            findings.push({
              id: "settings-no-schemas",
              title: "No Settings 2.0 schemas found",
              description: "The tenant does not appear to have Settings 2.0 enabled.",
              severity: "warning",
              recommendation: "Settings 2.0 should be available on all modern Dynatrace environments.",
            });
          }
        }

        // Helpers for access checks
        const hasGen2Access = (schema: string) => enabledCounts.get(schema) !== null;
        const hasGen3Access = (schema: string) => simpleCounts.get(schema) !== null;
        const gen3CountOrZero = (schema: string) => simpleCounts.get(schema) ?? 0;

        // Gen2 enabled/disabled breakdowns
        const autoTagData = enabledCounts.get(SETTINGS_SCHEMAS.autoTagging) as EnabledCounts | null;
        const autoTagEnabled = autoTagData?.enabled ?? 0;
        const autoTagDisabled = autoTagData?.disabled ?? 0;
        const autoTagTotal = autoTagData?.total ?? 0;

        const mzData = enabledCounts.get(SETTINGS_SCHEMAS.managementZones) as EnabledCounts | null;
        const mzEnabled = mzData?.enabled ?? 0;
        const mzDisabled = mzData?.disabled ?? 0;
        const mzTotal = mzData?.total ?? 0;

        const notifData = enabledCounts.get(SETTINGS_SCHEMAS.problemNotifications) as EnabledCounts | null;
        const notifEnabled = notifData?.enabled ?? 0;
        const notifDisabled = notifData?.disabled ?? 0;
        const notifTotal = notifData?.total ?? 0;

        const metricEventData = enabledCounts.get(SETTINGS_SCHEMAS.metricEvents) as EnabledCounts | null;
        const metricEventEnabled = metricEventData?.enabled ?? 0;
        const metricEventDisabled = metricEventData?.disabled ?? 0;
        const metricEventTotal = metricEventData?.total ?? 0;

        // Gen3 simple counts
        const ownershipCount = gen3CountOrZero(SETTINGS_SCHEMAS.ownershipTeams);

        // Check 2: Gen2 config debt — auto-tags + MZs are legacy (score on ENABLED count)
        const gen2Enabled = autoTagEnabled + mzEnabled;
        const gen2Disabled = autoTagDisabled + mzDisabled;
        checks.push({
          name: "Gen2 configuration debt",
          weight: 0.25,
          result: gen2Enabled === 0 ? "pass" : gen2Enabled <= 10 ? "partial" : "fail",
          partialValue: gen2Enabled <= 10 ? Math.max(0.2, 1 - (gen2Enabled / 15)) : undefined,
        });
        if (config.autoTagging.enabled) {
          if (autoTagTotal === 0) {
            findings.push({
              id: "settings-no-autotags",
              title: "No auto-tagging rules — clean",
              description: "No Gen2 auto-tagging rules found.",
              severity: "info",
              recommendation: "Use ownership teams for entity organization instead of auto-tags.",
            });
          } else if (autoTagEnabled === 0 && autoTagDisabled > 0) {
            findings.push({
              id: "settings-autotags-migrated",
              title: `${autoTagDisabled} auto-tagging rule(s) disabled — migration complete`,
              description: `All ${autoTagDisabled} auto-tagging rules have been disabled, indicating migration is complete. Consider deleting the disabled rules to clean up.`,
              severity: "success",
              recommendation: "Delete the disabled auto-tagging rules to finalize the migration.",
            });
          } else if (autoTagEnabled > 0) {
            const disabledNote = autoTagDisabled > 0 ? ` (${autoTagDisabled} disabled — migration in progress)` : "";
            findings.push({
              id: "settings-autotags-legacy",
              title: `${autoTagEnabled} enabled auto-tagging rule(s) — Gen2 legacy${disabledNote}`,
              description: `${autoTagEnabled} active auto-tagging rules represent Gen2 debt.${autoTagDisabled > 0 ? ` ${autoTagDisabled} rules have been disabled (migration progress).` : ""} They should be replaced with ownership teams.`,
              severity: getGen2Severity(autoTagEnabled, config.autoTagging),
              recommendation: "Migrate auto-tagging rules to ownership teams (builtin:ownership.teams).",
            });
          }
        }
        if (config.managementZones.enabled) {
          if (mzTotal === 0) {
            findings.push({
              id: "settings-no-mz",
              title: "No management zones — clean",
              description: "No Gen2 management zones found.",
              severity: "info",
              recommendation: "Use Grail permissions and IAM for access control instead of management zones.",
            });
          } else if (mzEnabled === 0 && mzDisabled > 0) {
            findings.push({
              id: "settings-mz-migrated",
              title: `${mzDisabled} management zone(s) disabled — migration complete`,
              description: `All ${mzDisabled} management zones have been disabled. Consider deleting them to finalize migration.`,
              severity: "success",
              recommendation: "Delete disabled management zones to clean up the migration.",
            });
          } else if (mzEnabled > 0) {
            const disabledNote = mzDisabled > 0 ? ` (${mzDisabled} disabled — migration in progress)` : "";
            findings.push({
              id: "settings-mz-legacy",
              title: `${mzEnabled} enabled management zone(s) — Gen2 legacy${disabledNote}`,
              description: `${mzEnabled} active management zones represent Gen2 debt.${mzDisabled > 0 ? ` ${mzDisabled} have been disabled (migration progress).` : ""} Gen3 uses Grail permissions and IAM policies.`,
              severity: getGen2Severity(mzEnabled, config.managementZones),
              recommendation: "Evaluate migrating management zones to Grail permissions and IAM.",
            });
          }
        }
        if (gen2Enabled === 0 && gen2Disabled === 0) {
          findings.push({
            id: "settings-no-gen2-debt",
            title: "No Gen2 configuration debt (auto-tags, MZs)",
            description: "No legacy auto-tagging rules or management zones found.",
            severity: "success",
            recommendation: "Continue using Gen3 constructs (ownership, Grail permissions) for organization.",
          });
        } else if (gen2Enabled === 0 && gen2Disabled > 0) {
          findings.push({
            id: "settings-gen2-fully-disabled",
            title: `All Gen2 configs disabled (${gen2Disabled} total) — migration complete`,
            description: `All ${gen2Disabled} Gen2 configuration items have been disabled. Consider deleting them to finalize migration.`,
            severity: "success",
            recommendation: "Delete disabled Gen2 configs to clean up the migration.",
          });
        }

        // Check 3: Ownership teams configured (Gen3 — rewarded)
        if (config.ownershipTeams.enabled) {
          checks.push({
            name: "Ownership teams configured",
            weight: config.ownershipTeams.weight,
            result: !hasGen3Access(SETTINGS_SCHEMAS.ownershipTeams) ? "partial" : ownershipCount > 0 ? "pass" : "fail",
            partialValue: !hasGen3Access(SETTINGS_SCHEMAS.ownershipTeams) ? 0 : undefined,
          });
          if (hasGen3Access(SETTINGS_SCHEMAS.ownershipTeams) && ownershipCount === 0) {
            findings.push({
              id: "settings-no-ownership",
              title: "No ownership teams configured",
              description: "Ownership teams are the Gen3 standard for entity organization, accountability, and alert routing.",
              severity: "warning",
              recommendation: "Configure ownership teams to replace auto-tags and management zones.",
            });
          } else if (ownershipCount > 0) {
            findings.push({
              id: "settings-ownership-active",
              title: `${ownershipCount} ownership team(s) configured`,
              description: "Gen3 ownership is active, enabling automated alert routing and team accountability.",
              severity: getGen3Severity(ownershipCount, config.ownershipTeams),
              recommendation: "Expand ownership coverage to all critical services.",
            });
          }
        }

        // Check 4: Classic notifications — warn to migrate to Workflows
        if (config.classicNotifications.enabled) {
          checks.push({
            name: "Classic notifications migration",
            weight: config.classicNotifications.weight,
            result: !hasGen2Access(SETTINGS_SCHEMAS.problemNotifications) ? "partial" :
              notifEnabled === 0 ? "pass" : notifEnabled <= 10 ? "partial" : "fail",
            partialValue: !hasGen2Access(SETTINGS_SCHEMAS.problemNotifications) ? 0 :
              notifEnabled <= 10 ? Math.max(0.3, 1 - (notifEnabled / 15)) : undefined,
          });
          if (hasGen2Access(SETTINGS_SCHEMAS.problemNotifications)) {
            if (notifTotal === 0) {
              findings.push({
                id: "settings-no-notifications",
                title: "No classic notification integrations — clean",
                description: "No Gen2 notification integrations found.",
                severity: "info",
                recommendation: "Use AutomationEngine Workflows for problem notification routing.",
              });
            } else if (notifEnabled === 0 && notifDisabled > 0) {
              findings.push({
                id: "settings-notifications-migrated",
                title: `${notifDisabled} classic notification integration(s) disabled — migration complete`,
                description: `All ${notifDisabled} classic notification integrations have been disabled, indicating migration is complete. Consider deleting the disabled integrations to clean up.`,
                severity: "success",
                recommendation: "Delete the disabled notification integrations to finalize the migration.",
              });
            } else if (notifEnabled > 0) {
              const disabledNote = notifDisabled > 0 ? ` (${notifDisabled} disabled — migration in progress)` : "";
              findings.push({
                id: "settings-notifications-legacy",
                title: `${notifEnabled} enabled classic notification integration(s) — migrate to Workflows${disabledNote}`,
                description: `${notifEnabled} active classic notification integrations should be migrated to AutomationEngine Workflows.${notifDisabled > 0 ? ` ${notifDisabled} integrations have been disabled (migration progress).` : ""}`,
                severity: getGen2Severity(notifEnabled, config.classicNotifications),
                recommendation: "Migrate notification integrations to Workflows for conditional logic, ownership-based routing, and multi-step actions.",
              });
            }
          }
        }

        // Check 5: Classic metric events — warn if high (score on ENABLED count)
        if (config.metricEvents.enabled) {
          checks.push({
            name: "Classic metric events",
            weight: config.metricEvents.weight,
            result: !hasGen2Access(SETTINGS_SCHEMAS.metricEvents) ? "partial" :
              metricEventEnabled === 0 ? "pass" : metricEventEnabled <= 20 ? "partial" : "fail",
            partialValue: !hasGen2Access(SETTINGS_SCHEMAS.metricEvents) ? 0 :
              metricEventEnabled <= 20 ? Math.max(0.3, 1 - (metricEventEnabled / 30)) : undefined,
          });
          if (hasGen2Access(SETTINGS_SCHEMAS.metricEvents)) {
            if (metricEventTotal === 0) {
              findings.push({
                id: "settings-no-metric-events",
                title: "No classic metric events — clean",
                description: "No Gen2 metric events found. Use Davis Analyzers for Gen3 AI-powered alerting.",
                severity: "info",
                recommendation: "Use Davis Analyzers for anomaly detection on Grail timeseries data.",
              });
            } else if (metricEventEnabled === 0 && metricEventDisabled > 0) {
              findings.push({
                id: "settings-metric-events-migrated",
                title: `${metricEventDisabled} classic metric event(s) disabled — migration complete`,
                description: `All ${metricEventDisabled} classic metric events have been disabled, indicating migration is complete. Consider deleting the disabled events to clean up.`,
                severity: "success",
                recommendation: "Delete the disabled metric events to finalize the migration.",
              });
            } else if (metricEventEnabled > 0) {
              const disabledNote = metricEventDisabled > 0 ? ` (${metricEventDisabled} disabled — migration in progress)` : "";
              findings.push({
                id: "settings-metric-events-legacy",
                title: `${metricEventEnabled} enabled classic metric event(s) — evaluate for Davis Analyzers${disabledNote}`,
                description: `${metricEventEnabled} active classic metric events are Gen2 alerting.${metricEventDisabled > 0 ? ` ${metricEventDisabled} events have been disabled (migration progress).` : ""} Gen3 uses Davis Analyzers for AI-powered anomaly detection.`,
                severity: getGen2Severity(metricEventEnabled, config.metricEvents),
                recommendation: "Review metric events and consider migrating to Davis Analyzers.",
              });
            }
          }
        }

        // Calculate score and migration
        const area = REVIEW_AREA_MAP.get("settings")!;
        const areaWeight = getAreaWeight(config, "settings");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: Gen2 ENABLED configs vs Gen3 configs
        const allGen2Enabled = autoTagEnabled + mzEnabled + notifEnabled + metricEventEnabled;
        const allGen2Disabled = autoTagDisabled + mzDisabled + notifDisabled + metricEventDisabled;
        const gen2Signals = (autoTagEnabled > 0 ? 1 : 0) + (mzEnabled > 0 ? 1 : 0) + (notifEnabled > 0 ? 1 : 0) + (metricEventEnabled > 0 ? 1 : 0);
        const gen3Signals = (ownershipCount > 0 ? 1 : 0) + (schemasAccessible ? 1 : 0);
        const migration = buildMigrationMetrics(
          gen2Signals,
          gen3Signals,
          `{gen3} Gen3 signals vs {classic} Gen2 active configs${allGen2Disabled > 0 ? ` (${allGen2Disabled} disabled)` : ""} ({pct}% migrated)`
        );

        // Summary finding
        findings.push({
          id: "settings-summary",
          title: `Settings: ${schemaCount} schemas, ${allGen2Enabled} enabled Gen2 configs${allGen2Disabled > 0 ? ` (${allGen2Disabled} disabled)` : ""}, ${ownershipCount} ownership teams`,
          description: `Gen2 debt: ${autoTagEnabled} auto-tags, ${mzEnabled} MZs, ${metricEventEnabled} metric events, ${notifEnabled} classic notifications (enabled).${allGen2Disabled > 0 ? ` ${allGen2Disabled} Gen2 configs disabled (migration progress).` : ""} Gen3: ${ownershipCount} ownership teams.`,
          severity: allGen2Enabled === 0 && ownershipCount > 0 ? "success" : allGen2Enabled > 0 ? "warning" : "info",
          recommendation: "Migrate Gen2 constructs (auto-tags, MZs, classic notifications, metric events) to Gen3 equivalents (ownership, Workflows, Davis Analyzers).",
        });

        setResult({
          areaId: "settings",
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
            error: err instanceof Error ? err.message : "Failed to analyze settings",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
