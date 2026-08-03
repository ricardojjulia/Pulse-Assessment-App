import React, { useState } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { ExternalLink } from "@dynatrace/strato-components/typography";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { CopyableQuery } from "./CopyableQuery";
import { Tooltip } from "./Tooltip";

function isTextSelection(): boolean {
  const sel = window.getSelection();
  return !!(sel && sel.toString().length > 0);
}
import type { CapabilityResult } from "../hooks/useCoverageData";
import { maturity } from "./TechRadar";
import { CRITERION_ACTIONS } from "../remediationActions";
import { CRITERION_IMPORTANCE } from "../data/criterionImportance";
import { CAP_SUMMARIES } from "../data/capSummaries";

function formatCriterionValue(value: number, isRatio: boolean): string {
  if (!Number.isFinite(value)) return isRatio ? "0%" : "0";
  if (isRatio) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

interface Props {
  capabilities: CapabilityResult[];
  anim: number;
  activeIdx: number | null;
  onSelect: (idx: number | null) => void;
}

const CriterionRow: React.FC<{ cr: CapabilityResult["criteriaResults"][0]; dk: boolean }> = ({ cr, dk }) => {
  const [open, setOpen] = useState(false);
  const displayValue = formatCriterionValue(cr.value, cr.isRatio);

  return (
    <Flex flexDirection="column"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${cr.label}: ${cr.error ? "Error" : cr.notApplicable ? "Not applicable" : cr.points > 0 ? "Passed" : "Not met"}`}
      style={{ borderRadius: 4, cursor: "pointer", transition: "background 0.15s",
        background: "transparent",
      }}
      onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setOpen(!open); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setOpen(!open); } }}
    >
      <Flex flexDirection="row" justifyContent="space-between" alignItems="center"
        style={{
        fontSize: 12, padding: "4px 6px",
        color: cr.error ? Colors.Text.Critical.Default : Colors.Text.Neutral.Subdued,
      }}>
        <Tooltip text={
          <Flex flexDirection="column">
            <Text style={{ lineHeight: 1.6, marginBottom: CRITERION_IMPORTANCE[cr.id] ? 8 : 0 }}>{cr.description}</Text>
            {CRITERION_IMPORTANCE[cr.id] && <Text style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>{CRITERION_IMPORTANCE[cr.id].split(". ")[0]}.</Text>}
            <Text style={{ fontSize: 11, opacity: 0.6, marginTop: 5 }}>Click to expand details</Text>
          </Flex>
        } maxWidth={320} containerStyle={{ flex: 1 }}>
          <Text>{cr.label}</Text>
        </Tooltip>
        <Text style={{
          fontWeight: 600,
          color: cr.error ? Colors.Text.Critical.Default : cr.notApplicable ? Colors.Text.Neutral.Disabled : cr.points > 0 ? Colors.Text.Success.Default : Colors.Text.Neutral.Disabled,
        }}>
          {cr.error ? "ERR" : cr.notApplicable ? "N/A" : cr.points > 0 ? `${displayValue} → ✓` : `${displayValue} → ✗`}
        </Text>
      </Flex>
      {open && (
        <Flex flexDirection="column" style={{
          padding: "6px 12px 8px", fontSize: 12, lineHeight: 1.6,
          borderLeft: `2px solid ${Colors.Border.Neutral.Default}`,
          marginLeft: 6, marginBottom: 6,
          color: Colors.Text.Neutral.Subdued,
        }}>
          <Text style={{ fontStyle: "italic", marginBottom: 3, color: Colors.Text.Neutral.Default }}>
            {cr.description}
          </Text>
          <Flex flexDirection="column">
            <CopyableQuery query={cr.query} dk={dk} inline />
          </Flex>
          <Flex flexDirection="column">
            <Text style={{ color: Colors.Text.Neutral.Disabled }}>Pass threshold: </Text>
            <Text>{cr.thresholds}</Text>
          </Flex>
          <Text style={{ fontWeight: 600, color: cr.error ? Colors.Text.Critical.Default : cr.notApplicable ? Colors.Text.Neutral.Disabled : Colors.Text.Success.Default }}>
            {cr.error ? "Query failed" : cr.notApplicable ? "Not applicable for this tenant" : cr.points > 0 ? `${displayValue} → ✓ Met` : `${displayValue} → ✗ Not met`}
          </Text>
          {(() => {
            const rem = CRITERION_ACTIONS[cr.id];
            if (!rem || cr.notApplicable) return null;
            return (
              <Flex flexDirection="column" style={{
                marginTop: 6, paddingTop: 6,
                borderTop: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
              }}>
                <Flex flexDirection="row" alignItems="center" gap={8} style={{ marginBottom: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: Colors.Text.Primary.Default }}>
                    Recommendation
                  </Text>
                  <Text style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: cr.points > 0
                      ? (dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.10)")
                      : (dk ? "rgba(229,57,53,0.12)" : "rgba(229,57,53,0.10)"),
                    color: cr.points > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default,
                    border: `1px solid ${cr.points > 0 ? "rgba(0,200,83,0.3)" : "rgba(229,57,53,0.3)"}`,
                  }}>
                    {cr.points > 0 ? "✓ Applied" : "✗ Not applied"}
                  </Text>
                </Flex>
                <Text style={{ fontSize: 12, lineHeight: 1.5, color: Colors.Text.Neutral.Default }}>
                  {rem.action}
                </Text>
                <ExternalLink
                  href={rem.docUrl}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 }}
                >
                  📖 {rem.docLabel} →
                </ExternalLink>
              </Flex>
            );
          })()}
        </Flex>
      )}
    </Flex>
  );
};

export const CapabilityCards: React.FC<Props> = React.memo(({ capabilities, anim, activeIdx, onSelect }) => {
  const dk = useCurrentTheme() === "dark";

  return (
    <Flex flexDirection="column" gap={6}>
      {capabilities.map((cap, i) => {
        const ml = maturity(cap.score);
        const act = activeIdx === i;
        return (
          <Flex key={i} flexDirection="column" data-cap-idx={i}
            role="button"
            tabIndex={0}
            aria-expanded={act}
            aria-label={`${cap.name}: ${Math.round(cap.score * anim)}% — ${ml.label}`}
            onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; onSelect(act ? null : i); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(act ? null : i); } }}
            style={{
              padding: "10px 16px", borderRadius: 10, cursor: "pointer",
              transition: "all 0.3s ease",
              border: act ? `2px solid ${cap.color}` : `1px solid ${Colors.Border.Neutral.Default}`,
              borderLeft: cap.consolidation < 100 && !act ? `3px solid ${Colors.Charts.Status.Warning.Default}` : undefined,
              background: Colors.Background.Surface.Default,
              boxShadow: "none",
              opacity: activeIdx !== null && !act ? 0.35 : 1,
            }}>
            <Flex flexDirection="row" alignItems="center" justifyContent="space-between" style={{ marginBottom: 6 }}>
              <Flex flexDirection="row" alignItems="center" gap={8}>
                <Flex flexDirection="column" style={{
                  width: 10, height: 10, borderRadius: "50%", background: cap.color,
                  boxShadow: act ? `0 0 10px ${cap.color}70` : "none",
                }} />
                <Text style={{ fontSize: 14, fontWeight: act ? 700 : 500, color: Colors.Text.Neutral.Default }}>
                    {cap.name}
                  </Text>
              </Flex>
              <Flex flexDirection="row" alignItems="center" gap={6}>
                <Text style={{ fontSize: 16, fontWeight: 700, color: cap.color, fontFamily: "system-ui, sans-serif" }}>
                  {Math.round(cap.score * anim)}%
                </Text>
                {cap.consolidation < 100 && cap.rawScore > 0 && (
                  <Flex alignItems="center" gap={4} style={{
                    padding: "2px 8px", borderRadius: 6,
                    background: cap.consolidation === 0
                      ? (dk ? "rgba(255,100,80,0.12)" : "rgba(255,100,80,0.08)")
                      : (dk ? "rgba(255,170,50,0.10)" : "rgba(255,170,50,0.06)"),
                    border: `1px solid ${cap.consolidation === 0
                      ? (dk ? "rgba(255,100,80,0.3)" : "rgba(255,100,80,0.2)")
                      : (dk ? "rgba(255,170,50,0.25)" : "rgba(255,170,50,0.18)")}`,
                  }}>
                    <Text style={{
                      fontSize: 10, fontWeight: 700,
                      color: cap.consolidation === 0 ? Colors.Text.Critical.Default : Colors.Charts.Status.Warning.Default,
                    }}>{cap.consolidation === 0 ? "Discovery:" : "DT:"} {cap.rawScore}%</Text>
                  </Flex>
                )}
                <Text style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 6,
                  background: ml.color + (dk ? "25" : "18"), color: ml.color, fontWeight: 600,
                }}>{ml.label}</Text>
              </Flex>
            </Flex>
            <Flex flexDirection="column" style={{ height: 4, borderRadius: 3, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <Flex flexDirection="column" style={{
                height: "100%", borderRadius: 3, background: cap.color,
                width: `${cap.score * anim}%`, transition: "width 1.4s cubic-bezier(0.4,0,0.2,1)",
                opacity: act ? 0.9 : 0.55,
              }} />
            </Flex>
            {act && (
              <Flex flexDirection="column" style={{ marginTop: 6 }}>
                {cap.criteriaResults.map((cr) => (
                  <CriterionRow key={cr.id} cr={cr} dk={dk} />
                ))}
              </Flex>
            )}
          </Flex>
        );
      })}
    </Flex>
  );
});
