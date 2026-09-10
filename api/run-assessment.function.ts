/**
 * Scheduled Assessment API Function
 *
 * Runs the full Pulse Assessment server-side and saves a snapshot to the
 * Dynatrace Document Store. Designed to be called from a Dynatrace Workflow
 * on a schedule (see docs/workflow-scheduled-assessment.yaml for a ready-made
 * import template).
 *
 * Input (optional JSON body):
 *   {
 *     "tier": "foundation" | "bestPractice" | "excellence"
 *   }
 *
 *   - "foundation"   → only foundation-tier criteria (fastest, ~60s budget)
 *   - "bestPractice" → foundation + bestPractice criteria
 *   - "excellence"   → all criteria (default when omitted)
 *
 * Output:
 *   {
 *     "success": boolean,
 *     "totalScore": number,        // 0–100
 *     "snapshotId": string,        // Document Store ID of the saved snapshot
 *     "capabilityScores": { [name]: number },
 *     "error"?: string             // present only on failure
 *   }
 */
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { documentsClient } from "@dynatrace-sdk/client-document";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { CAPABILITIES } from "../ui/app/queries";
import { CRITERION_TIERS } from "../ui/app/data/criterionTiers";
import {
  extractValue,
  scoreAgainstThreshold,
  computeCapabilityUtilization,
} from "../shared/scoring";
import type { CriterionTier } from "../shared/scoring";

// ── Types ──────────────────────────────────────────────────────────────────

type TierFilter = "foundation" | "bestPractice" | "excellence";

interface Payload {
  tier?: TierFilter;
  /** Wrapper shape forwarded by some Workflow action types. */
  data?: { tier?: TierFilter };
}

interface RunAssessmentResult {
  success: boolean;
  totalScore: number;
  snapshotId: string;
  capabilityScores: Record<string, number>;
  error?: string;
}

// Minimal typed shapes for the DQL SDK response so we avoid `any`.
interface DqlGrailMeta {
  scannedBytes?: number;
  scannedRecords?: number;
  scannedDataPoints?: number;
  notifications?: Array<{ severity?: string; message?: string }>;
}

interface DqlQueryResult {
  records?: Array<Record<string, unknown>>;
  metadata?: { grail?: DqlGrailMeta };
}

interface DqlQueryResponse {
  state?: string;
  result?: DqlQueryResult;
  requestToken?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DOC_TYPE = "ppa-snapshot";
const BATCH_SIZE = 10;
const QUERY_TIMEOUT_MS = 55_000; // leave headroom before the 60s function limit
const MAX_POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEFRAME_HOURS = 2;

// Tier order used to filter criteria: "foundation" = 0, "bestPractice" = 1, "excellence" = 2
const TIER_ORDER: Record<TierFilter, number> = {
  foundation: 0,
  bestPractice: 1,
  excellence: 2,
};

// ── DQL execution ──────────────────────────────────────────────────────────

async function executeDql(query: string): Promise<number> {
  try {
    const raw = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: QUERY_TIMEOUT_MS,
        maxResultRecords: 1000,
        defaultTimeframeStart: new Date(
          Date.now() - DEFAULT_TIMEFRAME_HOURS * 60 * 60 * 1000,
        ).toISOString(),
        defaultTimeframeEnd: new Date().toISOString(),
      },
    });

    // Cast through unknown to our minimal typed interface.
    let resp = raw as unknown as DqlQueryResponse;
    let state = resp.state;
    let res = resp.result;

    // Poll for RUNNING queries
    if (state === "RUNNING" && resp.requestToken) {
      const token = resp.requestToken;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        const poll = (await queryExecutionClient.queryPoll({
          requestToken: token,
        })) as unknown as DqlQueryResponse;
        state = poll.state;
        res = poll.result;
        if (
          state === "SUCCEEDED" ||
          state === "FAILED" ||
          state === "CANCELLED"
        )
          break;
      }
    }

    if (state === "FAILED" || state === "CANCELLED") return -1;
    if (!res) return -1;

    let value: number;
    if (res.records) {
      value = extractValue(res);
    } else if (Array.isArray(res)) {
      value = extractValue({ records: res as Array<Record<string, unknown>> });
    } else {
      value = extractValue(res);
    }
    return value;
  } catch {
    return -1;
  }
}

// ── Batch execution ────────────────────────────────────────────────────────

async function executeAllQueries(
  queries: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(queries)];
  const cache = new Map<string, number>();

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((q) => executeDql(q)),
    );
    for (let j = 0; j < batch.length; j++) {
      const result = settled[j];
      cache.set(
        batch[j],
        result.status === "fulfilled" ? result.value : -1,
      );
    }
  }

  return cache;
}

// ── Scoring ────────────────────────────────────────────────────────────────

interface CriterionScored {
  id: string;
  label: string;
  value: number;
  score: number;
  points: number;
  error: boolean;
  notApplicable: boolean;
  tier: CriterionTier;
}

// ── Snapshot helpers ───────────────────────────────────────────────────────

interface AssessmentSnapshot {
  id: string;
  timestamp: string;
  totalScore: number;
  tenant: string;
  capabilities: Array<{
    name: string;
    color: string;
    score: number;
    consolidation?: number;
    utilizationScore?: number;
    criteriaResults: Array<{
      id: string;
      label: string;
      value: number;
      points: number;
      error: boolean;
    }>;
  }>;
}

async function saveSnapshot(snap: AssessmentSnapshot): Promise<string> {
  const docId = `cca-${snap.id}`;
  await documentsClient.createDocument({
    body: {
      name: `cca-${snap.timestamp}`,
      type: DOC_TYPE,
      content: new Blob([JSON.stringify(snap)], { type: "application/json" }),
      id: docId,
    },
  });
  return docId;
}

function getTenantFromUrl(): string {
  try {
    const envUrl = getEnvironmentUrl();
    if (envUrl) {
      return envUrl.match(/\/\/([^.]+)/)?.[1] ?? "api-scheduled";
    }
  } catch { /* ignore */ }
  return "api-scheduled";
}

// ── Main function ──────────────────────────────────────────────────────────

export default async function (
  payload: Payload,
): Promise<RunAssessmentResult> {
  const actualPayload = payload.data ?? payload;
  const tierFilter: TierFilter | undefined = actualPayload.tier;
  const maxTierOrdinal = tierFilter !== undefined ? TIER_ORDER[tierFilter] : 2;

  try {
    // Collect all queries for the filtered criteria set
    const allQueries: string[] = [];
    for (const cap of CAPABILITIES) {
      for (const criterion of cap.criteria) {
        const criterionTier = (CRITERION_TIERS[criterion.id] ?? "foundation") as CriterionTier;
        if (TIER_ORDER[criterionTier] > maxTierOrdinal) continue;

        allQueries.push(criterion.query);
        if (criterion.queryB) allQueries.push(criterion.queryB);
        if (criterion.applicabilityQuery) allQueries.push(criterion.applicabilityQuery);
      }
    }

    // Execute all queries in parallel batches of 10
    const cache = await executeAllQueries(allQueries);

    // Score each capability
    const capabilityScores: Record<string, number> = {};
    const snapshotCapabilities: AssessmentSnapshot["capabilities"] = [];

    for (const cap of CAPABILITIES) {
      const criteriaResults: CriterionScored[] = [];

      for (const criterion of cap.criteria) {
        const criterionTier = (CRITERION_TIERS[criterion.id] ?? "foundation") as CriterionTier;
        if (TIER_ORDER[criterionTier] > maxTierOrdinal) continue;

        const valueA = cache.get(criterion.query) ?? -1;
        const valueB = criterion.queryB
          ? cache.get(criterion.queryB) ?? -1
          : undefined;
        const applicabilityValue = criterion.applicabilityQuery
          ? cache.get(criterion.applicabilityQuery) ?? -1
          : 1;

        const isError =
          valueA === -1 || (criterion.queryB !== undefined && valueB === -1);
        const applicabilityError =
          criterion.applicabilityQuery !== undefined && applicabilityValue === -1;

        let value: number;
        let notApplicable = false;

        if (isError) {
          value = 0;
        } else if (criterion.queryB !== undefined) {
          if (!valueB || valueB <= 0) {
            value = 0;
            notApplicable = valueB === 0;
          } else {
            value = Math.min(
              Math.round((valueA / valueB) * 1000) / 10,
              100,
            );
          }
        } else if (criterion.denominatorConstant != null) {
          const denom = criterion.denominatorConstant;
          value =
            denom <= 0
              ? 0
              : Math.min(Math.round((valueA / denom) * 1000) / 10, 100);
        } else {
          value = valueA;
        }

        if (!isError && !applicabilityError && applicabilityValue <= 0) {
          notApplicable = true;
        }

        const thresholdResult = scoreAgainstThreshold(
          value,
          criterion.thresholds,
        );
        const passed =
          isError || notApplicable ? false : thresholdResult.passed;

        criteriaResults.push({
          id: criterion.id,
          label: criterion.label,
          value: isError ? 0 : value,
          score: isError || notApplicable ? 0 : thresholdResult.score,
          points: passed ? 1 : 0,
          error: isError || applicabilityError,
          notApplicable,
          tier: criterionTier,
        });
      }

      if (criteriaResults.length === 0) {
        // No criteria in scope for this capability at the given tier filter
        capabilityScores[cap.name] = 0;
        continue;
      }

      // C6: exclude notApplicable and errored criteria from the score denominator
      const scorable = criteriaResults.filter(
        (cr) => !cr.notApplicable && !cr.error,
      );
      const capScore =
        scorable.length > 0
          ? Math.round(
              scorable.reduce((sum, cr) => sum + cr.score, 0) / scorable.length,
            )
          : 0;

      const util = computeCapabilityUtilization(criteriaResults);

      capabilityScores[cap.name] = capScore;

      snapshotCapabilities.push({
        name: cap.name,
        color: cap.color,
        score: capScore,
        consolidation: 100,
        utilizationScore: util.utilizationScore,
        criteriaResults: criteriaResults.map((cr) => ({
          id: cr.id,
          label: cr.label,
          value: cr.value,
          points: cr.points,
          error: cr.error,
        })),
      });
    }

    // Compute overall score (average of all capabilities that had criteria in scope)
    const scoredCaps = snapshotCapabilities.filter((c) => c.criteriaResults.length > 0);
    const totalScore =
      scoredCaps.length > 0
        ? Math.round(
            scoredCaps.reduce((sum, c) => sum + c.score, 0) / scoredCaps.length,
          )
        : 0;

    // Save snapshot to Document Store
    const snapshotId = `scheduled-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const tenant = getTenantFromUrl();

    const snap: AssessmentSnapshot = {
      id: snapshotId,
      timestamp,
      totalScore,
      tenant,
      capabilities: snapshotCapabilities,
    };

    const docId = await saveSnapshot(snap);

    return {
      success: true,
      totalScore,
      snapshotId: docId,
      capabilityScores,
    };
  } catch (err) {
    return {
      success: false,
      totalScore: 0,
      snapshotId: "",
      capabilityScores: {},
      error: err instanceof Error ? err.message : "Assessment failed",
    };
  }
}
