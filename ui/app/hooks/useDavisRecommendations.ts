// ui/app/hooks/useDavisRecommendations.ts
//
// React hook that produces dynamic Davis CoPilot recommendations on demand
// per capability AND enables conversation follow-ups.
//
// Contract ───────────────────────────────────────────────────────────────
//   Input:  CapabilityResult[] (post-run, fully scored)
//   Output: {
//     byCapability: Record<capName, DavisRecommendationState>,
//     requestInsight: (capName) => Promise<void>,
//     sendFollowUp: (capName, text) => Promise<void>,
//   }
//
// Lifecycle ──────────────────────────────────────────────────────────────
//   1. On capabilities change: initialise state for each capability as
//      "idle" (or "skipped" if there are no failed criteria — nothing to
//      ask Davis about). No SDK calls fire yet.
//   2. The consumer calls requestInsight(capName) when the user shows
//      intent — e.g. expanding a card, or clicking a "Generate" button on
//      the dedicated AI Insights page. This:
//        - Marks the capability "loading"
//        - Loads the 24h cache (lazy, once per session)
//        - Either resolves from cache or fires one Davis call
//   3. sendFollowUp(capName, text) continues an existing conversation by
//      passing the opaque State from the prior response back to the SDK.
//      Follow-ups are NOT cached — session-scoped.
//
// Why on-demand ──────────────────────────────────────────────────────────
// Davis CoPilot caps usage at 25 questions/user/15 min and 60/env/15 min.
// An assessment with 9 failing capabilities would burn 9 calls every time
// the user opened the app. On-demand keeps the steady state at zero and
// only spends quota when the SE/customer explicitly asks for an insight.

import { useCallback, useEffect, useRef, useState } from "react";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import type { State } from "@dynatrace-sdk/client-davis-copilot";
import type { CapabilityResult } from "./useCoverageData";
import {
  DavisCache,
  getRecommendation,
  getFollowUp,
  type DavisRecommendation,
  type DavisError,
} from "../ai/davisRecommendations";
import { failureSignature } from "../ai/promptTemplates";

/** One turn of the conversation surfaced to the UI. */
export interface DavisConversationTurn {
  role: "assistant" | "user";
  text: string;
  ts: number;
  /** Davis-issued ID. Required to submit feedback later. Only present on
   *  assistant turns. */
  messageToken?: string;
  /** True when the assistant turn came from the persistent cache. */
  fromCache?: boolean;
}

/** Per-capability state surfaced to the UI. */
export interface DavisRecommendationState {
  /** Coarse lifecycle of the LATEST turn.
   *  - "idle":     no Davis call attempted yet for this capability
   *  - "loading":  initial call OR follow-up in flight
   *  - "success":  at least one assistant turn delivered
   *  - "error":    last call failed; errorDetail carries the diagnosis
   *  - "skipped":  capability scored 100% — nothing to recommend */
  status: "idle" | "loading" | "success" | "error" | "skipped";
  /** Convenience handle to the latest assistant turn. */
  rec?: DavisRecommendation;
  /** Full conversation thread. */
  conversation: DavisConversationTurn[];
  /** Error message from the latest failed call. */
  error?: string;
  /** Structured error info — HTTP status + hint. */
  errorDetail?: DavisError;
}

/** Map keyed by capability name. */
export type DavisRecommendationMap = Record<string, DavisRecommendationState>;

interface UseDavisOptions {
  /** Gate the entire hook. When false, never calls Davis and returns
   *  an empty map. */
  enabled: boolean;
}

/** Result returned by the hook. */
export interface UseDavisHandle {
  /** Per-capability state. */
  byCapability: DavisRecommendationMap;
  /** Trigger an INITIAL Davis call for one capability. No-op if the
   *  capability is already loading, succeeded, or skipped. */
  requestInsight: (capabilityName: string) => Promise<void>;
  /** Continue an existing conversation on a capability. Capped at
   *  MAX_FOLLOWUPS per capability per session. */
  sendFollowUp: (capabilityName: string, text: string) => Promise<void>;
}

const MAX_FOLLOWUPS = 5;

function tenantIdFrom(envUrl: string | null): string {
  if (!envUrl) return "unknown";
  const m = envUrl.match(/\/\/([^.]+)\./);
  return m?.[1] ?? "unknown";
}

export function useDavisRecommendations(
  capabilities: CapabilityResult[],
  { enabled }: UseDavisOptions,
): UseDavisHandle {
  const [map, setMap] = useState<DavisRecommendationMap>({});
  /** Signature of the last capabilities array we initialised for. Re-init
   *  only when the SET of failing criteria changes. */
  const lastSigRef = useRef<string>("");
  /** Single per-tenant cache instance reused across requests in this
   *  session. Lazy — only created on the first requestInsight call. */
  const cacheRef = useRef<DavisCache | null>(null);
  /** Promise of an in-flight cache load, so concurrent requestInsight
   *  calls share a single load. */
  const cacheLoadingRef = useRef<Promise<void> | null>(null);
  /** Opaque SDK State per capability — needed to continue a conversation. */
  const stateRef = useRef<Record<string, State | undefined>>({});
  /** Follow-up call count per capability (to enforce MAX_FOLLOWUPS). */
  const followUpCountRef = useRef<Record<string, number>>({});
  /** Live capability list, kept in a ref so callbacks resolve capabilities
   *  by name without becoming closure-stale. */
  const capabilitiesRef = useRef<CapabilityResult[]>(capabilities);
  capabilitiesRef.current = capabilities;

  // ── Initialise state per capability whenever the failure SET changes ──
  // No SDK calls here — only state shape setup.
  useEffect(() => {
    if (!enabled || capabilities.length === 0) {
      if (Object.keys(map).length) setMap({});
      lastSigRef.current = "";
      stateRef.current = {};
      followUpCountRef.current = {};
      return;
    }

    const combined = capabilities.map(c => failureSignature(c)).join("|");
    if (combined === lastSigRef.current) return;
    lastSigRef.current = combined;

    // Build idle/skipped state — DO NOT fire any Davis calls.
    const initial: DavisRecommendationMap = {};
    for (const cap of capabilities) {
      const failed = cap.criteriaResults.filter(cr => cr.points === 0 && !cr.error).length;
      initial[cap.name] = failed === 0
        ? { status: "skipped", conversation: [] }
        : { status: "idle", conversation: [] };
    }
    // Reset session-scoped follow-up state for capabilities that changed.
    stateRef.current = {};
    followUpCountRef.current = {};
    setMap(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities, enabled]);

  // ── Cache initialisation, shared across concurrent requestInsight calls ──
  const ensureCache = useCallback(async (): Promise<void> => {
    if (cacheRef.current) return;
    if (cacheLoadingRef.current) {
      await cacheLoadingRef.current;
      return;
    }
    cacheLoadingRef.current = (async () => {
      try {
        const envUrl = getEnvironmentUrl();
        const tenantId = tenantIdFrom(envUrl ?? null);
        const cache = new DavisCache(tenantId);
        await cache.load();
        cacheRef.current = cache;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useDavisRecommendations] cache init failed:", err);
        cacheRef.current = null;
      } finally {
        cacheLoadingRef.current = null;
      }
    })();
    await cacheLoadingRef.current;
  }, []);

  // ── On-demand insight fetcher ─────────────────────────────────────────
  const requestInsight = useCallback(async (capabilityName: string) => {
    const cap = capabilitiesRef.current.find(c => c.name === capabilityName);
    if (!cap) return;

    const current = map[capabilityName];
    // Skip if already loading, already succeeded, or there's nothing to ask.
    if (current && (current.status === "loading" || current.status === "success" || current.status === "skipped")) {
      return;
    }

    // Mark loading immediately so repeated clicks don't fan out.
    setMap(prev => ({
      ...prev,
      [capabilityName]: {
        ...(prev[capabilityName] ?? { status: "idle" as const, conversation: [] }),
        status: "loading",
        error: undefined,
        errorDetail: undefined,
      },
    }));

    // Lazy-init the cache. Errors degrade silently to no-cache.
    await ensureCache();

    const result = await getRecommendation(cap, cacheRef.current);

    if (!result) {
      setMap(prev => ({
        ...prev,
        [capabilityName]: {
          status: "error",
          conversation: [],
          error: "Davis CoPilot unavailable",
        },
      }));
      return;
    }

    if (!result.ok) {
      setMap(prev => ({
        ...prev,
        [capabilityName]: {
          status: "error",
          conversation: [],
          error: result.err.message,
          errorDetail: result.err,
        },
      }));
      return;
    }

    const rec = result.rec;
    stateRef.current[capabilityName] = rec.state;
    followUpCountRef.current[capabilityName] = 0;

    setMap(prev => ({
      ...prev,
      [capabilityName]: {
        status: "success",
        rec,
        conversation: [{
          role: "assistant",
          text: rec.text,
          ts: rec.ts,
          messageToken: rec.messageToken,
          fromCache: rec.fromCache,
        }],
      },
    }));

    // Fire-and-forget cache flush — persists new entries without blocking UI.
    if (cacheRef.current && !rec.fromCache) {
      void cacheRef.current.flush();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureCache]);

  // ── Follow-up sender ─────────────────────────────────────────────────
  const sendFollowUp = useCallback(async (capabilityName: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const cap = capabilitiesRef.current.find(c => c.name === capabilityName);
    if (!cap) return;

    const used = followUpCountRef.current[capabilityName] ?? 0;
    if (used >= MAX_FOLLOWUPS) {
      setMap(prev => ({
        ...prev,
        [capabilityName]: {
          ...(prev[capabilityName] ?? { status: "idle", conversation: [] }),
          status: "error",
          error: `Follow-up limit reached (max ${MAX_FOLLOWUPS} per capability per session).`,
        },
      }));
      return;
    }

    setMap(prev => {
      const cur = prev[capabilityName] ?? { status: "idle" as const, conversation: [] };
      return {
        ...prev,
        [capabilityName]: {
          ...cur,
          status: "loading",
          conversation: [
            ...cur.conversation,
            { role: "user", text: trimmed, ts: Date.now() },
          ],
        },
      };
    });

    const previousState = stateRef.current[capabilityName];
    const result = await getFollowUp(cap, trimmed, previousState);

    if (!result) {
      setMap(prev => {
        const cur = prev[capabilityName];
        if (!cur) return prev;
        return {
          ...prev,
          [capabilityName]: {
            ...cur,
            status: "error",
            error: "Davis CoPilot unavailable for this follow-up.",
          },
        };
      });
      return;
    }

    if (!result.ok) {
      setMap(prev => {
        const cur = prev[capabilityName];
        if (!cur) return prev;
        return {
          ...prev,
          [capabilityName]: {
            ...cur,
            status: "error",
            error: result.err.message,
            errorDetail: result.err,
          },
        };
      });
      return;
    }

    const rec = result.rec;
    stateRef.current[capabilityName] = rec.state;
    followUpCountRef.current[capabilityName] = used + 1;

    setMap(prev => {
      const cur = prev[capabilityName];
      if (!cur) return prev;
      return {
        ...prev,
        [capabilityName]: {
          ...cur,
          status: "success",
          rec,
          error: undefined,
          errorDetail: undefined,
          conversation: [
            ...cur.conversation,
            {
              role: "assistant",
              text: rec.text,
              ts: rec.ts,
              messageToken: rec.messageToken,
              fromCache: false,
            },
          ],
        },
      };
    });
  }, []);

  return { byCapability: map, requestInsight, sendFollowUp };
}
