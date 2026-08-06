// ui/app/ai/reportPrompt.ts
//
// Prompt builder for the full-assessment AI Report (Davis-generated).
//
// Different from promptTemplates.ts which is per-capability. This one
// feeds Davis the whole assessment (all 9 capabilities + scores +
// failing-criteria summary) plus the SE's free-form question, so Davis
// can produce a tailored report — executive summary, QBR talking points,
// technical action plan, customer letter, etc.
//
// Same Q&A natural-language framing as promptTemplates v4 to avoid the
// GUARDRAIL_CHECK_FAILED rejection seen on task-style prompts.

/** Minimal capability shape the report builder needs. Both the live
 *  CapabilityResult and the lighter snapshot capability (Evolution page)
 *  satisfy this — utilization detail is optional and defaulted when absent. */
export interface ReportCapability {
  name: string;
  score: number;
  criteriaResults: { id: string; label: string; value: number; points: number; error: boolean }[];
  utilization?: {
    utilizationScore: number;
    levelLabel: string;
    foundation: { passed: number; total: number };
    bestPractice: { passed: number; total: number };
    excellence: { passed: number; total: number };
  };
}

/** Truncate long strings so the prompt body stays compact. */
function clamp(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Top-N worst-performing failed criteria for one capability — used to give
 *  Davis enough detail to be specific without flooding the prompt. */
function topFailing(cap: ReportCapability, n: number): { id: string; value: number; label: string }[] {
  return cap.criteriaResults
    .filter(cr => cr.points === 0 && !cr.error)
    .sort((a, b) => a.value - b.value)
    .slice(0, n)
    .map(cr => ({ id: cr.id, value: cr.value, label: cr.label }));
}

/** Input metadata for the report builder. */
export interface ReportContext {
  tenant: string;
  date: string;
  overallCoverage: number;
  overallUtilization: number;
  capabilities: ReportCapability[];
  /** Optional change context — e.g. a snapshot-to-snapshot delta summary
   *  from the Evolution page. When present it's appended so Davis can
   *  answer "what changed" questions. */
  comparisonNote?: string;
}

/** Output of the prompt builder — same triple as the per-capability one. */
export interface ReportPrompt {
  text: string;
  supplementary: string;
  instruction: string;
}

/**
 * Build the full-assessment prompt.
 *
 * @param ctx   tenant/date/scores + capabilities
 * @param userPrompt the free-form question the SE typed in the modal —
 *                   appended at the end as "Please …" so Davis treats it
 *                   as the explicit request.
 */
/**
 * Build the assessment context block — the full picture of the current run
 * (overall scores, per-capability detail, optional snapshot delta) in the
 * plain-English form Davis understands. Shared by:
 *   - buildReportPrompt (embedded chat, dev fallback)
 *   - assistIntent.ts   (native Dynatrace Assist conversation starters,
 *     where it becomes the hidden `supplementary` context — 100K char cap)
 */
export function buildAssessmentContext(ctx: ReportContext): string {
  const capLines = ctx.capabilities.map(cap => {
    const failed = cap.criteriaResults.filter(cr => cr.points === 0 && !cr.error).length;
    const total = cap.criteriaResults.length;
    const top = topFailing(cap, 4);
    // Reference each failing check by its plain-English NAME only — never
    // the internal id (e.g. "i15"). The name is the ground truth and is the
    // only thing the reader understands; sending the id makes Davis echo a
    // cryptic code back.
    const topStr = top.length > 0
      ? ` Weakest checks: ${top.map(t => `"${clamp(t.label, 55).replace(/\s*\(%\)\s*$/, "")}" at ${t.value}%`).join("; ")}.`
      : "";
    // Tier breakdown lets Davis answer utilization-aware questions ("which
    // Foundation gates are still closed?") without us pre-digesting it.
    // Snapshot capabilities (Evolution page) omit utilization detail — in that
    // case we report coverage + failing count only.
    const m = cap.utilization;
    if (m) {
      const tiers = `tiers F=${m.foundation.passed}/${m.foundation.total}, BP=${m.bestPractice.passed}/${m.bestPractice.total}, E=${m.excellence.passed}/${m.excellence.total}`;
      return `- ${cap.name}: coverage ${cap.score}%, utilization ${m.utilizationScore}/100 (${m.levelLabel}), ${tiers}, ${failed}/${total} criteria failing.${topStr}`;
    }
    return `- ${cap.name}: coverage ${cap.score}%, ${failed}/${total} criteria failing.${topStr}`;
  }).join("\n");

  return (
    `I just ran a Dynatrace observability coverage assessment (Pulse ` +
    `Assessment app) for a customer, tenant ${ctx.tenant}, on ${ctx.date}. ` +
    `Overall coverage is ${ctx.overallCoverage}% and overall utilization is ` +
    `${ctx.overallUtilization}/100. The capability scores are:\n${capLines}` +
    (ctx.comparisonNote
      ? `\nChange since the previous snapshot:\n${clamp(ctx.comparisonNote, 900)}`
      : "")
  );
}

export function buildReportPrompt(ctx: ReportContext, userPrompt: string): ReportPrompt {
  const cleanUserPrompt = clamp(userPrompt.trim(), 800);

  // v2 framing: put the user's question FIRST so Davis sees it as the
  // primary input, then offer the assessment data as supporting context.
  // The previous v1 wrapped the user prompt in quotes ("can you help me
  // with the following request: '...'") which tripped GUARDRAIL_CHECK
  // because Davis read it as a meta-task. Direct question works.
  const text =
    `${cleanUserPrompt}\n\n` +
    `Context: ${buildAssessmentContext(ctx)}\n\n` +
    `Please ground your answer in this assessment data and in the Dynatrace ` +
    `documentation. When you mention a check, refer to it by the exact name ` +
    `shown above — never invent or rename what it measures, and never use an ` +
    `internal code.`;

  // No supplementary — everything in the question. Empty string ⇒ omitted
  // from the SDK context array by the caller.
  const supplementary = "";

  const instruction =
    `Write in a clear, friendly, professional tone — approachable but precise, ` +
    `like an experienced SE writing for a colleague or customer. Reply in plain ` +
    `markdown with headings (## or ###) for major sections, short paragraphs, and ` +
    `lists where they aid scanning.\n\n` +
    `Naming (important):\n` +
    `- Refer to every check by its plain-English name exactly as written above ` +
    `(e.g. "Cloud region enrichment"). NEVER use internal codes like "i15", "a3", ` +
    `or the words "criterion ID" — the reader does not know those codes and they ` +
    `read as cryptic.\n` +
    `- Never guess or rename what a check measures. If a name says "Cloud region ` +
    `enrichment", do not call it "network monitoring".\n` +
    `- Do not invent Dynatrace features, settings, or URLs. If unsure a setting ` +
    `exists, describe the goal instead of naming a fake control.\n\n` +
    `Make every recommendation concrete and illustrated:\n` +
    `- Give a specific, real example of HOW to do it in Dynatrace — e.g. "In ` +
    `Settings > Cloud and virtualization > AWS, add the connection so logs carry ` +
    `the cloud.region attribute". Name the actual UI path, integration, or attribute.\n` +
    `- State the expected outcome in plain numbers (e.g. "this should lift ` +
    `Infrastructure coverage by about 4% and move it from L1 to L2").\n` +
    `- Prefer worked examples over abstract advice.\n\n` +
    `Avoid code fences and emoji. Aim for a complete answer — do not truncate. ` +
    `If the user's request implies a specific length or format (executive summary, ` +
    `talking points, action plan), honor that.`;

  return { text, supplementary, instruction };
}
