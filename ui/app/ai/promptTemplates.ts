// ui/app/ai/promptTemplates.ts
//
// Versioned prompt templates for Davis CoPilot recommendations.
//
// Why versioned ──────────────────────────────────────────────────────────
// The cache key for AI responses includes PROMPT_VERSION. Bumping the
// constant invalidates every cached response, forcing the next run to
// regenerate against the new prompt. Without this, an edit to the prompt
// would silently return stale answers from the cache.
//
// Bump PROMPT_VERSION whenever you change buildCapabilityPrompt() in any
// way that should produce a different response. Pure formatting changes
// (whitespace, comments) do not need a bump.

import type { CapabilityResult } from "../hooks/useCoverageData";
import { CRITERION_ACTIONS } from "../remediationActions";

/** Bump on any semantic change to buildCapabilityPrompt below.
 *  v4 (current): natural-language question framing. Davis returned
 *    GUARDRAIL_CHECK_FAILED on v3 because the prompt read as a task
 *    ("Analyse...", "Rules...", "Do NOT...") rather than a question.
 *    The Conversational Recommender skill is built for Q&A; v4 phrases
 *    everything as a question an SE would naturally ask. Format rules
 *    moved into the `instruction` context where they belong.
 *  v3: compact text + inline failed-criteria table. Triggered guardrail.
 *  v2: structured supplementary JSON + verbose prompt. Returned FAILED.
 *  v1: original generic prompt. */
export const PROMPT_VERSION = "v7";

/** Shape of the criterion data we feed to the model. Kept minimal but rich
 *  enough that Davis can write a specific, data-grounded recommendation
 *  instead of a generic "enable X" line. */
interface FailedCriterionInput {
  /** Stable ID like "i1", "a5" — Davis is told to cite these in its reply. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Full description of what the criterion measures (taken from queries.ts).
   *  This is what lets Davis say "this measures host CPU coverage from
   *  OneAgent OR cloud integration" instead of guessing. */
  description: string;
  /** Observed value (0-100%). */
  currentValue: number;
  /** Lowest threshold that would have passed this criterion (so Davis can
   *  state the gap exactly). */
  passingThreshold: number;
  /** Gap to passing = passingThreshold - currentValue (clamped at 0). */
  gap: number;
  /** Tier label so Davis can prioritise foundation issues. */
  tier: "foundation" | "bestPractice" | "excellence";
  /** Static remediation hint from CRITERION_ACTIONS — the SE-curated
   *  baseline that Davis is allowed to refine, not invent from scratch. */
  remediationHint: string;
  /** Dynatrace doc URL paired with the hint. Davis may cite this in its
   *  reply but is told NOT to invent new URLs. */
  docUrl: string;
}

/** Parse the threshold string (e.g. "≥90, ≥50, ≥1") and return the LOWEST
 *  threshold — that's the bar we need to cross for points=1. */
function lowestThreshold(thresholds: string): number {
  // Format from useCoverageData.ts:
  //   thresholds.sort((a,b) => b.min - a.min).map(t => `≥${t.min}`).join(", ")
  // → "≥90, ≥50, ≥1" (descending). Lowest is the LAST one.
  const matches = thresholds.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return 50; // safe default
  const nums = matches.map(s => parseFloat(s));
  return Math.min(...nums);
}

/** Truncate long strings so the prompt body stays compact. */
function clamp(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Top-level prompt builder for a single capability.
 *
 *  v3 design: inline the failed-criteria table directly into the text body,
 *  no supplementary JSON. Smaller payload, simpler structure — Davis was
 *  returning status:FAILED on the heavier v2 form. */
export function buildCapabilityPrompt(cap: CapabilityResult): {
  text: string;
  supplementary: string;
  instruction: string;
} {
  // Build the per-criterion record set.
  const failed: FailedCriterionInput[] = cap.criteriaResults
    .filter(cr => cr.points === 0 && !cr.error)
    .map(cr => {
      const passingThreshold = lowestThreshold(cr.thresholds);
      const gap = Math.max(0, passingThreshold - cr.value);
      const rem = CRITERION_ACTIONS[cr.id];
      return {
        id: cr.id,
        label: cr.label,
        description: cr.description,
        currentValue: cr.value,
        passingThreshold,
        gap,
        tier: cr.tier,
        remediationHint: rem?.action ?? "(no static remediation registered)",
        docUrl: rem?.docUrl ?? "",
      };
    });

  // Sort: foundation first, then by gap descending (worst gap first within
  // each tier). Davis is asked to follow this ordering for the response.
  const tierRank = (t: string) => t === "foundation" ? 0 : t === "bestPractice" ? 1 : 2;
  failed.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.gap - a.gap);

  // ── PROMPT TEXT (natural-language question) ─────────────────────────
  // Frame the whole thing as a question an SE would ask Davis Assist.
  // The guardrail rejects task-style prompts ("Analyse X", "Rules: ...");
  // it accepts genuine questions about Dynatrace usage.
  // Each line carries the criterion's ground truth by its plain-English
  // NAME (not the internal id) + tier + what it measures + the observed
  // value/gap + the SE-curated remediation hint. We deliberately omit the
  // internal id (e.g. "i15") so Davis can never echo a cryptic code back —
  // it only has the friendly name to refer to.
  const criteriaLines = failed.map(f => {
    const name = clamp(f.label, 60).replace(/\s*\(%\)\s*$/, ""); // strip trailing "(%)"
    return `- "${name}" (${f.tier} tier) — ${clamp(f.description, 120)} ` +
      `Currently ${f.currentValue}%, needs ≥${f.passingThreshold}% (gap ${f.gap.toFixed(0)}%). ` +
      `Suggested fix: ${clamp(f.remediationHint, 140)}`;
  }).join("\n");

  const text =
    `I'm a Dynatrace SE reviewing an observability coverage assessment for ` +
    `a customer's "${cap.name}" capability. The capability scored ${cap.score}% ` +
    `coverage and ${cap.utilization.utilizationScore}/100 utilization. These checks are ` +
    `below their passing thresholds (each line gives the check's name, what it ` +
    `measures, the current value, the gap, and a suggested fix):\n\n` +
    `${criteriaLines}\n\n` +
    `First, how would you summarise in two or three sentences what these results ` +
    `say about how the customer is using this capability today — what is already ` +
    `working and what is missing? Then, what are the 3 most impactful Dynatrace ` +
    `actions I should recommend to lift this capability's score? Please prioritise ` +
    `foundation-tier fixes first since they gate the utilization formula, then the ` +
    `highest-leverage single action, then the easiest enablement. For each action, ` +
    `refer to the checks it addresses by their names above, quote the current value ` +
    `and gap in plain language, give a concrete example of how to do it in ` +
    `Dynatrace (the specific Settings path, integration, or attribute), and ` +
    `estimate the coverage lift as a percentage.`;

  // No supplementary — everything is in `text` as a natural question.
  const supplementary = "";

  // ── INSTRUCTION (tone + accuracy + worked examples) ─────────────────
  const instruction =
    `Write in a clear, friendly, professional tone — like an experienced SE ` +
    `explaining next steps to a colleague. Start with a "## Summary" section: ` +
    `two or three plain-language sentences reading the results — what the ` +
    `customer already does well in this capability and what is missing. No ` +
    `jargon, no percentages recap beyond the one or two numbers that matter. ` +
    `Then answer with three numbered sections: ` +
    `"## 1. <action title>", "## 2. <action title>", "## 3. <action title>". ` +
    `Under each heading write one short paragraph (3-5 sentences). Bold the lead ` +
    `action verb.\n` +
    `IMPORTANT — naming: always refer to each check by its plain-English name ` +
    `(e.g. "Cloud region enrichment"), exactly as written in the data. NEVER use ` +
    `internal codes like "i15", "a3", or "criterion ID" — the reader does not know ` +
    `those codes and they look cryptic.\n` +
    `Include a concrete, real example of how to perform each action in Dynatrace — ` +
    `name the actual Settings path, integration, OneAgent flag, OpenPipeline rule, ` +
    `or telemetry attribute (e.g. "enable the AWS integration under Settings > ` +
    `Cloud and virtualization so logs carry the cloud.region attribute"). Do not ` +
    `invent settings or URLs; if unsure a control exists, describe the goal instead. ` +
    `Keep the total reply under 280 words. Avoid code blocks, emoji, and external links.`;

  return { text, supplementary, instruction };
}

/** Instruction passed alongside follow-up turns. Phrased as a request,
 *  not a list of constraints, to avoid the Davis guardrail. */
export function buildFollowUpInstruction(): string {
  return (
    `Please keep the reply concise (under 150 words unless I ask for more ` +
    `detail), in plain markdown — short paragraphs, optional ordered list, ` +
    `no code fences or emoji. Ground the answer in the previous context ` +
    `about this Dynatrace coverage capability and in the Dynatrace docs ` +
    `you have access to.`
  );
}

/** Build a signature of the failed-criteria set. Same signature → same
 *  recommendations should be returned, so this is the cache key salt.
 *
 *  We deliberately ignore exact values and use only id+passed/failed status,
 *  so a customer who moves a single criterion from 49% to 51% (still failing
 *  the ≥50 threshold) does not invalidate the cache. */
export function failureSignature(cap: CapabilityResult): string {
  const ids = cap.criteriaResults
    .filter(cr => cr.points === 0 && !cr.error)
    .map(cr => cr.id)
    .sort()
    .join(",");
  return `${PROMPT_VERSION}:${cap.name}:${ids}`;
}
