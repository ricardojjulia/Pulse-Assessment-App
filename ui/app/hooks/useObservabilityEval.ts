import { useState, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

export type ObsEvalPhase = "idle" | "estimating" | "confirmed" | "running" | "done" | "error";

export interface EstimateResult {
  pgiCount: number;
  serviceCount: number;
  spansPerHour: number;
  logsPerHour: number;
  /** Rough 24h data volume: spans×2KB + logs×0.5KB extrapolated to 24h. */
  estimatedGb: number;
  /** estimatedGb × 0.01 (DPS cost proxy). */
  estimatedDps: number;
}

export interface EvalResults {
  pgiByTech: Array<{ tech: string; count: number }>;
  servicesByType: Array<{ serviceType: string; count: number }>;
  activeServiceCount: number;
  totalServiceCount: number;
  topSpanServices: Array<{ svc: string; total: number; errors: number; errorRate: number }>;
  cloudFunctions: { awsLambdas: number; azureFunctions: number };
  instrumentedCloudFunctions: number;
  logSources: Array<{ src: string; total: number; errors: number; warnings: number; errorRate: number }>;
  stalePgiCount: number;
  scannedRecords: number;
  scannedBytes: number;
}

export interface ObsEvalHandle {
  phase: ObsEvalPhase;
  estimate: EstimateResult | null;
  results: EvalResults | null;
  error: string | null;
  segmentId: string | undefined;
  startEstimate: (segmentId?: string) => void;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
}

async function runQuery(
  query: string
): Promise<{ records: Record<string, unknown>[]; scannedBytes: number; scannedRecords: number }> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 55000 },
    });

    let state = response?.state;
    let res = response?.result;
    const requestToken = (response as unknown as Record<string, unknown>)?.requestToken as string | undefined;

    if (state === "RUNNING" && requestToken) {
      for (let i = 0; i < 20; i++) {
        await new Promise<void>(r => setTimeout(r, 1500));
        const poll = await queryExecutionClient.queryPoll({ requestToken });
        state = poll?.state;
        res = poll?.result;
        if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED") break;
      }
    }

    if (state === "FAILED" || state === "CANCELLED") {
      return { records: [], scannedBytes: 0, scannedRecords: 0 };
    }

    const grail = (res as Record<string, unknown> | undefined)?.metadata as Record<string, unknown> | undefined;
    const grailInner = grail?.grail as Record<string, unknown> | undefined;
    return {
      records: (res?.records ?? []) as Record<string, unknown>[],
      scannedBytes: (grailInner?.scannedBytes as number) ?? 0,
      scannedRecords: (grailInner?.scannedRecords as number) ?? 0,
    };
  } catch {
    return { records: [], scannedBytes: 0, scannedRecords: 0 };
  }
}

function toNum(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

function toStr(val: unknown): string {
  if (val === null || val === undefined) return "unknown";
  return String(val);
}

export function useObservabilityEval(): ObsEvalHandle {
  const [phase, setPhase] = useState<ObsEvalPhase>("idle");
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [results, setResults] = useState<EvalResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setPhase("idle");
    setEstimate(null);
    setResults(null);
    setError(null);
    setSegmentId(undefined);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setPhase("idle");
    setEstimate(null);
    setResults(null);
    setError(null);
  }, []);

  const startEstimate = useCallback((sid?: string) => {
    cancelledRef.current = false;
    setSegmentId(sid);
    setPhase("estimating");
    setEstimate(null);
    setResults(null);
    setError(null);

    const segFilter = sid ? `| filter filterSegments("${sid}")` : "";

    const E1 = `fetch dt.entity.process_group_instance | summarize count()`;
    const E2 = `fetch dt.entity.service | summarize count()`;
    const E3 = `fetch spans, from: now()-1h\n${segFilter}\n| summarize count()`;
    const E4 = `fetch logs, from: now()-1h\n${segFilter}\n| summarize count()`;

    Promise.all([runQuery(E1), runQuery(E2), runQuery(E3), runQuery(E4)])
      .then(([r1, r2, r3, r4]) => {
        if (cancelledRef.current) return;

        const pgiCount = toNum(r1.records[0]?.["count()"]);
        const serviceCount = toNum(r2.records[0]?.["count()"]);
        const spansPerHour = toNum(r3.records[0]?.["count()"]);
        const logsPerHour = toNum(r4.records[0]?.["count()"]);

        // Extrapolate to 24h: spans×2KB + logs×0.5KB → bytes → GB
        const estimatedGb = ((spansPerHour * 24 * 2048) + (logsPerHour * 24 * 512)) / (1024 * 1024 * 1024);
        const estimatedDps = estimatedGb * 0.01;

        setEstimate({ pgiCount, serviceCount, spansPerHour, logsPerHour, estimatedGb, estimatedDps });
        setPhase("confirmed");
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : "Estimation failed");
        setPhase("error");
      });
  }, []);

  const confirm = useCallback(() => {
    if (phase !== "confirmed" || !estimate) return;
    cancelledRef.current = false;
    setPhase("running");

    const segFilter = segmentId ? `| filter filterSegments("${segmentId}")` : "";

    const Q1 = `fetch dt.entity.process_group_instance
| fieldsAdd tech = processType
| summarize count = count(), by: {tech}
| sort count desc
| limit 20`;

    const Q2 = `fetch dt.entity.service
| summarize count = count(), by: {serviceType}
| sort count desc`;

    const Q3a = `timeseries val = sum(dt.service.request.count), by: {dt.entity.service}, from: now()-24h
| fields dt.entity.service
| dedup dt.entity.service
| summarize active = count()`;

    const Q3b = `fetch dt.entity.service | summarize count()`;

    const Q4 = `fetch spans, from: now()-24h
${segFilter}
| fieldsAdd svc = coalesce(dt.entity.service, service.name)
| filter isNotNull(svc)
| summarize total = count(), errors = countIf(toBoolean(otel.status_code == "ERROR")), by: {svc}
| fieldsAdd errorRate = round(toDouble(errors) / toDouble(total) * 100.0, 1)
| sort total desc
| limit 20`;

    const Q5a = `fetch dt.entity.aws_lambda_function | summarize count()`;
    const Q5b = `fetch dt.entity.azure_function_app | summarize count()`;

    const Q6 = `fetch spans, from: now()-7d
| filter isNotNull(faas.name) or isNotNull(faas.id)
| summarize instrumented = countDistinct(coalesce(faas.name, faas.id))`;

    const Q7 = `fetch logs, from: now()-24h
${segFilter}
| fieldsAdd _src = coalesce(log.source, "unknown")
| summarize total = count(), errors = countIf(loglevel == "ERROR" or loglevel == "SEVERE"), warnings = countIf(loglevel == "WARN" or loglevel == "WARNING"), by: {_src}
| fieldsAdd errorRate = round(toDouble(errors) / toDouble(total) * 100.0, 1)
| sort total desc
| limit 15`;

    const Q8 = `fetch dt.entity.process_group_instance
| filter toTimestamp(lastSeenTms) < now() - 7d
| summarize count()`;

    Promise.all([
      runQuery(Q1),
      runQuery(Q2),
      runQuery(Q3a),
      runQuery(Q3b),
      runQuery(Q4),
      runQuery(Q5a),
      runQuery(Q5b),
      runQuery(Q6),
      runQuery(Q7),
      runQuery(Q8),
    ]).then(([r1, r2, r3a, r3b, r4, r5a, r5b, r6, r7, r8]) => {
      if (cancelledRef.current) return;

      const pgiByTech = r1.records.map((row) => ({
        tech: toStr(row["tech"]),
        count: toNum(row["count"]),
      }));

      const servicesByType = r2.records.map((row) => ({
        serviceType: toStr(row["serviceType"]),
        count: toNum(row["count"]),
      }));

      const activeServiceCount = toNum(r3a.records[0]?.["active"]);
      const totalServiceCount = toNum(r3b.records[0]?.["count()"]);

      const topSpanServices = r4.records.map((row) => ({
        svc: toStr(row["svc"]),
        total: toNum(row["total"]),
        errors: toNum(row["errors"]),
        errorRate: toNum(row["errorRate"]),
      }));

      const awsLambdas = toNum(r5a.records[0]?.["count()"]);
      const azureFunctions = toNum(r5b.records[0]?.["count()"]);

      const instrumentedCloudFunctions = toNum(r6.records[0]?.["instrumented"]);

      const logSources = r7.records.map((row) => ({
        src: toStr(row["_src"]),
        total: toNum(row["total"]),
        errors: toNum(row["errors"]),
        warnings: toNum(row["warnings"]),
        errorRate: toNum(row["errorRate"]),
      }));

      const stalePgiCount = toNum(r8.records[0]?.["count()"]);

      const scannedBytes =
        r1.scannedBytes + r2.scannedBytes + r3a.scannedBytes + r3b.scannedBytes +
        r4.scannedBytes + r5a.scannedBytes + r5b.scannedBytes + r6.scannedBytes +
        r7.scannedBytes + r8.scannedBytes;

      const scannedRecords =
        r1.scannedRecords + r2.scannedRecords + r3a.scannedRecords + r3b.scannedRecords +
        r4.scannedRecords + r5a.scannedRecords + r5b.scannedRecords + r6.scannedRecords +
        r7.scannedRecords + r8.scannedRecords;

      setResults({
        pgiByTech,
        servicesByType,
        activeServiceCount,
        totalServiceCount,
        topSpanServices,
        cloudFunctions: { awsLambdas, azureFunctions },
        instrumentedCloudFunctions,
        logSources,
        stalePgiCount,
        scannedRecords,
        scannedBytes,
      });
      setPhase("done");
    }).catch((err: unknown) => {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : "Evaluation failed");
      setPhase("error");
    });
  }, [phase, estimate, segmentId]);

  return { phase, estimate, results, error, segmentId, startEstimate, confirm, cancel, reset };
}
