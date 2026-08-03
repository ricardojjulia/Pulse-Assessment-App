import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { CAPABILITIES, type CapabilityDef, type Threshold } from "../queries";
import { CRITERION_TIERS, type CriterionTier } from "../data/criterionTiers";

export interface TierResult {
  total: number;
  passed: number;
}

export interface MaturityResult {
  foundation: TierResult;
  bestPractice: TierResult;
  excellence: TierResult;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
  maturityScore: number;  // 0-100 weighted score
  maturityBand: string;  // "N/A" | "Low" | "Moderate" | "Good" | "Excellent"
}

export interface CapabilityResult {
  name: string;
  color: string;
  /** Effective score (adjusted by consolidation when active, otherwise same as rawScore). */
  score: number;
  /** Original score from DQL queries (before consolidation adjustment). */
  rawScore: number;
  details: string[];
  criteriaResults: { id: string; label: string; description: string; value: number; score: number; points: number; error: boolean; notApplicable: boolean; query: string; thresholds: string; tier: CriterionTier; isRatio: boolean; denominator?: number }[];
  maturity: MaturityResult;
  /** Consolidation factor (0–100). 100 = all data in DT, 30 = only 30% of estate in DT. */
  consolidation: number;
  /** Effective maturity score (adjusted by consolidation when active). */
  effectiveMaturityScore: number;
}

export interface QueryStats {
  total: number;
  succeeded: number;
  failed: number;
  scannedBytes: number;
  scannedRecords: number;
  scannedDataPoints: number;
}

export type ViewMode = "coverage" | "maturity" | "recommendations";

export interface EntityCounts {
  hosts: number;
  services: number;
  serviceMethods: number;
  processGroups: number;
  processInstances: number;
  applications: number;
  mobileApps: number;
  k8sClusters: number;
  k8sNamespaces: number;
  k8sNodes: number;
  syntheticTests: number;
  syntheticLocations: number;
  httpChecks: number;
  networkInterfaces: number;
  disks: number;
  logs: number;
  spans: number;
  aiSpans: number;
  events: number;
  problems: number;
  bizEvents: number;
  cloudLogs: number;
  securityEvents: number;
}

export interface CoverageData {
  capabilities: CapabilityResult[];
  totalScore: number;
  overallMaturityLevel: number;
  loading: boolean;
  idle: boolean;
  progress: number;
  error: string | null;
  tenant: string;
  date: string;
  stats: QueryStats | null;
  entityCounts: EntityCounts | null;
  liveScannedBytes: number;
  liveScannedRecords: number;
  consolidation: Record<string, number>;
  setConsolidation: (factors: Record<string, number>) => void;
  start: (caps?: CapabilityDef[]) => void;
  refresh: () => void;
  reset: () => void;
  goHome: () => void;
  resume: () => void;
}

function thresholdTarget(thresholds: Threshold[]): { direction: "min" | "max"; value: number } {
  const mins = thresholds.map(t => t.min).filter((v): v is number => typeof v === "number");
  if (mins.length > 0) return { direction: "min", value: Math.max(...mins) };
  const maxes = thresholds.map(t => t.max).filter((v): v is number => typeof v === "number");
  if (maxes.length > 0) return { direction: "max", value: Math.min(...maxes) };
  return { direction: "min", value: 1 };
}

function scoreAgainstThreshold(value: number, thresholds: Threshold[]): { score: number; passed: boolean } {
  const target = thresholdTarget(thresholds);
  if (target.direction === "max") {
    const passed = value <= target.value;
    const score = passed ? 100 : target.value <= 0 ? 0 : Math.max(0, Math.round((target.value / value) * 100));
    return { score, passed };
  }
  const passed = value >= target.value;
  const score = target.value <= 0 ? (passed ? 100 : 0) : Math.min(100, Math.round((value / target.value) * 100));
  return { score, passed };
}

function formatThresholds(thresholds: Threshold[]): string {
  return thresholds
    .slice()
    .sort((a, b) => (b.min ?? Number.NEGATIVE_INFINITY) - (a.min ?? Number.NEGATIVE_INFINITY))
    .map(t => typeof t.min === "number" ? `≥${t.min}` : `≤${t.max}`)
    .join(", ");
}

function extractNumeric(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  // timeseries aggregations return arrays (one value per time bin) — take last element
  if (Array.isArray(v) && v.length > 0) {
    for (let i = v.length - 1; i >= 0; i--) {
      if (typeof v[i] === "number") return v[i];
      if (typeof v[i] === "bigint") return Number(v[i]);
    }
  }
  return null;
}

function extractValue(result: any): number {
  try {
    if (!result) return 0;
    const records = result.records || result;
    if (!Array.isArray(records) || records.length === 0) return 0;
    const record = records[0];
    if (record == null) return 0;
    const direct = extractNumeric(record);
    if (direct !== null) return direct;
    if (typeof record === "object") {
      for (const v of Object.values(record)) {
        const n = extractNumeric(v);
        if (n !== null) return n;
      }
    }
    warn("extractValue: no numeric found in record:", JSON.stringify(record));
    return 0;
  } catch {
    return 0;
  }
}

function formatCriterionValue(value: number, isRatio: boolean): string {
  if (!Number.isFinite(value)) return isRatio ? "0%" : "0";
  if (!isRatio) return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

interface DqlResult { value: number; scannedBytes: number; scannedRecords: number; scannedDataPoints: number; }

/** Debug logging — disabled in production to avoid noisy output.
 *  Enable via browser console: localStorage.setItem("CCA_DEBUG","1") then reload. */
const DEBUG = typeof window !== "undefined" && localStorage.getItem("CCA_DEBUG") === "1";
const log = (...args: unknown[]) => { if (DEBUG) console.log("[CCA]", ...args); };
const warn = (...args: unknown[]) => { if (DEBUG) console.warn("[CCA]", ...args); };

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;
const QUERY_TIMEOUT_MS = 30000;
const DEFAULT_TIMEFRAME_HOURS = 2;

async function executeDql(query: string): Promise<DqlResult> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: QUERY_TIMEOUT_MS,
        maxResultRecords: 1000,
        defaultTimeframeStart: new Date(Date.now() - DEFAULT_TIMEFRAME_HOURS * 60 * 60 * 1000).toISOString(),
        defaultTimeframeEnd: new Date().toISOString(),
      },
    });

    // Handle query state — the SDK may return RUNNING/FAILED without a result
    let state = response?.state;
    let res = response?.result;
    let requestToken = (response as any)?.requestToken as string | undefined;

    // If query is still running, poll for result
    if (state === "RUNNING" && requestToken) {
      log(`⏳ Query still running, polling...`, query.substring(0, 60));
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const poll = await queryExecutionClient.queryPoll({ requestToken });
        state = poll?.state;
        res = poll?.result;
        if (state === "SUCCEEDED" || state === "FAILED" || state === "CANCELLED") break;
      }
    }

    // Handle terminal failure states
    if (state === "FAILED" || state === "CANCELLED") {
      const grail = (res as any)?.metadata?.grail;
      const notifications = grail?.notifications ?? [];
      const errMsg = notifications.map((n: any) => n.message).join("; ") || `Query ${state}`;
      warn(`✗ ${query.substring(0, 80)} → ${errMsg}`);
      return { value: -1, scannedBytes: 0, scannedRecords: 0, scannedDataPoints: 0 };
    }

    const grail = (res as any)?.metadata?.grail;
    const scannedBytes = grail?.scannedBytes ?? 0;
    const scannedRecords = grail?.scannedRecords ?? 0;
    const scannedDataPoints = grail?.scannedDataPoints ?? 0;

    // Log any warnings/notifications from the DQL engine
    const notifications = grail?.notifications ?? [];
    for (const n of notifications) {
      if (n.severity === "ERROR" || n.severity === "WARN") {
        warn(`⚠ DQL ${n.severity}: ${n.message} — query:`, query.substring(0, 60));
      }
    }

    if (!res) {
      warn(`No result for (state=${state}):`, query.substring(0, 80));
      return { value: -1, scannedBytes, scannedRecords, scannedDataPoints };
    }
    let value = 0;
    if (res.records) value = extractValue(res);
    else if (Array.isArray(res)) value = extractValue({ records: res });
    else if (typeof res === "number") value = res;
    else value = extractValue(res);
    if (value === 0) {
      log(`⚠ query returned 0 (state=${state}). Raw record[0]:`, JSON.stringify(res.records?.[0] ?? null), `| records.length=${res.records?.length ?? "N/A"}`);
    }
    log(`✓ ${query.substring(0, 80)} → ${value}`);
    return { value, scannedBytes, scannedRecords, scannedDataPoints };
  } catch (err: any) {
    warn(`✗ ${query.substring(0, 80)} → ERROR:`, err?.message || err);
    return { value: -1, scannedBytes: 0, scannedRecords: 0, scannedDataPoints: 0 };
  }
}

const CONCURRENCY = 10;

// Maturity tier weights for weighted scoring
export const FOUNDATION_WEIGHT = 60;
export const BEST_PRACTICE_WEIGHT = 25;
export const EXCELLENCE_WEIGHT = 15;

interface ExecutionResult { cache: Map<string, number>; totalScannedBytes: number; totalScannedRecords: number; totalScannedDataPoints: number; }

async function executeAllUnique(queries: string[], onProgress: (scannedBytes: number, scannedRecords: number) => void): Promise<ExecutionResult> {
  const cache = new Map<string, number>();
  const unique = [...new Set(queries)];
  let idx = 0;
  let totalScannedBytes = 0;
  let totalScannedRecords = 0;
  let totalScannedDataPoints = 0;

  async function next(): Promise<void> {
    while (idx < unique.length) {
      const q = unique[idx++];
      const result = await executeDql(q);
      cache.set(q, result.value);
      totalScannedBytes += result.scannedBytes;
      totalScannedRecords += result.scannedRecords;
      totalScannedDataPoints += result.scannedDataPoints;
      onProgress(totalScannedBytes, totalScannedRecords);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, () => next()));
  return { cache, totalScannedBytes, totalScannedRecords, totalScannedDataPoints };
}

export function useCoverageData(): CoverageData {
  const [capabilities, setCapabilities] = useState<CapabilityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [idle, setIdle] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(null);
  const [entityCounts, setEntityCounts] = useState<EntityCounts | null>(null);
  const [liveScannedBytes, setLiveScannedBytes] = useState(0);
  const [liveScannedRecords, setLiveScannedRecords] = useState(0);
  const [consolidation, setConsolidation] = useState<Record<string, number>>({});
  const [runId, setRunId] = useState(0);
  const cancelRef = useRef(0);
  const capsRef = useRef<CapabilityDef[]>(CAPABILITIES);

  const runAssessment = useCallback(async () => {
    const runToken = ++cancelRef.current;
    setIdle(false);
    setLoading(true);
    setProgress(0);
    setLiveScannedBytes(0);
    setLiveScannedRecords(0);
    setError(null);

    try {
      // Collect all queries for deduplication (include queryB for cross-entity criteria)
      const caps = capsRef.current;
      const allQueries = caps.flatMap((c) => c.criteria.flatMap((cr) => {
        const queries = cr.queryB ? [cr.query, cr.queryB] : [cr.query];
        if (cr.applicabilityQuery) queries.push(cr.applicabilityQuery);
        return queries;
      }));
      const uniqueCount = new Set(allQueries).size;
      let completed = 0;

      const { cache, totalScannedBytes, totalScannedRecords, totalScannedDataPoints } = await executeAllUnique(allQueries, (scannedSoFar, recordsSoFar) => {
        completed++;
        if (cancelRef.current === runToken) {
          setProgress(Math.round((completed / uniqueCount) * 100));
          setLiveScannedBytes(scannedSoFar);
          setLiveScannedRecords(recordsSoFar);
        }
      });

      if (cancelRef.current !== runToken) return; // cancelled

      const results: CapabilityResult[] = caps.map((cap) => {
        const criteriaResults: CapabilityResult["criteriaResults"] = [];
        const details: string[] = [];

        for (const criterion of cap.criteria) {
          const valueA = cache.get(criterion.query) ?? -1;
          const valueB = criterion.queryB ? cache.get(criterion.queryB) ?? -1 : undefined;
          const applicabilityValue = criterion.applicabilityQuery ? cache.get(criterion.applicabilityQuery) ?? -1 : 1;
          const applicabilityError = criterion.applicabilityQuery ? applicabilityValue === -1 : false;
          const denominatorError = criterion.queryB ? valueB === -1 : false;
          const isError = valueA === -1 || denominatorError;
          let value: number;
          let notApplicable = false;
          if (isError) {
            value = 0;
          } else if (criterion.queryB) {
            // Cross-entity ratio: (queryA / queryB) * 100
            if (!valueB || valueB <= 0) {
              value = 0;
              notApplicable = valueB === 0;
            } else {
              value = Math.min(Math.round((valueA / valueB) * 1000) / 10, 100); // one decimal %, capped at 100
            }
            log(`↔ ${criterion.id}: A=${valueA}, B=${valueB}, ratio=${value}%`);
          } else {
            value = valueA;
          }
          if (!isError && !applicabilityError && applicabilityValue <= 0) notApplicable = true;
          const thresholdScore = scoreAgainstThreshold(value, criterion.thresholds);
          const passed = isError || notApplicable ? false : thresholdScore.passed;
          const thDesc = formatThresholds(criterion.thresholds);
          const tier = CRITERION_TIERS[criterion.id] || "foundation";
          criteriaResults.push({
            id: criterion.id,
            label: criterion.label,
            description: criterion.description,
            value: isError ? 0 : value,
            score: isError || notApplicable ? 0 : thresholdScore.score,
            points: passed ? 1 : 0,
            error: isError || applicabilityError,
            notApplicable,
            query: criterion.queryB ? `${criterion.query}\n÷ ${criterion.queryB}` : criterion.query,
            thresholds: thDesc,
            tier,
            isRatio: !!criterion.queryB,
            denominator: criterion.queryB ? valueB : undefined,
          });
          if (!isError && value > 0) details.push(`${criterion.label}: ${formatCriterionValue(value, !!criterion.queryB)}`);
        }

        // Compute maturity per tier
        const tierCounts = { foundation: { total: 0, passed: 0 }, bestPractice: { total: 0, passed: 0 }, excellence: { total: 0, passed: 0 } };
        const tierScores = { foundation: { total: 0, score: 0 }, bestPractice: { total: 0, score: 0 }, excellence: { total: 0, score: 0 } };
        for (const cr of criteriaResults) {
          if (cr.notApplicable) continue;
          const t = cr.tier;
          tierCounts[t].total++;
          tierScores[t].total++;
          tierScores[t].score += cr.score;
          if (!cr.error && cr.points > 0) tierCounts[t].passed++; // points is 0 or 1
        }
        const fPct = tierScores.foundation.total > 0 ? tierScores.foundation.score / tierScores.foundation.total / 100 : 0;
        const bPct = tierScores.bestPractice.total > 0 ? tierScores.bestPractice.score / tierScores.bestPractice.total / 100 : 0;
        const ePct = tierScores.excellence.total > 0 ? tierScores.excellence.score / tierScores.excellence.total / 100 : 0;
        const fPassPct = tierCounts.foundation.total > 0 ? tierCounts.foundation.passed / tierCounts.foundation.total : 0;
        const bPassPct = tierCounts.bestPractice.total > 0 ? tierCounts.bestPractice.passed / tierCounts.bestPractice.total : 0;
        const ePassPct = tierCounts.excellence.total > 0 ? tierCounts.excellence.passed / tierCounts.excellence.total : 0;
        let level: 0 | 1 | 2 | 3 = 0;
        let levelLabel = "Not Adopted";
        if (fPassPct >= 0.5) { level = 1; levelLabel = "Foundation"; }
        if (fPassPct >= 1.0 && bPassPct >= 0.5) { level = 2; levelLabel = "Operational"; }
        if (fPassPct >= 1.0 && bPassPct >= 1.0 && ePassPct >= 0.5) { level = 3; levelLabel = "Optimized"; }

        // Progressive maturity: BP only counts if Foundation >= 80%, Excellence only if BP >= 60%
        const effB = fPct >= 0.8 ? bPct : 0;
        const effE = effB >= 0.6 ? ePct : 0;
        const maturityScore = Math.round((fPct * FOUNDATION_WEIGHT + effB * BEST_PRACTICE_WEIGHT + effE * EXCELLENCE_WEIGHT));
        const maturityBand = maturityScore >= 80 ? "Excellent" : maturityScore >= 60 ? "Good" : maturityScore >= 40 ? "Moderate" : maturityScore >= 20 ? "Low" : "N/A";

        const maturity: MaturityResult = {
          foundation: tierCounts.foundation,
          bestPractice: tierCounts.bestPractice,
          excellence: tierCounts.excellence,
          level,
          levelLabel,
          maturityScore,
          maturityBand,
        };

        const applicableCriteria = criteriaResults.filter(cr => !cr.notApplicable);
        const capScore = applicableCriteria.length > 0
          ? Math.round(applicableCriteria.reduce((sum, cr) => sum + cr.score, 0) / applicableCriteria.length)
          : 0;

        return { name: cap.name, color: cap.color, score: capScore, rawScore: capScore, details, criteriaResults, maturity, consolidation: 100, effectiveMaturityScore: maturityScore };
      });

      // Log summary
      const totalCriteria = results.reduce((s, c) => s + c.criteriaResults.length, 0);
      const errorCriteria = results.reduce((s, c) => s + c.criteriaResults.filter(cr => cr.error).length, 0);
      setStats({ total: totalCriteria, succeeded: totalCriteria - errorCriteria, failed: errorCriteria, scannedBytes: totalScannedBytes, scannedRecords: totalScannedRecords, scannedDataPoints: totalScannedDataPoints });

      // Extract entity counts from cache (denominator queries)
      const ec = (q: string) => { const v = cache.get(q); return v != null && v > 0 ? v : 0; };
      setEntityCounts({
        hosts: ec('fetch dt.entity.host | summarize count()'),
        services: ec('fetch dt.entity.service | summarize count()'),
        serviceMethods: ec('fetch dt.entity.service_method | summarize count()'),
        processGroups: ec('fetch dt.entity.process_group | summarize count()'),
        processInstances: ec('fetch dt.entity.process_group_instance | summarize count()'),
        applications: ec('fetch dt.entity.application | summarize count()'),
        mobileApps: ec('fetch dt.entity.mobile_application | summarize count()'),
        k8sClusters: ec('fetch dt.entity.kubernetes_cluster | summarize count()'),
        k8sNamespaces: ec('fetch dt.entity.cloud_application_namespace | summarize count()'),
        k8sNodes: ec("timeseries val=avg(dt.kubernetes.container.cpu_usage), by:{k8s.node.name} | fields k8s.node.name | dedup k8s.node.name | summarize c=count()"),
        syntheticTests: ec('fetch dt.entity.synthetic_test | summarize count()'),
        syntheticLocations: ec('fetch dt.entity.synthetic_location | summarize count()'),
        httpChecks: ec('fetch dt.entity.http_check | summarize count()'),
        networkInterfaces: (() => { const nq = 'fetch dt.entity.network_interface | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)'; const v = cache.get(nq); return v != null && v > 0 ? v : 0; })(),
        disks: (() => { const dq = 'fetch dt.entity.disk | fieldsAdd belongs_to = belongs_to[dt.entity.host] | expand belongs_to | summarize count = countDistinct(belongs_to)'; const v = cache.get(dq); return v != null && v > 0 ? v : 0; })(),
        logs: ec('fetch logs | filter timestamp > now() - 2h | summarize count()'),
        spans: ec('fetch spans, from:now()-2h | summarize count()'),
        aiSpans: ec('fetch spans, from:now()-2h | filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name) or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name) | summarize count()'),
        events: ec('fetch events | filter timestamp > now() - 2h | summarize count()'),
        problems: ec('fetch dt.davis.problems, from:now()-72h | filter not(dt.davis.is_duplicate) | summarize count()'),
        bizEvents: ec('fetch bizevents | filter timestamp > now() - 2h | summarize count()'),
        cloudLogs: ec('fetch logs | filter timestamp > now() - 2h | filter isNotNull(cloud.provider) | summarize count()'),
        securityEvents: ec('fetch events, from:now()-30d | filter event.kind == "SECURITY_EVENT" | fieldsAdd affected = affected_entity_ids | expand affected | filter startsWith(affected, "SERVICE-") | summarize count = countDistinct(affected) | fields count'),
      });
      if (DEBUG) {
        console.group(`[CCA] Assessment Complete`);
        console.log(`Queries: ${totalCriteria - errorCriteria}/${totalCriteria} succeeded, ${errorCriteria} failed`);
        results.forEach(c => {
          console.log(`  ${c.name}: ${c.score}% — ${c.criteriaResults.filter(cr => !cr.error).length}/${c.criteriaResults.length} criteria OK`);
        });
        console.groupEnd();
      }

      setCapabilities(results);
    } catch (err) {
      warn("Assessment failed:", err);
      if (cancelRef.current === runToken) {
        setError(err instanceof Error ? err.message : "Assessment failed");
      }
    } finally {
      if (cancelRef.current === runToken) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (runId > 0) runAssessment();
  }, [runAssessment, runId]);

  // Apply consolidation factors to produce adjusted scores
  const adjustedCapabilities = useMemo(() => {
    if (Object.keys(consolidation).length === 0) return capabilities;
    return capabilities.map(cap => {
      const factor = consolidation[cap.name] ?? 100;
      if (factor === 100) return cap;
      const adjScore = Math.round(cap.rawScore * factor / 100);
      const adjMaturity = Math.round(cap.maturity.maturityScore * factor / 100);
      return { ...cap, consolidation: factor, score: adjScore, effectiveMaturityScore: adjMaturity };
    });
  }, [capabilities, consolidation]);

  const totalScore = adjustedCapabilities.length > 0
    ? Math.round(adjustedCapabilities.reduce((sum, c) => sum + c.score, 0) / adjustedCapabilities.length)
    : 0;

  const overallMaturityLevel = adjustedCapabilities.length > 0
    ? Math.round(adjustedCapabilities.reduce((sum, c) => sum + c.effectiveMaturityScore, 0) / adjustedCapabilities.length)
    : 0;

  const tenant = (() => {
    try {
      const envUrl = getEnvironmentUrl();
      if (envUrl) {
        const m = envUrl.match(/\/\/([^.]+)/);
        if (m) return m[1];
      }
    } catch { /* ignore */ }
    const h = typeof window !== "undefined" ? window.location.hostname : "unknown";
    return h === "localhost" ? "localhost (dev)" : h.split(".")[0];
  })();

  const startFn = useCallback((caps?: CapabilityDef[]) => { capsRef.current = caps && caps.length > 0 ? caps : CAPABILITIES; setRunId((n) => n + 1); }, []);
  const refreshFn = useCallback(() => setRunId((n) => n + 1), []);
  const resetFn = useCallback(() => { setIdle(true); setCapabilities([]); setStats(null); setEntityCounts(null); setError(null); setConsolidation({}); }, []);
  const goHomeFn = useCallback(() => { setIdle(true); }, []);
  const resumeFn = useCallback(() => {
    if (capabilities.length > 0) setIdle(false);
  }, [capabilities.length]);

  return {
    capabilities: adjustedCapabilities,
    totalScore,
    overallMaturityLevel,
    loading,
    idle,
    progress,
    error,
    stats,
    entityCounts,
    liveScannedBytes,
    liveScannedRecords,
    consolidation,
    setConsolidation,
    tenant,
    date: new Date().toISOString().split("T")[0],
    start: startFn,
    refresh: refreshFn,
    reset: resetFn,
    goHome: goHomeFn,
    resume: resumeFn,
  };
}
