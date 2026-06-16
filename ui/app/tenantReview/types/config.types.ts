/** Configuration for a single review check */
export interface CheckThresholdConfig {
  /** Whether this check is enabled */
  enabled: boolean;
  /** Count at or below which the check is "warning" (yellow). Above this = critical. */
  warningMax: number;
  /** Count above which the check is "critical" (red). Same as warningMax by default. */
  criticalMax: number;
  /** Weight of this check within its area (0-1). Higher = more impact on area score. */
  weight: number;
}

/** Weight configuration for a review area */
export interface AreaWeightConfig {
  /** Weight of this area in the overall tenant score (0-1). Higher = more impact. */
  weight: number;
}

/** All configurable checks keyed by check ID */
export interface ReviewConfig {
  // Tagging & Organization
  autoTagging: CheckThresholdConfig;
  managementZones: CheckThresholdConfig;
  ownershipTeams: CheckThresholdConfig;

  // Alerting
  alertingProfiles: CheckThresholdConfig;
  classicNotifications: CheckThresholdConfig;
  metricEvents: CheckThresholdConfig;
  davisAnomalyDetectors: CheckThresholdConfig;

  // Dashboards
  classicDashboards: CheckThresholdConfig;
  grailDashboards: CheckThresholdConfig;
  notebooks: CheckThresholdConfig;
  lookupTables: CheckThresholdConfig;

  // Monitoring
  slos: CheckThresholdConfig;
  k8sClusters: CheckThresholdConfig;

  // Automation
  workflows: CheckThresholdConfig;
  davisNotifWorkflows: CheckThresholdConfig;

  // Storage
  customBuckets: CheckThresholdConfig;
  businessEvents: CheckThresholdConfig;

  // Logs
  openPipelineDepth: CheckThresholdConfig;
  calcLogMetrics: CheckThresholdConfig;

  // Security
  criticalSecurityEvents: CheckThresholdConfig;
  highSecurityEvents: CheckThresholdConfig;

  // Synthetic
  namMonitors: CheckThresholdConfig;
  syntheticGrailExecution: CheckThresholdConfig;

  // Smartscape Grail (critical Gen3 signal)
  smartscapeGrail: CheckThresholdConfig;

  // API Access
  apiTokens: CheckThresholdConfig;
  disabledTokens: CheckThresholdConfig;
  credentialVaultItems: CheckThresholdConfig;

  // Alerting (Problem History)
  openProblems: CheckThresholdConfig;
  problemFrequency: CheckThresholdConfig;

  // Security (Attacks)
  attacksDetected: CheckThresholdConfig;

  // Automation (Execution Health)
  workflowExecutionHealth: CheckThresholdConfig;

  // Monitoring (AG config + Releases)
  agAutoUpdate: CheckThresholdConfig;
  agGroups: CheckThresholdConfig;
  releaseTracking: CheckThresholdConfig;

  // Dashboards (Sharing + Trash)
  documentSharing: CheckThresholdConfig;
  trashedDocuments: CheckThresholdConfig;

  // Gen3 Adoption Signals
  otelTraces: CheckThresholdConfig;
  davisEvents: CheckThresholdConfig;
  segments: CheckThresholdConfig;
  declarativeGrouping: CheckThresholdConfig;
  issueTracking: CheckThresholdConfig;
  reliabilityGuardian: CheckThresholdConfig;
  bizeventsProcessing: CheckThresholdConfig;
  monitoringCandidates: CheckThresholdConfig;
  frequentIssues: CheckThresholdConfig;
  mobileApps: CheckThresholdConfig;

  /** Area weights for overall score calculation */
  areaWeights: Record<string, AreaWeightConfig>;

  /** Beta features */
  betaFeatures: BetaFeaturesConfig;
}

/** Configuration for beta/preview features */
export interface BetaFeaturesConfig {
  /** Show the Best Practices tab (default: false) */
  showBestPractices: boolean;
}

/** Human-readable label and description for each check */
export interface CheckMeta {
  label: string;
  description: string;
  /** What the thresholds mean: "gen2Debt" = higher is worse, "gen3Adoption" = higher is better */
  direction: "gen2Debt" | "gen3Adoption";
}

/** Keys that are check configs (excludes areaWeights) */
export type CheckConfigKey = Exclude<keyof ReviewConfig, "areaWeights" | "betaFeatures">;

export const CHECK_META: Record<CheckConfigKey, CheckMeta> = {
  autoTagging: {
    label: "Auto-Tagging Rules",
    description: "Gen2 legacy — high counts indicate migration debt",
    direction: "gen2Debt",
  },
  managementZones: {
    label: "Management Zones",
    description: "Gen2 legacy — should migrate to Grail permissions",
    direction: "gen2Debt",
  },
  ownershipTeams: {
    label: "Ownership Teams",
    description: "Gen3 feature — more teams = better coverage",
    direction: "gen3Adoption",
  },
  alertingProfiles: {
    label: "Alerting Profiles",
    description: "Gen2 legacy — should migrate to Workflows",
    direction: "gen2Debt",
  },
  classicNotifications: {
    label: "Classic Notifications",
    description: "Gen2 legacy — should migrate to Workflows",
    direction: "gen2Debt",
  },
  metricEvents: {
    label: "Metric Event Rules",
    description: "Gen2 classic alerting — should migrate to Davis Analyzers",
    direction: "gen2Debt",
  },
  davisAnomalyDetectors: {
    label: "Davis Anomaly Detectors",
    description: "Gen3 AI-powered alerting — replacement for classic metric events",
    direction: "gen3Adoption",
  },
  classicDashboards: {
    label: "Classic Dashboards",
    description: "Gen2 legacy — should migrate to Grail dashboards",
    direction: "gen2Debt",
  },
  grailDashboards: {
    label: "Grail Dashboards",
    description: "Gen3 visualization — more = better adoption",
    direction: "gen3Adoption",
  },
  notebooks: {
    label: "Notebooks",
    description: "Gen3 exploratory analysis — more = better adoption",
    direction: "gen3Adoption",
  },
  lookupTables: {
    label: "Lookup Tables",
    description: "Gen3 data enrichment — more = better adoption",
    direction: "gen3Adoption",
  },
  slos: {
    label: "SLOs",
    description: "Maturity indicator — more SLOs = better reliability management",
    direction: "gen3Adoption",
  },
  k8sClusters: {
    label: "Kubernetes Clusters",
    description: "K8s monitoring — clusters detected",
    direction: "gen3Adoption",
  },
  workflows: {
    label: "AutomationEngine Workflows",
    description: "Gen3 automation — more = better adoption",
    direction: "gen3Adoption",
  },
  davisNotifWorkflows: {
    label: "Davis Notification Workflows",
    description: "Gen3 alerting replacement — Davis trigger + email/notification action",
    direction: "gen3Adoption",
  },
  customBuckets: {
    label: "Custom Grail Buckets",
    description: "Gen3 data management — more = mature segmentation",
    direction: "gen3Adoption",
  },
  businessEvents: {
    label: "Business Events",
    description: "Gen3/Grail adoption signal — presence indicates BizOps usage",
    direction: "gen3Adoption",
  },
  openPipelineDepth: {
    label: "OpenPipeline Pipelines",
    description: "Gen3 data processing — more = mature ingestion",
    direction: "gen3Adoption",
  },
  calcLogMetrics: {
    label: "Calculated Log Metrics",
    description: "Legacy — should migrate to OpenPipeline metric extraction",
    direction: "gen2Debt",
  },
  criticalSecurityEvents: {
    label: "Critical Security Events",
    description: "Security risk — 0 is ideal",
    direction: "gen2Debt",
  },
  highSecurityEvents: {
    label: "High Security Events",
    description: "Security risk — lower is better",
    direction: "gen2Debt",
  },
  namMonitors: {
    label: "NAM Monitors (DNS/ICMP/TCP)",
    description: "Gen3-native network monitoring",
    direction: "gen3Adoption",
  },
  syntheticGrailExecution: {
    label: "Synthetic on Grail Executions",
    description: "Gen3 synthetic data in Grail — higher = better coverage",
    direction: "gen3Adoption",
  },
  smartscapeGrail: {
    label: "Smartscape on Grail",
    description: "CRITICAL Gen3 signal — Grail-native topology replacing classic Smartscape",
    direction: "gen3Adoption",
  },
  apiTokens: {
    label: "API Tokens",
    description: "Token sprawl — lower count is cleaner",
    direction: "gen2Debt",
  },
  disabledTokens: {
    label: "Disabled API Tokens",
    description: "Cleanup needed — disabled tokens should be removed",
    direction: "gen2Debt",
  },
  otelTraces: {
    label: "OpenTelemetry Traces",
    description: "Gen3 distributed tracing — spans flowing into Grail",
    direction: "gen3Adoption",
  },
  davisEvents: {
    label: "Davis Events in Grail",
    description: "Gen3 alerting — Davis events flowing to Grail",
    direction: "gen3Adoption",
  },
  segments: {
    label: "Segments (Gen3)",
    description: "Gen3 filtering — replacement for management zones",
    direction: "gen3Adoption",
  },
  declarativeGrouping: {
    label: "Declarative Process Grouping",
    description: "Gen3 process organization — replaces manual grouping",
    direction: "gen3Adoption",
  },
  issueTracking: {
    label: "Issue Tracking Integration",
    description: "Gen3 — connects problems to ticket systems",
    direction: "gen3Adoption",
  },
  reliabilityGuardian: {
    label: "Reliability Guardian",
    description: "Gen3 SRE feature — release validation",
    direction: "gen3Adoption",
  },
  bizeventsProcessing: {
    label: "Business Events Processing Rules",
    description: "Gen3 BizOps — processing pipelines, metrics extraction",
    direction: "gen3Adoption",
  },
  monitoringCandidates: {
    label: "Monitoring Candidates",
    description: "Unmonitored hosts — discovered but not instrumented",
    direction: "gen2Debt",
  },
  frequentIssues: {
    label: "Frequent Issues Detection",
    description: "Gen3 noise reduction — detects recurring problems",
    direction: "gen3Adoption",
  },
  mobileApps: {
    label: "Mobile App Monitoring",
    description: "Mobile RUM — iOS/Android monitoring",
    direction: "gen3Adoption",
  },
  credentialVaultItems: {
    label: "Credential Vault",
    description: "Credential vault adoption — centralized secret management",
    direction: "gen3Adoption",
  },
  openProblems: {
    label: "Open Problems",
    description: "Unresolved Davis problems — lower is healthier",
    direction: "gen2Debt",
  },
  problemFrequency: {
    label: "Problem Frequency (30d)",
    description: "Total problems in 30 days — high count suggests noisy alerting",
    direction: "gen2Debt",
  },
  attacksDetected: {
    label: "Runtime Attacks Detected",
    description: "AppSec attacks detected — confirms Application Security is active",
    direction: "gen3Adoption",
  },
  workflowExecutionHealth: {
    label: "Workflow Execution Health",
    description: "Workflow success rate — higher is better",
    direction: "gen3Adoption",
  },
  agAutoUpdate: {
    label: "AG Auto-Update Enabled",
    description: "ActiveGate auto-update — should be enabled for security patches",
    direction: "gen3Adoption",
  },
  agGroups: {
    label: "ActiveGate Groups",
    description: "AG group organization — groups improve routing and management",
    direction: "gen3Adoption",
  },
  releaseTracking: {
    label: "Release Tracking",
    description: "Release tracking adoption — correlates deployments with problems",
    direction: "gen3Adoption",
  },
  documentSharing: {
    label: "Document Sharing",
    description: "Dashboard/notebook sharing — indicates collaboration",
    direction: "gen3Adoption",
  },
  trashedDocuments: {
    label: "Trashed Documents",
    description: "Documents in trash — cleanup opportunity",
    direction: "gen2Debt",
  },
};

/** Default area weights (from reviewAreas.ts hardcoded values) */
export const DEFAULT_AREA_WEIGHTS: Record<string, AreaWeightConfig> = {
  monitoring:   { weight: 1.0 },
  settings:     { weight: 1.0 },
  storage:      { weight: 0.8 },
  alerting:     { weight: 1.0 },
  dashboards:   { weight: 0.8 },
  extensions:   { weight: 0.9 },
  automation:   { weight: 0.7 },
  tagging:      { weight: 0.8 },
  "api-access": { weight: 0.9 },
  security:     { weight: 1.0 },
  synthetic:    { weight: 0.7 },
  rum:          { weight: 0.7 },
  logs:         { weight: 0.9 },
  metrics:      { weight: 0.8 },
};

/** Default configuration with current hardcoded thresholds and weights */
export const DEFAULT_CONFIG: ReviewConfig = {
  // Gen2 debt checks
  //                                     enabled  warnMax  critMax  weight
  autoTagging:          { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.20 },
  managementZones:      { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.20 },
  alertingProfiles:     { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.25 },
  classicNotifications: { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.25 },
  metricEvents:         { enabled: true, warningMax: 20, criticalMax: 50,  weight: 0.25 },
  classicDashboards:    { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.20 },
  calcLogMetrics:       { enabled: true, warningMax: 5,  criticalMax: 50,  weight: 0.30 },
  apiTokens:            { enabled: true, warningMax: 20, criticalMax: 50,  weight: 0.20 },
  disabledTokens:       { enabled: true, warningMax: 0,  criticalMax: 5,   weight: 0.15 },
  criticalSecurityEvents: { enabled: true, warningMax: 0, criticalMax: 0,  weight: 0.25 },
  highSecurityEvents:   { enabled: true, warningMax: 0,  criticalMax: 5,   weight: 0.15 },

  // Gen3 adoption checks
  davisAnomalyDetectors: { enabled: true, warningMax: 1, criticalMax: 5,   weight: 0.20 },
  ownershipTeams:       { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.35 },
  grailDashboards:      { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.25 },
  notebooks:            { enabled: true, warningMax: 1,  criticalMax: 2,   weight: 0.20 },
  lookupTables:         { enabled: true, warningMax: 1,  criticalMax: 2,   weight: 0.15 },
  slos:                 { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.15 },
  k8sClusters:          { enabled: true, warningMax: 0,  criticalMax: 1,   weight: 0.10 },
  workflows:            { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.20 },
  davisNotifWorkflows:  { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.30 },
  customBuckets:        { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.25 },
  businessEvents:       { enabled: true, warningMax: 0,  criticalMax: 1,   weight: 0.25 },
  openPipelineDepth:    { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.30 },
  namMonitors:          { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.30 },
  syntheticGrailExecution: { enabled: true, warningMax: 1, criticalMax: 100, weight: 0.25 },
  smartscapeGrail:        { enabled: true, warningMax: 1, criticalMax: 50, weight: 0.30 },
  otelTraces:           { enabled: true, warningMax: 1,  criticalMax: 100, weight: 0.15 },
  davisEvents:          { enabled: true, warningMax: 1,  criticalMax: 100, weight: 0.15 },
  segments:             { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.15 },
  declarativeGrouping:  { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.10 },
  issueTracking:        { enabled: true, warningMax: 1,  criticalMax: 2,   weight: 0.10 },
  reliabilityGuardian:  { enabled: true, warningMax: 1,  criticalMax: 1,   weight: 0.10 },
  bizeventsProcessing:  { enabled: true, warningMax: 1,  criticalMax: 3,   weight: 0.15 },
  monitoringCandidates: { enabled: true, warningMax: 0,  criticalMax: 50,  weight: 0.10 },
  frequentIssues:       { enabled: true, warningMax: 1,  criticalMax: 1,   weight: 0.05 },
  mobileApps:           { enabled: true, warningMax: 0,  criticalMax: 1,   weight: 0.10 },

  // New Phase 2 checks
  credentialVaultItems: { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.15 },
  openProblems:         { enabled: true, warningMax: 0,  criticalMax: 10,  weight: 0.15 },
  problemFrequency:     { enabled: true, warningMax: 50, criticalMax: 200, weight: 0.10 },
  attacksDetected:      { enabled: true, warningMax: 0,  criticalMax: 1,   weight: 0.15 },
  workflowExecutionHealth: { enabled: true, warningMax: 1, criticalMax: 5, weight: 0.15 },
  agAutoUpdate:         { enabled: true, warningMax: 1,  criticalMax: 1,   weight: 0.10 },
  agGroups:             { enabled: true, warningMax: 1,  criticalMax: 1,   weight: 0.05 },
  releaseTracking:      { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.10 },
  documentSharing:      { enabled: true, warningMax: 1,  criticalMax: 5,   weight: 0.05 },
  trashedDocuments:     { enabled: true, warningMax: 0,  criticalMax: 10,  weight: 0.05 },

  // Area weights
  areaWeights: { ...DEFAULT_AREA_WEIGHTS },

  // Beta features
  betaFeatures: { showBestPractices: false },
};
