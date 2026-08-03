export const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export const scoreByTarget = (value, target) => {
  if (target <= 0) return 0;
  return clamp((Number(value || 0) / target) * 100);
};

export const inverseScore = (value, warning, critical) => {
  const n = Number(value || 0);
  if (n <= warning) return 100;
  if (n >= critical) return 0;
  return clamp(100 - ((n - warning) / (critical - warning)) * 100);
};

export const statusForScore = (score) => {
  if (score >= 80) return "Effective";
  if (score >= 60) return "Operationalizing";
  if (score >= 40) return "Underused";
  return "Needs focus";
};

export function firstRecord(dqlResults, queryId) {
  return dqlResults?.[queryId]?.records?.[0] ?? {};
}

export function records(dqlResults, queryId) {
  return dqlResults?.[queryId]?.records ?? [];
}

export function numericField(dqlResults, queryId, fields) {
  const record = firstRecord(dqlResults, queryId);
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

export function countFromApi(apiResults, id, candidateFields = ["totalCount", "count", "total"]) {
  const body = apiResults?.[id]?.body;
  if (!body || typeof body !== "object") return 0;
  for (const field of candidateFields) {
    const value = body[field];
    if (typeof value === "number") return value;
  }
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

export function calculateOes({ dqlResults = {}, apiResults = {}, settingsCounts = {} }) {
  const problemCount = numericField(dqlResults, "recentProblems", ["count()", "total"]);
  const davisEventCount = numericField(dqlResults, "davisEvents", ["total", "count()"]);
  const closedProblems = records(dqlResults, "problemsByStatus")
    .filter((record) => String(record["event.status"] ?? "").toUpperCase().includes("CLOSED"))
    .reduce((sum, record) => sum + Number(record["count()"] ?? 0), 0);
  const closureRate = problemCount > 0 ? (closedProblems / problemCount) * 100 : 0;
  const issueTracking = settingsCounts["builtin:issue-tracking.integration"] ?? 0;
  const frequentIssues = settingsCounts["builtin:anomaly-detection.frequent-issues"] ?? 0;

  const wfDqlTotal = numericField(dqlResults, "workflowExecutionHealth", ["total"]);
  const wfDqlSuccessRate = numericField(dqlResults, "workflowExecutionHealth", ["successRate"]);
  const workflowExecutions = apiResults.workflowExecutions?.summary ?? {};
  const wfTotal = workflowExecutions.totalCount ?? wfDqlTotal;
  const wfSuccessRate = wfTotal > 0
    ? ((workflowExecutions.successCount ?? 0) / wfTotal) * 100 || wfDqlSuccessRate
    : 0;
  const wfWithExecutions = workflowExecutions.workflowsWithExecutions ?? 0;
  const ownerCount = settingsCounts["builtin:ownership.teams"] ?? 0;
  const deploymentCount = numericField(dqlResults, "deploymentEvents", ["total"]);

  const ownershipConfig = settingsCounts["builtin:ownership.config"] ?? 0;
  const autoTags = settingsCounts["builtin:tags.auto-tagging"] ?? 0;
  const managementZones = settingsCounts["builtin:management-zones"] ?? 0;
  const segments = settingsCounts["builtin:segment"] ?? 0;
  const openPipelineConfigs = records(dqlResults, "openPipelineIngestByConfig").length
    + (settingsCounts["builtin:openpipeline.logs.pipelines"] ?? 0)
    + (settingsCounts["builtin:openpipeline.metrics.pipelines"] ?? 0);
  const spanTotal = numericField(dqlResults, "spanDataQuality", ["total"]);
  const spanWithService = numericField(dqlResults, "spanDataQuality", ["withServiceName"]);
  const spanQualityScore = spanTotal > 0 ? (spanWithService / spanTotal) * 100 : 0;
  const bizeventTotal = numericField(dqlResults, "bizeventsDataQuality", ["total"]);
  const bizeventWithType = numericField(dqlResults, "bizeventsDataQuality", ["withType"]);
  const bizeventQualityScore = bizeventTotal > 0 ? (bizeventWithType / bizeventTotal) * 100 : 0;
  const logTotal = numericField(dqlResults, "debugLogVolume", ["total"]);
  const debugCount = numericField(dqlResults, "debugLogVolume", ["debugCount"]);
  const debugRatio = logTotal > 0 ? (debugCount / logTotal) * 100 : 0;

  const dashboardCount = countFromApi(apiResults, "grailDashboards", ["totalCount"])
    + countFromApi(apiResults, "notebooks", ["totalCount"]);
  const sharedDocs = countFromApi(apiResults, "documentShares", ["totalCount"]);
  const auditTotal = numericField(dqlResults, "auditLogRecentActivity", ["total"]);
  const uniqueUsers = numericField(dqlResults, "auditLogRecentActivity", ["uniqueUsers"]);
  const pipelineRows = records(dqlResults, "openPipelineIngestByConfig").length;

  const signalsEvidence = [
    { label: "Davis problem signal", value: `${problemCount} problems / 7d`, score: scoreByTarget(problemCount, 25), note: "Enough signal exists for operations to learn from recurring conditions." },
    { label: "Problem closure", value: `${Math.round(closureRate)}% closed`, score: problemCount > 0 ? clamp(closureRate) : 20, note: "Closed problems indicate teams are acting on Davis signals." },
    { label: "Davis events in Grail", value: String(davisEventCount), score: scoreByTarget(davisEventCount, 1000), note: "Davis events in Grail enable investigation and automation paths." },
    { label: "Issue tracking", value: `${issueTracking} integrations`, score: scoreByTarget(issueTracking, 1), note: "Tickets connect trusted signals to accountable work." },
    { label: "Noise management", value: `${frequentIssues} frequent issue configs`, score: scoreByTarget(frequentIssues, 1), note: "Frequent issue detection helps reduce recurring alert fatigue." },
  ];

  const automationEvidence = [
    { label: "Workflow execution volume", value: `${wfTotal} executions / 30d`, score: scoreByTarget(wfTotal, 50), note: "Execution volume shows automation is actively used, not just configured." },
    { label: "Workflow reliability", value: `${Math.round(wfSuccessRate)}% success`, score: wfTotal > 0 ? clamp(wfSuccessRate) : 0, note: "Reliable workflows are required before teams trust automated response." },
    { label: "Workflows with activity", value: String(wfWithExecutions), score: scoreByTarget(wfWithExecutions, 5), note: "Multiple active workflows imply broader operational coverage." },
    { label: "Ownership distribution", value: `${ownerCount} teams`, score: scoreByTarget(ownerCount, 5), note: "Ownership teams make automation route to accountable responders." },
    { label: "Deployment signal", value: `${deploymentCount} events / 7d`, score: scoreByTarget(deploymentCount, 20), note: "Deployment events let Davis correlate incidents with releases." },
  ];

  const foundationEvidence = [
    { label: "Ownership model", value: `${ownerCount} teams / ${ownershipConfig} configs`, score: scoreByTarget(ownerCount + ownershipConfig, 5), note: "Ownership metadata turns telemetry into assigned action." },
    { label: "Tagging and segmentation", value: `${autoTags} tags, ${managementZones} MZs, ${segments} segments`, score: scoreByTarget(autoTags + managementZones + segments, 25), note: "Consistent metadata improves filtering, routing, and reporting." },
    { label: "OpenPipeline adoption", value: `${openPipelineConfigs} signals`, score: scoreByTarget(openPipelineConfigs, 3), note: "Pipeline usage shows telemetry is being shaped before consumption." },
    { label: "Span metadata quality", value: `${Math.round(spanQualityScore)}% with service.name`, score: spanTotal > 0 ? clamp(spanQualityScore) : 35, note: "Trace metadata determines how useful distributed traces are in practice." },
    { label: "Business event quality", value: `${Math.round(bizeventQualityScore)}% typed`, score: bizeventTotal > 0 ? clamp(bizeventQualityScore) : 35, note: "Typed business events are easier to query, alert on, and explain." },
    { label: "Debug log discipline", value: `${Math.round(debugRatio)}% debug/trace`, score: logTotal > 0 ? inverseScore(debugRatio, 10, 35) : 60, note: "High debug/trace volume can dilute useful signals and inflate cost." },
  ];

  const engagementEvidence = [
    { label: "Dashboards and notebooks", value: String(dashboardCount), score: scoreByTarget(dashboardCount, 20), note: "Reusable views indicate teams consume platform data repeatedly." },
    { label: "Shared documents", value: String(sharedDocs), score: scoreByTarget(sharedDocs, 5), note: "Shared assets point to team-level adoption, not isolated usage." },
    { label: "Audit activity", value: `${auditTotal} events / 30d`, score: scoreByTarget(auditTotal, 500), note: "Audit activity is a proxy for administrative and operational engagement." },
    { label: "Distinct users", value: String(uniqueUsers), score: scoreByTarget(uniqueUsers, 10), note: "Broader user activity means value is spreading beyond one operator." },
    { label: "Pipeline data consumption", value: `${pipelineRows} data types`, score: scoreByTarget(pipelineRows, 4), note: "Multiple data types flowing through pipelines imply active data shaping." },
  ];

  const avg = (items) => clamp(items.reduce((sum, item) => sum + item.score, 0) / items.length);
  const pillars = [
    { id: "signals", title: "Signals & Trust", weight: 35, score: avg(signalsEvidence), evidence: signalsEvidence },
    { id: "automation", title: "Automation", weight: 35, score: avg(automationEvidence), evidence: automationEvidence },
    { id: "foundation", title: "Foundation", weight: 20, score: avg(foundationEvidence), evidence: foundationEvidence },
    { id: "engagement", title: "Engagement", weight: 10, score: avg(engagementEvidence), evidence: engagementEvidence },
  ];
  const overallScore = clamp(pillars.reduce((sum, pillar) => sum + pillar.score * (pillar.weight / 100), 0));
  return { overallScore, status: statusForScore(overallScore), pillars };
}
