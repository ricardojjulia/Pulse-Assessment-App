// ui/app/ai/assistIntent.ts
//
// Native Dynatrace Intelligence conversation starters.
//
// Implements the official pattern from the Dynatrace Developer guide
// "Conversation starters" (Develop > Guides > Dynatrace Intelligence):
// instead of embedding our own chat, we fire an INTENT to the native
// Dynatrace Assist app (dynatrace.davis.copilot / ask-question). The
// Assist UI opens in a platform modal with our prompt prefilled and our
// assessment data attached as hidden supplementary context.
//
// Why this matters for the agentic architecture ─────────────────────────
// Per the guide: conversation starters currently run in non-agentic mode,
// but "in upcoming releases this will be changed to allow it to run in
// agentic mode when allowed on the tenant". By using the native intent
// surface (rather than the raw SDK conversation call), the Pulse app
// automatically inherits agentic mode when the tenant enables it — no
// code change needed.
//
// Payload contract (from the guide) ─────────────────────────────────────
//   prompt        required, visible to the user, ≤ 10K chars
//   execute       true → sent immediately; false → user edits first
//   contexts[]:
//     supplementary       hidden, ≤ 100K chars (our assessment data)
//     instruction         hidden, ≤ 2.5K chars (tone + naming rules)
//     document-retrieval  "dynatrace" (RAG on DT docs) | "disabled"
//     origin-app          our app id → shows the Pulse icon in Assist
//
// Availability ──────────────────────────────────────────────────────────
// Dynatrace Assist may be disabled on the tenant or denied to the user.
// The guide's rule: call listAvailableSkills() and only show conversation
// starter triggers when the response includes the "conversation" skill.

import { useEffect, useState } from "react";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { publicClient } from "@dynatrace-sdk/client-davis-copilot";
import { buildAssessmentContext, type ReportContext } from "./reportPrompt";

/** Native Assist app + intent ids (from the Conversation starters guide). */
export const DAVIS_COPILOT_APP_ID = "dynatrace.davis.copilot";
export const ASK_QUESTION_INTENT_ID = "ask-question";

/** Our app id — sent as origin-app so Assist shows the Pulse icon. */
const ORIGIN_APP_ID = "my.pulse.assessment";

/** Hidden instruction context (≤ 2.5K chars per the guide). Same tone and
 *  naming rules we validated on the embedded prompt (v6): friendly SE tone,
 *  plain-English check names, no internal codes, no invented settings. */
const ASSIST_INSTRUCTION =
  "Write in a clear, friendly, professional tone — approachable but precise, " +
  "like an experienced Dynatrace SE writing for a colleague or customer. " +
  "Use plain markdown with headings for major sections, short paragraphs, and " +
  "lists where they aid scanning. " +
  "Refer to every assessment check by its plain-English name exactly as given " +
  "in the supplementary context (e.g. \"Cloud region enrichment\"); never use " +
  "internal codes like i15 or a3, and never rename what a check measures. " +
  "Make recommendations concrete: name the actual Dynatrace Settings path, " +
  "integration, OneAgent flag, OpenPipeline rule, or telemetry attribute, and " +
  "state the expected outcome in numbers where possible. Do not invent " +
  "Dynatrace features, settings, or URLs — if unsure a control exists, " +
  "describe the goal instead.";

export interface OpenAssistOptions {
  /** The visible question (conversation starter body or user-typed text). */
  prompt: string;
  /** Full assessment context — becomes the hidden supplementary. */
  ctx: ReportContext;
  /** true → auto-send; false → user reviews/edits in the Assist UI first.
   *  Default false, per the guide's guidance for prefilled prompts. */
  execute?: boolean;
  /** Extra hidden context appended after the assessment data — e.g. a
   *  declared project and its prior AI analysis (Projects page). */
  extraContext?: string;
}

/** Why an intent could not be dispatched, in words the UI can show. */
export interface AssistIntentError {
  message: string;
  hint: string;
}

/**
 * Open the native Dynatrace Assist with a conversation starter.
 * The platform renders the Assist modal; follow-ups, history, and (future)
 * agentic execution are handled natively.
 *
 * Returns null on success, or a describable error. The common failure is
 * running under `dt-app dev`: the local dev server hosts the app DETACHED
 * from the Dynatrace shell, and intents require the embedded runtime —
 * so this only works on a deployed app inside the platform UI.
 */
export function openDynatraceAssist({ prompt, ctx, execute = false, extraContext }: OpenAssistOptions): AssistIntentError | null {
  const supplementary =
    buildAssessmentContext(ctx) + (extraContext ? `\n\n${extraContext}` : "");
  try {
    sendIntent(
      {
        prompt: prompt.slice(0, 10_000),
        execute,
        contexts: [
          { type: "supplementary", value: supplementary.slice(0, 100_000) },
          { type: "instruction", value: ASSIST_INSTRUCTION.slice(0, 2_500) },
          { type: "document-retrieval", value: "dynatrace" },
          { type: "origin-app", value: ORIGIN_APP_ID },
        ],
      },
      { recommendedAppId: DAVIS_COPILOT_APP_ID, recommendedIntentId: ASK_QUESTION_INTENT_ID },
    );
    return null;
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    if (/detached/i.test(message)) {
      return {
        message: "Intents are not available on the local dev server.",
        hint: "The app runs detached from the Dynatrace shell under `dt-app dev`, and intents need the embedded runtime. Use Generate PDF here, or open the deployed app in the tenant to hand the question to Assist.",
      };
    }
    return {
      message: message.slice(0, 200),
      hint: "The intent could not be dispatched to the Dynatrace Assist app.",
    };
  }
}

/**
 * Availability gate per the guide: only show conversation starter triggers
 * to users who can follow through. null = still checking.
 */
export function useConversationSkillAvailable(active: boolean): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active || available !== null) return;
    let cancelled = false;
    publicClient
      .listAvailableSkills()
      .then((response) => {
        if (!cancelled) setAvailable(response.skills?.includes("conversation") ?? false);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => { cancelled = true; };
  }, [active, available]);
  return available;
}
