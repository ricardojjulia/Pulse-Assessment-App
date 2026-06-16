import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts, getSettingsEnabledCounts } from "../services/settingsService";
import type { EnabledCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";

/**
 * Tagging & Organization review area.
 *
 * Scoring philosophy: Gen2 constructs (auto-tags, management zones) are legacy
 * and should be migrated to Gen3 ownership. Their existence is a warning, not
 * a positive signal. Ownership teams are the Gen3 standard.
 *
 * Checks:
 * 1. Auto-tagging rules — Gen2 legacy, warns to migrate
 * 2. Management zones — Gen2 legacy, warns to evaluate Gen3 alternatives
 * 3. Ownership teams configured — Gen3 feature, rewarded
 * 4. Ownership feature enabled — Gen3 configuration
 *
 * Migration metric: Gen2 configs (auto-tags + MZs) vs Gen3 (ownership).
 */
export function useTaggingReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "tagging",
    status: "unknown",
    score: { value: 0, weight: 0.8, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        // Fetch enabled/disabled breakdown for Gen2 schemas, regular counts for Gen3
        const [enabledCounts, simpleCounts] = await Promise.all([
          getSettingsEnabledCounts([SETTINGS_SCHEMAS.autoTagging, SETTINGS_SCHEMAS.managementZones]),
          getSettingsObjectCounts([SETTINGS_SCHEMAS.ownershipTeams, SETTINGS_SCHEMAS.ownershipConfig, SETTINGS_SCHEMAS.segments]),
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const autoTagData = enabledCounts.get(SETTINGS_SCHEMAS.autoTagging) as EnabledCounts | null;
        const autoTagEnabled = autoTagData?.enabled ?? 0;
        const autoTagDisabled = autoTagData?.disabled ?? 0;
        const autoTagTotal = autoTagData?.total ?? 0;

        const mzData = enabledCounts.get(SETTINGS_SCHEMAS.managementZones) as EnabledCounts | null;
        const mzEnabled = mzData?.enabled ?? 0;
        const mzDisabled = mzData?.disabled ?? 0;
        const mzTotal = mzData?.total ?? 0;

        const ownershipTeams = simpleCounts.get(SETTINGS_SCHEMAS.ownershipTeams) ?? 0;
        const ownershipConfig = simpleCounts.get(SETTINGS_SCHEMAS.ownershipConfig) ?? 0;

        // Check 1: Auto-tagging rules — Gen2 legacy
        // Score based on ENABLED count (disabled = migration progress, not debt)
        if (config.autoTagging.enabled) {
          checks.push({
            name: "Auto-tagging migration",
            weight: config.autoTagging.weight,
            result: autoTagEnabled === 0 ? "pass" :
              autoTagEnabled <= 10 && ownershipTeams > 0 ? "partial" : "fail",
            partialValue: autoTagEnabled <= 10 && ownershipTeams > 0 ? 0.6 : autoTagEnabled > 0 && ownershipTeams > 0 ? 0.4 : undefined,
          });
          if (autoTagEnabled === 0 && autoTagTotal === 0) {
            findings.push({
              id: "tag-no-autotags",
              title: "No auto-tagging rules — clean",
              description: "No Gen2 auto-tagging rules found. Entity organization should be driven by ownership teams.",
              severity: "info",
              recommendation: "Use ownership teams for entity organization instead of auto-tags.",
            });
          } else if (autoTagEnabled === 0 && autoTagDisabled > 0) {
            findings.push({
              id: "tag-autotags-migrated",
              title: `${autoTagDisabled} auto-tagging rule(s) disabled — migration complete`,
              description: `All ${autoTagDisabled} auto-tagging rules have been disabled, indicating migration is complete. Consider deleting the disabled rules to clean up.`,
              severity: "success",
              recommendation: "Delete the disabled auto-tagging rules to finalize the migration.",
            });
          } else {
            const disabledNote = autoTagDisabled > 0 ? ` (${autoTagDisabled} disabled — migration in progress)` : "";
            findings.push({
              id: "tag-autotags",
              title: `${autoTagEnabled} enabled auto-tagging rule(s) — Gen2 legacy${disabledNote}`,
              description: `${autoTagEnabled} active auto-tagging rules represent Gen2 debt.${autoTagDisabled > 0 ? ` ${autoTagDisabled} rules have been disabled (migration progress).` : ""} Gen3 uses ownership teams for entity accountability.`,
              severity: getGen2Severity(autoTagEnabled, config.autoTagging),
              recommendation: "Disable and migrate remaining auto-tagging rules to ownership teams.",
            });
          }
        }

        // Check 2: Management zones — Gen2 legacy
        // Score based on ENABLED count (disabled = migration progress)
        if (config.managementZones.enabled) {
          checks.push({
            name: "Management zone migration",
            weight: config.managementZones.weight,
            result: mzEnabled === 0 ? "pass" :
              mzEnabled <= 5 && ownershipTeams > 0 ? "partial" : "fail",
            partialValue: mzEnabled <= 5 && ownershipTeams > 0 ? 0.6 : mzEnabled > 0 && ownershipTeams > 0 ? 0.3 : undefined,
          });
          if (mzEnabled === 0 && mzTotal === 0) {
            findings.push({
              id: "tag-no-mz",
              title: "No management zones — clean",
              description: "No Gen2 management zones found. Access control should use Grail permissions and IAM policies.",
              severity: "info",
              recommendation: "Use Grail-based permissions and IAM for access control instead of management zones.",
            });
          } else if (mzEnabled === 0 && mzDisabled > 0) {
            findings.push({
              id: "tag-mz-migrated",
              title: `${mzDisabled} management zone(s) disabled — migration complete`,
              description: `All ${mzDisabled} management zones have been disabled. Consider deleting them to finalize migration.`,
              severity: "success",
              recommendation: "Delete disabled management zones to clean up the migration.",
            });
          } else {
            const disabledNote = mzDisabled > 0 ? ` (${mzDisabled} disabled — migration in progress)` : "";
            findings.push({
              id: "tag-mz",
              title: `${mzEnabled} enabled management zone(s) — Gen2 legacy${disabledNote}`,
              description: `${mzEnabled} active management zones represent Gen2 debt.${mzDisabled > 0 ? ` ${mzDisabled} have been disabled (migration progress).` : ""} Gen3 uses Grail permissions and IAM policies.`,
              severity: getGen2Severity(mzEnabled, config.managementZones),
              recommendation: "Evaluate migrating management zones to Grail permissions and IAM policies.",
            });
          }
        }

        // Check 3: Ownership teams (Gen3 feature) — rewarded heavily
        if (config.ownershipTeams.enabled) {
          checks.push({
            name: "Ownership teams configured",
            weight: config.ownershipTeams.weight,
            result: ownershipTeams >= 5 ? "pass" : ownershipTeams > 0 ? "partial" : "fail",
            partialValue: ownershipTeams > 0 ? Math.min(ownershipTeams / 5, 0.9) : undefined,
          });
          if (ownershipTeams === 0) {
            findings.push({
              id: "tag-no-ownership",
              title: "No ownership teams configured",
              description: "Ownership is the Gen3 standard for entity organization. It assigns teams to entities for accountability, automated alert routing via Workflows, and replaces the need for auto-tags and management zones.",
              severity: "critical",
              recommendation: "Configure ownership teams (builtin:ownership.teams) and assign entities to teams. This is the foundation for Gen3 organization.",
            });
          } else if (ownershipTeams < 5) {
            findings.push({
              id: "tag-ownership-low",
              title: `${ownershipTeams} ownership team(s) — needs expansion`,
              description: "Ownership teams are configured but coverage is limited. All critical services and infrastructure should have assigned owners.",
              severity: getGen3Severity(ownershipTeams, config.ownershipTeams),
              recommendation: "Expand ownership coverage to all critical services. Ownership enables automated Workflow routing and accountability.",
            });
          } else {
            findings.push({
              id: "tag-ownership",
              title: `${ownershipTeams} ownership team(s) configured`,
              description: "Strong ownership coverage. Ownership teams enable automated alert routing and accountability across the environment.",
              severity: getGen3Severity(ownershipTeams, config.ownershipTeams),
              recommendation: "Ensure all critical services have an ownership team assigned. Review ownership mappings periodically.",
            });
          }
        }

        // Check 4: Ownership config enabled
        checks.push({
          name: "Ownership feature enabled",
          weight: 0.25,
          result: ownershipConfig > 0 ? "pass" : "fail",
        });
        if (ownershipConfig === 0) {
          findings.push({
            id: "tag-no-ownership-config",
            title: "Ownership feature not enabled",
            description: "The ownership configuration (builtin:ownership.config) is not set. Ownership must be enabled for team assignments to take effect.",
            severity: "warning",
            recommendation: "Enable ownership configuration to activate team-based entity organization.",
          });
        }

        // Check 5: Segments configured (Gen3 filtering replacement for MZs)
        const segmentCount = simpleCounts.get(SETTINGS_SCHEMAS.segments) ?? 0;
        if (config.segments.enabled) {
          checks.push({
            name: "Segments configured (Gen3)",
            weight: config.segments.weight,
            result: segmentCount >= config.segments.criticalMax ? "pass" :
              segmentCount >= config.segments.warningMax ? "partial" : "fail",
            partialValue: segmentCount > 0 ? Math.min(0.4 + (segmentCount * 0.15), 0.9) : undefined,
          });
          findings.push({
            id: "tag-segments",
            title: segmentCount === 0 ? "No segments configured" : `${segmentCount} segment(s) configured — Gen3 filtering`,
            description: segmentCount === 0
              ? "Segments are the Gen3 replacement for management zones as a filtering mechanism."
              : "Segments provide Gen3 data filtering, replacing management zones for Grail data scoping.",
            severity: getGen3Severity(segmentCount, config.segments),
            recommendation: segmentCount === 0
              ? "Create segments to replace management zone-based filtering."
              : "Continue using segments for Grail data filtering.",
          });
        }

        // Summary — use enabled counts for Gen2 debt assessment
        const gen2Enabled = autoTagEnabled + mzEnabled;
        const gen2Disabled = autoTagDisabled + mzDisabled;
        findings.push({
          id: "tag-summary",
          title: `Organization: ${gen2Enabled} enabled Gen2 configs (${autoTagEnabled} tags, ${mzEnabled} MZs)${gen2Disabled > 0 ? `, ${gen2Disabled} disabled` : ""} vs ${ownershipTeams} Gen3 ownership teams`,
          description: gen2Enabled > 0 && ownershipTeams === 0
            ? "Environment relies entirely on Gen2 organization constructs. Migration to ownership teams is critical for Gen3 readiness."
            : gen2Enabled > 0 && ownershipTeams > 0
            ? `Mixed Gen2/Gen3 organization.${gen2Disabled > 0 ? ` ${gen2Disabled} Gen2 configs already disabled (migration progress).` : ""} Continue migrating to ownership-based organization.`
            : gen2Disabled > 0
            ? `Gen3 organization model in place. ${gen2Disabled} Gen2 configs disabled — consider deleting to finalize migration.`
            : "Gen3 organization model in place with ownership teams.",
          severity: gen2Enabled > 0 && ownershipTeams === 0 ? "warning" : gen2Enabled === 0 ? "success" : "info",
          recommendation: "Complete migration from auto-tags and management zones to ownership teams for full Gen3 readiness.",
        });

        const area = REVIEW_AREA_MAP.get("tagging")!;
        const areaWeight = getAreaWeight(config, "tagging");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: Gen2 ENABLED configs vs Gen3 (ownership teams)
        const classicSignals = (autoTagEnabled > 0 ? 1 : 0) + (mzEnabled > 0 ? 1 : 0);
        const gen3Signals = (ownershipTeams > 0 ? 1 : 0) + (ownershipConfig > 0 ? 1 : 0) + (segmentCount > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          classicSignals,
          gen3Signals,
          "{gen3} Gen3 signals vs {classic} Gen2 active configs ({pct}% migrated)"
        );

        setResult({
          areaId: "tagging",
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
            error: err instanceof Error ? err.message : "Failed to analyze tagging",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
