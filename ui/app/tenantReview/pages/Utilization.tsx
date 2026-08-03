import React, { useEffect, useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { functions } from "@dynatrace-sdk/app-utils";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { getDashboardSummary, type DashboardSummary } from "../services/dashboardService";
import { getSettingsObjectCounts } from "../services/settingsService";
import { LoadingState } from "../components/shared/LoadingState";

type PillarId = "signals" | "automation" | "foundation" | "engagement";

interface Evidence {
  label: string;
  value: string;
  score: number;
  note: string;
}

interface Pillar {
  id: PillarId;
  title: string;
  weight: number;
  accent: string;
  score: number;
  summary: string;
  evidence: Evidence[];
}

interface WorkflowExecutions {
  totalCount: number;
  successCount: number;
  errorCount: number;
  cancelledCount: number;
  triggerTypeCounts: Record<string, number>;
  workflowsWithExecutions: number;
  error?: string;
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const scoreByTarget = (value: number, target: number) => {
  if (target <= 0) return 0;
  return clamp((value / target) * 100);
};

const inverseScore = (value: number, warning: number, critical: number) => {
  if (value <= warning) return 100;
  if (value >= critical) return 0;
  return clamp(100 - ((value - warning) / (critical - warning)) * 100);
};

const formatNumber = (value: number) => value.toLocaleString();
const formatSettingCount = (value: number | null | undefined) =>
  value == null ? "N/A" : formatNumber(value);

const firstRecord = (query: ReturnType<typeof useDql>) =>
  (query.data?.records?.[0] ?? {}) as Record<string, unknown>;

const numericField = (query: ReturnType<typeof useDql>, fields: string[]) => {
  const record = firstRecord(query);
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
};

const successRateFromFunction = (exec: WorkflowExecutions | null) => {
  if (!exec || exec.totalCount === 0) return 0;
  return (exec.successCount / exec.totalCount) * 100;
};

const statusForScore = (score: number) => {
  if (score >= 80) return "Effective";
  if (score >= 60) return "Operationalizing";
  if (score >= 40) return "Underused";
  return "Needs focus";
};

const scoreColor = (score: number) => {
  if (score >= 80) return Colors.Text.Success.Default;
  if (score >= 60) return Colors.Text.Warning.Default;
  return Colors.Text.Critical.Default;
};

const Bar: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <div style={{ height: 8, borderRadius: 999, background: "#ECECF1", overflow: "hidden" }}>
    <div style={{ width: `${clamp(value)}%`, height: "100%", borderRadius: 999, background: color }} />
  </div>
);

const ScoreHero: React.FC<{ score: number; pillars: Pillar[] }> = ({ score, pillars }) => (
  <section
    style={{
      background: "#FFFFFF",
      borderRadius: 8,
      padding: "24px",
      borderTop: "3px solid #4F56D9",
    }}
  >
    <Flex justifyContent="space-between" alignItems="center" gap={32} flexWrap="wrap">
      <Flex flexDirection="column" gap={8}>
        <Text style={{ fontSize: 12, fontWeight: 800, color: "#777A91", letterSpacing: 1, textTransform: "uppercase" }}>
          Overall Effective Score
        </Text>
        <Flex alignItems="baseline" gap={12}>
          <Text style={{ fontSize: 64, lineHeight: "68px", fontWeight: 900, color: "#30314D" }}>{score}</Text>
          <Text style={{ fontSize: 20, fontWeight: 800, color: scoreColor(score) }}>{statusForScore(score)}</Text>
        </Flex>
        <Text style={{ maxWidth: 680, color: "#5D6077", lineHeight: 1.55 }}>
          Measures whether Dynatrace data is being converted into trusted signals, automated response,
          consistent operating foundations, and active engagement.
        </Text>
      </Flex>
      <Flex flexDirection="column" gap={12} style={{ minWidth: 360, flex: "1 1 360px" }}>
        {pillars.map((pillar) => (
          <div key={pillar.id} style={{ display: "grid", gridTemplateColumns: "160px 1fr 42px", gap: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 12, fontWeight: 800, color: "#555873" }}>{pillar.title}</Text>
            <Bar value={pillar.score} color={pillar.accent} />
            <Text style={{ textAlign: "right", fontSize: 12, fontWeight: 800, color: "#30314D" }}>{pillar.score}</Text>
          </div>
        ))}
      </Flex>
    </Flex>
  </section>
);

const PillarCard: React.FC<{ pillar: Pillar }> = ({ pillar }) => (
  <section
    style={{
      background: "#FFFFFF",
      borderRadius: 8,
      borderTop: `3px solid ${pillar.accent}`,
      padding: "18px 20px",
      minWidth: 260,
      flex: "1 1 420px",
    }}
  >
    <Flex flexDirection="column" gap={16}>
      <Flex justifyContent="space-between" alignItems="flex-start" gap={16}>
        <Flex flexDirection="column" gap={4}>
          <Heading level={3} style={{ margin: 0, color: "#30314D" }}>{pillar.title}</Heading>
          <Text style={{ fontSize: 12, color: "#8A8CA0" }}>{pillar.weight}% of OES</Text>
        </Flex>
        <Text style={{ fontSize: 32, lineHeight: "36px", fontWeight: 900, color: scoreColor(pillar.score) }}>
          {pillar.score}
        </Text>
      </Flex>
      <Text style={{ fontSize: 13, lineHeight: 1.5, color: "#5D6077" }}>{pillar.summary}</Text>
      <Flex flexDirection="column" gap={12}>
        {pillar.evidence.map((item) => (
          <Flex key={item.label} flexDirection="column" gap={6}>
            <Flex justifyContent="space-between" gap={12}>
              <Text style={{ fontSize: 12, fontWeight: 800, color: "#555873" }}>{item.label}</Text>
              <Text style={{ fontSize: 12, fontWeight: 800, color: "#30314D" }}>{item.value}</Text>
            </Flex>
            <Bar value={item.score} color={pillar.accent} />
            <Text style={{ fontSize: 11, color: "#8A8CA0" }}>{item.note}</Text>
          </Flex>
        ))}
      </Flex>
    </Flex>
  </section>
);

const RecommendationList: React.FC<{ pillars: Pillar[] }> = ({ pillars }) => {
  const weakSignals = pillars
    .flatMap((pillar) => pillar.evidence.map((evidence) => ({ pillar, evidence })))
    .sort((a, b) => a.evidence.score - b.evidence.score)
    .slice(0, 5);

  const actionFor = (pillar: Pillar, evidence: Evidence) => {
    if (pillar.id === "automation") return "Create or harden workflows for Davis problem routing, owner notification, and low-risk remediation.";
    if (pillar.id === "signals") return "Tune Davis signal quality: reduce stale/noisy problems, enable issue tracking, and connect problem events to workflows.";
    if (pillar.id === "foundation") return "Standardize ownership, tags, segments, and OpenPipeline routing so signals can be trusted and assigned.";
    return "Increase operational engagement with shared dashboards, notebooks, lookup tables, and regular Grail usage.";
  };

  return (
    <section style={{ background: "#FFFFFF", borderRadius: 8, padding: "20px 24px", borderTop: "3px solid #30314D" }}>
      <Flex flexDirection="column" gap={16}>
        <Heading level={3} style={{ margin: 0, color: "#30314D" }}>Highest ROI Actions</Heading>
        {weakSignals.map(({ pillar, evidence }, index) => (
          <div key={`${pillar.id}-${evidence.label}`} style={{ display: "grid", gridTemplateColumns: "34px 1fr 64px", gap: 14, alignItems: "start", padding: "10px 0", borderTop: index === 0 ? "none" : "1px solid #EEEFF4" }}>
            <Text style={{ fontSize: 18, fontWeight: 900, color: pillar.accent }}>{index + 1}</Text>
            <Flex flexDirection="column" gap={4}>
              <Text style={{ fontSize: 13, fontWeight: 800, color: "#30314D" }}>{evidence.label}</Text>
              <Text style={{ fontSize: 12, color: "#686B80", lineHeight: 1.5 }}>{actionFor(pillar, evidence)}</Text>
            </Flex>
            <Text style={{ textAlign: "right", fontWeight: 900, color: scoreColor(evidence.score) }}>{evidence.score}</Text>
          </div>
        ))}
      </Flex>
    </section>
  );
};

export const Utilization: React.FC = () => {
  const problems = useDql(DQL_QUERIES.recentProblems);
  const problemStatus = useDql(DQL_QUERIES.problemsByStatus);
  const davisEvents = useDql(DQL_QUERIES.davisEvents);
  const workflowHealth = useDql(DQL_QUERIES.workflowExecutionHealth);
  const deploymentEvents = useDql(DQL_QUERIES.deploymentEvents);
  const auditActivity = useDql(DQL_QUERIES.auditLogRecentActivity);
  const bizeventQuality = useDql(DQL_QUERIES.bizeventsDataQuality);
  const spanQuality = useDql(DQL_QUERIES.spanDataQuality);
  const debugLogs = useDql(DQL_QUERIES.debugLogVolume);
  const openPipeline = useDql(DQL_QUERIES.openPipelineIngestByConfig);

  const [workflowExecutions, setWorkflowExecutions] = useState<WorkflowExecutions | null>(null);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [settingsCounts, setSettingsCounts] = useState<Map<string, number | null>>(new Map());
  const [sdkLoading, setSdkLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSdkLoading(true);
      const schemaIds = [
        SETTINGS_SCHEMAS.ownershipTeams,
        SETTINGS_SCHEMAS.ownershipConfig,
        SETTINGS_SCHEMAS.autoTagging,
        SETTINGS_SCHEMAS.managementZones,
        SETTINGS_SCHEMAS.segments,
        SETTINGS_SCHEMAS.issueTracking,
        SETTINGS_SCHEMAS.frequentIssues,
        SETTINGS_SCHEMAS.openPipelineLogs,
        SETTINGS_SCHEMAS.openPipelineMetrics,
      ];
      const [workflowResponse, dashboards, counts] = await Promise.all([
        functions.call("workflowExecutions").then((res) => res.json() as Promise<WorkflowExecutions>).catch(() => null),
        getDashboardSummary().catch(() => null),
        getSettingsObjectCounts(schemaIds).catch(() => new Map<string, number | null>()),
      ]);
      if (!cancelled) {
        setWorkflowExecutions(workflowResponse);
        setDashboardSummary(dashboards);
        setSettingsCounts(counts);
        setSdkLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const dqlLoading = [
    problems, problemStatus, davisEvents, workflowHealth, deploymentEvents,
    auditActivity, bizeventQuality, spanQuality, debugLogs, openPipeline,
  ].some((query) => query.isLoading || query.isPending);

  const pillars = useMemo<Pillar[]>(() => {
    const problemCount = numericField(problems, ["count()", "total"]);
    const davisEventCount = numericField(davisEvents, ["total", "count()"]);
    const closedProblems = (problemStatus.data?.records ?? [])
      .filter((record) => String((record as Record<string, unknown>)["event.status"] ?? "").toUpperCase().includes("CLOSED"))
      .reduce((sum, record) => sum + Number((record as Record<string, unknown>)["count()"] ?? 0), 0);
    const closureRate = problemCount > 0 ? (closedProblems / problemCount) * 100 : 0;
    const settingRaw = (schema: string) => settingsCounts.get(schema);
    const settingKnown = (schema: string) => settingRaw(schema) != null;
    const settingCount = (schema: string) => settingRaw(schema) ?? 0;

    const issueTrackingRaw = settingRaw(SETTINGS_SCHEMAS.issueTracking);
    const issueTracking = issueTrackingRaw ?? 0;
    const frequentIssuesRaw = settingRaw(SETTINGS_SCHEMAS.frequentIssues);
    const frequentIssues = frequentIssuesRaw ?? 0;

    const wfDqlTotal = numericField(workflowHealth, ["total"]);
    const wfDqlSuccessRate = numericField(workflowHealth, ["successRate"]);
    const wfTotal = workflowExecutions?.totalCount || wfDqlTotal;
    const wfSuccessRate = workflowExecutions?.totalCount ? successRateFromFunction(workflowExecutions) : wfDqlSuccessRate;
    const wfWithExecutions = workflowExecutions?.workflowsWithExecutions ?? 0;
    const ownerCountRaw = settingRaw(SETTINGS_SCHEMAS.ownershipTeams);
    const ownerCount = ownerCountRaw ?? 0;
    const deploymentCount = numericField(deploymentEvents, ["total"]);

    const ownershipConfigRaw = settingRaw(SETTINGS_SCHEMAS.ownershipConfig);
    const ownershipConfig = ownershipConfigRaw ?? 0;
    const autoTagsRaw = settingRaw(SETTINGS_SCHEMAS.autoTagging);
    const autoTags = autoTagsRaw ?? 0;
    const managementZonesRaw = settingRaw(SETTINGS_SCHEMAS.managementZones);
    const managementZones = managementZonesRaw ?? 0;
    const segmentsRaw = settingRaw(SETTINGS_SCHEMAS.segments);
    const segments = segmentsRaw ?? 0;
    const openPipelineConfigs = (openPipeline.data?.records?.length ?? 0)
      + settingCount(SETTINGS_SCHEMAS.openPipelineLogs)
      + settingCount(SETTINGS_SCHEMAS.openPipelineMetrics);
    const spanTotal = numericField(spanQuality, ["total"]);
    const spanWithService = numericField(spanQuality, ["withServiceName"]);
    const spanQualityScore = spanTotal > 0 ? (spanWithService / spanTotal) * 100 : 0;
    const bizeventTotal = numericField(bizeventQuality, ["total"]);
    const bizeventWithType = numericField(bizeventQuality, ["withType"]);
    const bizeventQualityScore = bizeventTotal > 0 ? (bizeventWithType / bizeventTotal) * 100 : 0;
    const logTotal = numericField(debugLogs, ["total"]);
    const debugCount = numericField(debugLogs, ["debugCount"]);
    const debugRatio = logTotal > 0 ? (debugCount / logTotal) * 100 : 0;

    const dashboardCount = (dashboardSummary?.grailDashboardCount ?? 0) + (dashboardSummary?.notebookCount ?? 0);
    const sharedDocs = dashboardSummary?.sharedDocumentCount ?? 0;
    const auditTotal = numericField(auditActivity, ["total"]);
    const uniqueUsers = numericField(auditActivity, ["uniqueUsers"]);
    const pipelineRows = openPipeline.data?.records?.length ?? 0;
    const gen2OrgDebt = autoTags + managementZones;
    const metadataScore = settingKnown(SETTINGS_SCHEMAS.autoTagging)
      || settingKnown(SETTINGS_SCHEMAS.managementZones)
      || settingKnown(SETTINGS_SCHEMAS.segments)
      ? clamp((scoreByTarget(segments + ownerCount + ownershipConfig, 8) * 0.75) + (inverseScore(gen2OrgDebt, 0, 20) * 0.25))
      : 0;

    const signalsEvidence: Evidence[] = [
      { label: "Davis signal presence", value: `${formatNumber(problemCount)} problems / 30d`, score: davisEventCount > 0 ? 100 : problemCount > 0 ? 70 : 0, note: "Recent Davis problems or events prove the signal path is active." },
      { label: "Problem closure", value: problemCount > 0 ? `${Math.round(closureRate)}% closed` : "No problem history", score: problemCount > 0 ? closureRate : 0, note: "Closed problems indicate teams are acting on Davis signals." },
      { label: "Problem noise control", value: `${formatNumber(problemCount)} problems / 30d`, score: problemCount > 0 ? inverseScore(problemCount, 50, 200) : davisEventCount > 0 ? 100 : 0, note: "High problem volume lowers effectiveness even when signal generation is active." },
      { label: "Davis events in Grail", value: formatNumber(davisEventCount), score: scoreByTarget(davisEventCount, 1000), note: "Davis events in Grail enable investigation and automation paths." },
      { label: "Issue tracking", value: `${formatSettingCount(issueTrackingRaw)} integrations`, score: issueTrackingRaw == null ? 0 : scoreByTarget(issueTracking, 1), note: issueTrackingRaw == null ? "Could not verify issue tracking configuration." : "Tickets connect trusted signals to accountable work." },
      { label: "Frequent issue detection", value: `${formatSettingCount(frequentIssuesRaw)} configs`, score: frequentIssuesRaw == null ? 0 : scoreByTarget(frequentIssues, 1), note: frequentIssuesRaw == null ? "Could not verify frequent issue detection configuration." : "Frequent issue detection helps reduce recurring alert fatigue." },
    ];

    const automationEvidence: Evidence[] = [
      { label: "Workflow execution volume", value: `${formatNumber(wfTotal)} executions / 30d`, score: scoreByTarget(wfTotal, 50), note: "Execution volume shows automation is actively used, not just configured." },
      { label: "Workflow reliability", value: `${Math.round(wfSuccessRate)}% success`, score: wfTotal > 0 ? wfSuccessRate : 0, note: "Reliable workflows are required before teams trust automated response." },
      { label: "Workflows with activity", value: formatNumber(wfWithExecutions), score: scoreByTarget(wfWithExecutions, 5), note: "Multiple active workflows imply broader operational coverage." },
      { label: "Ownership distribution", value: `${formatSettingCount(ownerCountRaw)} teams`, score: ownerCountRaw == null ? 0 : scoreByTarget(ownerCount, 5), note: ownerCountRaw == null ? "Could not verify ownership teams." : "Ownership teams make automation route to accountable responders." },
      { label: "Deployment signal", value: `${formatNumber(deploymentCount)} events / 30d`, score: scoreByTarget(deploymentCount, 20), note: "Deployment events let Davis correlate incidents with releases." },
    ];

    const foundationEvidence: Evidence[] = [
      { label: "Ownership model", value: `${formatSettingCount(ownerCountRaw)} teams / ${formatSettingCount(ownershipConfigRaw)} configs`, score: ownerCountRaw == null && ownershipConfigRaw == null ? 0 : scoreByTarget(ownerCount + ownershipConfig, 5), note: "Ownership metadata turns telemetry into assigned action." },
      { label: "Gen3 organization model", value: `${formatSettingCount(segmentsRaw)} segments, ${formatSettingCount(autoTagsRaw)} auto-tags, ${formatSettingCount(managementZonesRaw)} MZs`, score: metadataScore, note: "Segments and ownership improve utilization; Gen2 auto-tags and management zones reduce this score." },
      { label: "OpenPipeline adoption", value: `${formatNumber(openPipelineConfigs)} signals`, score: scoreByTarget(openPipelineConfigs, 3), note: "Pipeline usage shows telemetry is being shaped before consumption." },
      { label: "Span metadata quality", value: spanTotal > 0 ? `${Math.round(spanQualityScore)}% with service.name` : "No spans / 30d", score: spanTotal > 0 ? spanQualityScore : 0, note: "Trace metadata determines how useful distributed traces are in practice." },
      { label: "Business event quality", value: bizeventTotal > 0 ? `${Math.round(bizeventQualityScore)}% typed` : "No business events / 30d", score: bizeventTotal > 0 ? bizeventQualityScore : 0, note: "Typed business events are easier to query, alert on, and explain." },
      { label: "Debug log discipline", value: logTotal > 0 ? `${Math.round(debugRatio)}% debug/trace` : "No logs / 24h", score: logTotal > 0 ? inverseScore(debugRatio, 10, 35) : 0, note: "High debug/trace volume can dilute useful signals and inflate cost." },
    ];

    const engagementEvidence: Evidence[] = [
      { label: "Dashboards and notebooks", value: formatNumber(dashboardCount), score: scoreByTarget(dashboardCount, 20), note: "Reusable views indicate teams consume platform data repeatedly." },
      { label: "Shared documents", value: formatNumber(sharedDocs), score: scoreByTarget(sharedDocs, 5), note: "Shared assets point to team-level adoption, not isolated usage." },
      { label: "Audit activity", value: `${formatNumber(auditTotal)} events / 30d`, score: scoreByTarget(auditTotal, 500), note: "Audit activity is a proxy for administrative and operational engagement." },
      { label: "Distinct users", value: formatNumber(uniqueUsers), score: scoreByTarget(uniqueUsers, 10), note: "Broader user activity means value is spreading beyond one operator." },
      { label: "Pipeline data consumption", value: `${formatNumber(pipelineRows)} data types`, score: scoreByTarget(pipelineRows, 4), note: "Multiple data types flowing through pipelines imply active data shaping." },
    ];

    const avg = (items: Evidence[]) => clamp(items.reduce((sum, item) => sum + item.score, 0) / items.length);

    return [
      { id: "signals", title: "Signals & Trust", weight: 35, accent: "#4F56D9", score: avg(signalsEvidence), summary: "Do teams receive useful, trusted Davis signals that turn into action?", evidence: signalsEvidence },
      { id: "automation", title: "Automation", weight: 35, accent: "#2F9E8F", score: avg(automationEvidence), summary: "Are workflows reliable, active, and routed to clear owners?", evidence: automationEvidence },
      { id: "foundation", title: "Foundation", weight: 20, accent: "#8E44AD", score: avg(foundationEvidence), summary: "Is telemetry standardized enough to support scalable operations?", evidence: foundationEvidence },
      { id: "engagement", title: "Engagement", weight: 10, accent: "#F08A24", score: avg(engagementEvidence), summary: "Are people consuming, sharing, and shaping the data regularly?", evidence: engagementEvidence },
    ];
  }, [
    problems.data, problemStatus.data, davisEvents.data, workflowHealth.data,
    deploymentEvents.data, auditActivity.data, bizeventQuality.data,
    spanQuality.data, debugLogs.data, openPipeline.data,
    workflowExecutions, dashboardSummary, settingsCounts,
  ]);

  const overallScore = useMemo(() => {
    const weighted = pillars.reduce((sum, pillar) => sum + pillar.score * (pillar.weight / 100), 0);
    return clamp(weighted);
  }, [pillars]);

  if (dqlLoading || sdkLoading) {
    return <LoadingState message="Calculating consumption effectiveness..." />;
  }

  return (
    <Flex flexDirection="column" gap={24} style={{ background: "#F7F7FA", minHeight: "100%", paddingBottom: 32 }}>
      <Flex flexDirection="column" gap={4}>
        <Heading level={1} style={{ color: "#30314D", margin: 0 }}>Consumption Effectiveness</Heading>
        <Text style={{ color: "#5D6077" }}>
          Overall Effective Score across signals, automation, foundation, and engagement.
        </Text>
      </Flex>

      <ScoreHero score={overallScore} pillars={pillars} />

      <Flex gap={20} flexWrap="wrap">
        {pillars.map((pillar) => <PillarCard key={pillar.id} pillar={pillar} />)}
      </Flex>

      <RecommendationList pillars={pillars} />

      <section style={{ background: "#FFFFFF", borderRadius: 8, padding: "18px 22px", borderTop: "3px solid #8A8CA0" }}>
        <Flex flexDirection="column" gap={8}>
          <Heading level={3} style={{ margin: 0, color: "#30314D" }}>Scoring Model</Heading>
          <Text style={{ color: "#62657B", lineHeight: 1.55 }}>
            OES = Signals & Trust 35% + Automation 35% + Foundation 20% + Engagement 10%.
            Scores are directional and evidence-based: each pillar averages measurable signals already available
            from Grail, AutomationEngine, Documents, Settings, and app functions.
          </Text>
        </Flex>
      </section>
    </Flex>
  );
};
