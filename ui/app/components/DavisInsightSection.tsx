// ui/app/components/DavisInsightSection.tsx
//
// Renders a Davis CoPilot recommendation for one capability inside the
// expanded capability card. Sits BELOW the static CRITERION_ACTIONS
// recommendations so a customer who has Davis CoPilot disabled still sees
// useful advice.
//
// States ─────────────────────────────────────────────────────────────────
//   loading  → Skeleton rows
//   success  → markdown body + provenance footer (Davis CoPilot badge,
//              "AI-generated" disclaimer, optional "from cache" indicator)
//   error    → discreet single-line note, no scary red
//   skipped  → renders nothing (capability scored 100%, no recommendation
//              was requested)
//
// Rendering ──────────────────────────────────────────────────────────────
// Davis returns markdown. We render a SAFE subset (headings, lists, bold,
// inline code, line breaks). No raw HTML, no link execution surprises.
// Strato's <Text> and <Flex> handle theme adaptation automatically.

import React, { useState } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { Skeleton, SkeletonText } from "@dynatrace/strato-components/content";
import type { DavisRecommendationState } from "../hooks/useDavisRecommendations";

interface Props {
  state: DavisRecommendationState | undefined;
  capabilityName: string;
  /** Optional follow-up sender from the useDavisRecommendations hook. When
   *  provided, the component renders an input box so the user can ask
   *  Davis clarifying questions. When omitted, only the initial response
   *  shows (used for snapshot views or read-only contexts). */
  onSendFollowUp?: (capabilityName: string, text: string) => Promise<void>;
  /** Optional on-demand insight trigger. When provided AND state.status is
   *  "idle", the component renders a "Generate AI insight" button that
   *  fires the initial Davis call for this capability. */
  onRequestInsight?: (capabilityName: string) => Promise<void>;
}

/** Tiny markdown renderer — handles `**bold**`, `` `code` ``, `# heading`,
 *  `## subheading`, ordered/unordered lists, and blank-line paragraph
 *  breaks. No links (Davis output sometimes invents URLs; we suppress them
 *  to avoid sending users to 404s). */
export function renderMarkdown(md: string, textColor: string, accentColor: string): React.ReactNode {
  // Strip any HTML tags defensively — we never want raw HTML execution.
  const safe = md.replace(/<[^>]*>/g, "");
  const lines = safe.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let listType: "ol" | "ul" | null = null;

  const flushList = () => {
    if (listBuf.length === 0) return;
    const isOl = listType === "ol";
    out.push(
      <Flex key={`list-${out.length}`} flexDirection="column" gap={4}
            style={{ marginLeft: 12, marginTop: 4, marginBottom: 4 }}>
        {listBuf.map((item, i) => (
          <Flex key={i} flexDirection="row" gap={6} alignItems="flex-start">
            <Text style={{ fontSize: 12, color: accentColor, fontWeight: 600, minWidth: 18 }}>
              {isOl ? `${i + 1}.` : "•"}
            </Text>
            <Text style={{ fontSize: 12, lineHeight: 1.55, color: textColor }}>
              {renderInline(item, textColor, accentColor)}
            </Text>
          </Flex>
        ))}
      </Flex>
    );
    listBuf = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flushList();
      continue;
    }
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const h1Match = line.match(/^#\s+(.*)$/);
    const h2Match = line.match(/^##\s+(.*)$/);
    const h3Match = line.match(/^###\s+(.*)$/);
    if (h1Match || h2Match || h3Match) {
      flushList();
      const header = (h1Match || h2Match || h3Match)![1];
      const size = h1Match ? 14 : h2Match ? 13 : 12;
      out.push(
        <Text key={out.length} style={{
          fontSize: size, fontWeight: 700, color: textColor,
          marginTop: 6, marginBottom: 2,
        }}>
          {renderInline(header, textColor, accentColor)}
        </Text>
      );
      continue;
    }
    if (olMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuf.push(olMatch[2]);
      continue;
    }
    if (ulMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuf.push(ulMatch[1]);
      continue;
    }
    flushList();
    out.push(
      <Text key={out.length} style={{
        fontSize: 12, lineHeight: 1.55, color: textColor, marginBottom: 2,
      }}>
        {renderInline(line, textColor, accentColor)}
      </Text>
    );
  }
  flushList();
  return out;
}

/** Render inline tokens (bold, code) inside a single line. */
function renderInline(text: string, textColor: string, accentColor: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let i = 0;
  let buf = "";
  const flush = () => { if (buf) { parts.push(buf); buf = ""; } };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > -1) {
        flush();
        parts.push(<Strong key={parts.length} style={{ color: textColor }}>{text.slice(i + 2, end)}</Strong>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > -1) {
        flush();
        parts.push(
          <span key={parts.length} style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11, padding: "1px 4px", borderRadius: 3,
            color: accentColor,
            background: accentColor + "12",
          }}>{text.slice(i + 1, end)}</span>
        );
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return parts;
}

export const DavisInsightSection: React.FC<Props> = ({ state, capabilityName, onSendFollowUp, onRequestInsight }) => {
  const dk = useCurrentTheme() === "dark";
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(true);

  if (!state || state.status === "skipped") return null;

  const textColor = Colors.Text.Neutral.Default;
  const subColor = Colors.Text.Neutral.Subdued;
  const accentColor = Colors.Text.Primary.Default;
  const borderColor = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const bgColor = dk ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.04)";

  // ── Header (always shown for non-skipped states) ──
  const Header = (
    <Flex flexDirection="row" alignItems="center" gap={8} style={{ marginBottom: open ? 6 : 0 }}>
      <Text style={{
        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 0.5, color: accentColor,
      }}>
        AI Insight
      </Text>
      <Text style={{
        fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
        background: accentColor + "15", color: accentColor,
      }}>
        Davis CoPilot
      </Text>
      <Text style={{ fontSize: 11, fontWeight: 700, color: accentColor, marginLeft: "auto" }}>
        {open ? "▾" : "▸"}
      </Text>
    </Flex>
  );

  // Clicking the panel folds the insight away instead of collapsing the whole
  // capability card underneath it — the card owns a click handler that would
  // otherwise swallow everything here. Clicks that land on a control, or that
  // finish a text selection, are left alone.
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = e.target as HTMLElement | null;
    // The panel itself carries role="button", so only a control *inside* it
    // should suppress the toggle.
    const control = el?.closest?.("button, input, textarea, a, select, [role='button']");
    if (control && control !== e.currentTarget) return;
    if ((window.getSelection()?.toString() ?? "") !== "") return;
    setOpen(o => !o);
  };

  return (
    <Flex flexDirection="column"
      onClick={toggle}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`AI insight for ${capabilityName}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); }
      }}
      style={{
        marginTop: 8, padding: "8px 10px", borderRadius: 6,
        border: `1px solid ${borderColor}`, background: bgColor,
        cursor: "pointer",
      }}>
      {Header}
      {!open && (
        <Text style={{ fontSize: 11, color: subColor, fontStyle: "italic" }}>
          {state.status === "loading" ? "Generating..." : "Click to reopen"}
        </Text>
      )}
      {open && (<>

      {/* Idle state — no Davis call attempted yet. Render a CTA button
          so the user explicitly opts in (and spends quota) only when
          they actually want a recommendation. */}
      {state.status === "idle" && (
        <Flex flexDirection="row" alignItems="center" gap={8}
          style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: subColor, flex: 1 }}>
            Generate an AI-powered recommendation grounded in this capability's
            failing criteria and Dynatrace documentation.
          </Text>
          {onRequestInsight && (
            <Button
              size="condensed"
              variant="emphasized"
              color="primary"
              onClick={(e) => {
                e?.stopPropagation?.();
                void onRequestInsight(capabilityName);
              }}
            >
              Generate insight
            </Button>
          )}
        </Flex>
      )}

      {/* Conversation thread — initial response + any follow-ups.
          Each turn alternates: assistant → user → assistant → ... */}
      {state.conversation.length > 0 && (
        <Flex flexDirection="column" gap={8} style={{ marginTop: 2 }}>
          {state.conversation.map((turn, i) => {
            const isAssistant = turn.role === "assistant";
            return (
              <Flex key={i} flexDirection="column"
                style={{
                  // User turns are subtly offset and tinted to distinguish
                  // from Davis's responses.
                  marginLeft: isAssistant ? 0 : 16,
                  paddingLeft: isAssistant ? 0 : 10,
                  borderLeft: isAssistant ? undefined : `2px solid ${accentColor}66`,
                }}>
                {!isAssistant && (
                  <Text style={{
                    fontSize: 10, fontWeight: 700, color: accentColor,
                    textTransform: "uppercase", letterSpacing: 0.5,
                    marginBottom: 2,
                  }}>
                    You asked
                  </Text>
                )}
                <Flex flexDirection="column" gap={2}>
                  {renderMarkdown(turn.text, textColor, accentColor)}
                </Flex>
              </Flex>
            );
          })}
        </Flex>
      )}

      {/* Loading skeleton — shown when initial fan-out is mid-flight OR a
          follow-up is being generated. */}
      {state.status === "loading" && (
        <Flex flexDirection="column" gap={4}
          style={{ marginTop: state.conversation.length > 0 ? 8 : 2 }}>
          <Skeleton height={10} width="60%" />
          <SkeletonText lines={state.conversation.length > 0 ? 2 : 3} />
        </Flex>
      )}

      {/* Error notice — surfaces the actual HTTP status, raw message, and
          an SE-actionable hint so the user can fix the cause without
          opening DevTools. */}
      {state.status === "error" && (
        <Flex flexDirection="column" gap={4}
          style={{ marginTop: state.conversation.length > 0 ? 6 : 2 }}>
          <Text style={{
            fontSize: 11, fontWeight: 700,
            color: Colors.Text.Critical.Default,
          }}>
            {state.errorDetail?.status
              ? `Davis CoPilot error (HTTP ${state.errorDetail.status})`
              : "Davis CoPilot unavailable"}
          </Text>
          {state.errorDetail?.message && (
            <Text style={{
              fontSize: 11, color: textColor,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              padding: "4px 6px", borderRadius: 3,
              background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
              wordBreak: "break-word",
            }}>
              {state.errorDetail.message}
            </Text>
          )}
          {state.errorDetail?.hint && (
            <Text style={{ fontSize: 11, color: subColor, lineHeight: 1.5 }}>
              {state.errorDetail.hint}
            </Text>
          )}
          {!state.errorDetail && state.conversation.length === 0 && (
            <Text style={{ fontSize: 11, color: subColor, fontStyle: "italic" }}>
              The static recommendation above still applies.
            </Text>
          )}
        </Flex>
      )}

      {/* Footer: provenance + follow-up input. Footer renders only after
          the initial response has arrived (state.rec is set). */}
      {state.rec && (
        <Flex flexDirection="column" style={{
          marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${borderColor}`,
        }}>
          <Flex flexDirection="row" alignItems="center" justifyContent="space-between"
            style={{ marginBottom: onSendFollowUp ? 6 : 0 }}>
            <Text style={{ fontSize: 10, color: subColor, fontStyle: "italic" }}>
              AI-generated · may contain inaccuracies · verify before acting
            </Text>
            {state.rec.fromCache && state.conversation.length === 1 && (
              <Text style={{ fontSize: 10, color: subColor }}>
                cached
              </Text>
            )}
          </Flex>

          {/* Follow-up input — only when caller wired onSendFollowUp.
              Submits on Enter or button click. Disabled while loading. */}
          {onSendFollowUp && (
            <Flex flexDirection="row" gap={6} alignItems="center">
              <input
                type="text"
                value={draft}
                placeholder="Ask Davis a follow-up question..."
                disabled={state.status === "loading"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Stop ALL keystrokes from bubbling up — the parent
                  // capability card listens for Enter/Space to toggle
                  // expansion (accessibility pattern), which would collapse
                  // the card mid-typing. We submit on Enter ourselves.
                  e.stopPropagation();
                  if (e.key === "Enter" && draft.trim() && state.status !== "loading") {
                    const txt = draft;
                    setDraft("");
                    void onSendFollowUp(capabilityName, txt);
                  }
                }}
                onKeyUp={(e) => e.stopPropagation()}
                onKeyPress={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: `1px solid ${borderColor}`,
                  background: dk ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.6)",
                  color: textColor,
                  fontFamily: "inherit",
                  outline: "none",
                }}
                aria-label={`Ask Davis a follow-up about ${capabilityName}`}
              />
              <Button
                size="condensed"
                disabled={!draft.trim() || state.status === "loading"}
                onClick={(e) => {
                  e?.stopPropagation?.();
                  const txt = draft;
                  setDraft("");
                  void onSendFollowUp(capabilityName, txt);
                }}
              >
                Ask
              </Button>
            </Flex>
          )}
        </Flex>
      )}
      </>)}
    </Flex>
  );
};
DavisInsightSection.displayName = "DavisInsightSection";
