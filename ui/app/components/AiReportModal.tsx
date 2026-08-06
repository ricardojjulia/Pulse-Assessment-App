// ui/app/components/AiReportModal.tsx
//
// Assist launcher — native Dynatrace Intelligence conversation starters.
//
// This is NOT an embedded chat. Following the official "Conversation
// starters" guide (Develop > Guides > Dynatrace Intelligence), every
// action here fires an intent to the native Dynatrace Assist app
// (dynatrace.davis.copilot / ask-question). The platform opens the Assist
// modal with our prompt prefilled and the full assessment attached as
// hidden supplementary context. Follow-ups, history, guardrails, and the
// upcoming agentic mode are all handled by the native surface.
//
// Layout:
//   Header      Dynatrace Intelligence identity + tenant context
//   Ask box     free-text question → opens Assist (auto-executes)
//   Starters    page-contextual suggestions (insights/tips/priorities)
//   Teams       dynamic reports per audience (leadership/SRE/security/…)
//
// Availability: per the guide, triggers only render when
// listAvailableSkills() includes the "conversation" skill.

import React, { useState } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { DynatraceIntelligenceSignetIcon, ArrowUpIcon } from "@dynatrace/strato-icons";
import type { ReportContext } from "../ai/reportPrompt";
import { openDynatraceAssist, useConversationSkillAvailable } from "../ai/assistIntent";
// (intent errors are rendered inline — see intentError below)
import { PAGE_STARTERS, TEAM_REPORTS, type AssistPage, type StarterGroup } from "../ai/conversationStarters";

interface Props {
  show: boolean;
  onDismiss: () => void;
  ctx: ReportContext;
  /** Which screen opened Assist — drives the page-contextual conversation
   *  starters. Defaults to "coverage". */
  page?: AssistPage;
}

export const AiReportModal: React.FC<Props> = ({ show, onDismiss, ctx, page = "coverage" }) => {
  const dk = useCurrentTheme() === "dark";
  const [draft, setDraft] = useState("");
  const [intentError, setIntentError] = useState<{ message: string; hint: string } | null>(null);

  const textColor = Colors.Text.Neutral.Default;
  const subColor = Colors.Text.Neutral.Subdued;
  const borderColor = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";

  // Guide rule: only show conversation starter triggers when the
  // conversation skill is actually available to this user on this tenant.
  const available = useConversationSkillAvailable(show);

  const close = () => {
    onDismiss();
    setTimeout(() => setDraft(""), 250);
  };

  /** Launch the native Assist and close this launcher. Starters open with
   *  execute:false so the user can review/edit the prefilled prompt in the
   *  native UI; typed questions auto-execute (the user wrote them). */
  const launch = (prompt: string, execute: boolean) => {
    // Intents need the app embedded in the Dynatrace shell; on the local
    // dev server they are rejected ("detached mode"). Show why instead of
    // closing as if it had worked.
    const err = openDynatraceAssist({ prompt, ctx, execute });
    if (err) { setIntentError(err); return; }
    close();
  };

  const send = () => {
    const q = draft.trim();
    if (!q) return;
    launch(q, true);
  };

  const pageGroups: StarterGroup[] = PAGE_STARTERS[page] ?? PAGE_STARTERS.coverage;

  const renderStarterGroups = (groups: StarterGroup[]) => groups.map(group => (
    <Flex key={group.category} flexDirection="column" gap={4}>
      <Text style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        textTransform: "uppercase", color: subColor,
      }}>
        {group.category}
      </Text>
      <Flex flexDirection="row" gap={6} flexWrap="wrap">
        {group.starters.map(s => (
          <Button key={s.title} size="condensed" onClick={() => launch(s.body, false)}>
            {s.title}
          </Button>
        ))}
      </Flex>
    </Flex>
  ));

  return (
    <Modal show={show} onDismiss={close} title="Assist" size="large">
      <Flex flexDirection="column" gap={16} style={{ minWidth: 620, maxWidth: 860 }}>

        {/* Intent dispatch failure — most often the local dev server, which
            hosts the app detached from the Dynatrace shell. */}
        {intentError && (
          <Flex flexDirection="column" gap={4} style={{
            padding: "8px 12px", borderRadius: 6,
            border: `1px solid ${Colors.Border.Critical.Default}`,
            background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
          }}>
            <Text style={{ fontSize: 12, color: Colors.Text.Critical.Default }}>
              <Strong>Assist:</Strong> {intentError.message}
            </Text>
            <Text style={{ fontSize: 11, color: subColor }}>{intentError.hint}</Text>
          </Flex>
        )}

        {/* ── Header: Dynatrace Intelligence identity + context ── */}
        <Flex flexDirection="row" alignItems="center" gap={8}
          style={{ paddingBottom: 10, borderBottom: `1px solid ${borderColor}` }}>
          <DynatraceIntelligenceSignetIcon size="large" />
          <Flex flexDirection="column">
            <Text style={{ fontSize: 13, fontWeight: 700, color: textColor }}>
              Dynatrace Intelligence
            </Text>
            <Text style={{ fontSize: 11, color: subColor }}>
              Tenant <Strong style={{ color: textColor }}>{ctx.tenant}</Strong> ·{" "}
              {ctx.overallCoverage}% coverage · {ctx.overallUtilization}/100 utilization
            </Text>
          </Flex>
        </Flex>

        {/* ── Availability states (guide: gate on the conversation skill) ── */}
        {available === null && (
          <Text style={{ fontSize: 12, color: subColor }}>
            Checking Dynatrace Assist availability…
          </Text>
        )}
        {available === false && (
          <Flex flexDirection="column" gap={4} style={{
            padding: 12, borderRadius: 8,
            border: `1px solid ${Colors.Text.Critical.Default}33`,
            background: dk ? "rgba(229,57,53,0.06)" : "rgba(229,57,53,0.04)",
          }}>
            <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Critical.Default }}>
              Dynatrace Assist is not available
            </Text>
            <Text style={{ fontSize: 11, color: subColor, lineHeight: 1.5 }}>
              The conversation skill is disabled on this tenant or you lack the
              required permissions. Ask an admin to enable Gen AI features in
              Settings, then reopen this panel.
            </Text>
          </Flex>
        )}

        {available === true && (
          <>
            {/* ── Ask box: free question → native Assist, auto-executed ── */}
            <Flex flexDirection="column" gap={6}>
              <Text style={{ fontSize: 13, fontWeight: 700, color: textColor }}>
                Ask about this assessment
              </Text>
              <Flex flexDirection="row" gap={8} alignItems="center">
                <input
                  type="text"
                  value={draft}
                  placeholder="e.g. Which 3 gaps should I fix first and why?"
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") send(); }}
                  onKeyUp={(e) => e.stopPropagation()}
                  style={{
                    flex: 1, padding: "10px 14px", fontSize: 13, borderRadius: 20,
                    border: `1px solid ${borderColor}`,
                    background: dk ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.85)",
                    color: textColor, fontFamily: "inherit", outline: "none",
                  }}
                  aria-label="Ask Dynatrace Assist about this assessment"
                />
                <Button
                  variant="emphasized" color="primary"
                  disabled={!draft.trim()}
                  onClick={send}
                  aria-label="Open in Dynatrace Assist"
                >
                  <Button.Prefix><ArrowUpIcon /></Button.Prefix>
                  Ask
                </Button>
              </Flex>
              <Text style={{ fontSize: 10, color: subColor }}>
                Opens the Dynatrace Assist conversation with your assessment data
                attached as context.
              </Text>
            </Flex>

            {/* ── Page-contextual starters ── */}
            <Flex flexDirection="column" gap={8}
              style={{ paddingTop: 12, borderTop: `1px solid ${borderColor}` }}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: textColor }}>
                Suggested for this page
              </Text>
              {renderStarterGroups(pageGroups)}
            </Flex>

            {/* ── Team-oriented dynamic reports ── */}
            <Flex flexDirection="column" gap={8}
              style={{ paddingTop: 12, borderTop: `1px solid ${borderColor}` }}>
              <Text style={{ fontSize: 11, fontWeight: 700, color: textColor }}>
                Generate a report for a team
              </Text>
              {renderStarterGroups(TEAM_REPORTS)}
            </Flex>
          </>
        )}

        {/* Footer */}
        <Flex flexDirection="row" justifyContent="space-between" alignItems="center"
          style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${borderColor}` }}>
          <Text style={{ fontSize: 10, color: subColor, fontStyle: "italic" }}>
            Conversations run in Dynatrace Assist · AI-generated · verify before acting
          </Text>
          <Button onClick={close}>Close</Button>
        </Flex>
      </Flex>
    </Modal>
  );
};
AiReportModal.displayName = "AiReportModal";
