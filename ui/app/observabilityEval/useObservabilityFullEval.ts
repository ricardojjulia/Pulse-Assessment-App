import { useState, useCallback, useRef } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import type { EstimateResult, ObsFullEvalResults, RoadmapItem } from "./types";
import { scoreToGrade } from "./types";
import type { Finding, FindingSeverity } from "../tenantReview/types/review.types";
import { runOneAgentDomain } from "./domains/oneagent";
import { runInfraDomain } from "./domains/infra";
import { runApmDomain } from "./domains/apm";
import { runLogsDomain } from "./domains/logs";
import { runDemDomain } from "./domains/dem";
import { runDavisDomain } from "./domains/davis";
import { runAutomationDomain } from "./domains/automation";
import { runGovernanceDomain } from "./domains/governance";
import { runBizObsDomain } from "./domains/bizobs";
import { runExtensionsDomain } from "./domains/extensions";

export type FullEvalPhase = "idle" | "estimating" | "confirmed" | "running" | "done" | "error";

export interface FullEvalHandle {
  phase: FullEvalPhase;
  estimate: EstimateResult | null;
  results: ObsFullEvalResults | null;
  error: string | null;
  startEstimate: (segmentId?: string) => void;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
const DOMAIN_WEIGHTS: Record<string, number> = {
  oneagent: 1.0, infra: 0.9, apm: 1.0, logs: 0.9, dem: 0.8,
  davis: 1.0, automation: 0.7, governance: 0.9, bizobs: 0.7, extensions: 0.8,
};

async function quickCount(query: string): Promise<number> {
  try {
    const r = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 20000 },
    });
    const rec = (r?.result?.records ?? []) as Record<string, unknown>[];
    const val = rec[0];
    if (!val) return 0;
    const n = Object.values(val)[0];
    return typeof n === "number" ? n : typeof n === "string" ? parseFloat(n) || 0 : 0;
  } catch {
    return 0;
  }
}

function buildRoadmap(findings: Finding[], domains: ObsFullEvalResults["domains"]): RoadmapItem[] {
  const domainNameById = Object.fromEntries(domains.map(d => [d.id, d.name]));
  const domainByFindingId: Record<string, string> = {};
  for (const domain of domains) {
    for (const f of domain.findings) {
      domainByFindingId[f.id] = domain.name;
    }
  }
  return findings.map((f): RoadmapItem => {
    const timeframe: RoadmapItem["timeframe"] =
      f.severity === "critical" || f.severity === "warning" ? "0-30d"
        : f.severity === "info" ? "30-60d"
        : "60-90d";
    return { timeframe, finding: f, domain: domainByFindingId[f.id] ?? "General" };
  });
}

export function useObservabilityFullEval(): FullEvalHandle {
  const [phase, setPhase] = useState<FullEvalPhase>("idle");
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [results, setResults] = useState<ObsFullEvalResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const segmentIdRef = useRef<string | undefined>(undefined);
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setPhase("idle");
    setEstimate(null);
    setResults(null);
    setError(null);
    segmentIdRef.current = undefined;
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setPhase("idle");
    setEstimate(null);
    setResults(null);
    setError(null);
  }, []);

  const startEstimate = useCallback((segmentId?: string) => {
    cancelledRef.current = false;
    segmentIdRef.current = segmentId;
    setPhase("estimating");
    setEstimate(null);
    setResults(null);
    setError(null);

    const sf = segmentId ? `| filter filterSegments("${segmentId}")` : "";

    Promise.all([
      quickCount("fetch dt.entity.process_group_instance | summarize count()"),
      quickCount("fetch dt.entity.service | summarize count()"),
      quickCount(`fetch spans, from:now()-1h\n${sf}\n| summarize count()`),
      quickCount(`fetch logs, from:now()-1h\n${sf}\n| summarize count()`),
    ]).then(([pgiCount, serviceCount, spansPerHour, logsPerHour]) => {
      if (cancelledRef.current) return;
      const estimatedGb = ((spansPerHour * 24 * 2048) + (logsPerHour * 24 * 512)) / (1024 * 1024 * 1024);
      setEstimate({ pgiCount, serviceCount, spansPerHour, logsPerHour, estimatedGb, estimatedDps: estimatedGb * 0.01 });
      setPhase("confirmed");
    }).catch((err: unknown) => {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : "Estimation failed");
      setPhase("error");
    });
  }, []);

  const confirm = useCallback(() => {
    if (phase !== "confirmed") return;
    cancelledRef.current = false;
    setPhase("running");

    const segId = segmentIdRef.current ?? "";

    Promise.all([
      runOneAgentDomain(),
      runInfraDomain(segId),
      runApmDomain(segId),
      runLogsDomain(segId),
      runDemDomain(),
      runDavisDomain(),
      runAutomationDomain(),
      runGovernanceDomain(),
      runBizObsDomain(),
      runExtensionsDomain(),
    ]).then((domains) => {
      if (cancelledRef.current) return;

      // Weighted overall score
      const totalWeight = domains.reduce((s, d) => s + (DOMAIN_WEIGHTS[d.id] ?? 1), 0);
      const weightedSum = domains.reduce((s, d) => s + d.score * (DOMAIN_WEIGHTS[d.id] ?? 1), 0);
      const overallScore = Math.round(weightedSum / totalWeight);
      const overallGrade = scoreToGrade(overallScore);

      // Flatten and sort all findings: critical → warning → info → success
      const allFindings: Finding[] = domains
        .flatMap(d => d.findings)
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

      const roadmap = buildRoadmap(allFindings, domains);

      const scannedBytes = 0;
      const scannedRecords = 0;

      setResults({ domains, overallScore, overallGrade, findings: allFindings, roadmap, scannedBytes, scannedRecords });
      setPhase("done");
    }).catch((err: unknown) => {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : "Evaluation failed");
      setPhase("error");
    });
  }, [phase]);

  return { phase, estimate, results, error, startEstimate, confirm, cancel, reset };
}
