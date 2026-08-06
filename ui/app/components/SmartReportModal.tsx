// ui/app/components/SmartReportModal.tsx
//
// Smart Report — the user describes the report they need in their own
// words; Davis CoPilot (Dynatrace Assist) writes it grounded in the live
// assessment. Two outputs:
//   - "Open in Assist": native intent — the answer appears in the
//     Dynatrace Assist panel, conversation stays interactive.
//   - "Generate PDF": Davis CoPilot SDK call; the markdown answer is
//     rendered into the app's PDF shell with an AI disclosure.
//
// Shipped to production in v2.5.6. No Davis call fires until the user
// submits a request, so simply opening the modal spends no quota.

import React, { useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { openDynatraceAssist } from "../ai/assistIntent";
import { generateSmartReportText, SMART_REPORT_SUGGESTIONS } from "../ai/smartReport";
import type { ReportContext } from "../ai/reportPrompt";
import { generateAiNarrativePdf } from "../reports/aiNarrativePdf";
import type { DavisError } from "../ai/davisRecommendations";

interface SmartReportModalProps {
  open: boolean;
  onClose: () => void;
  ctx: ReportContext;
  dk: boolean;
}

export const SmartReportModal: React.FC<SmartReportModalProps> = ({ open, onClose, ctx, dk }) => {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DavisError | null>(null);

  const accent = Colors.Text.Primary.Default;
  const border = Colors.Border.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  const effectiveAsk = ask.trim() || SMART_REPORT_SUGGESTIONS[0].ask;

  const openInAssist = () => {
    setError(null);
    // Intents only work when the app runs embedded in the Dynatrace shell.
    // On the local dev server the platform rejects them ("detached mode"),
    // so surface that instead of closing on a silent failure.
    const err = openDynatraceAssist({ prompt: effectiveAsk, ctx, execute: true });
    if (err) {
      setError({ status: 0, message: err.message, hint: err.hint });
      return;
    }
    onClose();
  };

  const generatePdf = async () => {
    setBusy(true);
    setError(null);
    const result = await generateSmartReportText(ctx, effectiveAsk);
    setBusy(false);
    if (!result.ok) {
      setError(result.err);
      return;
    }
    generateAiNarrativePdf(result.markdown, {
      title: "Smart Report",
      tenant: ctx.tenant,
      date: ctx.date,
      coverage: ctx.overallCoverage,
      utilization: ctx.overallUtilization,
      ask: effectiveAsk,
    });
    onClose();
  };

  return (
    <Modal show={open} onDismiss={() => { if (!busy) onClose(); }} title="Smart report — Dynatrace Assist" size="small">
      <Flex flexDirection="column" gap={12} style={{ minWidth: 520, maxWidth: 640 }}>
        <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
          Describe the report you need — Davis CoPilot writes it grounded in this
          assessment. Phrase it as a question (What / How / Which) for best results.
        </Text>

        <Flex gap={6} flexWrap="wrap">
          {SMART_REPORT_SUGGESTIONS.map(s => (
            <Flex
              key={s.label}
              role="button" tabIndex={0}
              onClick={() => setAsk(s.ask)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setAsk(s.ask); } }}
              style={{
                padding: "3px 10px", borderRadius: 12, cursor: "pointer", fontSize: 12,
                border: `1px solid ${ask === s.ask ? accent : border}`,
                color: ask === s.ask ? accent : textSec,
                background: ask === s.ask ? (dk ? "rgba(99,102,241,0.14)" : "rgba(99,102,241,0.08)") : "transparent",
                fontWeight: ask === s.ask ? 700 : 500,
                userSelect: "none",
              }}
            >
              {s.label}
            </Flex>
          ))}
        </Flex>

        <textarea
          value={ask}
          rows={4}
          placeholder={SMART_REPORT_SUGGESTIONS[0].ask}
          onChange={e => setAsk(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
          style={{
            padding: "8px 10px", borderRadius: 6, fontSize: 13, lineHeight: 1.5,
            border: `1px solid ${border}`, outline: "none", resize: "vertical",
            background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
            color: "inherit", fontFamily: "inherit",
          }}
        />

        {error && (
          <Flex flexDirection="column" gap={4} style={{
            padding: "8px 12px", borderRadius: 6,
            border: `1px solid ${Colors.Border.Critical.Default}`,
            background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
          }}>
            <Text style={{ fontSize: 12, color: Colors.Text.Critical.Default }}>
              <Strong>Davis CoPilot:</Strong> {error.message}
            </Text>
            {error.hint && <Text style={{ fontSize: 11, color: textSec }}>{error.hint}</Text>}
          </Flex>
        )}

        <Flex justifyContent="space-between" alignItems="center" gap={8} style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 10, color: textSec }}>
            AI-generated content — review before sharing.
          </Text>
          <Flex gap={8}>
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={openInAssist} disabled={busy} color="primary">
              Open in Assist
            </Button>
            <Button onClick={generatePdf} loading={busy} variant="emphasized" color="primary">
              Generate PDF
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Modal>
  );
};
