// ui/app/hooks/useAiReport.ts
//
// Davis-powered Assist conversation across the whole assessment.
//
// Different from useDavisRecommendations: that hook produces per-capability
// recommendations. This one runs against the full assessment context with a
// free-form user prompt AND supports continuing the conversation — the user
// can ask follow-up questions and Davis keeps context via the opaque `state`.
//
// No persistent cache — each conversation is unique and session-scoped.

import { useCallback, useRef, useState } from "react";
import { publicClient } from "@dynatrace-sdk/client-davis-copilot";
import type { State } from "@dynatrace-sdk/client-davis-copilot";
import type { DavisError } from "../ai/davisRecommendations";
import { buildReportPrompt, type ReportContext } from "../ai/reportPrompt";
import { buildFollowUpInstruction } from "../ai/promptTemplates";

/** One message in the Assist conversation. */
export interface AssistTurn {
  role: "user" | "assistant";
  text: string;
  ts: number;
  messageToken?: string;
}

interface UseAiReportResult {
  /** Current lifecycle: idle / loading / success / error. */
  status: "idle" | "loading" | "success" | "error";
  /** Full conversation thread (user + assistant turns, in order). */
  conversation: AssistTurn[];
  /** Structured error info (when status==='error'). The prior conversation
   *  is preserved so a failed follow-up doesn't wipe the thread. */
  errorDetail?: DavisError;
  /** Start a NEW conversation with the given prompt (clears any prior thread). */
  generate: (userPrompt: string) => Promise<void>;
  /** Continue the CURRENT conversation with a follow-up question. */
  followUp: (text: string) => Promise<void>;
  /** Reset to idle / empty thread (e.g. when the modal closes or the user
   *  clicks "Clear result"). */
  reset: () => void;
}

function classifyError(err: unknown): DavisError {
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
    case 401: hint = "Unauthorized. Sign out and back in."; break;
    case 403: hint = "Forbidden. The OAuth token is missing davis-copilot:conversations:execute. Sign out and back in to re-grant the scope."; break;
    case 404: hint = "Davis CoPilot may not be enabled on this tenant. Ask an admin to enable it."; break;
    case 429: hint = "Rate-limited. Wait a few minutes — Davis allows 25 questions/user/15min."; break;
    case 0:   hint = "Network error. Check connectivity."; break;
    default:  hint = `Unexpected error (HTTP ${status}).`;
  }
  return { status, message, hint };
}

/** Shared response handler. Returns the assistant turn on success, or null
 *  after setting the error state. */
type Setters = {
  setStatus: (s: UseAiReportResult["status"]) => void;
  setErrorDetail: (e: DavisError | undefined) => void;
};

export function useAiReport(ctx: ReportContext): UseAiReportResult {
  const [status, setStatus] = useState<UseAiReportResult["status"]>("idle");
  const [conversation, setConversation] = useState<AssistTurn[]>([]);
  const [errorDetail, setErrorDetail] = useState<DavisError | undefined>(undefined);
  /** Opaque Davis state to continue the conversation on follow-ups. */
  const stateRef = useRef<State | undefined>(undefined);

  const setters: Setters = { setStatus, setErrorDetail };

  /** Low-level call. `previousState` undefined → starts fresh conversation. */
  const call = useCallback(async (
    promptText: string,
    instruction: string,
    supplementary: string,
    previousState: State | undefined,
    requestType: string,
  ): Promise<AssistTurn | null> => {
    const context: { type: "supplementary" | "document-retrieval" | "instruction"; value: string }[] = [
      { type: "instruction", value: instruction },
      { type: "document-retrieval", value: "dynatrace" },
    ];
    if (supplementary) context.unshift({ type: "supplementary", value: supplementary });

    try {
      const resp = await publicClient.recommenderConversation({
        body: {
          text: promptText,
          state: previousState,
          context,
          annotations: { origin_app: "my.pulse.assessment", request_type: requestType },
        },
      });

      if (Array.isArray(resp)) {
        setters.setStatus("error");
        setters.setErrorDetail({ status: 0, message: "Unexpected event-stream response", hint: "Davis returned a streaming response when JSON was expected." });
        return null;
      }
      if (!resp || resp.status === "FAILED" || !resp.text) {
        const metaSummary = resp?.metadata ? ` Metadata: ${JSON.stringify(resp.metadata).slice(0, 200)}` : "";
        setters.setStatus("error");
        setters.setErrorDetail({
          status: 0,
          message: `Response status: ${resp?.status ?? "empty"}.${metaSummary}`,
          hint: "Davis processed the request but produced no usable answer. Try rephrasing more naturally.",
        });
        return null;
      }

      stateRef.current = resp.state;
      return { role: "assistant", text: resp.text, ts: Date.now(), messageToken: resp.messageToken };
    } catch (err) {
      const classified = classifyError(err);
      // eslint-disable-next-line no-console
      console.warn("[AI Report] call failed:", classified, err);
      setters.setStatus("error");
      setters.setErrorDetail(classified);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(async (userPrompt: string) => {
    if (!userPrompt.trim()) return;
    setErrorDetail(undefined);
    stateRef.current = undefined; // fresh conversation
    setConversation([{ role: "user", text: userPrompt.trim(), ts: Date.now() }]);
    setStatus("loading");

    const { text: promptText, supplementary, instruction } = buildReportPrompt(ctx, userPrompt);
    const turn = await call(promptText, instruction, supplementary, undefined, "full_report");
    if (turn) {
      setConversation(prev => [...prev, turn]);
      setStatus("success");
    }
  }, [ctx, call]);

  const followUp = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setErrorDetail(undefined);
    setConversation(prev => [...prev, { role: "user", text: trimmed, ts: Date.now() }]);
    setStatus("loading");

    const turn = await call(
      trimmed,
      buildFollowUpInstruction(),
      "",                       // no supplementary — Davis has context via state
      stateRef.current,
      "full_report_follow_up",
    );
    if (turn) {
      setConversation(prev => [...prev, turn]);
      setStatus("success");
    }
  }, [call]);

  const reset = useCallback(() => {
    setStatus("idle");
    setConversation([]);
    setErrorDetail(undefined);
    stateRef.current = undefined;
  }, []);

  return { status, conversation, errorDetail, generate, followUp, reset };
}
