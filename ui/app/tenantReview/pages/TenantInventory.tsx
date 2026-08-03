import React, { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { LoadingState } from "../components/shared/LoadingState";
import { ExportButtons } from "../components/shared/ExportButtons";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { getSettingsEnabledCounts, getSettingsObjectCounts, listSettingsSchemas } from "../services/settingsService";
import { getDashboardSummary } from "../services/dashboardService";
import { getTokenSummary } from "../services/tokenService";
import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { syntheticNetworkAvailabilityMonitorsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { functions } from "@dynatrace-sdk/app-utils";
import { cachedFunctionCall } from "../utils/cache";
import type { EnabledCounts } from "../services/settingsService";

interface InventoryRow {
  item: string;
  value: string;
  detail?: string;
}

interface InventorySectionData {
  id?: string;
  title: string;
  rows: InventoryRow[];
}

interface MetricDef {
  item: string;
  label: string;
  sub?: (row: InventoryRow | undefined) => string | undefined;
}

interface SectionMeta {
  title?: string;
  subtitle: string;
  accent: string;
  metrics: MetricDef[];
  barItems?: string[];
  badge?: (rows: InventoryRow[]) => string | undefined;
  detailLabel?: string;
}

/** Section IDs for jump links — exported for sidebar use */
export const INVENTORY_SECTIONS = [
  { id: "inv-group-entities", label: "── Entities ──", isGroup: true },
  { id: "inv-infrastructure", label: "Infrastructure" },
  { id: "inv-storage", label: "Data Storage" },
  { id: "inv-synthetic", label: "Synthetic" },
  { id: "inv-rum", label: "RUM" },
  { id: "inv-cloud", label: "Cloud" },
  { id: "inv-group-config", label: "── Configuration ──", isGroup: true },
  { id: "inv-settings", label: "Settings & Org" },
  { id: "inv-alerting", label: "Alerting & Davis" },
  { id: "inv-automation", label: "Automation" },
  { id: "inv-dashboards", label: "Dashboards" },
  { id: "inv-logs", label: "Log & Pipeline" },
  { id: "inv-security", label: "Security" },
  { id: "inv-bizanalytics", label: "Business Analytics" },
  { id: "inv-api", label: "API & Access" },
  { id: "inv-blindspots", label: "Blind Spots" },
];

function num(n: number): string { return n.toLocaleString(); }

function enabledStr(data: EnabledCounts | null): string {
  if (!data) return "N/A";
  if (data.total === 0) return "0";
  if (data.disabled === 0) return num(data.total);
  return `${num(data.enabled)} enabled / ${num(data.disabled)} disabled (${num(data.total)} total)`;
}

function schemaStr(count: number | null): string {
  if (count === null) return "N/A";
  return num(count);
}

const getRow = (rows: InventoryRow[], item: string) => rows.find((row) => row.item === item);

const firstNumber = (value: string | undefined) => {
  if (!value) return "0";
  const match = value.match(/N\/A|NOT ACCESSIBLE|PARTIAL|NOT QUERYABLE|NOT CHECKED|Enabled|Not configured|[\d,.]+/i);
  return match?.[0] ?? value;
};

const compactLabel = (label: string) => label.replace(/\s+/g, " ").trim().toUpperCase();

const parseNumeric = (value: string | number | undefined) => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const match = value.match(/[\d,.]+/);
  return match ? Number(match[0].replace(/,/g, "")) : 0;
};

const parsePairs = (detail?: string) => {
  if (!detail) return [];
  return detail
    .split(/[,;]/)
    .map((part) => part.trim())
    .map((part) => {
      const match = part.match(/^(.+?):\s*([\d,.]+)/);
      if (!match) return null;
      return { label: match[1].trim(), value: parseNumeric(match[2]) };
    })
    .filter((item): item is { label: string; value: number } => Boolean(item));
};

const activeGatePairs = (row?: InventoryRow) => {
  const detail = row?.detail ?? "";
  const online = Number(detail.match(/(\d+)\s+online/i)?.[1] ?? 0);
  const offline = Number(detail.match(/(\d+)\s+offline/i)?.[1] ?? 0);
  return online || offline ? [{ label: "Online", value: online }, { label: "Offline", value: offline }] : [];
};

const enabledPairs = (rows: InventoryRow[], totalItem: string, enabledItem: string, disabledItem: string) => {
  const enabled = parseNumeric(getRow(rows, enabledItem)?.value);
  const disabled = parseNumeric(getRow(rows, disabledItem)?.value);
  return enabled || disabled ? [{ label: "Enabled", value: enabled }, { label: "Disabled", value: disabled }] : [];
};

const cloudPairs = (rows: InventoryRow[]) => [
  { label: "Lambda", value: parseNumeric(getRow(rows, "AWS Lambda Functions")?.value) },
  { label: "S3", value: parseNumeric(getRow(rows, "AWS S3 Buckets")?.value) },
  { label: "EC2", value: parseNumeric(getRow(rows, "EC2 Instances")?.value) },
  { label: "RDS", value: parseNumeric(getRow(rows, "AWS RDS Databases")?.value) },
  { label: "Load Balancers", value: parseNumeric(getRow(rows, "AWS Load Balancers")?.value) },
  { label: "Azure VMs", value: parseNumeric(getRow(rows, "Azure VMs")?.value) },
  { label: "Azure Web Apps", value: parseNumeric(getRow(rows, "Azure Web Apps")?.value) },
].filter((item) => item.value > 0);

const SECTION_META: Record<string, SectionMeta> = {
  "inv-infrastructure": {
    title: "Infrastructure & Entities",
    subtitle: "OneAgent hosts, ActiveGates, services, processes, and Kubernetes",
    accent: "#4B9AF7",
    metrics: [
      { item: "Hosts (OneAgent)", label: "Hosts (OneAgent)" },
      { item: "Services", label: "Services" },
      { item: "Process Groups", label: "Process Groups" },
      { item: "ActiveGates (total)", label: "ActiveGates", sub: (row) => row?.detail },
      { item: "Kubernetes Clusters", label: "K8s Clusters" },
      { item: "K8s Workloads (cloud_application)", label: "K8s Workloads" },
      { item: "K8s Nodes", label: "K8s Nodes" },
      { item: "K8s Namespaces", label: "K8s Namespaces" },
    ],
    barItems: ["ActiveGates (total)", "Hypervisor Types", "OneAgent Versions", "Monitoring Modes", "Services by Type"],
    badge: (rows) => {
      const value = parseNumeric(getRow(rows, "Monitoring Candidates (unmonitored)")?.value);
      return value > 0 ? `${num(value)} unmonitored` : undefined;
    },
    detailLabel: "All infrastructure details",
  },
  "inv-storage": {
    title: "Data Storage & Grail",
    subtitle: "Grail buckets, log volumes, events, business events, and spans",
    accent: "#9C27B0",
    metrics: [
      { item: "Grail Buckets (total)", label: "Grail Buckets", sub: (row) => row?.detail?.includes("default") ? undefined : row?.detail },
      { item: "Log Volume (24h)", label: "Log Records (24h)" },
      { item: "Events in Grail (30d)", label: "Events in Grail (30d)" },
      { item: "Business Events (30d)", label: "Business Events (30d)" },
      { item: "OTel Spans (30d)", label: "OTel Spans (30d)" },
      { item: "DPS Full-Stack Usage (GiB, recent)", label: "DPS Full-Stack" },
    ],
    barItems: ["Log Volume (24h)", "Business Events (30d)"],
  },
  "inv-synthetic": {
    title: "Synthetic Monitoring",
    subtitle: "Browser monitors, HTTP checks, NAM, and synthetic execution data",
    accent: "#FB9B2B",
    metrics: [
      { item: "Browser Monitors", label: "Browser Monitors" },
      { item: "HTTP Monitors", label: "HTTP Monitors" },
      { item: "NAM Monitors (DNS/ICMP/TCP)", label: "NAM Monitors" },
      { item: "Synthetic Locations (total)", label: "Locations", sub: (row) => row?.detail },
      { item: "Grail Synthetic Executions (30d)", label: "Executions (30d)" },
    ],
    barItems: ["Grail Synthetic Executions (30d)"],
    detailLabel: "NAM monitor list",
  },
  "inv-rum": {
    title: "Real User Monitoring",
    subtitle: "Web and mobile application instrumentation and session replay",
    accent: "#E6376F",
    metrics: [
      { item: "Web Applications", label: "Web Applications" },
      { item: "Mobile Apps", label: "Mobile Apps" },
      { item: "RUM JS Configuration", label: "RUM JS Configs" },
      { item: "Session Replay", label: "Session Replay Configs" },
    ],
  },
  "inv-cloud": {
    title: "Cloud Integrations",
    subtitle: "AWS and Azure integration configurations and discovered cloud resources",
    accent: "#46BED6",
    metrics: [
      { item: "AWS Integration Configs", label: "AWS Configs" },
      { item: "Azure Integration Configs", label: "Azure Configs" },
      { item: "EC2 Instances", label: "EC2 Instances" },
      { item: "AWS Lambda Functions", label: "Lambda Functions" },
      { item: "AWS EKS Clusters", label: "EKS Clusters" },
      { item: "Azure VMs", label: "Azure VMs" },
      { item: "Azure AKS Clusters", label: "AKS Clusters" },
    ],
    badge: (rows) => {
      const total = cloudPairs(rows).reduce((sum, item) => sum + item.value, 0);
      return total > 0 ? `Cloud: ${num(total)} resources` : undefined;
    },
  },
  "inv-settings": {
    title: "Configuration & Settings",
    subtitle: "Settings 2.0 schemas, auto-tagging, management zones, and organizational config",
    accent: "#6D8494",
    metrics: [
      { item: "Settings 2.0 Schemas Available", label: "Settings Schemas" },
      { item: "Auto-Tagging Rules", label: "Auto-Tag Rules" },
      { item: "Management Zones", label: "Management Zones" },
      { item: "Ownership Teams", label: "Ownership Teams" },
      { item: "Network Zones", label: "Network Zones" },
      { item: "Segments (Gen3)", label: "Segments (Gen3)" },
    ],
    detailLabel: "Settings & org details",
  },
  "inv-alerting": {
    title: "Alerting & Davis AI",
    subtitle: "Alerting profiles, problem notifications, metric events, Davis anomaly detectors",
    accent: "#F15B4F",
    metrics: [
      { item: "Alerting Profiles", label: "Alerting Profiles" },
      { item: "Classic Notifications", label: "Notifications" },
      { item: "Metric Event Rules", label: "Metric Events" },
      { item: "Davis Anomaly Detectors", label: "Davis Detectors" },
      { item: "Maintenance Windows", label: "Maintenance Windows" },
      { item: "Davis Problems (30d)", label: "Problems (30d)" },
      { item: "Davis Events in Grail (30d)", label: "Davis Events (30d)" },
    ],
    barItems: ["Davis Problems (30d)"],
    detailLabel: "Davis & alerting details",
  },
  "inv-automation": {
    title: "Automation & Workflows",
    subtitle: "AutomationEngine workflows, trigger types, and ownership",
    accent: "#5CB85C",
    metrics: [
      { item: "AutomationEngine Workflows", label: "Workflows" },
      { item: "Distinct Workflow Owners", label: "Distinct Owners" },
    ],
  },
  "inv-dashboards": {
    title: "Dashboards & Visualization",
    subtitle: "Grail dashboards, notebooks, classic dashboards, lookup tables",
    accent: "#F2633F",
    metrics: [
      { item: "Grail Dashboards", label: "Grail Dashboards" },
      { item: "Notebooks", label: "Notebooks" },
      { item: "Classic Dashboards", label: "Classic Dashboards" },
      { item: "Lookup Tables", label: "Lookup Tables" },
      { item: "Shared Documents (env shares)", label: "Shared Documents" },
    ],
  },
  "inv-logs": {
    title: "Log Monitoring & OpenPipeline",
    subtitle: "Log storage, OpenPipeline configurations, processing rules, and custom attributes",
    accent: "#7A5C4D",
    metrics: [
      { item: "OpenPipeline Log Pipelines", label: "Log Pipelines" },
      { item: "OpenPipeline Metric Pipelines", label: "Metric Pipelines" },
      { item: "Log Storage Settings", label: "Storage Settings" },
      { item: "Log Event Rules", label: "Log Event Rules" },
      { item: "Custom Log Attributes", label: "Custom Attributes" },
      { item: "OpenPipeline Records Not Stored", label: "Not Stored (Pipeline)", sub: () => "records dropped" },
    ],
    barItems: ["OpenPipeline Ingest (by data type)", "OpenPipeline Routing (classic vs pipeline)"],
  },
  "inv-security": {
    title: "Security",
    subtitle: "Security events, attack protection, audit activity, and runtime vulnerability config",
    accent: "#7B6D64",
    metrics: [
      { item: "Security Events (30d)", label: "Security Events (30d)" },
      { item: "Attack Protection Configs", label: "Attack Protection" },
      { item: "Audit Log Events (7d)", label: "Audit Events (7d)" },
      { item: "Runtime Vulnerability Detection Configs", label: "Runtime Detection" },
      { item: "Security Notification Integration Configs", label: "Notifications" },
    ],
    barItems: ["Audit Log Events (7d)"],
    detailLabel: "Security configuration details",
  },
  "inv-bizanalytics": {
    title: "Business Analytics",
    subtitle: "Business event ingestion, processing rules, metrics, and bucket routing",
    accent: "#4F56D9",
    metrics: [
      { item: "Business Events (24h)", label: "Business Events (24h)" },
      { item: "Business Events HTTP Incoming Configs", label: "HTTP Incoming Configs" },
      { item: "Business Events Processing Rules", label: "Processing Rules" },
      { item: "Business Events Metrics Rules", label: "Metrics Rules" },
      { item: "Business Events Bucket Rules", label: "Bucket Rules" },
    ],
  },
  "inv-api": {
    title: "API & Access",
    subtitle: "API token inventory, enabled/disabled breakdown",
    accent: "#42A69A",
    metrics: [
      { item: "API Tokens (total)", label: "Total API Tokens" },
      { item: "API Tokens (enabled)", label: "Enabled" },
      { item: "API Tokens (disabled)", label: "Disabled" },
    ],
    badge: (rows) => {
      const disabled = parseNumeric(getRow(rows, "API Tokens (disabled)")?.value);
      return disabled > 0 ? `${num(disabled)} disabled tokens` : undefined;
    },
  },
  "inv-blindspots": {
    title: "Blind Spots - Not Queryable from This App",
    subtitle: "Items that cannot be retrieved via the available SDKs from within an AppEngine app",
    accent: "#8E8E8E",
    metrics: [],
    detailLabel: "View blind spots",
  },
};

const KpiTile: React.FC<{ row?: InventoryRow; label: string; accent: string; sub?: string }> = ({ row, label, accent, sub }) => (
  <Flex
    flexDirection="column"
    justifyContent="center"
    style={{
      minWidth: 132,
      minHeight: 76,
      padding: "8px 14px",
      borderLeft: `3px solid ${accent}`,
    }}
  >
    <Text style={{ fontSize: 28, lineHeight: "32px", fontWeight: 800, color: "#2F304C" }}>
      {firstNumber(row?.value)}
    </Text>
    <Text style={{ maxWidth: 118, fontSize: 11, lineHeight: "16px", fontWeight: 800, letterSpacing: 0.8, color: "#74758C", textTransform: "uppercase" }}>
      {compactLabel(label)}
    </Text>
    {sub && <Text style={{ fontSize: 11, lineHeight: "14px", color: "#8A8CA0" }}>{sub}</Text>}
  </Flex>
);

const BarRows: React.FC<{ title: string; rows: { label: string; value: number }[]; accent: string }> = ({ title, rows, accent }) => {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <Flex flexDirection="column" gap={8} style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#8A8CA0", textTransform: "uppercase" }}>
        {compactLabel(title)}
      </Text>
      <Flex flexDirection="column" gap={8}>
        {rows.slice(0, 14).map((row) => (
          <div key={`${title}-${row.label}`} style={{ display: "grid", gridTemplateColumns: "190px minmax(120px, 1fr) 72px", gap: 12, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: "#666A80", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</Text>
            <div style={{ height: 7, borderRadius: 999, background: "#ECECEF", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(1, Math.round((row.value / max) * 100))}%`, height: "100%", borderRadius: 999, background: accent }} />
            </div>
            <Text style={{ fontSize: 12, color: "#7C7E93", textAlign: "right" }}>{num(row.value)}</Text>
          </div>
        ))}
      </Flex>
    </Flex>
  );
};

const rowsForBarItem = (sectionId: string | undefined, rows: InventoryRow[], item: string) => {
  const row = getRow(rows, item);
  if (item === "ActiveGates (total)") return activeGatePairs(row);
  return parsePairs(row?.detail);
};

const ExtraBars: React.FC<{ sectionId?: string; rows: InventoryRow[]; meta: SectionMeta }> = ({ sectionId, rows, meta }) => (
  <>
    {meta.barItems?.map((item) => (
      <BarRows key={item} title={item} rows={rowsForBarItem(sectionId, rows, item)} accent={meta.accent} />
    ))}
    {sectionId === "inv-api" && (
      <BarRows title="Token Status" rows={enabledPairs(rows, "API Tokens (total)", "API Tokens (enabled)", "API Tokens (disabled)") } accent={meta.accent} />
    )}
    {sectionId === "inv-cloud" && (
      <BarRows title="Cloud Resources" rows={cloudPairs(rows)} accent={meta.accent} />
    )}
    {sectionId === "inv-dashboards" && (
      <BarRows
        title="Document Type Breakdown"
        rows={[
          { label: "Grail Dashboards", value: parseNumeric(getRow(rows, "Grail Dashboards")?.value) },
          { label: "Notebooks", value: parseNumeric(getRow(rows, "Notebooks")?.value) },
          { label: "Lookup Tables", value: parseNumeric(getRow(rows, "Lookup Tables")?.value) },
        ].filter((row) => row.value > 0)}
        accent={meta.accent}
      />
    )}
  </>
);

const DetailDisclosure: React.FC<{ label: string; rows: InventoryRow[] }> = ({ label, rows }) => {
  const [open, setOpen] = useState(false);
  return (
    <Flex flexDirection="column" style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          border: 0,
          padding: "8px 0",
          background: "transparent",
          color: "#34364F",
          font: "inherit",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {label}
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>‹</span>
      </button>
      {open && (
        <Flex flexDirection="column" gap={4} style={{ paddingTop: 6 }}>
          {rows.map((row) => (
            <div key={row.item} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) auto", gap: 16, padding: "7px 0", borderTop: "1px solid #EEEEF2" }}>
              <Flex flexDirection="column" gap={2}>
                <Text style={{ fontSize: 12, fontWeight: 700, color: "#575A72" }}>{row.item}</Text>
                {row.detail && <Text style={{ fontSize: 11, color: "#8A8CA0" }}>{row.detail}</Text>}
              </Flex>
              <Text style={{ fontSize: 12, fontWeight: 800, color: "#34364F", textAlign: "right" }}>{row.value}</Text>
            </div>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

const InventorySection: React.FC<InventorySectionData> = ({ id, title, rows }) => {
  const meta = SECTION_META[id ?? ""] ?? {
    title,
    subtitle: "",
    accent: "#4B9AF7",
    metrics: rows.slice(0, 6).map((row) => ({ item: row.item, label: row.item })),
  };
  const badge = meta.badge?.(rows);
  const metricDefs: MetricDef[] = meta.metrics.length > 0 ? meta.metrics : rows.slice(0, 5).map((row) => ({ item: row.item, label: row.item }));

  return (
    <section
      id={id}
      style={{
        scrollMarginTop: 16,
        background: "#FFFFFF",
        borderRadius: 8,
        borderTop: `3px solid ${meta.accent}`,
        padding: "22px 24px 18px",
        boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
      }}
    >
      <Flex flexDirection="column" gap={16}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={16}>
          <Flex flexDirection="column" gap={4}>
            <Heading level={2} style={{ color: "#30314D", margin: 0 }}>{meta.title ?? title}</Heading>
            {meta.subtitle && <Text style={{ fontSize: 13, color: "#9092A5" }}>{meta.subtitle}</Text>}
          </Flex>
          {badge && (
            <Text style={{ padding: "4px 9px", borderRadius: 4, background: `${meta.accent}16`, color: "#8A6028", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
              {badge}
            </Text>
          )}
        </Flex>

        <Flex gap={20} flexWrap="wrap" style={{ paddingTop: 6 }}>
          {metricDefs.map((metric) => {
            const row = getRow(rows, metric.item);
            return <KpiTile key={metric.item} row={row} label={metric.label} accent={meta.accent} sub={metric.sub?.(row)} />;
          })}
        </Flex>

        <ExtraBars sectionId={id} rows={rows} meta={meta} />

        {meta.detailLabel && <DetailDisclosure label={meta.detailLabel} rows={rows} />}
      </Flex>
    </section>
  );
};

export const TenantInventory: React.FC = () => {
  const [sections, setSections] = useState<InventorySectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const analyzedRef = useRef(false);

  // DQL queries — all entity types and data sources
  const hosts = useDql(DQL_QUERIES.hostCount);
  const services = useDql(DQL_QUERIES.serviceCount);
  const processGroups = useDql(DQL_QUERIES.processGroupCount);
  const hostVersions = useDql(DQL_QUERIES.hostsByAgentVersion);
  const hostModes = useDql(DQL_QUERIES.hostsByMonitoringMode);
  const slos = useDql(DQL_QUERIES.sloCount);
  const k8sClusters = useDql(DQL_QUERIES.k8sClusterCount);
  const k8sWorkloads = useDql(DQL_QUERIES.k8sWorkloadCount);
  const k8sNamespaces = useDql(DQL_QUERIES.k8sNamespaceCount);
  const logVolume = useDql(DQL_QUERIES.logVolumeByLevel);
  const logSources = useDql(DQL_QUERIES.logSourceTypes);
  const eventCount = useDql(DQL_QUERIES.eventCount);
  const bizEvents = useDql(DQL_QUERIES.bizEventVolume);
  const bizEventTypes = useDql(DQL_QUERIES.bizEventsByType);
  const securityEvents = useDql(DQL_QUERIES.securityEvents);
  const auditVolume = useDql(DQL_QUERIES.auditLogVolume);
  const auditCategories = useDql(DQL_QUERIES.auditLogByCategory);
  const grailBuckets = useDql(DQL_QUERIES.grailBuckets);
  const syntheticTests = useDql(DQL_QUERIES.syntheticTestCount);
  const httpChecks = useDql(DQL_QUERIES.httpCheckCount);
  const grailSynthetic = useDql(DQL_QUERIES.syntheticGrailEvents);
  const grailSynTypes = useDql(DQL_QUERIES.syntheticGrailByType);
  const davisProblems = useDql(DQL_QUERIES.recentProblems);
  const problemsByStatus = useDql(DQL_QUERIES.problemsByStatus);
  const davisEvents = useDql(DQL_QUERIES.davisEvents);
  const spans = useDql(DQL_QUERIES.spanCount);
  const apps = useDql(DQL_QUERIES.applicationCount);
  const lookups = useDql(DQL_QUERIES.lookupTableCount);
  const k8sNodes = useDql(DQL_QUERIES.k8sNodeCount);
  const mobileApps = useDql(DQL_QUERIES.mobileAppCount);
  const servicesByType = useDql(DQL_QUERIES.servicesByType);
  const monitoringCandidates = useDql(DQL_QUERIES.monitoringCandidates);
  const ec2Instances = useDql(DQL_QUERIES.ec2Count);
  const hostGroups = useDql(DQL_QUERIES.hostGroupCount);
  const dpsBilling = useDql(DQL_QUERIES.dpsBillingUsage);
  const awsLambda = useDql(DQL_QUERIES.awsLambdaCount);
  const awsRds = useDql(DQL_QUERIES.awsRdsCount);
  const awsElb = useDql(DQL_QUERIES.awsElbCount);
  const awsS3 = useDql(DQL_QUERIES.awsS3Count);
  const awsCreds = useDql(DQL_QUERIES.awsCredentialCount);
  const awsEks = useDql(DQL_QUERIES.awsEksCount);
  const azureVms = useDql(DQL_QUERIES.azureVmCount);
  const azureWebApps = useDql(DQL_QUERIES.azureWebAppCount);
  const azureSqlDbs = useDql(DQL_QUERIES.azureSqlDbCount);
  const azureFunctions = useDql(DQL_QUERIES.azureFunctionCount);
  const azureAks = useDql(DQL_QUERIES.azureAksCount);
  const anomalyDetectorStatus = useDql(DQL_QUERIES.anomalyDetectorStatus);
  const logIngestErrors = useDql(DQL_QUERIES.logIngestErrors);
  const logBucketStorage = useDql(DQL_QUERIES.logBucketStorage);
  const opIngestByConfig = useDql(DQL_QUERIES.openPipelineIngestByConfig);
  const opClassicVsPipeline = useDql(DQL_QUERIES.openPipelineClassicVsPipeline);
  const opNotStored = useDql(DQL_QUERIES.openPipelineNotStored);
  const hostCloudTypes = useDql(DQL_QUERIES.hostCloudTypes);
  const hostHypervisors = useDql(DQL_QUERIES.hostHypervisors);
  const containerInstances = useDql(DQL_QUERIES.containerInstanceCount);
  const processInstances = useDql(DQL_QUERIES.processInstanceCount);
  const disks = useDql(DQL_QUERIES.diskCount);
  const networkInterfaces = useDql(DQL_QUERIES.networkInterfaceCount);

  const allDql = [
    hosts, services, processGroups, hostVersions, hostModes, slos, k8sClusters,
    k8sWorkloads, k8sNamespaces, logVolume, logSources, eventCount, bizEvents,
    bizEventTypes, securityEvents, auditVolume, auditCategories, grailBuckets,
    syntheticTests, httpChecks, grailSynthetic, grailSynTypes, davisProblems,
    problemsByStatus, davisEvents, spans, apps, lookups, k8sNodes, mobileApps,
    servicesByType, monitoringCandidates, ec2Instances, hostGroups,
    dpsBilling, opIngestByConfig, opClassicVsPipeline, opNotStored,
    awsLambda, awsRds, awsElb, awsS3, awsCreds, awsEks,
    azureVms, azureWebApps, azureSqlDbs, azureFunctions, azureAks,
    anomalyDetectorStatus, logIngestErrors, logBucketStorage,
    hostCloudTypes, hostHypervisors, containerInstances,
    processInstances, disks, networkInterfaces,
  ];
  const allDqlLoading = allDql.some((q) => q.isLoading || q.isPending);

  useEffect(() => {
    if (allDqlLoading) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;

    async function collect() {
      // All schemas that support enabled/disabled
      const gen2Schemas = [
        SETTINGS_SCHEMAS.autoTagging,
        SETTINGS_SCHEMAS.managementZones,
        SETTINGS_SCHEMAS.alertingProfile,
        SETTINGS_SCHEMAS.problemNotifications,
        SETTINGS_SCHEMAS.metricEvents,
      ];

      // All other known schemas
      const gen3Schemas = [
        SETTINGS_SCHEMAS.ownershipTeams,
        SETTINGS_SCHEMAS.ownershipConfig,
        SETTINGS_SCHEMAS.davisAnomalyDetectors,
        SETTINGS_SCHEMAS.maintenanceWindow,
        SETTINGS_SCHEMAS.attackProtection,
        SETTINGS_SCHEMAS.logStorageSettings,
        SETTINGS_SCHEMAS.logEvents,
        SETTINGS_SCHEMAS.logProcessingRules,
        SETTINGS_SCHEMAS.openPipelineLogs,
        SETTINGS_SCHEMAS.openPipelineMetrics,
        SETTINGS_SCHEMAS.rumWeb,
        SETTINGS_SCHEMAS.sessionReplay,
        SETTINGS_SCHEMAS.processGroupDetection,
        SETTINGS_SCHEMAS.serviceDetection,
        SETTINGS_SCHEMAS.cloudAws,
        SETTINGS_SCHEMAS.cloudAzure,
        SETTINGS_SCHEMAS.networkZones,
        SETTINGS_SCHEMAS.oneAgentUpdates,
        SETTINGS_SCHEMAS.sloSettings,
        SETTINGS_SCHEMAS.segments,
        SETTINGS_SCHEMAS.declarativeGrouping,
        SETTINGS_SCHEMAS.issueTracking,
        SETTINGS_SCHEMAS.reliabilityGuardian,
        SETTINGS_SCHEMAS.frequentIssues,
        SETTINGS_SCHEMAS.osServicesMonitoring,
        SETTINGS_SCHEMAS.oneAgentFeatures,
        SETTINGS_SCHEMAS.logCustomAttributes,
        SETTINGS_SCHEMAS.runtimeVulnDetection,
        SETTINGS_SCHEMAS.securityNotifications,
        SETTINGS_SCHEMAS.bizeventsIncoming,
        SETTINGS_SCHEMAS.bizeventsProcessingRules,
        SETTINGS_SCHEMAS.bizeventsMetricsRules,
        SETTINGS_SCHEMAS.bizeventsBucketRules,
      ];

      // Fetch SDK-based data via app functions (parallel)
      type AGType = { id: string; hostname: string; group: string; networkZone: string; version: string; containerized: boolean; online: boolean; connectedHosts: number; osType: string; autoUpdateStatus: string };
      const emptyAG = { total: 0, containerized: 0, standalone: 0, online: 0, offline: 0, activeGates: [] as AGType[], error: "Failed" };
      const callFn = (name: string) => functions.call(name);
      const [agResult, nzResult, synLocResult, sloResult] = await Promise.all([
        cachedFunctionCall<typeof emptyAG>(callFn, "activeGates").catch(() => emptyAG),
        cachedFunctionCall<{ zones: { id: string; numOfOneAgents: number; numOfConfiguredActiveGates: number }[]; total: number }>(callFn, "networkZones").catch(() => ({ zones: [] as { id: string; numOfOneAgents: number; numOfConfiguredActiveGates: number }[], total: -1 })),
        cachedFunctionCall<{ total: number; publicCount: number; privateCount: number }>(callFn, "syntheticLocations").catch(() => ({ total: -1, publicCount: 0, privateCount: 0 })),
        cachedFunctionCall<{ total: number; enabled: number; disabled: number }>(callFn, "slos").catch(() => ({ total: -1, enabled: 0, disabled: 0 })),
      ]);

      const [enabledCounts, simpleCounts, schemas, dashSummary, tokenSummary, workflowResult, namResult] = await Promise.all([
        getSettingsEnabledCounts(gen2Schemas),
        getSettingsObjectCounts(gen3Schemas),
        listSettingsSchemas(),
        getDashboardSummary(),
        getTokenSummary(),
        workflowsClient.getWorkflows().catch(() => null),
        syntheticNetworkAvailabilityMonitorsClient.getMonitors({ monitorSelector: "type(MULTI_PROTOCOL)" }).catch(() => null),
      ]);

      const dqlCount = (q: { data?: { records?: unknown[] } | null }) =>
        Number((q.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? (q.data?.records?.[0] as Record<string, unknown>)?.["total"] ?? 0);
      const dqlRecords = (q: { data?: { records?: unknown[] } | null }) =>
        (q.data?.records ?? []) as Record<string, unknown>[];
      const sc = (key: string) => simpleCounts.get(key);
      const ec = (key: string) => enabledCounts.get(key) as EnabledCounts | null;

      const result: { id?: string; title: string; rows: InventoryRow[] }[] = [];

      // --- Infrastructure ---
      const versionRecords = dqlRecords(hostVersions);
      const modeRecords = dqlRecords(hostModes);
      // Format AG details from SDK response
      const containerizedAGs = agResult.activeGates.filter((a) => a.containerized);
      const standaloneAGs = agResult.activeGates.filter((a) => !a.containerized);
      const formatAG = (a: { hostname: string; group: string; networkZone: string; version: string; online: boolean; connectedHosts: number }) => {
        const group = a.group ? ` [${a.group}]` : "";
        const zone = a.networkZone && a.networkZone !== "default" ? ` (${a.networkZone})` : "";
        const status = a.online ? "" : " OFFLINE";
        const hosts = a.connectedHosts > 0 ? ` ${a.connectedHosts} hosts` : "";
        return `${a.hostname}${group}${zone}${hosts}${status}`;
      };

      result.push({
        id: "inv-infrastructure",
        title: "Infrastructure & Entities",
        rows: [
          { item: "Hosts (OneAgent)", value: num(dqlCount(hosts)) },
          { item: "ActiveGates (total)", value: agResult.error ? `N/A (${agResult.error})` : num(agResult.total), detail: agResult.total > 0 ? `${agResult.online} online, ${agResult.offline} offline` : undefined },
          { item: "ActiveGates — Containerized", value: agResult.error ? "N/A" : num(containerizedAGs.length), detail: containerizedAGs.length > 0 ? containerizedAGs.map(formatAG).join("; ") : undefined },
          { item: "ActiveGates — Standalone", value: agResult.error ? "N/A" : num(standaloneAGs.length), detail: standaloneAGs.length > 0 ? standaloneAGs.map(formatAG).join("; ") : undefined },
          { item: "Services", value: num(dqlCount(services)) },
          { item: "Process Groups", value: num(dqlCount(processGroups)) },
          { item: "OneAgent Versions", value: String(versionRecords.length), detail: versionRecords.map((r) => `${String(r.agentVersion ?? "unknown")}: ${num(Number(r.hostCount ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Monitoring Modes", value: String(modeRecords.length), detail: modeRecords.map((r) => `${String(r.monitoringMode ?? "unknown")}: ${num(Number(r.hostCount ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Kubernetes Clusters", value: num(dqlCount(k8sClusters)) },
          { item: "K8s Workloads (cloud_application)", value: num(dqlCount(k8sWorkloads)) },
          { item: "K8s Namespaces", value: num(dqlCount(k8sNamespaces)) },
          { item: "SLOs (classic API)", value: sloResult.total >= 0 ? `${num(sloResult.total)} (${sloResult.enabled} enabled, ${sloResult.disabled} disabled)` : num(dqlCount(slos)), detail: sloResult.total >= 0 ? "Via Environment API v2 — classic SLOs. Gen3 SLOs use Grail-native evaluation." : undefined },
          { item: "Web Applications (RUM)", value: num(dqlCount(apps)) },
          { item: "K8s Nodes", value: num(dqlCount(k8sNodes)) },
          { item: "Host Groups", value: num(dqlCount(hostGroups)) },
          { item: "Monitoring Candidates (unmonitored)", value: num(dqlCount(monitoringCandidates)), detail: dqlCount(monitoringCandidates) > 0 ? "High count indicates hosts discovered but not monitored — potential blind spots" : undefined },
          { item: "Services by Type", value: num(dqlCount(services)), detail: dqlRecords(servicesByType).map((r) => `${String(r.serviceType ?? "unknown")}: ${num(Number(r.serviceCount ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Mobile Apps", value: num(dqlCount(mobileApps)) },
          { item: "Process Group Instances", value: num(dqlCount(processInstances)) },
          { item: "Container Instances", value: num(dqlCount(containerInstances)) },
          { item: "Disks", value: num(dqlCount(disks)) },
          { item: "Network Interfaces", value: num(dqlCount(networkInterfaces)) },
          { item: "Cloud Types", value: String(dqlRecords(hostCloudTypes).length), detail: dqlRecords(hostCloudTypes).map((r) => `${String(r.cloudType ?? "unknown")}: ${num(Number(r.hostCount ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Hypervisor Types", value: String(dqlRecords(hostHypervisors).length), detail: dqlRecords(hostHypervisors).map((r) => `${String(r.hypervisorType ?? "unknown")}: ${num(Number(r.hostCount ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Process Group Detection Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.processGroupDetection) ?? null) },
          { item: "Service Detection Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.serviceDetection) ?? null) },
          { item: "OneAgent Update Settings", value: schemaStr(sc(SETTINGS_SCHEMAS.oneAgentUpdates) ?? null) },
          { item: "OS Services Monitoring Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.osServicesMonitoring) ?? null) },
          { item: "OneAgent Feature Flags", value: schemaStr(sc(SETTINGS_SCHEMAS.oneAgentFeatures) ?? null) },
          { item: "Declarative Process Grouping Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.declarativeGrouping) ?? null) },
        ],
      });

      // --- Settings & Organization ---
      result.push({
        id: "inv-settings",
        title: "Settings & Organization",
        rows: [
          { item: "Settings 2.0 Schemas Available", value: schemas ? num(schemas.length) : "N/A" },
          { item: "Auto-Tagging Rules", value: enabledStr(ec(SETTINGS_SCHEMAS.autoTagging)) },
          { item: "Management Zones", value: enabledStr(ec(SETTINGS_SCHEMAS.managementZones)) },
          { item: "Ownership Teams", value: schemaStr(sc(SETTINGS_SCHEMAS.ownershipTeams) ?? null) },
          { item: "Ownership Config", value: (sc(SETTINGS_SCHEMAS.ownershipConfig) ?? 0) > 0 ? "Enabled" : "Not configured" },
          { item: "Network Zones", value: nzResult.total >= 0 ? num(nzResult.total) : schemaStr(sc(SETTINGS_SCHEMAS.networkZones) ?? null), detail: nzResult.zones.length > 0 ? nzResult.zones.map((z) => `${z.id} (${z.numOfOneAgents ?? 0} agents, ${z.numOfConfiguredActiveGates ?? 0} AGs)`).join("; ") : undefined },
          { item: "Segments (Gen3)", value: schemaStr(sc(SETTINGS_SCHEMAS.segments) ?? null) },
          { item: "Issue Tracking Integration (Gen3)", value: schemaStr(sc(SETTINGS_SCHEMAS.issueTracking) ?? null) },
          { item: "Reliability Guardian Configs (Gen3)", value: schemaStr(sc(SETTINGS_SCHEMAS.reliabilityGuardian) ?? null) },
        ],
      });

      // --- Alerting ---
      result.push({
        id: "inv-alerting",
        title: "Alerting & Davis AI",
        rows: [
          { item: "Alerting Profiles", value: enabledStr(ec(SETTINGS_SCHEMAS.alertingProfile)) },
          { item: "Classic Notifications", value: enabledStr(ec(SETTINGS_SCHEMAS.problemNotifications)) },
          { item: "Metric Event Rules", value: enabledStr(ec(SETTINGS_SCHEMAS.metricEvents)) },
          { item: "Davis Anomaly Detectors", value: schemaStr(sc(SETTINGS_SCHEMAS.davisAnomalyDetectors) ?? null) },
          { item: "Maintenance Windows", value: schemaStr(sc(SETTINGS_SCHEMAS.maintenanceWindow) ?? null) },
          { item: "Davis Problems (30d)", value: num(dqlCount(davisProblems)), detail: dqlRecords(problemsByStatus).map((r) => `${String(r["event.status"])}: ${num(Number(r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Davis Events in Grail (30d)", value: num(dqlCount(davisEvents)) },
          { item: "Frequent Issues Detection Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.frequentIssues) ?? null) },
          { item: "Anomaly Detector Status Events (24h)", value: anomalyDetectorStatus.error ? "N/A" : num(dqlCount(anomalyDetectorStatus)), detail: "ANOMALY_DETECTOR_STATUS_EVENT — shows whether Davis detectors are executing successfully" },
        ],
      });

      // --- Automation ---
      const workflows = workflowResult?.results ?? [];
      let triggerBreakdown = "";
      if (workflows.length > 0) {
        let ev = 0, sch = 0, dav = 0;
        for (const wf of workflows) {
          const t = typeof ((wf as unknown as Record<string, unknown>).trigger as Record<string, unknown>)?.type === "string" ? String(((wf as unknown as Record<string, unknown>).trigger as Record<string, unknown>).type) : "";
          if (t.includes("event")) ev++;
          if (t.includes("time") || t.includes("schedule") || t.includes("cron") || t.includes("interval")) sch++;
          if (t.includes("davis")) dav++;
        }
        triggerBreakdown = `Event: ${num(ev)}, Schedule: ${num(sch)}, Davis: ${num(dav)}`;
      }
      result.push({
        id: "inv-automation",
        title: "Automation & Workflows",
        rows: [
          { item: "AutomationEngine Workflows", value: workflowResult ? num(workflows.length) : "N/A", detail: triggerBreakdown || undefined },
          { item: "Distinct Workflow Owners", value: workflowResult ? num(new Set(workflows.map((w) => String((w as unknown as Record<string, unknown>).owner ?? ""))).size) : "N/A" },
        ],
      });

      // --- Dashboards ---
      result.push({
        id: "inv-dashboards",
        title: "Dashboards & Visualization",
        rows: [
          { item: "Grail Dashboards", value: num(dashSummary.grailDashboardCount) },
          { item: "Notebooks", value: num(dashSummary.notebookCount) },
          { item: "Classic Dashboards", value: dashSummary.classicDashboardCount >= 0 ? num(dashSummary.classicDashboardCount) : "N/A (Config API v1 not accessible)" },
          { item: "Lookup Tables", value: num(dqlCount(lookups)) },
          { item: "Shared Documents (env shares)", value: num(dashSummary.sharedDocumentCount) },
        ],
      });

      // --- Data Storage ---
      const bucketRecords = dqlRecords(grailBuckets);
      const customBuckets = bucketRecords.filter((b) => { const n = String(b.name ?? ""); return !n.startsWith("default_") && n !== "default"; });
      result.push({
        id: "inv-storage",
        title: "Data Storage & Grail",
        rows: [
          { item: "Grail Buckets (total)", value: num(bucketRecords.length), detail: bucketRecords.map((b) => `${String(b.name ?? "unnamed")} (${num(Number(b.records ?? 0))} records, ${String(b.retention_days ?? "N/A")}d retention)`).join("; ") },
          { item: "Custom Grail Buckets", value: num(customBuckets.length) },
          { item: "Log Volume (24h)", value: num(dqlRecords(logVolume).reduce((s, r) => s + Number(r["logCount"] ?? r["count()"] ?? 0), 0)), detail: dqlRecords(logVolume).map((r) => `${String(r.loglevel)}: ${num(Number(r["logCount"] ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Log Sources", value: num(dqlRecords(logSources).length), detail: dqlRecords(logSources).map((r) => `${String(r["log.source"])}: ${num(Number(r["logCount"] ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Events in Grail (30d)", value: num(dqlCount(eventCount)) },
          { item: "Business Events (30d)", value: num(dqlCount(bizEvents)), detail: dqlRecords(bizEventTypes).map((r) => `${String(r["event.type"])}: ${num(Number(r["eventCount"] ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "OTel Spans (30d)", value: spans.error ? "N/A (needs storage:spans:read scope)" : num(dqlCount(spans)) },
          { item: "DPS Full-Stack Usage (GiB, recent)", value: dpsBilling.error ? "N/A (needs storage:metrics:read)" : `${Number((dpsBilling.data?.records?.[0] as Record<string, unknown>)?.["totalGiB"] ?? 0).toFixed(1)} GiB` },
        ],
      });

      // --- Log & Pipeline ---
      result.push({
        id: "inv-logs",
        title: "Log Monitoring & OpenPipeline",
        rows: [
          { item: "Log Storage Settings", value: schemaStr(sc(SETTINGS_SCHEMAS.logStorageSettings) ?? null) },
          { item: "Log Event Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.logEvents) ?? null) },
          { item: "OpenPipeline Log Pipelines", value: schemaStr(sc(SETTINGS_SCHEMAS.openPipelineLogs) ?? null) },
          { item: "OpenPipeline Metric Pipelines", value: schemaStr(sc(SETTINGS_SCHEMAS.openPipelineMetrics) ?? null) },
          { item: "Custom Log Attributes", value: schemaStr(sc(SETTINGS_SCHEMAS.logCustomAttributes) ?? null) },
          { item: "OpenPipeline Ingest (by data type)", value: opIngestByConfig.error ? "N/A" : String(dqlRecords(opIngestByConfig).length) + " types", detail: dqlRecords(opIngestByConfig).map((r) => `${String(r.configuration)}: ${num(Number(r.total ?? 0))} records`).join(", ") || undefined },
          { item: "OpenPipeline Routing (classic vs pipeline)", value: opClassicVsPipeline.error ? "N/A" : String(dqlRecords(opClassicVsPipeline).length) + " routes", detail: dqlRecords(opClassicVsPipeline).map((r) => `${String(r.route_name)}/${String(r.configuration)}: ${num(Number(r.total ?? 0))}`).join(", ") || undefined },
          { item: "OpenPipeline Records Not Stored", value: opNotStored.error ? "N/A" : String(dqlRecords(opNotStored).reduce((s, r) => s + Number(r.total ?? 0), 0)), detail: dqlRecords(opNotStored).map((r) => `${String(r.configuration)}: ${num(Number(r.total ?? 0))}`).join(", ") || undefined },
          { item: "Log Ingest Errors (recent)", value: logIngestErrors.error ? "N/A" : num(Number((logIngestErrors.data?.records?.[0] as Record<string, unknown>)?.["total"] ?? 0)), detail: "dt.sfm.storage.ingest.errors for logs table — persistence failures" },
          { item: "Log Bucket Storage (bytes)", value: logBucketStorage.error ? "N/A" : `${(Number((logBucketStorage.data?.records?.[0] as Record<string, unknown>)?.["totalBytes"] ?? 0) / 1073741824).toFixed(1)} GB`, detail: "Estimated uncompressed size of log data in Grail buckets" },
        ],
      });

      // --- Security ---
      const secRow = (securityEvents.data?.records?.[0] ?? {}) as Record<string, unknown>;
      result.push({
        id: "inv-security",
        title: "Security",
        rows: [
          { item: "Security Events (30d)", value: num(Number(secRow["total"] ?? 0)), detail: `Critical: ${num(Number(secRow["critical"] ?? 0))}, High: ${num(Number(secRow["high"] ?? 0))}, Medium: ${num(Number(secRow["medium"] ?? 0))}, Low: ${num(Number(secRow["low"] ?? 0))}` },
          { item: "Attack Protection Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.attackProtection) ?? null) },
          { item: "Audit Log Events (7d)", value: num(dqlCount(auditVolume)), detail: dqlRecords(auditCategories).slice(0, 10).map((r) => `${String(r["event.type"])}: ${num(Number(r["eventCount"] ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Runtime Vulnerability Detection Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.runtimeVulnDetection) ?? null) },
          { item: "Security Notification Integration Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.securityNotifications) ?? null) },
        ],
      });

      // --- Synthetic ---
      const totalSyn = dqlCount(syntheticTests);
      const httpCount = dqlCount(httpChecks);
      const browserCount = Math.max(0, totalSyn - httpCount);
      const namMonitors = namResult?.monitors ?? [];
      result.push({
        id: "inv-synthetic",
        title: "Synthetic Monitoring",
        rows: [
          { item: "Browser Monitors", value: num(browserCount) },
          { item: "HTTP Monitors", value: num(httpCount) },
          { item: "NAM Monitors (DNS/ICMP/TCP)", value: namResult ? num(namMonitors.length) : "N/A", detail: namMonitors.map((m) => `${m.name}${m.enabled === false ? " (disabled)" : ""}`).join(", ") || undefined },
          { item: "Grail Synthetic Executions (30d)", value: num(dqlCount(grailSynthetic)), detail: dqlRecords(grailSynTypes).map((r) => `${String(r["event.type"])}: ${num(Number(r["eventCount"] ?? r["count()"] ?? 0))}`).join(", ") || undefined },
          { item: "Synthetic Locations (total)", value: synLocResult.total >= 0 ? num(synLocResult.total) : "N/A", detail: synLocResult.total > 0 ? `${synLocResult.publicCount} public, ${synLocResult.privateCount} private` : undefined },
        ],
      });

      // --- RUM ---
      result.push({
        id: "inv-rum",
        title: "Real User Monitoring",
        rows: [
          { item: "Web Applications", value: num(dqlCount(apps)) },
          { item: "RUM JS Configuration", value: (sc(SETTINGS_SCHEMAS.rumWeb) ?? 0) > 0 ? `${schemaStr(sc(SETTINGS_SCHEMAS.rumWeb) ?? null)} config(s)` : "Not configured" },
          { item: "Session Replay", value: (sc(SETTINGS_SCHEMAS.sessionReplay) ?? 0) > 0 ? `${schemaStr(sc(SETTINGS_SCHEMAS.sessionReplay) ?? null)} config(s)` : "Not configured" },
        ],
      });

      // --- Cloud ---
      result.push({
        id: "inv-cloud",
        title: "Cloud Integrations",
        rows: [
          { item: "AWS Integration Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.cloudAws) ?? null) },
          { item: "Azure Integration Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.cloudAzure) ?? null) },
          { item: "EC2 Instances", value: num(dqlCount(ec2Instances)) },
          { item: "AWS Lambda Functions", value: num(dqlCount(awsLambda)) },
          { item: "AWS RDS Databases", value: num(dqlCount(awsRds)) },
          { item: "AWS Load Balancers", value: num(dqlCount(awsElb)) },
          { item: "AWS S3 Buckets", value: num(dqlCount(awsS3)) },
          { item: "AWS Credentials", value: num(dqlCount(awsCreds)) },
          { item: "AWS EKS Clusters", value: num(dqlCount(awsEks)) },
          { item: "Azure VMs", value: num(dqlCount(azureVms)) },
          { item: "Azure Web Apps", value: num(dqlCount(azureWebApps)) },
          { item: "Azure SQL Databases", value: num(dqlCount(azureSqlDbs)) },
          { item: "Azure Functions", value: num(dqlCount(azureFunctions)) },
          { item: "Azure AKS Clusters", value: num(dqlCount(azureAks)) },
        ],
      });

      // --- API & Access ---
      const tokens = tokenSummary ?? { totalCount: 0, enabledCount: 0, tokens: [] };
      result.push({
        id: "inv-api",
        title: "API & Access",
        rows: [
          { item: "API Tokens (total)", value: num(tokens.totalCount) },
          { item: "API Tokens (enabled)", value: num(tokens.enabledCount) },
          { item: "API Tokens (disabled)", value: num(tokens.totalCount - tokens.enabledCount) },
        ],
      });

      // --- Business Analytics ---
      result.push({
        id: "inv-bizanalytics",
        title: "Business Analytics",
        rows: [
          { item: "Business Events HTTP Incoming Configs", value: schemaStr(sc(SETTINGS_SCHEMAS.bizeventsIncoming) ?? null) },
          { item: "Business Events Processing Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.bizeventsProcessingRules) ?? null) },
          { item: "Business Events Metrics Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.bizeventsMetricsRules) ?? null) },
          { item: "Business Events Bucket Rules", value: schemaStr(sc(SETTINGS_SCHEMAS.bizeventsBucketRules) ?? null) },
        ],
      });

      // --- Blind Spots ---
      result.push({
        id: "inv-blindspots",
        title: "Blind Spots — Not Queryable from This App",
        rows: [
          { item: "Classic Dashboards", value: dashSummary.classicDashboardCount >= 0 ? "Available" : "NOT ACCESSIBLE", detail: "Config API v1 is not proxied by the platform. OAuth not supported on live API endpoint." },
          { item: "ActiveGate Health Metrics", value: "PARTIAL", detail: "Count, containerized/standalone, version, connected hosts via SDK. JVM memory, disk, and detailed health metrics available via dt.sfm.active_gate.* but not yet displayed." },
          { item: "Credential Vault Entries", value: "NOT QUERYABLE", detail: "Schema builtin:credential-vault / builtin:credentials does not exist. Vault contents not accessible from apps." },
          { item: "Release Tracking Config", value: "NOT QUERYABLE", detail: "Schema builtin:release-tracking / builtin:release-monitoring does not exist on tested tenants." },
          { item: "Hub/Marketplace Apps Installed", value: "NOT QUERYABLE", detail: "No API available to list installed Dynatrace Hub apps from within an app." },
          { item: "IAM Users & Groups", value: "NOT QUERYABLE", detail: "Account Management API requires OAuth client credentials stored in Credential Vault. See IAM Utilities app pattern." },
          { item: "DPS Billing Details", value: "PARTIAL", detail: "Full-Stack GiB usage available via dt.billing.full_stack_monitoring.usage. Detailed per-capability DPS breakdown requires account-level billing API." },
          { item: "Calculated Service Metrics", value: "NOT QUERYABLE", detail: "Config API v1 only. Not available via Settings 2.0 or DQL." },
          { item: "Calculated Synthetic Metrics", value: "NOT QUERYABLE", detail: "Config API v1 only. Not available via Settings 2.0 or DQL." },
          { item: "Custom Device Groups", value: "NOT QUERYABLE", detail: "Config API v1 only." },
          { item: "Request Naming Rules", value: "NOT QUERYABLE", detail: "Config API v1 only. Service-level request naming not in Settings 2.0." },
          { item: "Conditional Naming Rules", value: "NOT QUERYABLE", detail: "Config API v1 only." },
          { item: "Application Detection Rules", value: "NOT QUERYABLE", detail: "Config API v1 only." },
          { item: "GCP Cloud Integration", value: "NOT CHECKED", detail: "Schema ID for GCP integration not included. Add if applicable." },
          { item: "OpenPipeline Trace Pipelines", value: "NOT QUERYABLE", detail: "Schema builtin:openpipeline.traces.pipelines does not exist on tested tenants." },
        ],
      });

      // Reorder sections: entities first, then config, matching INVENTORY_SECTIONS order
      const sectionOrder = INVENTORY_SECTIONS.filter((s) => !s.isGroup).map((s) => s.id);
      const ordered = sectionOrder
        .map((id) => result.find((s) => s.id === id))
        .filter(Boolean) as typeof result;
      // Add any sections not in the order list (shouldn't happen but safe)
      const remaining = result.filter((s) => !sectionOrder.includes(s.id ?? ""));
      setSections([...ordered, ...remaining]);
      setLoading(false);
    }

    void collect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDqlLoading]);

  if (loading) return <LoadingState message="Collecting tenant inventory..." />;

  const totalItems = sections.reduce((s, sec) => s + sec.rows.length, 0);

  return (
    <Flex flexDirection="column" gap={24} style={{ background: "#F7F7FA", minHeight: "100%", paddingBottom: 32 }}>
      <Flex justifyContent="space-between" alignItems="flex-start" style={{ padding: "6px 0 0" }}>
        <Flex flexDirection="column" gap={4}>
          <Heading level={1} style={{ color: "#30314D", margin: 0 }}>Tenant Inventory</Heading>
          <Text style={{ color: "#5C5F76" }}>Raw inventory of what exists in this tenant. No scoring or evaluation - just facts.</Text>
        </Flex>
        <Flex alignItems="center" gap={16}>
          <Text style={{ color: "#8A8CA0", fontSize: 13 }}>{sections.length} categories</Text>
          <ExportButtons
            title="Tenant Inventory"
            sections={sections.map((sec) => ({ title: sec.title, rows: sec.rows }))}
            summary={[`${totalItems} items across ${sections.length} categories`]}
          />
        </Flex>
      </Flex>

      {/* Entity sections */}
      <Flex flexDirection="column" gap={24}>
        <Heading level={2} id="inv-group-entities" style={{ scrollMarginTop: "16px", color: "#30314D", margin: 0 }}>Entities & Monitoring</Heading>
        {sections.filter((s) => ["inv-infrastructure", "inv-storage", "inv-synthetic", "inv-rum", "inv-cloud"].includes(s.id ?? "")).map((sec) => (
          <InventorySection key={sec.title} id={sec.id} title={sec.title} rows={sec.rows} />
        ))}
      </Flex>

      {/* Config sections */}
      <Flex flexDirection="column" gap={24}>
        <Heading level={2} id="inv-group-config" style={{ scrollMarginTop: "16px", color: "#30314D", margin: 0 }}>Configuration & Settings</Heading>
        {sections.filter((s) => ["inv-settings", "inv-alerting", "inv-automation", "inv-dashboards", "inv-logs", "inv-security", "inv-bizanalytics", "inv-api"].includes(s.id ?? "")).map((sec) => (
          <InventorySection key={sec.title} id={sec.id} title={sec.title} rows={sec.rows} />
        ))}
      </Flex>

      {/* Blind spots */}
      {sections.filter((s) => s.id === "inv-blindspots").map((sec) => (
        <InventorySection key={sec.title} id={sec.id} title={sec.title} rows={sec.rows} />
      ))}
    </Flex>
  );
};
