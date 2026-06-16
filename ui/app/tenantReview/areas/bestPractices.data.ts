/**
 * Best Practices review data hook.
 *
 * Evaluates tenant configuration against best practices derived from
 * the USFOODS Module A workshop series (A.00–A.06). The 15 categories
 * cover platform governance, infrastructure, data management, security,
 * and operational maturity.
 *
 * Initially USFOODS-specific; a generalized variant is planned.
 */
import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { calculateAreaScore, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts, getSettingsEnabledCounts } from "../services/settingsService";
import type { EnabledCounts } from "../services/settingsService";
import { functions } from "@dynatrace-sdk/app-utils";
import { cachedFunctionCall } from "../utils/cache";

/** A best-practice category with its findings */
export interface BestPracticeCategory {
  id: string;
  name: string;
  description: string;
  findings: Finding[];
  passedChecks: number;
  totalChecks: number;
}

/** Complete result from the best practices review */
export interface BestPracticesResult {
  categories: BestPracticeCategory[];
  overallScore: number;
  totalPassed: number;
  totalChecks: number;
  isLoading: boolean;
  error?: string;
}

/** Helper to extract a number from a DQL result record */
function dqlNumber(data: { records?: unknown[] } | undefined, field = "count()"): number {
  if (!data?.records?.[0]) return 0;
  const rec = data.records[0] as Record<string, unknown>;
  return Number(rec[field] ?? rec["total"] ?? rec["count()"] ?? 0);
}

/** Helper to extract rows from DQL results */
function dqlRows(data: { records?: unknown[] } | undefined): Record<string, unknown>[] {
  return (data?.records ?? []) as Record<string, unknown>[];
}

export function useBestPracticesReview(): BestPracticesResult {
  const [result, setResult] = useState<BestPracticesResult>({
    categories: [],
    overallScore: 0,
    totalPassed: 0,
    totalChecks: 0,
    isLoading: true,
  });

  // DQL queries — original 15 categories
  const hostsByMode = useDql(DQL_QUERIES.hostsByMonitoringMode);
  const hostsByVersion = useDql(DQL_QUERIES.hostsByAgentVersion);
  const hostsByHostGroup = useDql(DQL_QUERIES.hostsByHostGroup);
  const networkZoneAssignments = useDql(DQL_QUERIES.networkZoneAssignments);
  const bucketDetails = useDql(DQL_QUERIES.bucketDetails);
  const auditActivity = useDql(DQL_QUERIES.auditLogRecentActivity);
  const activeGateCount = useDql(DQL_QUERIES.activeGateCount);
  const k8sClusterCount = useDql(DQL_QUERIES.k8sClusterCount);
  const workflowCount = useDql(DQL_QUERIES.davisEvents);
  const sloCount = useDql(DQL_QUERIES.sloCount);
  const awsCount = useDql(DQL_QUERIES.awsIntegrationCount);
  const openPipelineIngest = useDql(DQL_QUERIES.openPipelineIngestByConfig);
  const hostCount = useDql(DQL_QUERIES.hostCount);

  // DQL queries — additional categories from workshop summaries
  const workflowExecHealth = useDql(DQL_QUERIES.workflowExecutionHealth);
  const deploymentEvents = useDql(DQL_QUERIES.deploymentEvents);
  const bizeventsQuality = useDql(DQL_QUERIES.bizeventsDataQuality);
  const spanQuality = useDql(DQL_QUERIES.spanDataQuality);
  const debugLogVolume = useDql(DQL_QUERIES.debugLogVolume);
  const syntheticDetails = useDql(DQL_QUERIES.syntheticMonitorDetails);
  const spanCount = useDql(DQL_QUERIES.spanCount);
  const bizEventVolume = useDql(DQL_QUERIES.bizEventVolume);
  const applicationCount = useDql(DQL_QUERIES.applicationCount);

  // DQL queries — reference dashboard coverage gaps
  const serviceMethodCount = useDql(DQL_QUERIES.serviceMethodCount);
  const customServiceCount = useDql(DQL_QUERIES.customServiceCount);
  const hostsWithoutHostGroup = useDql(DQL_QUERIES.hostsWithoutHostGroup);

  const analyzedRef = useRef(false);

  useEffect(() => {
    // Wait for all DQL queries to finish loading
    const allDql = [
      hostsByMode, hostsByVersion, hostsByHostGroup, networkZoneAssignments,
      bucketDetails, auditActivity, activeGateCount, k8sClusterCount,
      workflowCount, sloCount, awsCount, openPipelineIngest, hostCount,
      workflowExecHealth, deploymentEvents, bizeventsQuality, spanQuality,
      debugLogVolume, syntheticDetails, spanCount, bizEventVolume, applicationCount,
      serviceMethodCount, customServiceCount, hostsWithoutHostGroup,
    ];
    if (allDql.some((q) => q.isLoading || q.isPending)) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;

    let cancelled = false;

    async function analyze() {
      try {
        // Fetch settings counts and metrics-based checks
        const [enabledCounts, simpleCounts, metricsCheck] = await Promise.all([
          getSettingsEnabledCounts([
            SETTINGS_SCHEMAS.alertingProfile,
            SETTINGS_SCHEMAS.managementZones,
            SETTINGS_SCHEMAS.autoTagging,
            SETTINGS_SCHEMAS.metricEvents,
          ]),
          getSettingsObjectCounts([
            SETTINGS_SCHEMAS.networkZones,
            SETTINGS_SCHEMAS.segments,
            SETTINGS_SCHEMAS.ownershipTeams,
            SETTINGS_SCHEMAS.davisAnomalyDetectors,
            SETTINGS_SCHEMAS.openPipelineLogs,
            SETTINGS_SCHEMAS.openPipelineMetrics,
            SETTINGS_SCHEMAS.issueTracking,
            SETTINGS_SCHEMAS.reliabilityGuardian,
            SETTINGS_SCHEMAS.calculatedMetricsService,
            SETTINGS_SCHEMAS.calculatedMetricsLog,
            SETTINGS_SCHEMAS.declarativeGrouping,
            SETTINGS_SCHEMAS.bizeventsSecurityContextRules,
          ]),
          cachedFunctionCall<{ calculatedServiceMetrics: number; extensionConfigurations: number }>(
            (name: string) => functions.call(name), "metricsCheck"
          ).catch(() => ({ calculatedServiceMetrics: -1, extensionConfigurations: -1 })),
        ]);
        if (cancelled) return;

        const enabledCount = (schema: string): EnabledCounts | null =>
          (enabledCounts.get(schema) as EnabledCounts | null) ?? null;
        const simpleCount = (schema: string): number => simpleCounts.get(schema) ?? 0;

        const categories: BestPracticeCategory[] = [];
        const allChecks: Check[] = [];

        // Shared variables used across multiple categories
        const totalHosts = dqlNumber(hostCount.data);
        const mzData = enabledCount(SETTINGS_SCHEMAS.managementZones);
        const mzEnabled = mzData?.enabled ?? 0;
        const atData = enabledCount(SETTINGS_SCHEMAS.autoTagging);
        const apData = enabledCount(SETTINGS_SCHEMAS.alertingProfile);

        // ──────────────────────────────────────────────
        // 1. Platform Architecture & Deployment Mode
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: All hosts should be FULL_STACK monitoring mode
          total++;
          const modeRows = dqlRows(hostsByMode.data);
          const nonFullStack = modeRows.filter(
            (r) => String(r["monitoringMode"]).toUpperCase() !== "FULL_STACK"
          );
          if (modeRows.length === 0 && !hostsByMode.error) {
            findings.push({
              id: "bp-arch-no-hosts",
              title: "No hosts detected",
              description: "No monitored hosts found. Cannot verify Cloud Native FullStack deployment.",
              severity: "info",
              recommendation: "Deploy OneAgent in Cloud Native FullStack mode on all nodes.",
            });
          } else if (nonFullStack.length === 0) {
            passed++;
            findings.push({
              id: "bp-arch-fullstack",
              title: "All hosts running FULL_STACK mode",
              description: `All ${totalHosts} hosts are using full-stack monitoring as recommended.`,
              severity: "success",
              recommendation: "Continue using FULL_STACK mode for complete visibility.",
            });
          } else {
            const nonFsCount = nonFullStack.reduce((s, r) => s + Number(r["hostCount"] ?? 0), 0);
            findings.push({
              id: "bp-arch-mixed-modes",
              title: `${nonFsCount} host(s) not in FULL_STACK mode`,
              description: `Found hosts in non-FULL_STACK modes: ${nonFullStack.map((r) => `${r["monitoringMode"]} (${r["hostCount"]})`).join(", ")}. Best practice requires Cloud Native FullStack for all nodes.`,
              severity: "warning",
              recommendation: "Migrate all hosts to Cloud Native FullStack mode via DynaKube CR.",
            });
          }

          // Check: Gen3 only — no Gen2 constructs
          total++;
          const atEnabled = atData?.enabled ?? 0;
          const apEnabled = apData?.enabled ?? 0;
          const gen2Total = mzEnabled + atEnabled + apEnabled;
          if (gen2Total === 0) {
            passed++;
            findings.push({
              id: "bp-arch-gen3-only",
              title: "No active Gen2 constructs detected",
              description: "No enabled management zones, auto-tagging rules, or alerting profiles found. Tenant is Gen3-aligned.",
              severity: "success",
              recommendation: "Continue using Gen3 constructs: segments, primary Grail tags, and workflows.",
            });
          } else {
            findings.push({
              id: "bp-arch-gen2-present",
              title: `${gen2Total} active Gen2 construct(s) found`,
              description: `Enabled: ${mzEnabled} management zone(s), ${atEnabled} auto-tagging rule(s), ${apEnabled} alerting profile(s). Best practice: do not use management zones, auto-tags, calculated metrics, alerting profiles, or classic dashboards.`,
              severity: "critical",
              recommendation: "Migrate to Gen3: use segments instead of MZs, primary Grail tags instead of auto-tags, workflows instead of alerting profiles.",
            });
          }

          // Check: AWS integration
          total++;
          const awsCredentials = dqlNumber(awsCount.data);
          if (awsCredentials > 0) {
            passed++;
            findings.push({
              id: "bp-arch-aws",
              title: `${awsCredentials} AWS integration(s) configured`,
              description: "AWS cloud integration is active for metrics, logs, topology, and events.",
              severity: "success",
              recommendation: "Ensure all 4 signal types are ingested: metrics, logs, topology, EventBridge events.",
            });
          } else {
            findings.push({
              id: "bp-arch-no-aws",
              title: "No AWS integration detected",
              description: "No AWS credentials entity found. If running on AWS, deploy via CloudFormation for full integration.",
              severity: "info",
              recommendation: "Deploy AWS integration via CloudFormation stack for IAM role, Firehose, and EventBridge rules.",
            });
          }

          // Check: Full-stack monitoring coverage percentage
          if (totalHosts > 0) {
            total++;
            const fullStackRows = modeRows.filter((r) => String(r["monitoringMode"]).toUpperCase() === "FULL_STACK");
            const fullStackHosts = fullStackRows.reduce((s, r) => s + Number(r["hostCount"] ?? 0), 0);
            const coveragePct = Math.round((fullStackHosts / totalHosts) * 100);
            if (coveragePct >= 95) {
              passed++;
              findings.push({
                id: "bp-arch-coverage",
                title: `Full-stack coverage: ${coveragePct}% (${fullStackHosts}/${totalHosts} hosts)`,
                description: "Full-stack monitoring coverage exceeds 95% threshold.",
                severity: "success",
                recommendation: "Maintain full-stack coverage. Investigate any remaining non-FULL_STACK hosts.",
              });
            } else {
              findings.push({
                id: "bp-arch-coverage-low",
                title: `Full-stack coverage: ${coveragePct}% (${fullStackHosts}/${totalHosts} hosts) — below 95%`,
                description: `Only ${coveragePct}% of hosts are running FULL_STACK monitoring. Target is 95%+.`,
                severity: coveragePct < 50 ? "critical" : "warning",
                recommendation: "Deploy OneAgent in Cloud Native FullStack mode on remaining hosts. Check for monitoring candidates.",
              });
            }
          }

          allChecks.push({ name: "Platform Architecture", weight: 0.10, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "platform-architecture", name: "1. Platform Architecture & Deployment Mode", description: "Cloud Native FullStack, Gen3-only, AWS integration", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 2. DynaKube Configuration & Feature Flags
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Host groups configured (indicates DynaKube hostGroup is set)
          total++;
          const hostGroupRows = dqlRows(hostsByHostGroup.data);
          const hostsWithGroup = hostGroupRows.filter((r) => r["dt.host_group.id"] && String(r["dt.host_group.id"]) !== "");
          if (hostsWithGroup.length > 0) {
            passed++;
            findings.push({
              id: "bp-dk-hostgroup",
              title: `Host group(s) configured: ${hostsWithGroup.map((r) => r["dt.host_group.id"]).join(", ")}`,
              description: "Hosts are assigned to host groups, indicating DynaKube hostGroup configuration.",
              severity: "success",
              recommendation: "Use convention: <org>-<cluster>-<environment> (e.g., moxe-eks-production).",
            });
          } else {
            findings.push({
              id: "bp-dk-no-hostgroup",
              title: "No host groups configured",
              description: "No hosts are assigned to host groups. DynaKube CR should set spec.oneAgent.cloudNativeFullStack.hostGroup.",
              severity: "warning",
              recommendation: "Set hostGroup in DynaKube CR for proper host organization.",
            });
          }

          // Check: Host group coverage percentage
          if (totalHosts > 0) {
            total++;
            const hostsNoGroup = dqlNumber(hostsWithoutHostGroup.data);
            const coveragePct = Math.round(((totalHosts - hostsNoGroup) / totalHosts) * 100);
            if (coveragePct >= 95) {
              passed++;
              findings.push({
                id: "bp-dk-hg-coverage",
                title: `Host group coverage: ${coveragePct}% (${hostsNoGroup} host(s) without group)`,
                description: "Nearly all hosts are assigned to host groups, indicating proper DynaKube hostGroup configuration.",
                severity: "success",
                recommendation: "Maintain host group assignments. Use convention: <org>-<cluster>-<environment>.",
              });
            } else {
              findings.push({
                id: "bp-dk-hg-coverage-low",
                title: `Host group coverage: ${coveragePct}% — ${hostsNoGroup} host(s) without group`,
                description: `${hostsNoGroup} of ${totalHosts} hosts are not assigned to any host group. Best practice: 95%+ coverage.`,
                severity: coveragePct < 50 ? "critical" : "warning",
                recommendation: "Set spec.oneAgent.cloudNativeFullStack.hostGroup in DynaKube CR for all clusters.",
              });
            }
          }

          // Informational: DynaKube settings not checkable from app APIs
          findings.push({
            id: "bp-dk-info",
            title: "DynaKube CR settings require kubectl verification",
            description: "Feature flags (opt-in injection, fail-fast policy, label version detection, metadata enrichment, CSI mount timeout, tolerations, resource limits) cannot be verified from Dynatrace App APIs.",
            severity: "info",
            recommendation: "Verify DynaKube CR settings via kubectl: injection policy, namespace selectors, tolerations, resource sizing.",
          });

          allChecks.push({ name: "DynaKube Configuration", weight: 0.05, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "dynakube-config", name: "2. DynaKube Configuration & Feature Flags", description: "Host groups, feature flags, resource sizing", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 3. ActiveGate Sizing & Capabilities
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: At least 2 ActiveGates for HA
          total++;
          const agCount = dqlNumber(activeGateCount.data, "agCount");
          if (agCount >= 2) {
            passed++;
            findings.push({
              id: "bp-ag-ha",
              title: `${agCount} ActiveGate(s) detected — HA configuration`,
              description: "Multiple ActiveGates provide high availability and load distribution.",
              severity: "success",
              recommendation: "Ensure AGs are spread across availability zones with topologySpreadConstraints.",
            });
          } else if (agCount === 1) {
            findings.push({
              id: "bp-ag-single",
              title: "Only 1 ActiveGate detected — no HA",
              description: "A single ActiveGate creates a single point of failure. Best practice: 2+ replicas for 11-30 node clusters.",
              severity: "warning",
              recommendation: "Increase ActiveGate replicas to at least 2 for high availability.",
            });
          } else {
            findings.push({
              id: "bp-ag-none",
              title: "No ActiveGates detected via SFM metrics",
              description: "No ActiveGate CPU metrics found. ActiveGates may not be reporting or the metric is not available.",
              severity: "info",
              recommendation: "Deploy at least 2 ActiveGates with capabilities: kubernetes-monitoring, routing, metrics-ingest.",
            });
          }

          // Check: AG to host ratio
          total++;
          if (agCount > 0 && totalHosts > 0) {
            const ratio = totalHosts / agCount;
            if (ratio <= 15) {
              passed++;
              findings.push({
                id: "bp-ag-ratio",
                title: `AG-to-host ratio: 1:${Math.round(ratio)} — within guidelines`,
                description: `${agCount} ActiveGate(s) serving ${totalHosts} hosts.`,
                severity: "success",
                recommendation: "Monitor AG memory utilization. Alert on > 80% memory usage.",
              });
            } else {
              findings.push({
                id: "bp-ag-ratio-high",
                title: `AG-to-host ratio: 1:${Math.round(ratio)} — may need scaling`,
                description: `${agCount} ActiveGate(s) serving ${totalHosts} hosts. Consider adding replicas for clusters > 30 nodes.`,
                severity: "warning",
                recommendation: "Scale to 2-3 AGs for 31-50 nodes, 3+ for 50+ nodes. Add 1 replica per ~1,000 pods.",
              });
            }
          } else {
            passed++; // Skip if no data
          }

          allChecks.push({ name: "ActiveGate Sizing", weight: 0.07, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "activegate-sizing", name: "3. ActiveGate Sizing & Capabilities", description: "Replica count, HA, scaling thresholds", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 4. Network Zones & Routing
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Network zones configured
          total++;
          const nzCount = simpleCount(SETTINGS_SCHEMAS.networkZones);
          const nzRows = dqlRows(networkZoneAssignments.data);
          const hostsInDefault = nzRows.filter((r) => !r["networkZone"] || String(r["networkZone"]) === "default");
          const defaultCount = hostsInDefault.reduce((s, r) => s + Number(r["hostCount"] ?? 0), 0);

          if (nzCount > 0 && nzRows.length > 1) {
            passed++;
            findings.push({
              id: "bp-nz-configured",
              title: `${nzCount} network zone(s) configured with ${nzRows.length} assignment group(s)`,
              description: "Network zones are configured for traffic routing and failover.",
              severity: "success",
              recommendation: "Use naming convention: <org>.<cluster>.<environment>. Never reuse zone names across environments.",
            });
          } else if (nzCount > 0) {
            findings.push({
              id: "bp-nz-partial",
              title: `${nzCount} network zone(s) configured but limited host assignment diversity`,
              description: defaultCount > 0 ? `${defaultCount} host(s) remain in the default zone.` : "Network zones exist but host assignment may not be fully configured.",
              severity: "warning",
              recommendation: "Assign all hosts to named network zones. Set spec.networkZone in DynaKube CR.",
            });
          } else {
            findings.push({
              id: "bp-nz-none",
              title: "No custom network zones configured",
              description: "All agents are using the default zone. This mixes traffic across clusters and prevents proper failover routing.",
              severity: "warning",
              recommendation: "Create named network zones per cluster/environment. Set networkZone in every DynaKube CR.",
            });
          }

          allChecks.push({ name: "Network Zones", weight: 0.05, result: passed === total ? "pass" : "fail", partialValue: passed / Math.max(total, 1) });
          categories.push({ id: "network-zones", name: "4. Network Zones & Routing", description: "Zone configuration, failover routing", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 5. OneAgent Lifecycle Management
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Single agent version (no drift)
          total++;
          const versionRows = dqlRows(hostsByVersion.data);
          if (versionRows.length === 1) {
            passed++;
            findings.push({
              id: "bp-oa-single-version",
              title: `All hosts on single agent version: ${versionRows[0]["agentVersion"]}`,
              description: "No version drift detected. All hosts are running the same OneAgent version.",
              severity: "success",
              recommendation: "Continue with automatic updates or coordinated canary strategy.",
            });
          } else if (versionRows.length > 1) {
            findings.push({
              id: "bp-oa-version-drift",
              title: `${versionRows.length} different agent versions detected — version drift`,
              description: `Versions: ${versionRows.map((r) => `${r["agentVersion"]} (${r["hostCount"]} hosts)`).join(", ")}. Multiple versions indicate a failed or in-progress update.`,
              severity: "warning",
              recommendation: "Investigate version drift. If intentional (canary), validate within 48 hours before promoting.",
            });
          } else {
            findings.push({
              id: "bp-oa-no-version-data",
              title: "No agent version data available",
              description: "Cannot determine OneAgent version distribution.",
              severity: "info",
              recommendation: "Verify OneAgent deployment and agent version reporting.",
            });
          }

          // Check: All hosts FULL_STACK
          total++;
          const modeRows2 = dqlRows(hostsByMode.data);
          const infraOnly = modeRows2.filter(
            (r) => String(r["monitoringMode"]).toUpperCase() !== "FULL_STACK"
          );
          if (infraOnly.length === 0 && modeRows2.length > 0) {
            passed++;
            findings.push({
              id: "bp-oa-all-fullstack",
              title: "All hosts in FULL_STACK monitoring mode",
              description: "No INFRASTRUCTURE or CLOUD_INFRASTRUCTURE mode detected. Consistent monitoring mode across all hosts.",
              severity: "success",
              recommendation: "Monitor for mode drift weekly via DQL queries.",
            });
          } else if (infraOnly.length > 0) {
            findings.push({
              id: "bp-oa-mode-drift",
              title: `Monitoring mode drift: ${infraOnly.map((r) => `${r["monitoringMode"]} (${r["hostCount"]})`).join(", ")}`,
              description: "Hosts running in non-FULL_STACK mode indicate misconfiguration.",
              severity: "critical",
              recommendation: "All hosts must show FULL_STACK. Any INFRASTRUCTURE or CLOUD_INFRASTRUCTURE = misconfiguration.",
            });
          }

          allChecks.push({ name: "OneAgent Lifecycle", weight: 0.08, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "oneagent-lifecycle", name: "5. OneAgent Lifecycle Management", description: "Version drift, monitoring mode, token rotation", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 6. Kubernetes Labels & Tagging Strategy
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: No auto-tagging rules (deprecated for Grail)
          total++;
          const atCount = atData?.enabled ?? 0;
          if (atCount === 0) {
            passed++;
            findings.push({
              id: "bp-tag-no-autotag",
              title: "No active auto-tagging rules — Gen3 compliant",
              description: "Auto-tagging rules are deprecated for Grail. Tags should come from Kubernetes labels at source.",
              severity: "success",
              recommendation: "Apply tags in Kubernetes manifests and AWS resources — never create tags manually in Dynatrace UI.",
            });
          } else {
            findings.push({
              id: "bp-tag-autotag-present",
              title: `${atCount} active auto-tagging rule(s) — deprecated for Grail`,
              description: "Auto-tagging rules have no effect on Smartscape on Grail or 3rd gen apps. Tags must come from source (K8s labels).",
              severity: "critical",
              recommendation: "Remove auto-tagging rules. Use Kubernetes labels (app.kubernetes.io/name, team, tier) and promote to Primary Grail Tags.",
            });
          }

          // Check: No management zones (deprecated for Grail)
          total++;
          if (mzEnabled === 0) {
            passed++;
            findings.push({
              id: "bp-tag-no-mz",
              title: "No active management zones — Gen3 compliant",
              description: "Management zones are deprecated for Grail. Use segments and primary fields instead.",
              severity: "success",
              recommendation: "Use segments for data scoping and IAM policies for access control.",
            });
          } else {
            findings.push({
              id: "bp-tag-mz-present",
              title: `${mzEnabled} active management zone(s) — deprecated for Grail`,
              description: "Management zones are deprecated. Use segments and primary Grail fields instead.",
              severity: "critical",
              recommendation: "Migrate management zones to segments. Use primary fields: k8s.namespace.name, k8s.cluster.name, dt.host_group.id.",
            });
          }

          // Check: Ownership teams configured
          total++;
          const ownerCount = simpleCount(SETTINGS_SCHEMAS.ownershipTeams);
          if (ownerCount > 0) {
            passed++;
            findings.push({
              id: "bp-tag-ownership",
              title: `${ownerCount} ownership team(s) configured`,
              description: "Ownership teams enable team-based routing and accountability.",
              severity: "success",
              recommendation: "Map ownership teams to K8s labels (team, tier) for consistent team identification.",
            });
          } else {
            findings.push({
              id: "bp-tag-no-ownership",
              title: "No ownership teams configured",
              description: "Ownership teams are critical for team-based alert routing and accountability.",
              severity: "warning",
              recommendation: "Configure ownership teams (builtin:ownership.teams) and map to K8s team labels.",
            });
          }

          // Check: Calculated service metrics (Gen2 debt)
          total++;
          const calcSvcMetrics = metricsCheck.calculatedServiceMetrics;
          if (calcSvcMetrics === 0) {
            passed++;
            findings.push({
              id: "bp-tag-no-calc-metrics",
              title: "No calculated service metrics — Gen3 compliant",
              description: "No legacy calculated service metrics found. Metric extraction should be done via OpenPipeline.",
              severity: "success",
              recommendation: "Use OpenPipeline metric extraction instead of calculated service metrics.",
            });
          } else if (calcSvcMetrics > 0) {
            findings.push({
              id: "bp-tag-calc-metrics",
              title: `${calcSvcMetrics} calculated service metric(s) — Gen2 legacy`,
              description: "Calculated service metrics are Gen2 constructs. Best practice: use OpenPipeline metric extraction or Davis Analyzers.",
              severity: calcSvcMetrics > 20 ? "critical" : "warning",
              recommendation: "Migrate calculated service metrics to OpenPipeline metric extraction rules.",
            });
          } else {
            // -1 = error fetching
            findings.push({
              id: "bp-tag-calc-metrics-na",
              title: "Calculated service metrics: unable to check",
              description: "Could not query metrics API to count calculated service metrics.",
              severity: "info",
              recommendation: "Verify environment-api:metrics:read scope is available.",
            });
          }

          allChecks.push({ name: "K8s Labels & Tagging", weight: 0.10, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "k8s-labels-tagging", name: "6. Kubernetes Labels & Tagging Strategy", description: "Tag-at-source, no auto-tags or MZs, ownership teams, no legacy metrics", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 7. Grail Buckets & Retention Strategy
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          const bucketRows = dqlRows(bucketDetails.data);
          const customBuckets = bucketRows.filter((r) => {
            const name = String(r["name"] ?? "");
            return !name.startsWith("default_") && !name.startsWith("dt_");
          });

          // Check: Custom buckets exist
          total++;
          if (customBuckets.length > 0) {
            passed++;
            findings.push({
              id: "bp-bucket-custom",
              title: `${customBuckets.length} custom bucket(s): ${customBuckets.map((r) => r["name"]).join(", ")}`,
              description: "Custom Grail buckets indicate mature data management with purpose-built retention and access boundaries.",
              severity: "success",
              recommendation: "Use naming convention: <org>_<scope>_<datatype> for IAM policy compatibility.",
            });
          } else {
            findings.push({
              id: "bp-bucket-no-custom",
              title: "No custom Grail buckets — using defaults only",
              description: "All data is going to default buckets. Best practice: create purpose-built buckets for app logs, infra logs, security logs, spans, events, and bizevents with different retention periods.",
              severity: "warning",
              recommendation: "Create custom buckets: app_logs (30d), infra_logs (14d), security_logs (365d), spans (14d), events (90d), bizevents (90d).",
            });
          }

          // Check: Not using default_logs as permanent destination
          total++;
          const defaultLogsBucket = bucketRows.find((r) => String(r["name"]) === "default_logs");
          const defaultLogsRecords = Number(defaultLogsBucket?.["records"] ?? 0);
          if (defaultLogsRecords === 0 || !defaultLogsBucket) {
            passed++;
            findings.push({
              id: "bp-bucket-default-clean",
              title: "default_logs bucket is empty or not present",
              description: "Not relying on default_logs as permanent storage.",
              severity: "success",
              recommendation: "Keep default_logs as catch-all only. Route all known sources to purpose-built buckets.",
            });
          } else if (customBuckets.length > 0) {
            findings.push({
              id: "bp-bucket-default-partial",
              title: `default_logs has ${defaultLogsRecords.toLocaleString()} records — partial routing`,
              description: "Some data is still landing in default_logs. Review OpenPipeline routing to ensure all known sources are routed to custom buckets.",
              severity: "info",
              recommendation: "Review OpenPipeline routing rules. Add rules for unmatched log sources going to default_logs.",
            });
          } else {
            findings.push({
              id: "bp-bucket-default-only",
              title: `All logs in default_logs (${defaultLogsRecords.toLocaleString()} records)`,
              description: "All log data is going to the default bucket. This prevents granular retention, access control, and cost optimization.",
              severity: "warning",
              recommendation: "Create custom buckets and OpenPipeline routing rules to separate log data by purpose.",
            });
          }

          allChecks.push({ name: "Grail Buckets & Retention", weight: 0.08, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "grail-buckets", name: "7. Grail Buckets & Retention Strategy", description: "Custom buckets, retention tiers, naming conventions", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 8. OpenPipeline Processing & Routing
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: OpenPipeline configurations exist
          total++;
          const opLogsCount = simpleCount(SETTINGS_SCHEMAS.openPipelineLogs);
          const opMetricsCount = simpleCount(SETTINGS_SCHEMAS.openPipelineMetrics);
          const opTotal = opLogsCount + opMetricsCount;
          if (opTotal > 0) {
            passed++;
            findings.push({
              id: "bp-op-configured",
              title: `${opTotal} OpenPipeline configuration(s) (${opLogsCount} logs, ${opMetricsCount} metrics)`,
              description: "OpenPipeline processing and routing rules are configured for data management.",
              severity: "success",
              recommendation: "Ensure priority-ordered rule chain: most specific first, catch-all last (first match wins).",
            });
          } else {
            findings.push({
              id: "bp-op-none",
              title: "No custom OpenPipeline configurations detected",
              description: "No custom OpenPipeline log or metric pipeline settings found. Data is using default routing only.",
              severity: "warning",
              recommendation: "Configure OpenPipeline routing: security logs first, then infra, then app, then catch-all. Drop health check logs to save ~15-20% volume.",
            });
          }

          // Check: OpenPipeline ingest activity
          total++;
          const opIngestRows = dqlRows(openPipelineIngest.data);
          if (opIngestRows.length > 0) {
            passed++;
            const configs = opIngestRows.map((r) => `${r["configuration"]}: ${Number(r["total"]).toLocaleString()}`).join(", ");
            findings.push({
              id: "bp-op-active",
              title: `OpenPipeline actively processing data across ${opIngestRows.length} configuration(s)`,
              description: `Ingest by config: ${configs}`,
              severity: "success",
              recommendation: "Monitor OpenPipeline not-stored metrics for dropped data. Include enabled flag and note field per rule.",
            });
          } else {
            findings.push({
              id: "bp-op-no-ingest",
              title: "No OpenPipeline ingest data detected",
              description: "No OpenPipeline ingest metrics found. Pipelines may not be actively processing data.",
              severity: "info",
              recommendation: "Verify OpenPipeline is processing data via dt.sfm.openpipeline.ingest_sources_in.records metric.",
            });
          }

          allChecks.push({ name: "OpenPipeline", weight: 0.08, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "openpipeline", name: "8. OpenPipeline Processing & Routing", description: "Routing rules, processing stages, metric extraction", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 9. Segments & Data Scoping
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          total++;
          const segmentCount = simpleCount(SETTINGS_SCHEMAS.segments);
          if (segmentCount >= 3) {
            passed++;
            findings.push({
              id: "bp-seg-good",
              title: `${segmentCount} segment(s) configured — mature data scoping`,
              description: "Multiple segments indicate proper data scoping by team, environment, or service tier.",
              severity: "success",
              recommendation: "Build segments on Primary Grail Fields (k8s.namespace.name, k8s.cluster.name, dt.host_group.id) for optimal scan reduction.",
            });
          } else if (segmentCount > 0) {
            findings.push({
              id: "bp-seg-partial",
              title: `${segmentCount} segment(s) configured — consider expanding`,
              description: "Segments exist but consider adding more for team and environment separation.",
              severity: "info",
              recommendation: "Create segments for: Platform, Backend, Frontend, and a full-access Admin segment. Segments reduce scanned bytes significantly.",
            });
          } else {
            findings.push({
              id: "bp-seg-none",
              title: "No segments configured",
              description: "Segments are the Gen3 replacement for management zones. They reduce scanned data and improve query performance.",
              severity: "warning",
              recommendation: "Create segments using Primary Grail Fields. Segments are convenience; IAM policies are enforcement — use both together.",
            });
          }

          allChecks.push({ name: "Segments", weight: 0.06, result: passed === total ? "pass" : "fail", partialValue: passed / Math.max(total, 1) });
          categories.push({ id: "segments", name: "9. Segments & Data Scoping", description: "Data segmentation, scan reduction, team boundaries", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 10. IAM Policies & Access Control
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          const total = 0;
          const passed = 0;

          // IAM configuration is not queryable from app APIs
          findings.push({
            id: "bp-iam-info",
            title: "IAM policy configuration requires Account Management verification",
            description: "IAM policies, groups, and boundaries cannot be inspected from Dynatrace App APIs. Verify: SAML/SSO via corporate IdP, group-based access (admins, SRE, dev, frontend, readonly), three-layer model (groups + policies + boundaries).",
            severity: "info",
            recommendation: "Verify IAM setup: deny-by-default model, DENY for security logs on non-admin groups, reuse policies with different boundaries per group.",
          });

          findings.push({
            id: "bp-iam-checklist",
            title: "IAM best practice checklist (manual verification)",
            description: "Verify: (1) SAML/SSO authentication, (2) IdP group prefix for Dynatrace groups, (3) Separate admin/SRE/dev/frontend/readonly groups, (4) Bucket-scoped policies with WHERE clauses, (5) DENY rules for security logs on non-admin groups, (6) Boundaries limiting scope per group.",
            severity: "info",
            recommendation: "Review quarterly: verify role mappings match current team structure.",
          });

          allChecks.push({ name: "IAM Policies", weight: 0.05, result: "partial", partialValue: 0.5 });
          categories.push({ id: "iam-policies", name: "10. IAM Policies & Access Control", description: "Groups, policies, boundaries — manual verification required", findings, passedChecks: passed, totalChecks: Math.max(total, 1) });
        }

        // ──────────────────────────────────────────────
        // 11. API Tokens, OAuth & Security
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: SLOs exist (maturity signal for tokens/governance)
          total++;
          const slos = dqlNumber(sloCount.data);
          if (slos > 0) {
            passed++;
            findings.push({
              id: "bp-token-slos",
              title: `${slos} SLO(s) configured — operational maturity`,
              description: "SLOs indicate structured reliability management which often correlates with good token governance.",
              severity: "success",
              recommendation: "Define SLOs for critical services with environment-specific targets: 99.5% (prod), 99.0% (staging), 95.0% (dev).",
            });
          } else {
            findings.push({
              id: "bp-token-no-slos",
              title: "No SLOs configured",
              description: "SLOs are a key maturity indicator. Define availability and latency SLOs for critical services.",
              severity: "warning",
              recommendation: "Create SLOs: checkout availability (99.5% prod), checkout latency P95 (95% prod) on rolling week windows.",
            });
          }

          // Informational: Token governance
          findings.push({
            id: "bp-token-info",
            title: "Token governance best practices (manual verification)",
            description: "Verify: (1) Use OAuth2 clients for all new integrations, (2) One client per integration, (3) Least-privilege scopes, (4) Dedicated service users, (5) Secrets in AWS Secrets Manager/Vault, (6) Expiry dates on all tokens, (7) Monthly token inventory audit.",
            severity: "info",
            recommendation: "Prefer OAuth2 over classic access tokens. Set expiry dates, rotate every 90 days minimum, revoke unused tokens monthly.",
          });

          allChecks.push({ name: "API Tokens & OAuth", weight: 0.06, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "tokens-oauth", name: "11. API Tokens, OAuth & Security", description: "OAuth adoption, token governance, secret management", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 12. Terraform & Configuration-as-Code
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];

          findings.push({
            id: "bp-tf-info",
            title: "Terraform/Monaco usage requires external verification",
            description: "Configuration-as-code tool usage cannot be detected from Dynatrace App APIs. Verify: Terraform as primary CaC tool, pinned provider version (~> 1.91), never mix Monaco and Terraform for same config type.",
            severity: "info",
            recommendation: "Use Terraform for ongoing deployment, Monaco for bulk export/audit only. Deploy enrichment + buckets + OpenPipeline as coordinated Terraform module.",
          });

          findings.push({
            id: "bp-tf-checklist",
            title: "Terraform best practice checklist (manual verification)",
            description: "Verify: (1) terraform plan before every apply, (2) Environment promotion via .tfvars, (3) Variables for tenant URL, alert delay, SLO targets, notification channels, (4) OPA/Conftest in CI pipeline for resource allowlists.",
            severity: "info",
            recommendation: "Block merge on terraform plan failure in CI. Use environment-specific .tfvars for dev/staging/production.",
          });

          allChecks.push({ name: "Terraform & CaC", weight: 0.03, result: "partial", partialValue: 0.5 });
          categories.push({ id: "terraform-config", name: "12. Terraform & Configuration-as-Code", description: "CaC tooling, provider config, CI/CD — manual verification", findings, passedChecks: 0, totalChecks: 1 });
        }

        // ──────────────────────────────────────────────
        // 13. ArgoCD & GitOps Patterns
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];

          findings.push({
            id: "bp-argo-info",
            title: "ArgoCD/GitOps patterns require external verification",
            description: "GitOps tooling cannot be detected from Dynatrace App APIs. Verify: ArgoCD manages K8s-level resources (DynaKube, namespace labels, secrets via ESO), GitHub Actions + Terraform manages platform config.",
            severity: "info",
            recommendation: "DynaKube changes through Git only (never kubectl apply in production). Use Kustomize overlays per cluster. External Secrets Operator for token sync.",
          });

          findings.push({
            id: "bp-argo-checklist",
            title: "GitOps best practice checklist (manual verification)",
            description: "Verify: (1) ArgoCD Application with selfHeal + ServerSideApply, (2) Git as source of truth, (3) Rollback via git revert, (4) Single repo for all Dynatrace config, (5) ESO syncing from AWS Secrets Manager.",
            severity: "info",
            recommendation: "If it is in Git, Git wins — manual UI changes get overwritten. Use git revert for rollback, not manual edits.",
          });

          allChecks.push({ name: "ArgoCD & GitOps", weight: 0.03, result: "partial", partialValue: 0.5 });
          categories.push({ id: "argocd-gitops", name: "13. ArgoCD & GitOps Patterns", description: "GitOps workflow, ArgoCD config, ESO — manual verification", findings, passedChecks: 0, totalChecks: 1 });
        }

        // ──────────────────────────────────────────────
        // 14. Monitoring the Monitoring
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: K8s clusters monitored
          total++;
          const k8sClusters = dqlNumber(k8sClusterCount.data);
          if (k8sClusters > 0) {
            passed++;
            findings.push({
              id: "bp-mon-k8s",
              title: `${k8sClusters} Kubernetes cluster(s) monitored`,
              description: "Kubernetes monitoring is active, enabling operator health, webhook, and CSI driver visibility.",
              severity: "success",
              recommendation: "Monitor: operator health (0 restarts), webhook latency (<50ms), CSI driver on all nodes, OneAgent connectivity.",
            });
          } else {
            findings.push({
              id: "bp-mon-no-k8s",
              title: "No Kubernetes clusters detected",
              description: "No K8s clusters found. If running on Kubernetes, verify kubernetes-monitoring ActiveGate capability.",
              severity: "info",
              recommendation: "Enable kubernetes-monitoring capability on ActiveGate for full cluster visibility.",
            });
          }

          // Check: Davis Anomaly Detectors for health monitoring
          total++;
          const davisDetectors = simpleCount(SETTINGS_SCHEMAS.davisAnomalyDetectors);
          if (davisDetectors >= 3) {
            passed++;
            findings.push({
              id: "bp-mon-davis-detectors",
              title: `${davisDetectors} Davis Anomaly Detector(s) — monitoring health coverage`,
              description: "Multiple Davis Anomaly Detectors suggest monitoring health coverage for infrastructure components.",
              severity: "success",
              recommendation: "Ensure detectors cover: OneAgent host dropout, AG pod failure, injection rate drop.",
            });
          } else if (davisDetectors > 0) {
            findings.push({
              id: "bp-mon-few-detectors",
              title: `${davisDetectors} Davis Anomaly Detector(s) — expand coverage`,
              description: "Some monitoring health coverage exists. Consider adding detectors for critical infrastructure signals.",
              severity: "info",
              recommendation: "Add detectors for: host count baseline, AG memory utilization, webhook latency, injection rate.",
            });
          } else {
            findings.push({
              id: "bp-mon-no-detectors",
              title: "No Davis Anomaly Detectors for health monitoring",
              description: "No Davis Anomaly Detectors configured. These should monitor the monitoring stack itself.",
              severity: "warning",
              recommendation: "Create Davis Anomaly Detectors: OneAgent host dropout (every 15 min), AG pod failure, injection rate < 95%.",
            });
          }

          // Check: Reliability Guardian
          total++;
          const rgCount = simpleCount(SETTINGS_SCHEMAS.reliabilityGuardian);
          if (rgCount > 0) {
            passed++;
            findings.push({
              id: "bp-mon-guardian",
              title: `${rgCount} Reliability Guardian(s) configured`,
              description: "Reliability Guardians validate releases and changes against defined quality criteria.",
              severity: "success",
              recommendation: "Use Reliability Guardians in CI/CD pipelines for automated release validation.",
            });
          } else {
            findings.push({
              id: "bp-mon-no-guardian",
              title: "No Reliability Guardians configured",
              description: "Reliability Guardians enable automated release validation against defined SLOs and quality criteria.",
              severity: "info",
              recommendation: "Configure Reliability Guardian for release validation with entity baseline snapshot checks.",
            });
          }

          // Check: Service key requests (SERVICE_METHOD) — indicates request naming maturity
          total++;
          const svcMethods = dqlNumber(serviceMethodCount.data);
          if (svcMethods > 0) {
            passed++;
            findings.push({
              id: "bp-mon-svc-methods",
              title: `${svcMethods.toLocaleString()} service method(s) detected — request naming active`,
              description: "Service methods (key requests) are being tracked, indicating request-level monitoring is configured.",
              severity: "success",
              recommendation: "Review key request naming rules for critical services. Ensure top endpoints are captured.",
            });
          } else {
            findings.push({
              id: "bp-mon-no-svc-methods",
              title: "No service methods detected",
              description: "No SERVICE_METHOD entities found. Key request naming may not be configured.",
              severity: "info",
              recommendation: "Configure request naming rules or key requests for critical service endpoints.",
            });
          }

          // Check: Custom services — indicates custom instrumentation
          total++;
          const customSvcs = dqlNumber(customServiceCount.data);
          if (customSvcs > 0) {
            findings.push({
              id: "bp-mon-custom-svcs",
              title: `${customSvcs} custom service(s) detected`,
              description: "Custom services indicate manual instrumentation for services not auto-detected by OneAgent.",
              severity: "info",
              recommendation: "Review custom service definitions. Ensure they're still needed and properly maintained.",
            });
          }
          passed++; // Informational — pass regardless

          // Check: Extension configurations maturity
          total++;
          const extConfigs = metricsCheck.extensionConfigurations;
          if (extConfigs > 0) {
            passed++;
            findings.push({
              id: "bp-mon-ext-configs",
              title: `${extConfigs} extension monitoring configuration(s) active`,
              description: "Extensions 2.0 monitoring configurations are deployed for additional data sources.",
              severity: "success",
              recommendation: "Monitor extension health via dsfm:extension.* metrics. Ensure AG-hosted extensions have dedicated EC2 AG.",
            });
          } else if (extConfigs === 0) {
            findings.push({
              id: "bp-mon-no-ext-configs",
              title: "No extension monitoring configurations",
              description: "No Extensions 2.0 monitoring configurations found. Extensions enable SNMP, Prometheus, SQL, and Python-based monitoring.",
              severity: "info",
              recommendation: "Deploy Extensions 2.0 for additional data sources if needed (SNMP, Prometheus, SQL).",
            });
          }

          allChecks.push({ name: "Monitoring the Monitoring", weight: 0.08, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "monitoring-monitoring", name: "14. Monitoring the Monitoring", description: "Health monitoring, Davis Detectors, service instrumentation, extensions", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 15. Governance & Audit Cadence
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Audit log activity (indicates review cadence)
          total++;
          const auditTotal = dqlNumber(auditActivity.data, "total");
          if (auditTotal > 0) {
            passed++;
            findings.push({
              id: "bp-gov-audit-active",
              title: `${auditTotal.toLocaleString()} audit events in last 30 days`,
              description: "Audit log activity indicates configuration changes are being tracked.",
              severity: "success",
              recommendation: "Review audit logs weekly for unexpected configuration changes. Set up alerts for critical config modifications.",
            });
          } else {
            findings.push({
              id: "bp-gov-no-audit",
              title: "No audit events detected in last 30 days",
              description: "No audit events found. This may indicate audit logging is not configured or no changes have been made.",
              severity: "info",
              recommendation: "Ensure audit logging is enabled. Review weekly for unauthorized changes.",
            });
          }

          // Check: Issue tracking integration (operational maturity)
          total++;
          const itCount = simpleCount(SETTINGS_SCHEMAS.issueTracking);
          if (itCount > 0) {
            passed++;
            findings.push({
              id: "bp-gov-issue-tracking",
              title: `${itCount} issue tracking integration(s) configured`,
              description: "Issue tracking connects Davis problems to external ITSM systems for automated incident management.",
              severity: "success",
              recommendation: "Ensure all critical services have issue tracking configured for automated ticket creation.",
            });
          } else {
            findings.push({
              id: "bp-gov-no-issue-tracking",
              title: "No issue tracking integration configured",
              description: "Issue tracking integration connects Davis problems to Jira, ServiceNow, etc. for automated incident management.",
              severity: "warning",
              recommendation: "Configure issue tracking integration (builtin:issue-tracking.integration) for automated ticket creation from Davis problems.",
            });
          }

          // Informational: Governance cadence
          findings.push({
            id: "bp-gov-cadence",
            title: "Governance cadence checklist (manual verification)",
            description: "Verify: (1) Weekly audit log review, (2) Monthly API token inventory, (3) Monthly entity count baseline, (4) Quarterly full policy review, (5) Quarterly bucket retention review, (6) Annual break-glass account test.",
            severity: "info",
            recommendation: "Implement single SA Writer principle: only pipeline service account writes to production. Use two-pipeline model: IAM pipeline (central) + config pipeline (per-team).",
          });

          allChecks.push({ name: "Governance & Audit", weight: 0.08, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "governance-audit", name: "15. Governance & Audit Cadence", description: "Audit reviews, token inventory, policy reviews", findings, passedChecks: passed, totalChecks: total });
        }

        // ══════════════════════════════════════════════
        // Additional categories from workshop summaries
        // ══════════════════════════════════════════════

        // ──────────────────────────────────────────────
        // 16. Workflows & Automation
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Workflow execution health
          total++;
          const wfRow = dqlRows(workflowExecHealth.data)[0] ?? {};
          const wfTotal = Number(wfRow["total"] ?? 0);
          const wfSuccessRate = Number(wfRow["successRate"] ?? 0);
          if (wfTotal > 0 && wfSuccessRate >= 95) {
            passed++;
            findings.push({
              id: "bp-wf-health",
              title: `Workflow success rate: ${wfSuccessRate.toFixed(1)}% (${wfTotal} executions/7d)`,
              description: "Workflow execution success rate is above 95% threshold.",
              severity: "success",
              recommendation: "Continue monitoring. Set up alerts for workflow failure rate spikes.",
            });
          } else if (wfTotal > 0) {
            findings.push({
              id: "bp-wf-health-low",
              title: `Workflow success rate: ${wfSuccessRate.toFixed(1)}% (${wfTotal} executions/7d) — below 95% target`,
              description: "Workflow success rate is below the recommended 95% threshold. Investigate failing workflows.",
              severity: "warning",
              recommendation: "Review failing workflows. Ensure HTTP calls have 10s timeout, DQL queries have 30s timeout, and external calls have try-catch error handling.",
            });
          } else {
            findings.push({
              id: "bp-wf-no-executions",
              title: "No workflow executions in last 7 days",
              description: "No AutomationEngine workflow executions detected. Workflows are the Gen3 replacement for notification integrations.",
              severity: "info",
              recommendation: "Create workflows for: alert routing (Davis Problem trigger), health monitoring (scheduled), and remediation (with approval gates).",
            });
          }

          // Check: Deployment events (CI/CD integration)
          total++;
          const deployCount = dqlNumber(deploymentEvents.data, "total");
          if (deployCount > 0) {
            passed++;
            findings.push({
              id: "bp-wf-deploy-events",
              title: `${deployCount} deployment event(s) in last 7 days — CI/CD integrated`,
              description: "Deployment events are flowing, indicating CI/CD pipeline integration with Dynatrace.",
              severity: "success",
              recommendation: "Ensure all production deployments send events. Use deployment markers for Davis AI correlation.",
            });
          } else {
            findings.push({
              id: "bp-wf-no-deploy",
              title: "No deployment events detected (last 7d)",
              description: "No CUSTOM_DEPLOYMENT events found. Deployment events enable Davis AI to correlate problems with releases.",
              severity: "warning",
              recommendation: "Send deployment events from CI/CD pipeline via Events API v2. This enables release-aware problem correlation.",
            });
          }

          allChecks.push({ name: "Workflows & Automation", weight: 0.07, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "workflows-automation", name: "16. Workflows & Automation", description: "Workflow health, CI/CD integration, deployment events", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 17. Distributed Tracing & Spans
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Spans flowing to Grail
          total++;
          const spans = dqlNumber(spanCount.data, "total");
          if (spans > 0) {
            passed++;
            findings.push({
              id: "bp-span-flowing",
              title: `${spans.toLocaleString()} spans in Grail (last 24h) — distributed tracing active`,
              description: "Spans are flowing to Grail, enabling distributed trace analysis and service dependency mapping.",
              severity: "success",
              recommendation: "Ensure all critical services are instrumented. Drop health check spans at ingestion via OpenPipeline to reduce volume.",
            });
          } else {
            findings.push({
              id: "bp-span-none",
              title: "No spans detected in Grail (last 24h)",
              description: "No distributed tracing data found. Spans are critical for service dependency analysis and root cause investigation.",
              severity: "warning",
              recommendation: "Enable distributed tracing via OneAgent auto-instrumentation or OpenTelemetry SDK. Verify storage:spans:read scope.",
            });
          }

          // Check: Span data quality
          total++;
          const sqRow = dqlRows(spanQuality.data)[0] ?? {};
          const sqTotal = Number(sqRow["total"] ?? 0);
          const sqWithService = Number(sqRow["withServiceName"] ?? 0);
          if (sqTotal > 0) {
            const serviceRate = (sqWithService / sqTotal * 100);
            if (serviceRate >= 95) {
              passed++;
              findings.push({
                id: "bp-span-quality-good",
                title: `Span data quality: ${serviceRate.toFixed(1)}% have service.name`,
                description: "Span instrumentation quality is high with service.name attribute populated on most spans.",
                severity: "success",
                recommendation: "Ensure db.system, db.statement, and db.namespace are populated on database spans for query analysis.",
              });
            } else {
              findings.push({
                id: "bp-span-quality-low",
                title: `Span data quality: ${serviceRate.toFixed(1)}% have service.name — needs improvement`,
                description: `${sqTotal.toLocaleString()} total spans, but only ${serviceRate.toFixed(1)}% have service.name populated.`,
                severity: "warning",
                recommendation: "Configure OpenTelemetry resource attributes to include service.name, service.version, and deployment.environment on all spans.",
              });
            }
          }

          allChecks.push({ name: "Distributed Tracing", weight: 0.06, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "distributed-tracing", name: "17. Distributed Tracing & Spans", description: "Span ingestion, data quality, OpenTelemetry", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 18. Business Events
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Business events flowing
          total++;
          const bizeventTotal = dqlNumber(bizEventVolume.data, "total");
          if (bizeventTotal > 0) {
            passed++;
            findings.push({
              id: "bp-biz-flowing",
              title: `${bizeventTotal.toLocaleString()} business events (last 24h) — BizOps active`,
              description: "Business events are flowing to Grail, enabling revenue tracking, funnel analysis, and business KPIs.",
              severity: "success",
              recommendation: "Ensure all events have event.type and event.provider populated. Use reverse-domain naming for event types.",
            });
          } else {
            findings.push({
              id: "bp-biz-none",
              title: "No business events detected (last 24h)",
              description: "Business events enable revenue tracking, conversion funnel analysis, and business KPI monitoring.",
              severity: "info",
              recommendation: "Instrument business events for critical transactions: purchases, signups, cart additions. Use the Business Events API or OneAgent auto-capture.",
            });
          }

          // Check: Bizevent data quality
          total++;
          const bqRow = dqlRows(bizeventsQuality.data)[0] ?? {};
          const bqTotal = Number(bqRow["total"] ?? 0);
          const bqWithType = Number(bqRow["withType"] ?? 0);
          const bqWithProvider = Number(bqRow["withProvider"] ?? 0);
          if (bqTotal > 0) {
            const typeRate = (bqWithType / bqTotal * 100);
            const providerRate = (bqWithProvider / bqTotal * 100);
            if (typeRate >= 99 && providerRate >= 99) {
              passed++;
              findings.push({
                id: "bp-biz-quality-good",
                title: `Business event quality: ${typeRate.toFixed(1)}% have event.type, ${providerRate.toFixed(1)}% have event.provider`,
                description: "Business event data quality is excellent with required fields populated.",
                severity: "success",
                recommendation: "Continue maintaining high data quality. Add user_id or session_id for funnel analysis.",
              });
            } else {
              findings.push({
                id: "bp-biz-quality-low",
                title: `Business event quality: ${typeRate.toFixed(1)}% have event.type, ${providerRate.toFixed(1)}% have event.provider`,
                description: "Some business events are missing required fields. All events should have event.type and event.provider.",
                severity: "warning",
                recommendation: "Ensure all business events include: event.type (reverse-domain format), event.provider, and a user/session identifier.",
              });
            }
          }

          // Check: Business events security context rules
          total++;
          const bizSecRules = simpleCount(SETTINGS_SCHEMAS.bizeventsSecurityContextRules);
          if (bizSecRules > 0) {
            passed++;
            findings.push({
              id: "bp-biz-sec-context",
              title: `${bizSecRules} business event security context rule(s) configured`,
              description: "Security context rules control access to business events at the record level.",
              severity: "success",
              recommendation: "Ensure security context rules cover PCI-regulated and sensitive business events.",
            });
          } else if (bizeventTotal > 0) {
            findings.push({
              id: "bp-biz-no-sec-context",
              title: "No business event security context rules",
              description: "Business events are flowing but no security context rules are configured. This means all users with bucket access can see all events.",
              severity: "warning",
              recommendation: "Configure builtin:bizevents-security-context-rules for sensitive business events (payment, PII).",
            });
          }

          allChecks.push({ name: "Business Events", weight: 0.05, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "business-events", name: "18. Business Events", description: "BizOps adoption, event data quality, security context", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 19. Log Processing & Filtering
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: DEBUG/TRACE log filtering
          total++;
          const dlRow = dqlRows(debugLogVolume.data)[0] ?? {};
          const dlTotal = Number(dlRow["total"] ?? 0);
          const dlDebug = Number(dlRow["debugCount"] ?? 0);
          if (dlTotal > 0) {
            const debugPct = (dlDebug / dlTotal * 100);
            if (debugPct < 5) {
              passed++;
              findings.push({
                id: "bp-log-debug-low",
                title: `DEBUG/TRACE logs: ${debugPct.toFixed(1)}% of volume — well filtered`,
                description: `${dlDebug.toLocaleString()} DEBUG/TRACE out of ${dlTotal.toLocaleString()} total logs in 24h.`,
                severity: "success",
                recommendation: "Continue filtering debug logs. Consider OpenPipeline rules to drop health check logs (~15-20% volume savings).",
              });
            } else {
              findings.push({
                id: "bp-log-debug-high",
                title: `DEBUG/TRACE logs: ${debugPct.toFixed(1)}% of volume — excessive`,
                description: `${dlDebug.toLocaleString()} DEBUG/TRACE logs out of ${dlTotal.toLocaleString()} total in 24h. Best practice: filter DEBUG/TRACE in production.`,
                severity: "warning",
                recommendation: "Configure OpenPipeline to drop DEBUG/TRACE logs in production. This can save 15-30% of log storage costs.",
              });
            }
          }

          allChecks.push({ name: "Log Processing", weight: 0.05, result: passed === total ? "pass" : passed > 0 ? "partial" : "fail", partialValue: total > 0 ? passed / total : 0 });
          categories.push({ id: "log-processing", name: "19. Log Processing & Filtering", description: "Debug filtering, PII masking, volume optimization", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 20. Synthetic Monitoring
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: Synthetic monitors exist
          total++;
          const synthRows = dqlRows(syntheticDetails.data);
          const synthTotal = synthRows.reduce((s, r) => s + Number(r["testCount"] ?? 0), 0);
          if (synthTotal > 0) {
            passed++;
            const typeBreakdown = synthRows.map((r) => `${r["type"]}: ${r["testCount"]}`).join(", ");
            findings.push({
              id: "bp-synth-present",
              title: `${synthTotal} synthetic monitor(s) — ${typeBreakdown}`,
              description: "Synthetic monitoring is configured for availability and performance validation.",
              severity: "success",
              recommendation: "Ensure critical monitors run at 1-5 min frequency from 3+ locations. Enable SSL certificate monitoring.",
            });
          } else {
            findings.push({
              id: "bp-synth-none",
              title: "No synthetic monitors detected",
              description: "Synthetic monitoring provides proactive availability and performance checks for critical endpoints.",
              severity: "warning",
              recommendation: "Create HTTP monitors for critical APIs (1-min frequency, 3+ locations). Add browser monitors for key user journeys (5-min frequency).",
            });
          }

          allChecks.push({ name: "Synthetic Monitoring", weight: 0.05, result: passed === total ? "pass" : "fail", partialValue: passed / Math.max(total, 1) });
          categories.push({ id: "synthetic-monitoring", name: "20. Synthetic Monitoring", description: "Availability testing, performance checks, SSL monitoring", findings, passedChecks: passed, totalChecks: total });
        }

        // ──────────────────────────────────────────────
        // 21. Real User Monitoring (RUM)
        // ──────────────────────────────────────────────
        {
          const findings: Finding[] = [];
          let passed = 0;
          let total = 0;

          // Check: RUM applications configured
          total++;
          const appCount = dqlNumber(applicationCount.data);
          if (appCount > 0) {
            passed++;
            findings.push({
              id: "bp-rum-apps",
              title: `${appCount} RUM application(s) configured`,
              description: "Real User Monitoring is active, providing browser/mobile user experience data.",
              severity: "success",
              recommendation: "Verify: automatic RUM injection enabled, SPA route change capture on, Core Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1) tracked.",
            });
          } else {
            findings.push({
              id: "bp-rum-none",
              title: "No RUM applications detected",
              description: "Real User Monitoring provides actual end-user experience data including Core Web Vitals, errors, and session replay.",
              severity: "info",
              recommendation: "Enable RUM via automatic JavaScript injection. Configure user action naming, session replay (with privacy masking), and Core Web Vitals targets.",
            });
          }

          allChecks.push({ name: "Real User Monitoring", weight: 0.04, result: passed === total ? "pass" : "fail", partialValue: passed / Math.max(total, 1) });
          categories.push({ id: "rum", name: "21. Real User Monitoring (RUM)", description: "User experience, Core Web Vitals, session replay", findings, passedChecks: passed, totalChecks: total });
        }

        // Calculate overall score
        const score = calculateAreaScore(allChecks, 1.0);
        const totalPassed = categories.reduce((s, c) => s + c.passedChecks, 0);
        const totalCheckCount = categories.reduce((s, c) => s + c.totalChecks, 0);

        if (!cancelled) {
          setResult({
            categories,
            overallScore: score.value,
            totalPassed,
            totalChecks: totalCheckCount,
            isLoading: false,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setResult((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to analyze best practices",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    hostsByMode.isLoading, hostsByMode.isPending, hostsByMode.data, hostsByMode.error,
    hostsByVersion.isLoading, hostsByVersion.isPending, hostsByVersion.data, hostsByVersion.error,
    hostsByHostGroup.isLoading, hostsByHostGroup.isPending, hostsByHostGroup.data, hostsByHostGroup.error,
    networkZoneAssignments.isLoading, networkZoneAssignments.isPending, networkZoneAssignments.data, networkZoneAssignments.error,
    bucketDetails.isLoading, bucketDetails.isPending, bucketDetails.data, bucketDetails.error,
    auditActivity.isLoading, auditActivity.isPending, auditActivity.data, auditActivity.error,
    activeGateCount.isLoading, activeGateCount.isPending, activeGateCount.data, activeGateCount.error,
    k8sClusterCount.isLoading, k8sClusterCount.isPending, k8sClusterCount.data, k8sClusterCount.error,
    workflowCount.isLoading, workflowCount.isPending, workflowCount.data, workflowCount.error,
    sloCount.isLoading, sloCount.isPending, sloCount.data, sloCount.error,
    awsCount.isLoading, awsCount.isPending, awsCount.data, awsCount.error,
    openPipelineIngest.isLoading, openPipelineIngest.isPending, openPipelineIngest.data, openPipelineIngest.error,
    hostCount.isLoading, hostCount.isPending, hostCount.data, hostCount.error,
    workflowExecHealth.isLoading, workflowExecHealth.isPending, workflowExecHealth.data, workflowExecHealth.error,
    deploymentEvents.isLoading, deploymentEvents.isPending, deploymentEvents.data, deploymentEvents.error,
    bizeventsQuality.isLoading, bizeventsQuality.isPending, bizeventsQuality.data, bizeventsQuality.error,
    spanQuality.isLoading, spanQuality.isPending, spanQuality.data, spanQuality.error,
    debugLogVolume.isLoading, debugLogVolume.isPending, debugLogVolume.data, debugLogVolume.error,
    syntheticDetails.isLoading, syntheticDetails.isPending, syntheticDetails.data, syntheticDetails.error,
    spanCount.isLoading, spanCount.isPending, spanCount.data, spanCount.error,
    bizEventVolume.isLoading, bizEventVolume.isPending, bizEventVolume.data, bizEventVolume.error,
    applicationCount.isLoading, applicationCount.isPending, applicationCount.data, applicationCount.error,
    serviceMethodCount.isLoading, serviceMethodCount.isPending, serviceMethodCount.data, serviceMethodCount.error,
    customServiceCount.isLoading, customServiceCount.isPending, customServiceCount.data, customServiceCount.error,
    hostsWithoutHostGroup.isLoading, hostsWithoutHostGroup.isPending, hostsWithoutHostGroup.data, hostsWithoutHostGroup.error,
  ]);

  return result;
}
