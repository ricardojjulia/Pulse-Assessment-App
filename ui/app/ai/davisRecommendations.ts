// ui/app/ai/davisRecommendations.ts
//
// Davis CoPilot integration: per-capability dynamic recommendations.
//
// Why ────────────────────────────────────────────────────────────────────
// The static CRITERION_ACTIONS map in ../remediationActions.ts gives every
// criterion a generic English action. It works but cannot reason about the
// customer's actual data — e.g. "you have 80% Foundation but only 30% Best
// Practice, focus on X first". This module asks Davis CoPilot to generate
// recommendations grounded in the run's CapabilityResult, with caching so
// the response is deterministic per (failure signature, prompt version).
//
// Design choices ─────────────────────────────────────────────────────────
// 1. ONE call per capability for the INITIAL recommendation. A 9-capability
//    assessment fans out at most 9 Davis requests instead of 94.
// 2. FOLLOW-UPS: the user can ask Davis a clarifying question that continues
//    the conversation. We pass the opaque `state` from the previous response
//    back to the SDK so the model keeps context. Follow-ups are NOT cached
//    (they're session-scoped) — only the initial response is.
// 3. Cache key uses the failure SIGNATURE (set of failed criterion IDs),
//    not exact values. A criterion drifting from 49% to 51% (both failing
//    a ≥50 threshold) does not invalidate.
// 4. PROMPT_VERSION is in the cache key. Bumping it in promptTemplates.ts
//    invalidates every entry — no orphaned stale responses.
// 5. Silent degradation. Any Davis error (network, missing scope, rate
//    limit, model failure) returns null, and the UI falls back to the
//    static recommendation. The assessment itself never fails because the
//    AI was unavailable.

import { publicClient } from "@dynatrace-sdk/client-davis-copilot";
import type { State } from "@dynatrace-sdk/client-davis-copilot";
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { CapabilityResult } from "../hooks/useCoverageData";
import {
  buildCapabilityPrompt,
  buildFollowUpInstruction,
  failureSignature,
  PROMPT_VERSION,
} from "./promptTemplates";

/** Result returned to the React hook for one Davis call. */
export interface DavisRecommendation {
  /** Markdown body produced by the model. */
  text: string;
  /** Epoch ms when the response was generated (or originally cached). */
  ts: number;
  /** True if this came from cache (no network call this run). Always false
   *  for follow-up responses since follow-ups are not cached. */
  fromCache: boolean;
  /** Davis-issued ID for the response. Surfaces in the response card for
   *  debugging and is required to submit feedback via recommenderFeedback. */
  messageToken?: string;
  /** Opaque SDK state required to continue this conversation in a follow-up.
   *  Persisted in memory only — not written to the Document Store cache. */
  state?: State;
}

/** Structured error info we surface to the UI so the user gets the actual
 *  HTTP status + human-readable hint instead of a generic "unavailable". */
export interface DavisError {
  /** HTTP status code if available, or 0 for network errors. */
  status: number;
  /** Concise message — the API body's `message` field when present, else
   *  the SDK error's message. Safe to render in the UI. */
  message: string;
  /** SE-actionable hint based on status code. */
  hint: string;
}

/** Convert any thrown error into a structured DavisError. */
export function classifyError(err: unknown): DavisError {
  // SDK errors carry response.status and body.
  const e = err as {
    response?: { status?: number };
    body?: { error?: { message?: string }; message?: string };
    message?: string;
  };
  const status = e?.response?.status ?? 0;
  const bodyMsg = e?.body?.error?.message ?? e?.body?.message;
  const fallbackMsg = e?.message ?? String(err);
  const message = (bodyMsg || fallbackMsg).slice(0, 240);

  let hint: string;
  switch (status) {
    case 401:
      hint = "Unauthorized. Your session expired — sign out and back in.";
      break;
    case 403:
      hint = "Forbidden. The OAuth token is missing the davis-copilot:conversations:execute scope. Sign out and back in to re-grant the scope, or contact your admin if the scope was rejected.";
      break;
    case 404:
      hint = "Not found. Davis CoPilot is likely not enabled on this tenant. Ask an admin to enable Davis CoPilot, or verify the feature is in your subscription.";
      break;
    case 429:
      hint = "Rate-limited. Davis CoPilot caps usage at 25 questions per user and 60 per environment per 15 minutes. Wait a few minutes.";
      break;
    case 500:
    case 502:
    case 503:
      hint = "Davis CoPilot service error. Retry in a minute.";
      break;
    case 0:
      hint = "Network error. Check connectivity to the Dynatrace tenant.";
      break;
    default:
      hint = `Unexpected error (HTTP ${status}). See the raw message above.`;
  }
  return { status, message, hint };
}

// ─── Persistent cache ──────────────────────────────────────────────────

interface CacheEntry {
  text: string;
  ts: number;
  messageToken?: string;
}

interface CacheDocument {
  schemaVersion: 1;
  tenantId: string;
  entries: Record<string, CacheEntry>;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const DOC_ID = "pulse-davis-recs";
const DOC_TYPE = "pulse-davis-recs";

/** FNV-1a 32-bit. Same family as queryCache.ts. */
function fnv32(str: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function makeKey(signature: string): string {
  return fnv32(signature);
}

/**
 * 24h cache for Davis recommendations, persisted to the Document Store.
 *
 * Same lifecycle as QueryCache: load() at run start, get()/set() during,
 * flush() once at run end. Errors degrade silently to no-cache.
 *
 * Only the INITIAL recommendation is cached. Follow-up turns are kept in
 * the React hook's in-memory state and lost on reload — appropriate for a
 * conversation, where re-asking the same follow-up is rare.
 */
export class DavisCache {
  private entries = new Map<string, CacheEntry>();
  private docVersion: string | null = null;
  private loaded = false;
  private dirty = false;

  constructor(private readonly tenantId: string) {}

  async load(): Promise<boolean> {
    try {
      const content = await documentsClient.downloadDocumentContent({ id: DOC_ID });
      const text = await content.get("text");
      const doc = JSON.parse(text) as Partial<CacheDocument>;
      if (doc?.schemaVersion !== 1 || doc.tenantId !== this.tenantId) {
        this.loaded = true;
        return true;
      }
      try {
        const meta = await documentsClient.getDocumentMetadata({ id: DOC_ID });
        this.docVersion = String(meta.version ?? "");
      } catch {
        this.docVersion = null;
      }
      const now = Date.now();
      for (const [key, entry] of Object.entries(doc.entries ?? {})) {
        if (!entry || typeof entry.text !== "string" || typeof entry.ts !== "number") continue;
        if (now - entry.ts > TTL_MS) continue;
        this.entries.set(key, entry);
      }
      this.loaded = true;
      // eslint-disable-next-line no-console
      console.log(`[DavisCache] loaded ${this.entries.size} entries for tenant ${this.tenantId}`);
      return true;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number }; code?: number })?.response?.status
        ?? (err as { code?: number })?.code;
      if (status === 404) {
        this.loaded = true;
        return true;
      }
      // eslint-disable-next-line no-console
      console.warn("[DavisCache] load failed, falling back to no-cache mode:", err);
      this.loaded = false;
      return false;
    }
  }

  get(signature: string): CacheEntry | null {
    if (!this.loaded) return null;
    return this.entries.get(makeKey(signature)) ?? null;
  }

  set(signature: string, entry: CacheEntry): void {
    if (!this.loaded) return;
    this.entries.set(makeKey(signature), entry);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.loaded || !this.dirty) return;
    const body: CacheDocument = {
      schemaVersion: 1,
      tenantId: this.tenantId,
      entries: Object.fromEntries(this.entries),
    };
    const content = new Blob([JSON.stringify(body)], { type: "application/json" });
    try {
      if (this.docVersion != null) {
        await documentsClient.updateDocument({
          id: DOC_ID,
          body: { content, name: DOC_ID, type: DOC_TYPE },
          optimisticLockingVersion: this.docVersion,
        });
      } else {
        await documentsClient.createDocument({
          body: { content, name: DOC_ID, type: DOC_TYPE },
        });
      }
      this.dirty = false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[DavisCache] flush failed (recommendations not persisted this run):", err);
    }
  }
}

// ─── Davis calls ────────────────────────────────────────────────────────

/** Union result: either a recommendation or a structured error. Lets the
 *  UI render the actual failure mode (status + hint) instead of generic
 *  "unavailable" text. */
export type DavisResult =
  | { ok: true; rec: DavisRecommendation }
  | { ok: false; err: DavisError };

/**
 * Get the INITIAL recommendation for a capability. Checks cache first; on
 * miss, calls Davis CoPilot recommenderConversation. Returns a structured
 * result so the UI can show the actual error (HTTP status + hint).
 */
export async function getRecommendation(
  cap: CapabilityResult,
  cache: DavisCache | null,
): Promise<DavisResult | null> {
  if (cap.criteriaResults.filter(cr => cr.points === 0 && !cr.error).length === 0) {
    return null;
  }

  const signature = failureSignature(cap);

  if (cache) {
    const hit = cache.get(signature);
    if (hit) {
      // Cached response has no `state` — follow-ups starting from a cached
      // response begin a fresh conversation (Davis is robust to this; it
      // can refer back to the supplementary context in the new prompt).
      return {
        ok: true,
        rec: {
          text: hit.text,
          ts: hit.ts,
          fromCache: true,
          messageToken: hit.messageToken,
        },
      };
    }
  }

  const { text: promptText, supplementary, instruction } = buildCapabilityPrompt(cap);

  try {
    // Build context array — only include supplementary if non-empty. v3
    // omits it entirely; older versions populated it.
    const context: { type: "supplementary" | "document-retrieval" | "instruction"; value: string }[] = [
      { type: "instruction", value: instruction },
      { type: "document-retrieval", value: "dynatrace" },
    ];
    if (supplementary) {
      context.unshift({ type: "supplementary", value: supplementary });
    }

    const resp = await publicClient.recommenderConversation({
      body: {
        text: promptText,
        context,
        annotations: {
          origin_app: "my.pulse.assessment",
          prompt_version: PROMPT_VERSION,
        },
      },
    });

    if (Array.isArray(resp)) {
      // eslint-disable-next-line no-console
      console.warn("[Davis] unexpected event-stream response, dropping");
      return { ok: false, err: { status: 0, message: "Unexpected event-stream response", hint: "Davis returned a streaming response when JSON was expected." } };
    }
    if (!resp || resp.status === "FAILED" || !resp.text) {
      // Dump everything we got — metadata often contains the actual cause.
      // eslint-disable-next-line no-console
      console.warn("[Davis] FAILED or empty response. Full payload:", {
        status: resp?.status,
        text: resp?.text,
        messageToken: resp?.messageToken,
        metadata: resp?.metadata,
        promptLen: promptText.length,
        instructionLen: instruction.length,
        suppLen: supplementary.length,
      });
      const metaSummary = resp?.metadata
        ? ` Metadata: ${JSON.stringify(resp.metadata).slice(0, 200)}`
        : "";
      return {
        ok: false,
        err: {
          status: 0,
          message: `Response status: ${resp?.status ?? "empty"}.${metaSummary}`,
          hint: "Davis processed the request but produced no usable answer. Common causes: prompt complexity, content-filter trigger, or transient service issue. Try the Force refresh button to re-issue with the latest prompt template.",
        },
      };
    }

    const entry: CacheEntry = {
      text: resp.text,
      ts: Date.now(),
      messageToken: resp.messageToken,
    };

    if (cache) cache.set(signature, entry);

    return {
      ok: true,
      rec: {
        text: entry.text,
        ts: entry.ts,
        fromCache: false,
        messageToken: entry.messageToken,
        state: resp.state,
      },
    };
  } catch (err) {
    const classified = classifyError(err);
    // eslint-disable-next-line no-console
    console.warn(`[Davis] call failed for ${cap.name}:`, classified, err);
    return { ok: false, err: classified };
  }
}

/**
 * Continue an existing conversation. Sends `text` as a user follow-up
 * alongside the opaque `previousState` from the prior response, so Davis
 * keeps the context (capability, scores, criteria, prior reasoning).
 *
 * Not cached — follow-ups are user-driven and session-scoped.
 */
export async function getFollowUp(
  cap: CapabilityResult,
  followUpText: string,
  previousState: State | undefined,
): Promise<DavisResult | null> {
  if (!followUpText.trim()) return null;

  try {
    const resp = await publicClient.recommenderConversation({
      body: {
        text: followUpText.trim(),
        state: previousState,
        context: [
          { type: "instruction", value: buildFollowUpInstruction() },
          { type: "document-retrieval", value: "dynatrace" },
        ],
        annotations: {
          origin_app: "my.pulse.assessment",
          prompt_version: PROMPT_VERSION,
          turn_type: "follow_up",
          capability: cap.name.slice(0, 128),
        },
      },
    });

    if (Array.isArray(resp)) {
      // eslint-disable-next-line no-console
      console.warn("[Davis] unexpected event-stream response on follow-up");
      return { ok: false, err: { status: 0, message: "Unexpected event-stream response", hint: "Davis returned a streaming response when JSON was expected." } };
    }
    if (!resp || resp.status === "FAILED" || !resp.text) {
      // eslint-disable-next-line no-console
      console.warn("[Davis] follow-up FAILED status or empty text", resp?.status);
      return { ok: false, err: { status: 0, message: `Response status: ${resp?.status ?? "empty"}`, hint: "Davis returned a failed or empty response. Try again in a moment." } };
    }

    return {
      ok: true,
      rec: {
        text: resp.text,
        ts: Date.now(),
        fromCache: false,
        messageToken: resp.messageToken,
        state: resp.state,
      },
    };
  } catch (err) {
    const classified = classifyError(err);
    // eslint-disable-next-line no-console
    console.warn(`[Davis] follow-up call failed for ${cap.name}:`, classified, err);
    return { ok: false, err: classified };
  }
}
