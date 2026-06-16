import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";

import { getSettingsObjectCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen3Severity, getGen2Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";
import {
  activeGatesAutoUpdateConfigurationClient,
  activeGatesActiveGateGroupsClient,
} from "@dynatrace-sdk/client-classic-environment-v2";

/**
 * Monitoring Configuration review area.
 *
 * Checks:
 * 1. Hosts monitored (OneAgent deployment)
 * 2. Services detected
 * 3. Process groups detected
 * 4. OneAgent version uniformity
 * 5. Grail entity access working
 * 6. SLO adoption (maturity indicator)
 * 7. Kubernetes cluster monitoring
 * 8. Kubernetes workload coverage
 *
 * Migration metric: OneAgent is Gen3-compatible; K8s and SLOs are Gen3-native.
 */
export function useMonitoringReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "monitoring",
    status: "unknown",
    score: { value: 0, weight: 1.0, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const hostCount = useDql(DQL_QUERIES.hostCount);
  const serviceCount = useDql(DQL_QUERIES.serviceCount);
  const processGroupCount = useDql(DQL_QUERIES.processGroupCount);
  const hostsByVersion = useDql(DQL_QUERIES.hostsByAgentVersion);
  const sloCount = useDql(DQL_QUERIES.sloCount);
  const k8sClusters = useDql(DQL_QUERIES.k8sClusterCount);
  const k8sWorkloads = useDql(DQL_QUERIES.k8sWorkloadCount);
  const monitoringCandidates = useDql(DQL_QUERIES.monitoringCandidates);
  const smartscapeHosts = useDql(DQL_QUERIES.smartscapeHosts);
  const smartscapeServices = useDql(DQL_QUERIES.smartscapeServices);
  const smartscapeProcesses = useDql(DQL_QUERIES.smartscapeProcesses);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (hostCount.isLoading || serviceCount.isLoading || processGroupCount.isLoading || hostsByVersion.isLoading) return;
    if (hostCount.isPending || serviceCount.isPending || processGroupCount.isPending || hostsByVersion.isPending) return;
    if (sloCount.isLoading || sloCount.isPending) return;
    if (k8sClusters.isLoading || k8sClusters.isPending) return;
    if (k8sWorkloads.isLoading || k8sWorkloads.isPending) return;
    if (monitoringCandidates.isLoading || monitoringCandidates.isPending) return;
    if (smartscapeHosts.isLoading || smartscapeHosts.isPending) return;
    if (smartscapeServices.isLoading || smartscapeServices.isPending) return;
    if (smartscapeProcesses.isLoading || smartscapeProcesses.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {


    const findings: Finding[] = [];
    const checks: Check[] = [];

    // Parse counts
    const hosts = Number((hostCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const services = Number((serviceCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const processGroups = Number((processGroupCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const slos = Number((sloCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const clusters = Number((k8sClusters.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const workloads = Number((k8sWorkloads.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);

    // Check 1: Hosts monitored
    const hasHostError = !!hostCount.error;
    checks.push({
      name: "Hosts monitored",
      weight: 0.2,
      result: hasHostError ? "partial" : hosts > 0 ? "pass" : "fail",
      partialValue: hasHostError ? 0 : undefined,
    });
    if (!hasHostError && hosts === 0) {
      findings.push({
        id: "mon-no-hosts",
        title: "No monitored hosts found",
        description: "No hosts are being monitored. Verify OneAgent deployment.",
        severity: "critical",
        recommendation: "Deploy OneAgent to your infrastructure hosts.",
      });
    }

    // Check 2: Services detected
    checks.push({
      name: "Services detected",
      weight: 0.15,
      result: services > 0 ? "pass" : "fail",
    });

    // Check 3: Process groups detected
    checks.push({
      name: "Process groups detected",
      weight: 0.1,
      result: processGroups > 0 ? "pass" : "fail",
    });

    // Check 4: Agent version diversity (fewer versions = better)
    const versionRecords = (hostsByVersion.data?.records ?? []) as Record<string, unknown>[];
    const uniqueVersions = versionRecords.length;
    checks.push({
      name: "OneAgent version uniformity",
      weight: 0.1,
      result: uniqueVersions <= 2 ? "pass" : uniqueVersions <= 4 ? "partial" : "fail",
      partialValue: uniqueVersions <= 4 ? 1 - (uniqueVersions / 8) : undefined,
    });
    if (uniqueVersions > 2) {
      findings.push({
        id: "mon-version-spread",
        title: `${uniqueVersions} different OneAgent versions detected`,
        description: `Running multiple OneAgent versions increases operational complexity. Versions: ${versionRecords.map((r) => (typeof r.agentVersion === "string" ? r.agentVersion : "unknown")).join(", ")}`,
        severity: uniqueVersions > 4 ? "warning" : "info",
        recommendation: "Enable automatic OneAgent updates or schedule a coordinated update to reduce version spread.",
      });
    }

    // Check 5: Grail entity access
    checks.push({
      name: "Grail entity access working",
      weight: 0.1,
      result: hostCount.error ? "partial" : "pass",
      partialValue: hostCount.error ? 0 : undefined,
    });
    if (hostCount.error) {
      findings.push({
        id: "mon-grail-error",
        title: "Cannot query Grail for entity data",
        description: "The app may not have the required scope to query entities. Review results may be incomplete.",
        severity: "warning",
        recommendation: "Verify storage:entities:read scope is configured for this app.",
      });
    }

    // Check 6: SLO adoption (key maturity indicator)
    const sloAccessible = !sloCount.error;
    if (config.slos.enabled) {
      checks.push({
        name: "SLOs configured",
        weight: config.slos.weight,
        result: !sloAccessible ? "partial" : slos >= 5 ? "pass" : slos > 0 ? "partial" : "fail",
        partialValue: !sloAccessible ? 0.3 : slos > 0 ? Math.min(slos / 5, 0.8) : undefined,
      });
      if (sloCount.error) {
        findings.push({
          id: "mon-slo-error",
          title: "Cannot query SLO entities",
          description: "SLO entity query failed. This may be a scope issue or SLOs may not be configured.",
          severity: "info",
          recommendation: "Verify entity access and check if Service Level Objectives are configured.",
        });
      } else if (slos === 0) {
        findings.push({
          id: "mon-no-slos",
          title: "No Service Level Objectives (SLOs) configured",
          description: "SLOs are a key maturity indicator. They define reliability targets for services and trigger alerts when error budgets are at risk.",
          severity: "warning",
          recommendation: "Define SLOs for critical services. Start with availability and latency SLOs for customer-facing services.",
        });
      } else {
        findings.push({
          id: "mon-slo-count",
          title: `${slos} Service Level Objective(s) configured`,
          description: slos < 5
            ? "SLOs are in place but coverage may be limited. Consider adding SLOs for all critical services."
            : "Good SLO coverage. SLOs provide reliability targets and error budget tracking.",
          severity: getGen3Severity(slos, config.slos),
          recommendation: slos < 5
            ? "Expand SLO coverage to all critical services and user journeys."
            : "Review SLO targets periodically and ensure burn rate alerts are configured.",
        });
      }
    }

    // Check 7: Kubernetes cluster monitoring
    const k8sAccessible = !k8sClusters.error;
    if (config.k8sClusters.enabled) {
      checks.push({
        name: "Kubernetes monitoring",
        weight: config.k8sClusters.weight,
        result: !k8sAccessible ? "partial" : clusters > 0 ? "pass" : "partial",
        partialValue: !k8sAccessible ? 0.3 : clusters === 0 ? 0.5 : undefined,
      });
      if (k8sClusters.error) {
        findings.push({
          id: "mon-k8s-error",
          title: "Cannot query Kubernetes cluster entities",
          description: "K8s cluster entity query failed. This may be a scope issue.",
          severity: "info",
          recommendation: "Verify entity access for Kubernetes monitoring data.",
        });
      } else if (clusters === 0) {
        findings.push({
          id: "mon-no-k8s",
          title: "No Kubernetes clusters monitored",
          description: "No K8s cluster entities found. This is expected if the environment does not use Kubernetes.",
          severity: "info",
          recommendation: "If using Kubernetes, deploy the Dynatrace Operator for full-stack K8s monitoring.",
        });
      } else {
        findings.push({
          id: "mon-k8s-clusters",
          title: `${clusters} Kubernetes cluster(s) monitored`,
          description: `${workloads} cloud application workload(s) detected across ${clusters} cluster(s).`,
          severity: getGen3Severity(clusters, config.k8sClusters),
          recommendation: workloads === 0
            ? "K8s clusters are monitored but no workloads detected. Verify Dynatrace Operator configuration and namespace monitoring."
            : "Review Kubernetes monitoring coverage to ensure all critical namespaces and workloads are instrumented.",
        });
      }
    }

    // Check 8: K8s workload coverage (if clusters exist)
    if (clusters > 0) {
      checks.push({
        name: "Kubernetes workload coverage",
        weight: 0.1,
        result: workloads >= clusters * 5 ? "pass" : workloads > 0 ? "partial" : "fail",
        partialValue: workloads > 0 ? Math.min(workloads / (clusters * 5), 0.8) : undefined,
      });
      if (workloads === 0) {
        findings.push({
          id: "mon-k8s-no-workloads",
          title: "Kubernetes clusters found but no workloads detected",
          description: "Clusters are monitored but no cloud application workloads are being tracked.",
          severity: "warning",
          recommendation: "Ensure the Dynatrace Operator is configured with applicationMonitoring or cloudNativeFullStack mode.",
        });
      }
    }

    // Check 9: Declarative Process Grouping (Gen3)
    // Fetched via Settings 2.0
    let declGroupCount = 0;
    let relGuardianCount = 0;
    try {
      const settingsCounts = await getSettingsObjectCounts([
        SETTINGS_SCHEMAS.declarativeGrouping,
        SETTINGS_SCHEMAS.reliabilityGuardian,
      ]);
      declGroupCount = settingsCounts.get(SETTINGS_SCHEMAS.declarativeGrouping) ?? 0;
      relGuardianCount = settingsCounts.get(SETTINGS_SCHEMAS.reliabilityGuardian) ?? 0;
    } catch {
      // Settings API may not be accessible; counts remain 0
    }

    if (config.declarativeGrouping.enabled) {
      checks.push({
        name: "Declarative Process Grouping (Gen3)",
        weight: config.declarativeGrouping.weight,
        result: declGroupCount >= config.declarativeGrouping.criticalMax ? "pass" :
          declGroupCount >= config.declarativeGrouping.warningMax ? "partial" : "fail",
        partialValue: declGroupCount > 0 ? Math.min(0.4 + (declGroupCount * 0.15), 0.9) : undefined,
      });
      findings.push({
        id: "mon-declarative-grouping",
        title: declGroupCount === 0 ? "No declarative process grouping rules" : `${declGroupCount} declarative process grouping rule(s) — Gen3`,
        description: declGroupCount === 0
          ? "Declarative process grouping is the Gen3 approach to organizing process groups, replacing manual grouping."
          : "Declarative process grouping rules provide Gen3 process organization, replacing manual grouping.",
        severity: getGen3Severity(declGroupCount, config.declarativeGrouping),
        recommendation: declGroupCount === 0
          ? "Create declarative process grouping rules to replace manual process group configuration."
          : "Continue using declarative process grouping for consistent process organization.",
      });
    }

    // Check 10: Reliability Guardian (Gen3 SRE feature)
    if (config.reliabilityGuardian.enabled) {
      checks.push({
        name: "Reliability Guardian configured",
        weight: config.reliabilityGuardian.weight,
        result: relGuardianCount >= config.reliabilityGuardian.criticalMax ? "pass" :
          relGuardianCount >= config.reliabilityGuardian.warningMax ? "partial" : "fail",
        partialValue: relGuardianCount > 0 ? Math.min(0.4 + (relGuardianCount * 0.15), 0.9) : undefined,
      });
      findings.push({
        id: "mon-reliability-guardian",
        title: relGuardianCount === 0 ? "No Reliability Guardian configured" : `${relGuardianCount} Reliability Guardian config(s) — Gen3 SRE`,
        description: relGuardianCount === 0
          ? "Reliability Guardian is a Gen3 SRE feature for automated release validation against quality gates."
          : "Reliability Guardian provides automated release validation, ensuring deployments meet quality gates.",
        severity: getGen3Severity(relGuardianCount, config.reliabilityGuardian),
        recommendation: relGuardianCount === 0
          ? "Configure Reliability Guardian to automate release validation and catch regressions before they reach production."
          : "Continue using Reliability Guardian for release quality assurance.",
      });
    }

    // Check 11: Monitoring candidates (unmonitored hosts = debt)
    const candidateCount = Number((monitoringCandidates.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    if (config.monitoringCandidates.enabled) {
      checks.push({
        name: "Monitoring candidates (unmonitored hosts)",
        weight: config.monitoringCandidates.weight,
        result: candidateCount === 0 ? "pass" : candidateCount <= config.monitoringCandidates.criticalMax ? "partial" : "fail",
        partialValue: candidateCount > 0 ? Math.max(0.2, 1 - (candidateCount / 100)) : undefined,
      });
      findings.push({
        id: "mon-candidates",
        title: candidateCount === 0 ? "No unmonitored hosts — full coverage" : `${candidateCount} monitoring candidate(s) — unmonitored hosts`,
        description: candidateCount === 0
          ? "All discovered hosts are monitored."
          : "These hosts have been discovered but not instrumented with OneAgent.",
        severity: getGen2Severity(candidateCount, config.monitoringCandidates),
        recommendation: candidateCount === 0
          ? "Maintain full monitoring coverage."
          : "Deploy OneAgent to unmonitored hosts to close coverage gaps.",
      });
    }

    // Check 12: Smartscape on Grail — CRITICAL Gen3 signal
    const ssHosts = Number((smartscapeHosts.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const ssServices = Number((smartscapeServices.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const ssProcesses = Number((smartscapeProcesses.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    const ssTotal = ssHosts + ssServices + ssProcesses;
    const classicTotal = hosts + services + processGroups;
    const ssCoverage = classicTotal > 0 ? Math.round((ssTotal / classicTotal) * 100) : 0;

    if (config.smartscapeGrail.enabled) {
      checks.push({
        name: "Smartscape on Grail (Gen3 topology)",
        weight: config.smartscapeGrail.weight,
        result: smartscapeHosts.error ? "partial" :
          ssCoverage >= 80 ? "pass" : ssCoverage >= 30 ? "partial" : ssTotal > 0 ? "partial" : "fail",
        partialValue: smartscapeHosts.error ? 0.3 :
          ssTotal > 0 ? Math.min(ssCoverage / 100, 0.9) : undefined,
      });
      if (smartscapeHosts.error) {
        findings.push({
          id: "mon-smartscape-error",
          title: "Cannot query Smartscape Grail topology",
          description: "The smartscapeNodes query failed. This may indicate Smartscape on Grail is not yet enabled.",
          severity: "warning",
          recommendation: "Smartscape on Grail is the Gen3 topology model. Contact Dynatrace support to enable it.",
        });
      } else if (ssTotal === 0) {
        findings.push({
          id: "mon-no-smartscape",
          title: "Smartscape on Grail not active — CRITICAL Gen3 gap",
          description: "No entities found in the Grail-native Smartscape topology (smartscapeNodes). This is the foundation for Gen3 entity relationships and must be migrated from classic Smartscape.",
          severity: "critical",
          recommendation: "Smartscape on Grail is required for Gen3. Work with Dynatrace to enable the Grail-native topology model.",
        });
      } else {
        findings.push({
          id: "mon-smartscape-coverage",
          title: `Smartscape on Grail: ${ssTotal} entities (${ssCoverage}% coverage) — ${ssHosts} hosts, ${ssServices} services, ${ssProcesses} processes`,
          description: `Grail-native topology has ${ssTotal} entities vs ${classicTotal} classic entities (${ssCoverage}% coverage). Full coverage means the Gen3 topology model is fully operational.`,
          severity: getGen3Severity(ssCoverage, config.smartscapeGrail),
          recommendation: ssCoverage >= 80
            ? "Excellent Smartscape on Grail coverage. The Gen3 topology model is operational."
            : `Smartscape on Grail coverage is ${ssCoverage}%. Work toward full migration from classic Smartscape topology.`,
        });
      }
    }

    // Check 13: ActiveGate auto-update configuration
    if (config.agAutoUpdate.enabled) {
      try {
        const agAutoUpdateConfig = await activeGatesAutoUpdateConfigurationClient.getGlobalAutoUpdateConfigForTenant();
        // AG auto-update config has globalSetting property
        const autoUpdateSetting = (agAutoUpdateConfig as unknown as Record<string, unknown>).globalSetting as string | undefined;
        const autoUpdateEnabled = autoUpdateSetting === "ENABLED";

        checks.push({
          name: "ActiveGate auto-update enabled",
          weight: config.agAutoUpdate.weight,
          result: autoUpdateEnabled ? "pass" : "fail",
        });

        if (!autoUpdateEnabled) {
          findings.push({
            id: "mon-ag-no-autoupdate",
            title: "ActiveGate auto-update is globally disabled",
            description: "With auto-update disabled, ActiveGates won't receive security patches and new features automatically.",
            severity: "warning",
            recommendation: "Enable ActiveGate auto-update globally, or ensure a documented manual update process is in place.",
          });
        }
      } catch {
        // AG auto-update API not accessible — skip
      }
    }

    // Check 14: ActiveGate group organization
    if (config.agGroups.enabled && hosts > 0) {
      try {
        const agGroupsResult = await activeGatesActiveGateGroupsClient.getActiveGateGroups();
        const groupCount = agGroupsResult.groups?.length ?? 0;

        // Only flag if there are multiple AGs but no groups
        checks.push({
          name: "ActiveGate groups organized",
          weight: config.agGroups.weight,
          result: groupCount > 0 ? "pass" : "partial",
          partialValue: groupCount === 0 ? 0.5 : undefined,
        });

        if (groupCount === 0) {
          findings.push({
            id: "mon-ag-no-groups",
            title: "No ActiveGate groups configured",
            description: "ActiveGate groups enable load balancing, routing control, and organized management of your AG fleet.",
            severity: "info",
            recommendation: "Organize ActiveGates into groups for better routing, load balancing, and operational management.",
          });
        } else {
          findings.push({
            id: "mon-ag-groups",
            title: `${groupCount} ActiveGate group(s) configured`,
            description: "ActiveGates are organized into groups for routing and management.",
            severity: "success",
            recommendation: "Review AG group assignments periodically to ensure balanced distribution.",
          });
        }
      } catch {
        // AG groups API not accessible — skip
      }
    }

    // Check 15: Release tracking adoption
    if (config.releaseTracking.enabled) {
      try {
        const releaseResponse = await functions.call("releases");
        const releaseResult = (await releaseResponse.json()) as {
          totalCount: number; releasesWithProblems: number; error?: string;
        };

        if (!releaseResult.error) {
          const releaseCount = releaseResult.totalCount;
          checks.push({
            name: "Release tracking adoption",
            weight: config.releaseTracking.weight,
            result: releaseCount >= config.releaseTracking.criticalMax ? "pass" :
              releaseCount >= config.releaseTracking.warningMax ? "partial" : "fail",
            partialValue: releaseCount > 0 ? Math.min(0.4 + (releaseCount * 0.1), 0.9) : undefined,
          });

          if (releaseCount === 0) {
            findings.push({
              id: "mon-no-releases",
              title: "No releases tracked (30d)",
              description: "Release tracking correlates deployments with problems and performance changes.",
              severity: "info",
              recommendation: "Enable release tracking via OneAgent version detection or CI/CD integration to correlate deployments with problems.",
            });
          } else {
            const problemPct = releaseCount > 0 ? Math.round((releaseResult.releasesWithProblems / releaseCount) * 100) : 0;
            findings.push({
              id: "mon-releases",
              title: `${releaseCount} release(s) tracked (30d), ${releaseResult.releasesWithProblems} with problems (${problemPct}%)`,
              description: `Release tracking is active. ${problemPct}% of releases had associated problems.`,
              severity: problemPct > 30 ? "warning" : getGen3Severity(releaseCount, config.releaseTracking),
              recommendation: problemPct > 30
                ? "High percentage of releases with problems. Review deployment quality, testing, and consider canary releases."
                : "Good release tracking coverage. Continue correlating deployments with performance data.",
            });
          }
        }
      } catch {
        // Releases API not accessible — skip
      }
    }

    // Summary finding
    const summaryParts = [`${hosts} hosts, ${services} services, ${processGroups} process groups`];
    if (slos > 0) summaryParts.push(`${slos} SLOs`);
    if (clusters > 0) summaryParts.push(`${clusters} K8s clusters, ${workloads} workloads`);
    findings.push({
      id: "mon-summary",
      title: `Monitoring inventory: ${summaryParts.join(", ")}`,
      description: `${uniqueVersions} unique OneAgent version(s) detected across monitored hosts.`,
      severity: "info",
      recommendation: "Maintain current agent versions and review monitoring coverage regularly.",
    });

    const area = REVIEW_AREA_MAP.get("monitoring")!;
    const areaWeight = getAreaWeight(config, "monitoring");
    const score = calculateAreaScore(checks, areaWeight);

    // Migration: OneAgent is Gen3-compatible; K8s, SLOs, Smartscape Grail are Gen3-native
    const gen3Signals = hosts + (slos > 0 ? 1 : 0) + (clusters > 0 ? 1 : 0) + (ssTotal > 0 ? 1 : 0);
    const totalSignals = hosts + 1 + 1 + 1; // hosts + SLO + K8s + Smartscape Grail
    const migration = buildMigrationMetrics(
      Math.max(0, totalSignals - gen3Signals),
      gen3Signals,
      "{gen3} monitoring signals active — OneAgent, SLOs, and K8s are Gen3-compatible ({pct}%)"
    );

    setResult({
      areaId: "monitoring",
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
            error: err instanceof Error ? err.message : "Failed to analyze monitoring",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    hostCount.isLoading, hostCount.isPending, hostCount.data, hostCount.error,
    serviceCount.isLoading, serviceCount.isPending, serviceCount.data,
    processGroupCount.isLoading, processGroupCount.isPending, processGroupCount.data,
    hostsByVersion.isLoading, hostsByVersion.isPending, hostsByVersion.data,
    sloCount.isLoading, sloCount.isPending, sloCount.data, sloCount.error,
    k8sClusters.isLoading, k8sClusters.isPending, k8sClusters.data, k8sClusters.error,
    k8sWorkloads.isLoading, k8sWorkloads.isPending, k8sWorkloads.data,
    monitoringCandidates.isLoading, monitoringCandidates.isPending, monitoringCandidates.data, monitoringCandidates.error,
    smartscapeHosts.isLoading, smartscapeHosts.isPending, smartscapeHosts.data, smartscapeHosts.error,
    smartscapeServices.isLoading, smartscapeServices.isPending, smartscapeServices.data,
    smartscapeProcesses.isLoading, smartscapeProcesses.isPending, smartscapeProcesses.data,
  ]);

  return result;
}
