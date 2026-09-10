// ui/app/hooks/useDavisSynthesis.ts
//
// React hook that drives the cross-capability synthesis Davis call — a single
// 10th request that asks Davis to identify the top 3 priorities across all 9
// capability recommendations.
//
// Design decisions ────────────────────────────────────────────────────────
// - User-initiated only (never auto-fires) to avoid burning quota at page load.
// - Not cached: synthesis depends on which individual recommendations exist at
//   click-time, so caching would be unreliable and wasteful.
// - Own rate-limit state: separate from useDavisRecommendations so the two
//   call types don't cross-contaminate each other's rate-limit UI.
// - Stable callback reference: statusRef/byCapabilityRef/capabilitiesRef keep
//   the async closure reading the latest values without stale captures. The
//   empty useCallback dep array means requestSynthesis never re-creates, making
//   it safe to pass as an event handler prop.
// - Idempotent: if status is "loading" or "done", requestSynthesis is a no-op.
//   Call again when status is "error" to retry.
// - Text preserved: once status reaches "done", the text stays even if
//   byCapability updates. Only cleared by calling requestSynthesis() from "error"
//   (which is only possible via the explicit Retry button).

import { useCallback, useRef, useState } from "react";
import { publicClient } from "@dynatrace-sdk/client-davis-copilot";
import type { DavisRecommendationMap } from "./useDavisRecommendations";
import type { CapabilityResult } from "./useCoverageData";
import { buildSynthesisPrompt, PROMPT_VERSION } from "../ai/promptTemplates";
import { classifyError } from "../ai/davisRecommendations";

/** Lifecycle status for the synthesis call. Uses "done" (not "success") to
 *  distinguish it visually from per-capability status values. */
export type SynthesisStatus = "idle" | "loading" | "done" | "error";

/** Handle returned by the hook. */
export interface UseDavisSynthesisResult {
  /** Synthesis text from Davis, or null before the first successful call. */
  text: string | null;
  /** Lifecycle status of the synthesis call. */
  status: SynthesisStatus;
  /** Human-readable error string (message + hint), or null when not in error. */
  error: string | null;
  /** Epoch ms when the synthesis-specific rate-limit window expires.
   *  Separate from the per-capability rateLimitedUntil in useDavisRecommendations.
   *  Undefined when not currently rate-limited. */
  rateLimitedUntil: number | undefined;
  /** Trigger the synthesis call. Idempotent: no-op if status is "loading" or
   *  "done". Call again when status is "idle" or "error" to (re-)request. */
  requestSynthesis: () => Promise<void>;
}

/** 15-minute rate-limit window (matches Davis CoPilot quota caps). */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Manages the cross-capability synthesis Davis call.
 *
 * @param byCapability - Current per-capability recommendation map from
 *   useDavisRecommendations.  Only the `rec.text` field is consumed.
 * @param capabilities - Full list of capability results (name + score).
 */
export function useDavisSynthesis(
  byCapability: DavisRecommendationMap,
  capabilities: CapabilityResult[],
): UseDavisSynthesisResult {
  const [status, setStatus] = useState<SynthesisStatus>("idle");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | undefined>(undefined);

  // Refs let the async callback read the latest state without stale closures
  // and without adding those values to the useCallback dep array (which would
  // recreate the function on every render).
  const statusRef = useRef<SynthesisStatus>("idle");
  statusRef.current = status;
  const byCapabilityRef = useRef<DavisRecommendationMap>(byCapability);
  byCapabilityRef.current = byCapability;
  const capabilitiesRef = useRef<CapabilityResult[]>(capabilities);
  capabilitiesRef.current = capabilities;

  const requestSynthesis = useCallback(async () => {
    // Idempotent: guard against double-clicks and re-renders.
    if (statusRef.current === "loading" || statusRef.current === "done") return;

    setStatus("loading");
    setError(null);

    const { text: promptText, instruction } = buildSynthesisPrompt(
      byCapabilityRef.current,
      capabilitiesRef.current,
    );

    try {
      const resp = await publicClient.recommenderConversation({
        body: {
          text: promptText,
          context: [
            { type: "instruction", value: instruction },
            { type: "document-retrieval", value: "dynatrace" },
          ],
          annotations: {
            origin_app: "my.pulse.assessment",
            prompt_version: PROMPT_VERSION,
            turn_type: "synthesis",
          },
        },
      });

      if (Array.isArray(resp)) {
        // eslint-disable-next-line no-console
        console.warn("[useDavisSynthesis] unexpected event-stream response");
        setStatus("error");
        setError("Unexpected event-stream response from Davis CoPilot.");
        return;
      }

      if (!resp || resp.status === "FAILED" || !resp.text) {
        // eslint-disable-next-line no-console
        console.warn("[useDavisSynthesis] FAILED or empty response:", resp?.status, resp?.metadata);
        setStatus("error");
        setError(
          `Davis returned no usable response (status: ${resp?.status ?? "empty"}). ` +
          `Try again or check that Davis CoPilot is enabled on this tenant.`,
        );
        return;
      }

      // Successful response — preserve text and clear any prior rate-limit.
      setText(resp.text);
      setRateLimitedUntil(undefined);
      setStatus("done");
    } catch (err) {
      const classified = classifyError(err);
      // eslint-disable-next-line no-console
      console.warn("[useDavisSynthesis] Davis call failed:", classified, err);
      if (classified.status === 429) {
        setRateLimitedUntil(Date.now() + RATE_LIMIT_WINDOW_MS);
      } else {
        setRateLimitedUntil(undefined);
      }
      setError(`${classified.message} — ${classified.hint}`);
      setStatus("error");
    }
  // Empty dep array: reads all state via refs, giving a stable reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { text, status, error, rateLimitedUntil, requestSynthesis };
}
