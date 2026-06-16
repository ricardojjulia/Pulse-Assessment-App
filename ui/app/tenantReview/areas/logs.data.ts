import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";

/**
 * Log Monitoring review area.
 *
 * Checks:
 * 1. Logs flowing into Grail (last 24h)
 * 2. Multiple log sources detected
 * 3. Log storage settings configured (Settings 2.0)
 * 4. Log event rules configured
 * 5. OpenPipeline pipeline count (heavily weighted — multiple pipelines = mature)
 * 6. OpenPipeline data type coverage (logs, metrics, traces)
 *
 * Scoring philosophy: Default/single pipeline = average. Multiple pipelines
 * across multiple data types = high score. Having pipelines for logs AND
 * metrics AND traces shows comprehensive Gen3 adoption.
 *
 * Migration metric: Grail log signals active (logs in Grail, storage rules,
 * event rules, OpenPipeline configured).
 */
export function useLogMonitoringReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "logs",
    status: "unknown",
    score: { value: 0, weight: 0.9, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const logSources = useDql(DQL_QUERIES.logSourceTypes);
  const logVolume = useDql(DQL_QUERIES.logVolumeByLevel);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (logSources.isLoading || logVolume.isLoading) return;
    if (logSources.isPending || logVolume.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        const counts = await getSettingsObjectCounts([
          SETTINGS_SCHEMAS.logStorageSettings,
          SETTINGS_SCHEMAS.logEvents,
          SETTINGS_SCHEMAS.logProcessingRules,
          SETTINGS_SCHEMAS.openPipelineLogs,
          SETTINGS_SCHEMAS.openPipelineMetrics,
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const sourceRecords = (logSources.data?.records ?? []) as Record<string, unknown>[];
        const volumeRecords = (logVolume.data?.records ?? []) as Record<string, unknown>[];
        const totalLogs = volumeRecords.reduce((sum, r) => sum + Number(r["logCount"] ?? r["count()"] ?? 0), 0);

        const storageSettings = counts.get(SETTINGS_SCHEMAS.logStorageSettings) ?? 0;
        const logEventRules = counts.get(SETTINGS_SCHEMAS.logEvents) ?? 0;
        const processingRules = counts.get(SETTINGS_SCHEMAS.logProcessingRules) ?? 0;

        // OpenPipeline pipeline configs per data type
        const opLogs = counts.get(SETTINGS_SCHEMAS.openPipelineLogs) ?? 0;
        const opMetrics = counts.get(SETTINGS_SCHEMAS.openPipelineMetrics) ?? 0;
        const opTotal = opLogs + opMetrics;
        const opDataTypes = [opLogs > 0, opMetrics > 0].filter(Boolean).length;

        // Check 1: Logs flowing into Grail
        const logQueryFailed = !!logVolume.error;
        checks.push({
          name: "Logs ingested into Grail",
          weight: 0.2,
          result: logQueryFailed ? "partial" : totalLogs > 0 ? "pass" : "fail",
          partialValue: logQueryFailed ? 0 : undefined,
        });
        if (logQueryFailed) {
          findings.push({
            id: "log-no-access",
            title: "Cannot query log data from Grail",
            description: "The app may not have the required scope to query logs. Review results may be incomplete.",
            severity: "warning",
            recommendation: "Verify storage:logs:read scope is configured for this app.",
          });
        } else if (totalLogs === 0) {
          findings.push({
            id: "log-no-data",
            title: "No logs found in Grail (last 24h)",
            description: "No log data is flowing into Grail. Classic log storage may still be in use.",
            severity: "critical",
            recommendation: "Migrate log ingestion to Grail. Configure OpenPipeline for log processing.",
          });
        } else {
          findings.push({
            id: "log-volume",
            title: `${totalLogs.toLocaleString()} logs in Grail (last 24h)`,
            description: `Log levels: ${volumeRecords.map((r) => `${String(r.loglevel)}: ${Number(r["logCount"] ?? r["count()"] ?? 0).toLocaleString()}`).join(", ")}`,
            severity: "info",
            recommendation: "Monitor log volume trends and adjust retention policies accordingly.",
          });
        }

        // Check 2: Log sources
        checks.push({
          name: "Multiple log sources",
          weight: 0.1,
          result: sourceRecords.length >= 3 ? "pass" : sourceRecords.length > 0 ? "partial" : "fail",
          partialValue: sourceRecords.length > 0 ? Math.min(sourceRecords.length / 3, 1) : undefined,
        });
        if (sourceRecords.length > 0) {
          findings.push({
            id: "log-sources",
            title: `${sourceRecords.length} log source(s) detected`,
            description: sourceRecords.map((r) => `${String(r["log.source"])}: ${Number(r["logCount"] ?? r["count()"] ?? 0).toLocaleString()}`).join(", "),
            severity: "info",
            recommendation: "Ensure all important log sources are configured for Grail ingestion.",
          });
        }

        // Check 3: Log storage settings in Settings 2.0
        checks.push({
          name: "Log storage settings configured",
          weight: 0.1,
          result: storageSettings > 0 ? "pass" : "partial",
          partialValue: 0.4,
        });
        if (storageSettings === 0) {
          findings.push({
            id: "log-no-storage-settings",
            title: "No log storage settings in Settings 2.0",
            description: "Log storage settings control which logs are stored and retained.",
            severity: "info",
            recommendation: "Configure log storage settings (builtin:logmonitoring.log-storage-settings) to control ingestion.",
          });
        }

        // Check 4: Log event rules
        checks.push({
          name: "Log event rules configured",
          weight: 0.1,
          result: logEventRules > 0 ? "pass" : "partial",
          partialValue: 0.3,
        });
        if (logEventRules > 0) {
          findings.push({
            id: "log-event-rules",
            title: `${logEventRules} log event rule(s) configured`,
            description: "Log event rules generate events from log patterns for alerting.",
            severity: "info",
            recommendation: "Review log event rules for accuracy and noise reduction.",
          });
        }

        // Check 5: OpenPipeline pipeline depth — heavily weighted
        // 0 pipelines = fail, 1 = low partial, 2-3 = better partial, 4+ = pass
        if (config.openPipelineDepth.enabled) {
          checks.push({
            name: "OpenPipeline pipeline depth",
            weight: config.openPipelineDepth.weight,
            result: opTotal >= 4 ? "pass" : opTotal >= 2 ? "partial" : opTotal === 1 ? "partial" : "fail",
            partialValue: opTotal >= 2 ? Math.min(0.5 + (opTotal * 0.1), 0.9) :
              opTotal === 1 ? 0.3 : undefined,
          });

          // Check 6: OpenPipeline data type coverage — rewards breadth across logs/metrics/traces
          checks.push({
            name: "OpenPipeline data type coverage",
            weight: config.openPipelineDepth.weight,
            result: opDataTypes >= 3 ? "pass" : opDataTypes === 2 ? "partial" : opDataTypes === 1 ? "partial" : "fail",
            partialValue: opDataTypes === 2 ? 0.7 : opDataTypes === 1 ? 0.4 : undefined,
          });

          // OpenPipeline findings — differentiated messaging based on depth
          if (opTotal === 0) {
            findings.push({
              id: "log-openpipeline-none",
              title: "No OpenPipeline pipeline configurations found",
              description: "OpenPipeline is the Gen3 standard for data ingestion processing. It replaces classic log processing rules and provides parsing, enrichment, routing, and metric extraction for logs, metrics, and traces.",
              severity: "warning",
              recommendation: "Configure OpenPipeline pipelines for logs, metrics, and traces to enable Gen3 data processing.",
            });
          } else if (opTotal === 1) {
            const parts: string[] = [];
            if (opLogs > 0) parts.push(`${opLogs} log`);
            if (opMetrics > 0) parts.push(`${opMetrics} metric`);
            findings.push({
              id: "log-openpipeline-minimal",
              title: `OpenPipeline: only ${parts.join(", ")} pipeline — needs expansion`,
              description: "A single default pipeline provides basic processing. Custom pipelines with enrichment, parsing, and routing rules are needed for mature data management.",
              severity: "warning",
              recommendation: "Create additional OpenPipeline pipelines with custom parsing rules, attribute enrichment, and metric extraction for logs and metrics.",
            });
          } else {
            const parts: string[] = [];
            if (opLogs > 0) parts.push(`${opLogs} log`);
            if (opMetrics > 0) parts.push(`${opMetrics} metric`);
            findings.push({
              id: "log-openpipeline-active",
              title: `OpenPipeline: ${parts.join(", ")} pipeline(s) — ${opTotal} total`,
              description: opTotal >= 4
                ? `${opTotal} pipeline configurations across ${opDataTypes} data type(s). Strong OpenPipeline adoption with custom processing rules.`
                : `${opTotal} pipeline configurations across ${opDataTypes} data type(s). Good start — expand with additional custom pipelines for parsing, enrichment, and routing.`,
              severity: getGen3Severity(opTotal, config.openPipelineDepth),
              recommendation: opDataTypes < 2
                ? `Add OpenPipeline pipelines for missing data types (${[opLogs === 0 ? "logs" : "", opMetrics === 0 ? "metrics" : ""].filter(Boolean).join(", ")}) for broader Gen3 coverage.`
                : "OpenPipeline is well configured. Review pipelines periodically for optimization.",
            });
          }
        }

        // Summary
        findings.push({
          id: "log-summary",
          title: `Log monitoring: ${totalLogs.toLocaleString()} logs/24h, ${storageSettings} storage rules, ${logEventRules} event rules, ${opTotal} OpenPipeline pipelines (${opDataTypes} data types)`,
          description: `${processingRules} classic processing rules configured. Grail-based log monitoring with OpenPipeline is the Gen3 standard.`,
          severity: "info",
          recommendation: "Complete migration from classic log monitoring to Grail + OpenPipeline.",
        });

        const area = REVIEW_AREA_MAP.get("logs")!;
        const areaWeight = getAreaWeight(config, "logs");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: 4 Gen3 log signals
        const gen3Signals = (totalLogs > 0 ? 1 : 0) + (storageSettings > 0 ? 1 : 0) + (logEventRules > 0 ? 1 : 0) + (opTotal > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          4 - gen3Signals,
          gen3Signals,
          "{gen3} of 4 log monitoring signals active ({pct}%)"
        );

        setResult({
          areaId: "logs",
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
            error: err instanceof Error ? err.message : "Failed to analyze log monitoring",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    logSources.isLoading, logSources.isPending, logSources.data,
    logVolume.isLoading, logVolume.isPending, logVolume.data, logVolume.error,
  ]);

  return result;
}
