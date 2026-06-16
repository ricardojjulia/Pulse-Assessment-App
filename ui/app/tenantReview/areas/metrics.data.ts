import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen2Severity } from "../hooks/useReviewConfig";

export function useMetricsReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "metrics",
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
        // Check metric events (Settings 2.0) and log metric definitions
        // Note: calculated service/synthetic metrics are Config API v1 only, not available via Settings 2.0
        const calcLogSchema = "builtin:logmonitoring.schemaless-log-metric";

        const counts = await getSettingsObjectCounts([
          SETTINGS_SCHEMAS.metricEvents,
          calcLogSchema,
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const metricEventCount = counts.get(SETTINGS_SCHEMAS.metricEvents) ?? 0;
        const calcLogMetrics = counts.get(calcLogSchema) ?? 0;

        // Check 1: Calculated log metrics
        if (config.calcLogMetrics.enabled) {
          checks.push({
            name: "Calculated log metrics manageable",
            weight: config.calcLogMetrics.weight,
            result: calcLogMetrics === 0 ? "pass" : calcLogMetrics <= 5 ? "partial" : "fail",
            partialValue: calcLogMetrics <= 5 ? 1 - (calcLogMetrics / 10) : undefined,
          });
          if (calcLogMetrics > 0) {
            findings.push({
              id: "met-calc-log",
              title: `${calcLogMetrics} calculated log metric(s)`,
              description: "Calculated log metrics should be migrated to OpenPipeline metric extraction.",
              severity: getGen2Severity(calcLogMetrics, config.calcLogMetrics),
              recommendation: "Use OpenPipeline to extract metrics from logs instead of calculated log metrics.",
            });
          }
        }

        // Check 2: Metric events count
        if (config.metricEvents.enabled) {
          checks.push({
            name: "Metric events count reasonable",
            weight: config.metricEvents.weight,
            result: metricEventCount <= 20 ? "pass" : metricEventCount <= 50 ? "partial" : "fail",
            partialValue: metricEventCount <= 50 ? 1 - (metricEventCount / 100) : undefined,
          });
          if (metricEventCount > 20) {
            findings.push({
              id: "met-many-events",
              title: `${metricEventCount} metric event rules — Gen2 legacy`,
              description: "A high number of metric event rules indicates heavy reliance on Gen2 classic alerting. These should be migrated to Davis Analyzers.",
              severity: getGen2Severity(metricEventCount, config.metricEvents),
              recommendation: "Review metric events and consider migrating to Davis Analyzers for AI-powered anomaly detection.",
            });
          }
        }

        // Check 3: DQL timeseries readiness
        checks.push({
          name: "DQL timeseries readiness",
          weight: 0.35,
          result: calcLogMetrics === 0 ? "pass" : "partial",
          partialValue: calcLogMetrics === 0 ? undefined : Math.max(0.2, 1 - (calcLogMetrics / 20)),
        });
        findings.push({
          id: "met-dql-timeseries",
          title: "DQL timeseries is the Gen3 metric query approach",
          description: "The DQL 'timeseries' command provides flexible metric querying on Grail. Classic metric selectors still work but DQL is the future.",
          severity: "info",
          recommendation: "Use DQL 'timeseries' queries for new metric analysis. Migrate classic metric expressions over time.",
        });

        // Summary
        findings.push({
          id: "met-summary",
          title: `Metrics: ${metricEventCount} event rules, ${calcLogMetrics} calculated log metrics`,
          description: "Calculated metrics and classic metric expressions should be migrated to DQL timeseries queries and OpenPipeline.",
          severity: "info",
          recommendation: "Reduce calculated metrics by adopting DQL and OpenPipeline.",
        });

        const area = REVIEW_AREA_MAP.get("metrics")!;
        const areaWeight = getAreaWeight(config, "metrics");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: calculated log metrics are classic; DQL timeseries is Gen3
        const migration = buildMigrationMetrics(
          calcLogMetrics,
          0, // Can't easily count DQL-based metrics
          "{classic} calculated log metrics to migrate ({pct}%)"
        );

        setResult({
          areaId: "metrics",
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
            error: err instanceof Error ? err.message : "Failed to analyze metrics",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
