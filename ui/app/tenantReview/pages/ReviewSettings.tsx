import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Switch } from "@dynatrace/strato-components/forms";
import { TextInput } from "@dynatrace/strato-components/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useReviewConfig } from "../hooks/useReviewConfig";
import type { CheckMeta, CheckConfigKey } from "../types/config.types";
import { CHECK_META, DEFAULT_CONFIG, DEFAULT_AREA_WEIGHTS } from "../types/config.types";

const SECTION_ORDER: { title: string; areaId: string; checks: CheckConfigKey[] }[] = [
  {
    title: "Tagging & Organization",
    areaId: "tagging",
    checks: ["autoTagging", "managementZones", "ownershipTeams", "segments"],
  },
  {
    title: "Alerting & Automation",
    areaId: "alerting",
    checks: ["alertingProfiles", "classicNotifications", "metricEvents", "davisAnomalyDetectors", "davisEvents", "workflows", "davisNotifWorkflows", "issueTracking", "frequentIssues", "openProblems", "problemFrequency", "workflowExecutionHealth"],
  },
  {
    title: "Dashboards & Visualization",
    areaId: "dashboards",
    checks: ["classicDashboards", "grailDashboards", "notebooks", "lookupTables", "documentSharing", "trashedDocuments"],
  },
  {
    title: "Monitoring & Smartscape",
    areaId: "monitoring",
    checks: ["slos", "k8sClusters", "declarativeGrouping", "reliabilityGuardian", "monitoringCandidates", "smartscapeGrail", "agAutoUpdate", "agGroups", "releaseTracking"],
  },
  {
    title: "Data Storage & Grail",
    areaId: "storage",
    checks: ["customBuckets", "businessEvents", "otelTraces", "bizeventsProcessing"],
  },
  {
    title: "Log Monitoring & OpenPipeline",
    areaId: "logs",
    checks: ["openPipelineDepth", "calcLogMetrics"],
  },
  {
    title: "Security",
    areaId: "security",
    checks: ["criticalSecurityEvents", "highSecurityEvents", "attacksDetected"],
  },
  {
    title: "Synthetic Monitoring",
    areaId: "synthetic",
    checks: ["namMonitors", "syntheticGrailExecution"],
  },
  {
    title: "RUM & Mobile",
    areaId: "rum",
    checks: ["mobileApps"],
  },
  {
    title: "API & Access",
    areaId: "api-access",
    checks: ["apiTokens", "disabledTokens", "credentialVaultItems"],
  },
];

const CheckRow: React.FC<{
  checkId: CheckConfigKey;
  meta: CheckMeta;
}> = ({ checkId, meta }) => {
  const { config, updateCheck } = useReviewConfig();
  const check = config[checkId];
  const defaults = DEFAULT_CONFIG[checkId];

  return (
    <Flex
      flexDirection="row"
      alignItems="center"
      gap={12}
      style={{
        padding: "8px 16px",
        borderRadius: "6px",
        backgroundColor: check.enabled ? "transparent" : "rgba(128,128,128,0.05)",
        opacity: check.enabled ? 1 : 0.5,
      }}
    >
      <Flex style={{ minWidth: "36px" }}>
        <Switch
          value={check.enabled}
          onChange={(val) => { updateCheck(checkId, { enabled: val }); }}
        />
      </Flex>

      <Flex flexDirection="column" gap={2} style={{ flex: 1, minWidth: "180px" }}>
        <Text style={{ fontWeight: 600, fontSize: "13px" }}>{meta.label}</Text>
        <Text style={{ fontSize: "11px", opacity: 0.6 }}>{meta.description}</Text>
      </Flex>

      <Flex gap={8} alignItems="center">
        <Flex flexDirection="column" alignItems="center" gap={2}>
          <Text style={{ fontSize: "10px", fontWeight: 600, opacity: 0.7 }}>
            Weight
          </Text>
          <TextInput
            value={String(check.weight)}
            onChange={(val) => { updateCheck(checkId, { weight: parseFloat(val) || 0 }); }}
            disabled={!check.enabled}
            style={{ width: "56px", textAlign: "center" }}
          />
          {check.weight !== defaults.weight && (
            <Text style={{ fontSize: "9px", opacity: 0.4 }}>def: {defaults.weight}</Text>
          )}
        </Flex>

        <Flex flexDirection="column" alignItems="center" gap={2}>
          <Text style={{ fontSize: "10px", fontWeight: 600, color: Colors.Text.Warning.Default }}>
            {meta.direction === "gen2Debt" ? "Warn >" : "Good ≥"}
          </Text>
          <TextInput
            value={String(check.warningMax)}
            onChange={(val) => { updateCheck(checkId, { warningMax: Number(val) || 0 }); }}
            disabled={!check.enabled}
            style={{ width: "64px", textAlign: "center" }}
          />
          {check.warningMax !== defaults.warningMax && (
            <Text style={{ fontSize: "9px", opacity: 0.4 }}>def: {defaults.warningMax}</Text>
          )}
        </Flex>

        <Flex flexDirection="column" alignItems="center" gap={2}>
          <Text style={{ fontSize: "10px", fontWeight: 600, color: meta.direction === "gen2Debt" ? Colors.Text.Critical.Default : Colors.Text.Success.Default }}>
            {meta.direction === "gen2Debt" ? "Crit >" : "Excel ≥"}
          </Text>
          <TextInput
            value={String(check.criticalMax)}
            onChange={(val) => { updateCheck(checkId, { criticalMax: Number(val) || 0 }); }}
            disabled={!check.enabled}
            style={{ width: "64px", textAlign: "center" }}
          />
          {check.criticalMax !== defaults.criticalMax && (
            <Text style={{ fontSize: "9px", opacity: 0.4 }}>def: {defaults.criticalMax}</Text>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
};

const SectionHeader: React.FC<{ title: string; areaId: string }> = ({ title, areaId }) => {
  const { config, updateAreaWeight } = useReviewConfig();
  const currentWeight = config.areaWeights[areaId]?.weight ?? DEFAULT_AREA_WEIGHTS[areaId]?.weight ?? 0.5;
  const defaultWeight = DEFAULT_AREA_WEIGHTS[areaId]?.weight ?? 0.5;

  return (
    <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: "4px" }}>
      <Heading level={3}>{title}</Heading>
      <Flex alignItems="center" gap={8}>
        <Text style={{ fontSize: "11px", fontWeight: 600, opacity: 0.7 }}>Area Weight:</Text>
        <TextInput
          value={String(currentWeight)}
          onChange={(val) => { updateAreaWeight(areaId, parseFloat(val) || 0); }}
          style={{ width: "56px", textAlign: "center" }}
        />
        {currentWeight !== defaultWeight && (
          <Text style={{ fontSize: "9px", opacity: 0.4 }}>def: {defaultWeight}</Text>
        )}
      </Flex>
    </Flex>
  );
};

export const ReviewSettings: React.FC = () => {
  const { config, isDefault, resetToDefaults, configMode, setConfigMode, saveGlobal, loadGlobal, globalStatus, isLoading, updateBetaFeature } = useReviewConfig();

  return (
    <Flex flexDirection="column" gap={24}>
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex flexDirection="column" gap={8}>
          <Heading level={1}>Review Configuration</Heading>
          <Text>
            Customize weights, thresholds, and enable/disable checks.
            Area weights control how much each area contributes to the overall score.
            Check weights control importance within each area.
          </Text>
        </Flex>
        <Flex gap={8}>
          <Button
            onClick={resetToDefaults}
            disabled={isDefault}
            variant="emphasized"
            color="neutral"
          >
            Reset to Defaults
          </Button>
        </Flex>
      </Flex>

      {/* Storage mode toggle */}
      <Flex
        alignItems="center"
        gap={16}
        style={{
          padding: "12px 16px",
          borderRadius: "6px",
          backgroundColor: "rgba(128, 128, 128, 0.04)",
          border: "1px solid rgba(128, 128, 128, 0.12)",
        }}
      >
        <Text style={{ fontWeight: 600, fontSize: "13px" }}>Storage:</Text>
        <Flex gap={8}>
          <Button
            onClick={() => { setConfigMode("local"); }}
            variant={configMode === "local" ? "emphasized" : "default"}
            color={configMode === "local" ? "primary" : "neutral"}
          >
            Local (this browser)
          </Button>
          <Button
            onClick={() => { setConfigMode("global"); }}
            variant={configMode === "global" ? "emphasized" : "default"}
            color={configMode === "global" ? "primary" : "neutral"}
          >
            Global (all users)
          </Button>
        </Flex>
        {configMode === "global" && (
          <Flex gap={8} alignItems="center">
            <Button onClick={() => { void saveGlobal(); }} variant="default" color="neutral" disabled={isLoading}>
              Save Now
            </Button>
            <Button onClick={() => { void loadGlobal(); }} variant="default" color="neutral" disabled={isLoading}>
              Reload
            </Button>
          </Flex>
        )}
        <Text style={{ fontSize: "11px", opacity: 0.6, flex: 1 }}>
          {configMode === "local"
            ? "Changes saved to this browser only. Other users see their own settings."
            : "Changes auto-save to Dynatrace (1.5s debounce). All users share this configuration."}
        </Text>
      </Flex>

      {/* Global status message */}
      {globalStatus && configMode === "global" && (
        <Text style={{ fontSize: "12px", fontStyle: "italic", opacity: 0.7 }}>
          {globalStatus}
        </Text>
      )}

      {/* Beta features toggle */}
      <Flex
        flexDirection="column"
        gap={8}
        style={{
          padding: "12px 16px",
          borderRadius: "6px",
          backgroundColor: "rgba(128, 128, 128, 0.04)",
          border: "1px solid rgba(128, 128, 128, 0.12)",
        }}
      >
        <Text style={{ fontWeight: 600, fontSize: "13px" }}>Beta Features</Text>
        <Flex alignItems="center" gap={12}>
          <Switch
            value={config.betaFeatures.showBestPractices}
            onChange={(val) => { updateBetaFeature("showBestPractices", val); }}
          />
          <Flex flexDirection="column" gap={2}>
            <Text style={{ fontSize: "13px", fontWeight: 600 }}>Best Practices</Text>
            <Text style={{ fontSize: "11px", opacity: 0.6 }}>
              Show the Best Practices tab — evaluates tenant against platform governance best practices (21 categories).
            </Text>
          </Flex>
        </Flex>
      </Flex>

      {!isDefault && (
        <Flex
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            backgroundColor: "rgba(255, 193, 7, 0.08)",
            borderLeft: `4px solid ${Colors.Text.Warning.Default}`,
          }}
        >
          <Text style={{ fontSize: "13px" }}>
            Custom configuration active. Scores reflect your custom weights and thresholds.
          </Text>
        </Flex>
      )}

      {SECTION_ORDER.map((section) => (
        <Flex key={section.title} flexDirection="column" gap={4}>
          <SectionHeader title={section.title} areaId={section.areaId} />
          {section.checks.map((checkId) => (
            <CheckRow
              key={checkId}
              checkId={checkId}
              meta={CHECK_META[checkId]}
            />
          ))}
        </Flex>
      ))}
    </Flex>
  );
};
