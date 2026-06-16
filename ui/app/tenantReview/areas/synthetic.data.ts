import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { syntheticNetworkAvailabilityMonitorsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { useReviewConfig, getAreaWeight, getGen3Severity } from "../hooks/useReviewConfig";

/**
 * Synthetic Monitoring review area.
 *
 * Checks:
 * 1. Synthetic monitors configured (classic entities)
 * 2. Monitor type diversity (browser + HTTP)
 * 3. Network Availability Monitors (NAM) — Gen3-native (DNS/ICMP/TCP)
 * 4. Synthetic on Grail active (execution events in dt.synthetic.events)
 * 5. Grail execution volume
 *
 * NAM monitors are queried via the syntheticNetworkAvailabilityMonitorsClient
 * SDK (type=MULTI_PROTOCOL). They are a key Gen3 feature.
 */
export function useSyntheticReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "synthetic",
    status: "unknown",
    score: { value: 0, weight: 0.7, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const testCount = useDql(DQL_QUERIES.syntheticTestCount);
  const httpCheckCount = useDql(DQL_QUERIES.httpCheckCount);
  const grailEvents = useDql(DQL_QUERIES.syntheticGrailEvents);
  const grailByType = useDql(DQL_QUERIES.syntheticGrailByType);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (testCount.isLoading || httpCheckCount.isLoading || grailEvents.isLoading || grailByType.isLoading) return;
    if (testCount.isPending || httpCheckCount.isPending || grailEvents.isPending || grailByType.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        // Fetch NAM monitors via the SDK API
        const namResult = await syntheticNetworkAvailabilityMonitorsClient
          .getMonitors({ monitorSelector: "type(MULTI_PROTOCOL)" })
          .catch(() => null);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        // Parse classic entity counts
        const totalTests = Number((testCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
        const httpChecks = Number((httpCheckCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
        const browserMonitors = Math.max(0, totalTests - httpChecks);
        const hasMultipleTypes = httpChecks > 0 && browserMonitors > 0;

        // Parse NAM monitors
        const namMonitors = namResult?.monitors ?? [];
        const namCount = namMonitors.length;
        const enabledNam = namMonitors.filter((m) => m.enabled !== false);

        // Parse Grail execution data
        const grailEventRow = (grailEvents.data?.records?.[0] ?? {}) as Record<string, unknown>;
        const grailTotal = Number(grailEventRow["total"] ?? grailEventRow["count()"] ?? 0);
        const grailAccessible = !grailEvents.error;
        const grailTypeRecords = (grailByType.data?.records ?? []) as Record<string, unknown>[];
        const grailTypeCount = grailTypeRecords.length;

        // Check 1: Synthetic monitors exist (any type)
        const totalAllMonitors = totalTests + namCount;
        checks.push({
          name: "Synthetic monitors configured",
          weight: 0.15,
          result: totalAllMonitors > 0 ? "pass" : "fail",
        });
        if (totalAllMonitors === 0) {
          findings.push({
            id: "syn-no-monitors",
            title: "No synthetic monitors found",
            description: "Synthetic monitoring provides proactive availability and performance checks.",
            severity: "warning",
            recommendation: "Create HTTP monitors, browser monitors, or NAM monitors (DNS/ICMP/TCP) for critical services.",
          });
        }

        // Check 2: Monitor type diversity
        const monitorTypes = [browserMonitors > 0, httpChecks > 0, namCount > 0].filter(Boolean).length;
        checks.push({
          name: "Monitor type diversity",
          weight: 0.15,
          result: monitorTypes >= 2 ? "pass" : totalAllMonitors > 0 ? "partial" : "fail",
          partialValue: totalAllMonitors > 0 ? Math.min(0.3 + (monitorTypes * 0.25), 0.9) : undefined,
        });
        if (totalAllMonitors > 0) {
          const typeParts: string[] = [];
          if (browserMonitors > 0) typeParts.push(`${browserMonitors} browser`);
          if (httpChecks > 0) typeParts.push(`${httpChecks} HTTP`);
          if (namCount > 0) typeParts.push(`${namCount} NAM`);
          findings.push({
            id: "syn-types",
            title: `Synthetic monitors: ${typeParts.join(", ")}`,
            description: monitorTypes >= 2
              ? `Good type diversity with ${monitorTypes} monitor types in use.`
              : "Only one monitor type in use. Consider adding browser monitors, HTTP monitors, and NAM monitors (DNS/ICMP/TCP).",
            severity: monitorTypes >= 3 ? "success" : monitorTypes >= 2 ? "info" : "info",
            recommendation: "Ensure coverage includes browser monitors (user journeys), HTTP monitors (API health), and NAM monitors (network availability).",
          });
        }

        // Check 3: NAM monitors — Gen3-native, heavily rewarded
        if (config.namMonitors.enabled) {
          checks.push({
            name: "Network Availability Monitors (NAM)",
            weight: config.namMonitors.weight,
            result: namResult === null ? "partial" :
              namCount >= 3 ? "pass" : namCount > 0 ? "partial" : "fail",
            partialValue: namResult === null ? 0.3 :
              namCount > 0 ? Math.min(0.4 + (namCount * 0.15), 0.9) : undefined,
          });
          if (namResult === null) {
            findings.push({
              id: "syn-nam-error",
              title: "Cannot access Network Availability Monitors API",
              description: "The app may not have the environment-api:synthetic-monitors:read scope.",
              severity: "warning",
              recommendation: "Verify environment-api:synthetic-monitors:read scope is configured.",
            });
          } else if (namCount === 0) {
            findings.push({
              id: "syn-no-nam",
              title: "No Network Availability Monitors (NAM) configured",
              description: "NAM monitors (DNS, ICMP, TCP) are Gen3-native network monitoring. They provide DNS resolution, TCP port availability, and ICMP ping checks without requiring ActiveGate.",
              severity: "warning",
              recommendation: "Create NAM monitors for DNS resolution, TCP port availability, and ICMP ping checks on critical infrastructure endpoints.",
            });
          } else {
            const namNames = enabledNam.map((m) => m.name).join(", ");
            findings.push({
              id: "syn-nam-active",
              title: `${namCount} Network Availability Monitor(s) — Gen3-native`,
              description: `NAM monitors (DNS/ICMP/TCP): ${namNames}. ${enabledNam.length} of ${namCount} enabled.`,
              severity: getGen3Severity(namCount, config.namMonitors),
              recommendation: namCount >= 3
                ? "Strong NAM coverage. Review monitor targets periodically and expand to cover all critical network endpoints."
                : "Expand NAM coverage with DNS, ICMP, and TCP monitors for critical infrastructure endpoints.",
            });
          }
        }

        // Check 4: Synthetic on Grail active
        if (config.syntheticGrailExecution.enabled) {
          checks.push({
            name: "Synthetic on Grail active",
            weight: config.syntheticGrailExecution.weight,
            result: !grailAccessible ? "partial" : grailTotal > 0 ? "pass" : "fail",
            partialValue: !grailAccessible ? 0.3 : undefined,
          });
          if (grailEvents.error) {
            findings.push({
              id: "syn-grail-error",
              title: "Cannot access Synthetic on Grail data",
              description: "The app may not have the required scope to query dt.synthetic.events.",
              severity: "warning",
              recommendation: "Verify storage:events:read scope is configured for this app.",
            });
          } else if (grailTotal === 0) {
            findings.push({
              id: "syn-no-grail",
              title: "No Synthetic on Grail execution data (last 7 days)",
              description: "No synthetic execution events found in dt.synthetic.events. Synthetic on Grail stores execution results for DQL-based analysis.",
              severity: "warning",
              recommendation: "Verify synthetic monitors are executing and results are flowing to Grail.",
            });
          } else {
            const typeDetails = grailTypeRecords.map((r) =>
              `${String(r["event.type"])}: ${Number(r["eventCount"] ?? r["count()"] ?? 0).toLocaleString()}`
            ).join(", ");
            findings.push({
              id: "syn-grail-active",
              title: `${grailTotal.toLocaleString()} Synthetic on Grail executions (last 7 days)`,
              description: `${grailTypeCount} execution type(s): ${typeDetails}. Execution data in Grail enables DQL-based analysis and dashboarding.`,
              severity: getGen3Severity(grailTotal, config.syntheticGrailExecution),
              recommendation: "Monitor execution trends and set up DQL-based alerting for synthetic failures.",
            });
          }
        }

        // Check 5: Grail execution volume
        checks.push({
          name: "Synthetic execution volume",
          weight: 0.15,
          result: !grailAccessible ? "partial" :
            grailTotal >= 1000 ? "pass" : grailTotal >= 100 ? "partial" : grailTotal > 0 ? "partial" : "fail",
          partialValue: !grailAccessible ? 0.3 :
            grailTotal >= 100 ? Math.min(0.5 + (grailTotal / 5000), 0.9) :
            grailTotal > 0 ? 0.3 : undefined,
        });

        // Summary
        findings.push({
          id: "syn-summary",
          title: `Synthetic: ${totalTests} classic, ${namCount} NAM, ${grailTotal.toLocaleString()} Grail executions (7d)`,
          description: `${monitorTypes} monitor type(s) in use. NAM monitors (DNS/ICMP/TCP) are Gen3-native. Synthetic on Grail provides DQL-queryable execution data.`,
          severity: namCount > 0 && grailTotal >= 100 ? "success" :
            namCount > 0 || grailTotal > 0 ? "info" : "warning",
          recommendation: "Use a mix of browser, HTTP, and NAM monitors with results flowing to Grail for comprehensive synthetic coverage.",
        });

        const area = REVIEW_AREA_MAP.get("synthetic")!;
        const areaWeight = getAreaWeight(config, "synthetic");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: classic-only vs Gen3 (NAM + Grail data)
        const classicSignals = totalTests > 0 && namCount === 0 && grailTotal === 0 ? 1 : 0;
        const gen3Signals = (namCount > 0 ? 1 : 0) + (grailTotal > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          classicSignals,
          gen3Signals,
          "{gen3} Gen3 synthetic signals (NAM + Grail) vs {classic} classic-only ({pct}%)"
        );

        setResult({
          areaId: "synthetic",
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
            error: err instanceof Error ? err.message : "Failed to analyze synthetic monitoring",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    testCount.isLoading, testCount.isPending, testCount.data, testCount.error,
    httpCheckCount.isLoading, httpCheckCount.isPending, httpCheckCount.data,
    grailEvents.isLoading, grailEvents.isPending, grailEvents.data, grailEvents.error,
    grailByType.isLoading, grailByType.isPending, grailByType.data,
  ]);

  return result;
}
