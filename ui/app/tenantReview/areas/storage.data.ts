import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen3Severity } from "../hooks/useReviewConfig";

/**
 * Data Storage & Grail review area.
 *
 * Checks:
 * 1. Grail buckets accessible and configured
 * 2. Custom bucket depth (multiple custom buckets = mature data management)
 * 3. Logs flowing into Grail (last 24h)
 * 4. Events stored in Grail (last 7d)
 * 5. Bucket retention policies configured
 * 6. Business events ingested (key Gen3/Grail adoption signal)
 *
 * Scoring philosophy: Default/system buckets only = average. Multiple custom
 * buckets with retention policies = high score. Business events flowing = bonus.
 *
 * Migration metric: Grail data signals active out of 4 (logs, events, buckets, bizevents).
 */
export function useStorageReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "storage",
    status: "unknown",
    score: { value: 0, weight: 0.8, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const buckets = useDql(DQL_QUERIES.grailBuckets);
  const logVolume = useDql(DQL_QUERIES.logVolumeByLevel);
  const eventCount = useDql(DQL_QUERIES.eventCount);
  const bizEvents = useDql(DQL_QUERIES.bizEventVolume);
  const spanCount = useDql(DQL_QUERIES.spanCount);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (buckets.isLoading || logVolume.isLoading || eventCount.isLoading || bizEvents.isLoading || spanCount.isLoading) return;
    if (buckets.isPending || logVolume.isPending || eventCount.isPending || bizEvents.isPending || spanCount.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        // Fetch business events processing rules via Settings 2.0
        let bizProcessingCount = 0;
        try {
          const settingsCounts = await getSettingsObjectCounts([
            SETTINGS_SCHEMAS.bizeventsProcessingRules,
            SETTINGS_SCHEMAS.bizeventsMetricsRules,
            SETTINGS_SCHEMAS.bizeventsBucketRules,
          ]);
          if (cancelled) return;
          bizProcessingCount = (settingsCounts.get(SETTINGS_SCHEMAS.bizeventsProcessingRules) ?? 0)
            + (settingsCounts.get(SETTINGS_SCHEMAS.bizeventsMetricsRules) ?? 0)
            + (settingsCounts.get(SETTINGS_SCHEMAS.bizeventsBucketRules) ?? 0);
        } catch {
          // Settings API may not be accessible
        }

    const findings: Finding[] = [];
    const checks: Check[] = [];

    // Parse bucket data — distinguish default vs custom buckets
    const bucketRecords = (buckets.data?.records ?? []) as Record<string, unknown>[];
    const defaultBucketPrefixes = ["default_"];
    const customBuckets = bucketRecords.filter((b) => {
      const name = typeof b.name === "string" ? b.name : "";
      return !defaultBucketPrefixes.some((p) => name.startsWith(p)) && name !== "default";
    });
    const customBucketCount = customBuckets.length;

    // Check 1: Grail buckets accessible
    checks.push({
      name: "Grail buckets accessible",
      weight: 0.1,
      result: buckets.error ? "fail" : "pass",
    });
    if (buckets.error) {
      findings.push({
        id: "storage-bucket-error",
        title: "Cannot access Grail bucket information",
        description: "The app may not have the required scope to query bucket data. Review results may be incomplete.",
        severity: "warning",
        recommendation: "Verify storage:system:read and storage:buckets:read scopes are configured for this app.",
      });
    }

    // Check 2: Custom bucket depth — heavily weighted, rewards mature data management
    // Default-only = average (0.4), 1-2 custom = good (0.7), 3+ custom = excellent (pass)
    if (config.customBuckets.enabled) {
      checks.push({
        name: "Custom Grail buckets configured",
        weight: config.customBuckets.weight,
        result: buckets.error ? "fail" :
          customBucketCount >= 3 ? "pass" :
          customBucketCount >= 1 ? "partial" :
          bucketRecords.length > 0 ? "partial" : "fail",
        partialValue: buckets.error ? undefined :
          customBucketCount >= 1 ? Math.min(0.5 + (customBucketCount * 0.15), 0.9) :
          bucketRecords.length > 0 ? 0.4 : undefined,
      });
      if (!buckets.error && customBucketCount === 0 && bucketRecords.length > 0) {
        findings.push({
          id: "storage-default-only",
          title: "Only default Grail buckets — no custom data segmentation",
          description: "All data is stored in default buckets. Custom buckets allow different retention periods, access controls, and cost optimization per data type.",
          severity: "warning",
          recommendation: "Create custom buckets for security logs (longer retention), application logs (standard), and debug/trace logs (shorter retention) to optimize storage costs and meet compliance requirements.",
        });
      } else if (!buckets.error && customBucketCount >= 3) {
        findings.push({
          id: "storage-custom-mature",
          title: `${customBucketCount} custom Grail buckets — mature data management`,
          description: "Multiple custom buckets indicate deliberate data segmentation with tailored retention and access policies.",
          severity: getGen3Severity(customBucketCount, config.customBuckets),
          recommendation: "Continue reviewing bucket utilization and retention alignment with business needs.",
        });
      }
    }

    // Check 3: Logs flowing into Grail
    const logRecords = (logVolume.data?.records ?? []) as Record<string, unknown>[];
    const totalLogs = logRecords.reduce((sum, r) => sum + Number(r["logCount"] ?? r["count()"] ?? 0), 0);
    checks.push({
      name: "Logs ingested into Grail",
      weight: 0.15,
      result: totalLogs > 0 ? "pass" : "fail",
    });
    if (totalLogs === 0) {
      findings.push({
        id: "storage-no-logs",
        title: "No logs found in Grail (last 24h)",
        description: "No log data is flowing into Grail. This may indicate classic log storage is still in use.",
        severity: "warning",
        recommendation: "Migrate log ingestion to Grail and configure OpenPipeline for log processing.",
      });
    } else {
      findings.push({
        id: "storage-log-volume",
        title: `${totalLogs.toLocaleString()} log records in Grail (last 24h)`,
        description: `Log levels: ${logRecords.map((r) => `${String(r.loglevel)}: ${Number(r["logCount"] ?? r["count()"] ?? 0).toLocaleString()}`).join(", ")}`,
        severity: "info",
        recommendation: "Monitor log volume to manage Grail storage costs.",
      });
    }

    // Check 4: Events flowing into Grail
    const events = Number((eventCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
    checks.push({
      name: "Events stored in Grail",
      weight: 0.1,
      result: events > 0 ? "pass" : "partial",
      partialValue: 0.5,
    });

    // Check 5: Bucket retention configured — rewards completeness
    const bucketsWithRetention = bucketRecords.filter((b) => b.retention_days != null);
    const customWithRetention = customBuckets.filter((b) => b.retention_days != null);
    checks.push({
      name: "Retention policies configured",
      weight: 0.15,
      result: bucketRecords.length === 0 ? "partial" :
        bucketsWithRetention.length === bucketRecords.length && customBucketCount > 0 ? "pass" :
        bucketsWithRetention.length === bucketRecords.length ? "partial" : "partial",
      partialValue: bucketRecords.length === 0 ? 0.5 :
        customBucketCount > 0 && customWithRetention.length === customBucketCount ? 0.9 :
        bucketsWithRetention.length / bucketRecords.length * 0.7,
    });

    // Check 6: Business events ingested (key Gen3 adoption signal)
    const bizEventRow = (bizEvents.data?.records?.[0] ?? {}) as Record<string, unknown>;
    const totalBizEvents = Number(bizEventRow["total"] ?? bizEventRow["count()"] ?? 0);
    const bizEventsAccessible = !bizEvents.error;
    if (config.businessEvents.enabled) {
      checks.push({
        name: "Business events ingested",
        weight: config.businessEvents.weight,
        result: !bizEventsAccessible ? "partial" : totalBizEvents > 0 ? "pass" : "fail",
        partialValue: !bizEventsAccessible ? 0.3 : undefined,
      });
      if (bizEvents.error) {
        findings.push({
          id: "storage-bizevents-error",
          title: "Cannot access business events data",
          description: "The app may not have the storage:bizevents:read scope.",
          severity: "warning",
          recommendation: "Verify storage:bizevents:read scope is configured for this app.",
        });
      } else if (totalBizEvents === 0) {
        findings.push({
          id: "storage-no-bizevents",
          title: "No business events in Grail (last 24h)",
          description: "Business events are a key Gen3/Grail capability for tracking business-relevant actions like purchases, sign-ups, and custom application events.",
          severity: "warning",
          recommendation: "Instrument business events using the OneAgent API, OpenTelemetry, or the Business Events ingest API to unlock business analytics in Grail.",
        });
      } else {
        findings.push({
          id: "storage-bizevents-volume",
          title: `${totalBizEvents.toLocaleString()} business events in Grail (last 24h)`,
          description: "Business events are flowing into Grail, enabling business analytics and BizOps capabilities.",
          severity: getGen3Severity(totalBizEvents, config.businessEvents),
          recommendation: "Review business event types and ensure key business processes are instrumented.",
        });
      }
    }

    // Check 7: OpenTelemetry traces in Grail (Gen3 distributed tracing)
    const spanRow = (spanCount.data?.records?.[0] ?? {}) as Record<string, unknown>;
    const totalSpans = Number(spanRow["total"] ?? spanRow["count()"] ?? 0);
    if (config.otelTraces.enabled) {
      checks.push({
        name: "OpenTelemetry traces in Grail",
        weight: config.otelTraces.weight,
        result: spanCount.error ? "partial" : totalSpans > 0 ? "pass" : "partial",
        partialValue: spanCount.error ? 0.3 : totalSpans === 0 ? 0.5 : undefined,
      });
      if (spanCount.error) {
        findings.push({
          id: "storage-spans-error",
          title: "Cannot access OpenTelemetry trace data",
          description: "The app may not have the required scope to query spans in Grail.",
          severity: "info",
          recommendation: "Verify storage:spans:read scope is configured for this app.",
        });
      } else if (totalSpans === 0) {
        findings.push({
          id: "storage-no-spans",
          title: "No OpenTelemetry traces in Grail (last 24h)",
          description: "No span data is flowing into Grail. OpenTelemetry traces are optional but indicate Gen3 distributed tracing adoption.",
          severity: "info",
          recommendation: "If using distributed tracing, configure OpenTelemetry instrumentation to send spans to Dynatrace Grail.",
        });
      } else {
        findings.push({
          id: "storage-spans-volume",
          title: `${totalSpans.toLocaleString()} OpenTelemetry spans in Grail (last 24h)`,
          description: "OpenTelemetry traces are flowing into Grail, indicating Gen3 distributed tracing is active.",
          severity: getGen3Severity(totalSpans, config.otelTraces),
          recommendation: "Review trace sampling rates and ensure critical services are instrumented.",
        });
      }
    }

    // Check 8: Business Events Processing Rules (Gen3 BizOps)
    if (config.bizeventsProcessing.enabled) {
      checks.push({
        name: "Business Events Processing Rules",
        weight: config.bizeventsProcessing.weight,
        result: bizProcessingCount >= config.bizeventsProcessing.criticalMax ? "pass" :
          bizProcessingCount >= config.bizeventsProcessing.warningMax ? "partial" : "fail",
        partialValue: bizProcessingCount > 0 ? Math.min(0.4 + (bizProcessingCount * 0.15), 0.9) : undefined,
      });
      findings.push({
        id: "storage-bizevents-processing",
        title: bizProcessingCount === 0 ? "No business events processing rules" : `${bizProcessingCount} business events processing rule(s) — Gen3 BizOps`,
        description: bizProcessingCount === 0
          ? "Business events processing rules define pipelines, metrics extraction, and bucket routing for BizOps data."
          : "Business events processing rules are configured for BizOps data pipelines, metrics extraction, and bucket routing.",
        severity: getGen3Severity(bizProcessingCount, config.bizeventsProcessing),
        recommendation: bizProcessingCount === 0
          ? "Configure business events processing rules to extract metrics and route data to appropriate buckets."
          : "Continue refining business events processing pipelines for optimal BizOps coverage.",
      });
    }

    // Summary
    findings.push({
      id: "storage-summary",
      title: "Grail storage summary",
      description: `${bucketRecords.length} bucket(s) (${customBucketCount} custom), ${totalLogs.toLocaleString()} logs (24h), ${events.toLocaleString()} events (7d), ${totalBizEvents.toLocaleString()} bizevents (24h), ${totalSpans.toLocaleString()} spans (24h).`,
      severity: "info",
      recommendation: customBucketCount === 0
        ? "Create custom Grail buckets and instrument business events to fully leverage the Gen3 data platform."
        : "Ensure all data types (logs, metrics, events, traces, business events) flow through Grail with appropriate bucket segmentation.",
    });

    // Bucket detail listing — placed last to avoid taking up screen space
    if (bucketRecords.length > 0) {
      const bucketDetail = bucketRecords.map((b) => {
        const name = typeof b.name === "string" ? b.name : "unnamed";
        const records = typeof b.records === "string" ? b.records : "0";
        const retention = typeof b.retention_days === "string" || typeof b.retention_days === "number" ? `${String(b.retention_days)}` : "N/A";
        return `${name} (${Number(records).toLocaleString()} records, ${retention}d retention)`;
      }).join("; ");
      findings.push({
        id: "storage-bucket-detail",
        title: `${bucketRecords.length} Grail bucket(s) — detail`,
        description: bucketDetail,
        severity: "info",
        recommendation: "Review retention policies to balance cost and compliance requirements.",
      });
    }

    const area = REVIEW_AREA_MAP.get("storage")!;
    const areaWeight = getAreaWeight(config, "storage");
    const score = calculateAreaScore(checks, areaWeight);

    // Migration: 6 Grail data signals (added bizevents processing)
    const grailSignals = (totalLogs > 0 ? 1 : 0) + (events > 0 ? 1 : 0) + (customBucketCount > 0 ? 1 : 0) + (totalBizEvents > 0 ? 1 : 0) + (totalSpans > 0 ? 1 : 0) + (bizProcessingCount > 0 ? 1 : 0);
    const migration = buildMigrationMetrics(
      6 - grailSignals,
      grailSignals,
      "{gen3} of 6 Grail data signals active ({pct}% migrated)"
    );

    setResult({
      areaId: "storage",
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
            error: err instanceof Error ? err.message : "Failed to analyze storage",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [
    buckets.isLoading, buckets.isPending, buckets.data, buckets.error,
    logVolume.isLoading, logVolume.isPending, logVolume.data,
    eventCount.isLoading, eventCount.isPending, eventCount.data,
    bizEvents.isLoading, bizEvents.isPending, bizEvents.data, bizEvents.error,
    spanCount.isLoading, spanCount.isPending, spanCount.data, spanCount.error,
  ]);

  return result;
}
