import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { ExternalLink, Text } from "@dynatrace/strato-components/typography";
import { Flex, Grid, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Tooltip } from "../components/Tooltip";
import { ExpandableChartModal, ExpandChartButton } from "../components/ExpandableChartModal";
import { CovUtilRadar } from "../components/CovUtilRadar";
import { CRITERION_ACTIONS } from "../remediationActions";
import { CRITERION_TIERS } from "../data/criterionTiers";
import { CAPABILITIES } from "../queries";
import type { AssessmentSnapshot } from "../hooks/useAssessmentHistory";
import type { CapabilityResult } from "../hooks/useCoverageData";
import { FOUNDATION_WEIGHT, BEST_PRACTICE_WEIGHT, EXCELLENCE_WEIGHT } from "../hooks/useCoverageData";
import { SegmentedControl } from "../components/SegmentedControl";

/** Lookup: criterion ID → true if it uses cross-entity ratio (queryB). Derived from static CAPABILITIES definition. */
const IS_RATIO_MAP: Record<string, boolean> = {};
for (const cap of CAPABILITIES) for (const cr of cap.criteria) if (cr.queryB) IS_RATIO_MAP[cr.id] = true;

interface CritDiff {
  id: string;
  label: string;
  currValue: number;
  prevValue: number;
  currPoints: number;
  prevPoints: number;
  pointsDelta: number;
  currError: boolean;
  prevError: boolean;
  isRatio: boolean;
}

interface CapDiff {
  name: string;
  color: string;
  currScore: number;
  prevScore: number;
  delta: number;
  currUtilization: number;
  prevUtilization: number;
  utilizationDelta: number;
  currConsolidation: number;
  prevConsolidation: number;
  critDiffs: CritDiff[];
  improved: CritDiff[];
  degraded: CritDiff[];
  unchanged: CritDiff[];
}

interface Props {
  snapshots: AssessmentSnapshot[];
  saveSnapshot: (capabilities: CapabilityResult[], totalScore: number, tenant: string) => void;
}

/* ── helpers ── */
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

import { scoreColor } from "../utils/colors";

function deltaColor(d: number) {
  if (d > 0) return Colors.Text.Success.Default;
  if (d < 0) return Colors.Text.Critical.Default;
  return Colors.Text.Neutral.Disabled;
}

/** Compute utilization score for a capability's criteria using the CRITERION_TIERS lookup */
function computeUtilization(criteria: { id: string; points: number; error: boolean }[]): number {
  const tiers = { foundation: { total: 0, passed: 0 }, bestPractice: { total: 0, passed: 0 }, excellence: { total: 0, passed: 0 } };
  for (const cr of criteria) {
    const t = CRITERION_TIERS[cr.id] || "foundation";
    tiers[t].total++;
    if (!cr.error && cr.points > 0) tiers[t].passed++;
  }
  const fPct = tiers.foundation.total > 0 ? tiers.foundation.passed / tiers.foundation.total : 0;
  const bPct = tiers.bestPractice.total > 0 ? tiers.bestPractice.passed / tiers.bestPractice.total : 0;
  const ePct = tiers.excellence.total > 0 ? tiers.excellence.passed / tiers.excellence.total : 0;
  // Progressive: BP only counts if Foundation >= 80%, Excellence only if BP >= 60%
  const effB = fPct >= 0.8 ? bPct : 0;
  const effE = effB >= 0.6 ? ePct : 0;
  return Math.round(fPct * FOUNDATION_WEIGHT + effB * BEST_PRACTICE_WEIGHT + effE * EXCELLENCE_WEIGHT);
}

export const ComparisonPage: React.FC<Props> = ({ snapshots, saveSnapshot }) => {
  const dk = useCurrentTheme() === "dark";
  const navigate = useNavigate();

  // Last 12 snapshots available for comparison
  const available = useMemo(() => snapshots.slice(0, 12), [snapshots]);
  const [idxA, setIdxA] = useState(0);                 // A = newer (default: most recent)
  const [idxB, setIdxB] = useState(available.length > 1 ? 1 : 0); // B = older (default: second)
  const [selectedCap, setSelectedCap] = useState<string | null>(null);
  const [showListA, setShowListA] = useState(false);
  const [showListB, setShowListB] = useState(false);
  const [dimension, setDimension] = useState<"coverage" | "utilization">("coverage");
  const [expandedRadar, setExpandedRadar] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    const calc = () => {
      const vw = el ? el.offsetWidth : window.innerWidth;
      setIsMobile(vw < 640);
    };
    calc();
    if (el && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(calc);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const bg = Colors.Background.Base.Default;
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const textTert = Colors.Text.Neutral.Disabled;
  const card = Colors.Background.Container.Neutral.Default;
  const border = Colors.Border.Neutral.Default;

  const snapA = available[idxA] ?? null;
  const snapB = available[idxB] ?? null;

  const comparison = useMemo(() => {
    if (!snapA || !snapB || idxA === idxB) return null;

    const capDiffs = snapA.capabilities.map((cc) => {
      const pc = snapB.capabilities.find((p) => p.name === cc.name);
      const prevScore = pc?.score ?? 0;
      const d = cc.score - prevScore;

      const critDiffs = cc.criteriaResults.map((cr) => {
        const pcr = pc?.criteriaResults.find((p) => p.id === cr.id);
        return {
          id: cr.id,
          label: cr.label,
          currValue: cr.value,
          prevValue: pcr?.value ?? 0,
          currPoints: cr.points,
          prevPoints: pcr?.points ?? 0,
          pointsDelta: cr.points - (pcr?.points ?? 0),
          currError: cr.error,
          prevError: pcr?.error ?? true,
          isRatio: !!IS_RATIO_MAP[cr.id],
        };
      });

      const currUtil = computeUtilization(cc.criteriaResults);
      const prevUtil = pc ? computeUtilization(pc.criteriaResults) : 0;

      return {
        name: cc.name,
        color: cc.color,
        currScore: cc.score,
        prevScore,
        delta: d,
        currUtilization: currUtil,
        prevUtilization: prevUtil,
        utilizationDelta: currUtil - prevUtil,
        currConsolidation: cc.consolidation ?? 100,
        prevConsolidation: pc?.consolidation ?? 100,
        critDiffs,
        improved: critDiffs.filter((c) => c.pointsDelta > 0),
        degraded: critDiffs.filter((c) => c.pointsDelta < 0),
        unchanged: critDiffs.filter((c) => c.pointsDelta === 0),
      };
    });

    const elapsed = new Date(snapA.timestamp).getTime() - new Date(snapB.timestamp).getTime();
    const absDays = Math.round(Math.abs(elapsed) / 86400_000);
    const absHours = Math.round(Math.abs(elapsed) / 3600_000);
    const timeSpan = absDays >= 1 ? `${absDays} day${absDays !== 1 ? "s" : ""}` : `${absHours} hour${absHours !== 1 ? "s" : ""}`;

    const baselineUtil = capDiffs.length > 0 ? Math.round(capDiffs.reduce((s, c) => s + c.prevUtilization, 0) / capDiffs.length) : 0;
    const currentUtil = capDiffs.length > 0 ? Math.round(capDiffs.reduce((s, c) => s + c.currUtilization, 0) / capDiffs.length) : 0;

    return {
      baseline: { timestamp: snapB.timestamp, totalScore: snapB.totalScore },
      current: { timestamp: snapA.timestamp, totalScore: snapA.totalScore },
      totalDelta: snapA.totalScore - snapB.totalScore,
      baselineUtilization: baselineUtil,
      currentUtilization: currentUtil,
      utilizationDelta: currentUtil - baselineUtil,
      timeSpan,
      capDiffs,
      improved: capDiffs.filter((c) => c.delta > 0),
      degraded: capDiffs.filter((c) => c.delta < 0),
      unchanged: capDiffs.filter((c) => c.delta === 0),
    };
  }, [snapA, snapB, idxA, idxB]);

  /* ── Empty state ── */
  if (available.length < 2) {
    return (
      <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={16} style={{ fontFamily: "inherit", background: bg, color: text, minHeight: "100vh" }}>
        <Flex flexDirection="column" style={{ fontSize: 18, fontWeight: 800 }}>Not enough data</Flex>
        <Flex flexDirection="column" style={{ fontSize: 14, color: textSec, textAlign: "center", maxWidth: 320 }}>
          Run the assessment at least twice to compare evolution over time. Each run is saved automatically.
        </Flex>
        <Button onClick={() => navigate("/")} size="condensed">← Back to Overview</Button>
      </Flex>
    );
  }

  const snapPickerBtn = (label: string, snap: AssessmentSnapshot | null, isOpen: boolean, toggle: () => void, color: string) => {
    const mat = snap ? Math.round(snap.capabilities.reduce((s, c) => s + computeUtilization(c.criteriaResults), 0) / (snap.capabilities.length || 1)) : 0;
    return (
    <Button onClick={(e: React.MouseEvent<Element>) => { e.stopPropagation(); toggle(); }} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "6px 14px",
      border: `2px solid ${color}88`,
      background: dk ? `${color}22` : `${color}10`,
      minWidth: 180,
      borderRadius: 8,
    }}>
      <Text style={{ fontWeight: 900, color: dk ? "#fff" : "#fff", fontSize: 13, minWidth: 22, textAlign: "center", background: color, borderRadius: 4, padding: "1px 6px", lineHeight: "20px" }}>{label}</Text>
      {snap ? (
        <Flex alignItems="center" gap={12} style={{ flex: 1 }}>
          <Text style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmtShort(snap.timestamp)}</Text>
          <Flex alignItems="center" gap={4}>
            <Text style={{ fontWeight: 700, color, fontSize: 13, whiteSpace: "nowrap" }}>C{snap.totalScore}%</Text>
            <Text style={{ color: Colors.Charts.Categorical.Color08.Default, fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>M{mat}%</Text>
          </Flex>
          <Text style={{ color: textTert, fontSize: 12, whiteSpace: "nowrap" }}>{relativeTime(snap.timestamp)}</Text>
        </Flex>
      ) : (
        <Text style={{ color: textTert, fontStyle: "italic", flex: 1, fontSize: 12 }}>Select…</Text>
      )}
      <Text style={{ fontSize: 10, color: textTert }}>{isOpen ? "▲" : "▼"}</Text>
    </Button>
    );
  };

  const snapDropdown = (selectedIdx: number, onSelect: (i: number) => void, otherIdx: number, color: string) => (
    <Flex flexDirection="column" style={{
      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 4,
      background: card, border: `1px solid ${border}`, borderRadius: 8,
      maxHeight: 260, overflowY: "auto", boxShadow: dk ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.15)",
    }}>
      {available.map((snap, i) => {
        const isSelected = i === selectedIdx;
        const isDisabled = i === otherIdx;
        const mat = Math.round(snap.capabilities.reduce((s, c) => s + computeUtilization(c.criteriaResults), 0) / (snap.capabilities.length || 1));
        return (
          <Flex key={snap.id}
            onClick={(e) => { e.stopPropagation(); if (!isDisabled) onSelect(i); }} alignItems="center" gap={8} style={{ padding: "8px 16px", cursor: isDisabled ? "not-allowed" : "pointer", fontSize: 12, opacity: isDisabled ? 0.35 : 1,
              background: isSelected ? (dk ? `${color}18` : `${color}0A`) : "transparent",
              borderLeft: isSelected ? `3px solid ${color}` : "3px solid transparent" }}>
            <Text style={{ flex: 1 }}>{fmtShort(snap.timestamp)}</Text>
            <Text style={{ fontWeight: 700, minWidth: 36, textAlign: "right" }}>C{snap.totalScore}%</Text>
            <Text style={{ color: Colors.Charts.Categorical.Color08.Default, fontWeight: 600, fontSize: 12, minWidth: 36, textAlign: "right" }}>M{mat}%</Text>
            <Text style={{ color: textTert, fontSize: 12, minWidth: 64, textAlign: "right" }}>{relativeTime(snap.timestamp)}</Text>
            {isSelected && <Text style={{ color, fontSize: 12, fontWeight: 700 }}>●</Text>}
          </Flex>
        );
      })}
    </Flex>
  );

  return (
    <Flex flexDirection="column" ref={rootRef} onClick={() => { setSelectedCap(null); setShowListA(false); setShowListB(false); }} style={{ fontFamily: "inherit", background: bg, color: text, height: "100%", padding: "4px 16px", overflow: "auto" }}>
      {/* Header + A/B Selectors — compact single row */}
      <Flex alignItems="center" gap={8} flexWrap="wrap" style={{ marginBottom: 4 }} onClick={(e) => e.stopPropagation()}>
        <Tooltip text="Return to the main assessment page." position="bottom">
        <Button onClick={() => navigate("/")} size="condensed">← Back</Button>
        </Tooltip>
        <Text style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" }}>Evolution</Text>
        <Flex flexDirection="column" style={{ position: "relative", flex: 1, minWidth: 160, maxWidth: 320 }}>
          {snapPickerBtn("A", snapA, showListA, () => { setShowListA(v => !v); setShowListB(false); }, Colors.Charts.Categorical.Color01.Default)}
          {showListA && snapDropdown(idxA, (i) => { setIdxA(i); setShowListA(false); }, idxB, Colors.Charts.Categorical.Color01.Default)}
        </Flex>
        <Text style={{ color: textTert, fontSize: 12, fontWeight: 700 }}>vs</Text>
        <Flex flexDirection="column" style={{ position: "relative", flex: 1, minWidth: 160, maxWidth: 320 }}>
          {snapPickerBtn("B", snapB, showListB, () => { setShowListB(v => !v); setShowListA(false); }, Colors.Charts.Categorical.Color14.Default)}
          {showListB && snapDropdown(idxB, (i) => { setIdxB(i); setShowListB(false); }, idxA, Colors.Charts.Categorical.Color14.Default)}
        </Flex>
      </Flex>

      {idxA === idxB && (
        <Flex flexDirection="column" style={{ textAlign: "center", padding: 40, color: textSec, fontSize: 13 }}>Select two different snapshots to compare.</Flex>
      )}

      {comparison && (
        <Flex flexDirection="column" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* KPI Summary — compact inline */}
          <Flex alignItems="center" gap={6} flexWrap="wrap" style={{ marginBottom: 4 }}>
            <Flex alignItems="center" gap={4} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${border}`, background: card }}>
              <Text style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: textTert, fontWeight: 700 }}>Cov</Text>
              <Text style={{ fontSize: 14, fontWeight: 800 }}>{comparison.baseline.totalScore}→{comparison.current.totalScore}%</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: deltaColor(comparison.totalDelta) }}>{comparison.totalDelta > 0 ? "+" : ""}{comparison.totalDelta}%</Text>
            </Flex>
            <Flex alignItems="center" gap={4} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${border}`, background: card }}>
              <Text style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: textTert, fontWeight: 700 }}>Util</Text>
              <Text style={{ fontSize: 14, fontWeight: 800 }}>{comparison.baselineUtilization}→{comparison.currentUtilization}%</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: deltaColor(comparison.utilizationDelta) }}>{comparison.utilizationDelta > 0 ? "+" : ""}{comparison.utilizationDelta}%</Text>
            </Flex>
            <Flex alignItems="center" gap={4} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${border}`, background: card }}>
              <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Success.Default }}>↑{comparison.improved.length}</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Critical.Default }}>↓{comparison.degraded.length}</Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: textTert }}>={comparison.unchanged.length}</Text>
            </Flex>
            <Text style={{ fontSize: 12, color: textSec }}>{comparison.timeSpan}</Text>
          </Flex>

          {/* ══════ RADAR CHART + CAPABILITY BARS (side by side) ══════ */}
          <Flex gap={8} style={{ marginBottom: 0, flex: 1, minHeight: 0 }} flexWrap={isMobile ? "wrap" : "nowrap"} onClick={(e) => e.stopPropagation()}>
            {/* Left: CovUtilRadar */}
            <Flex flexDirection="column" style={{
              flex: isMobile ? "1 1 100%" : "3 1 0%", minWidth: 0, minHeight: 0,
              borderRadius: 12, border: `1px solid ${border}`, background: card,
              padding: "6px 12px 8px", overflow: "hidden",
            }}>
              <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 2 }}>
                <Flex alignItems="center" gap={8} flexWrap="wrap">
                  <Text style={{ fontSize: 14, fontWeight: 800, color: text, letterSpacing: 0.2 }}>{dimension === "coverage" ? "Coverage" : "Utilization"} Comparison</Text>
                  <SegmentedControl
                    value={dimension}
                    onChange={setDimension}
                    options={[
                      { value: "coverage", label: "Coverage" },
                      { value: "utilization", label: "Utilization" },
                    ]}
                  />
                </Flex>
                <ExpandChartButton onClick={() => setExpandedRadar(true)} />
              </Flex>
              <Flex flexDirection="column" style={{ flex: 1, minHeight: 0 }}>
                <CovUtilRadar
                  data={comparison.capDiffs.map(c => ({
                    name: c.name,
                    coverage: dimension === "coverage" ? c.currScore : c.currUtilization,
                    utilization: dimension === "coverage" ? c.prevScore : c.prevUtilization,
                    color: c.color,
                  }))}
                  coverageColor="#134fc9"
                  utilizationColor="#d56b1a"
                  legendLabels={[`A ${fmtShort(comparison.current.timestamp)}`, `B ${fmtShort(comparison.baseline.timestamp)}`]}
                  activeIdx={selectedCap ? comparison.capDiffs.findIndex(c => c.name === selectedCap) : null}
                  onSelect={(idx) => setSelectedCap(idx !== null && idx >= 0 ? comparison.capDiffs[idx]?.name ?? null : null)}
                />
              </Flex>
            </Flex>

            {/* Right: Score per Capability */}
            <Flex flexDirection="column" style={{
              flex: isMobile ? "1 1 100%" : "2 1 0%", minWidth: 0, minHeight: 0,
              background: card, border: `1px solid ${border}`, borderRadius: 12,
              padding: "8px 12px", overflowY: "auto",
            }}>
              <Flex alignItems="center" gap={8} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: 800, color: text, flex: 1 }}>Score per Capability</Text>
              </Flex>
              {comparison.capDiffs.map((cap) => (
                <CapabilityBar key={cap.name} cap={cap} dk={dk} border={border} textSec={textSec} textTert={textTert} dimension={dimension} forceOpen={selectedCap === cap.name} onHeaderClick={() => setSelectedCap(selectedCap === cap.name ? null : cap.name)} />
              ))}
              {comparison.unchanged.length > 0 && (
                <Flex flexDirection="column" style={{ marginTop: 8, padding: "6px 0 0 0", borderTop: `1px solid ${border}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 11, fontWeight: 700, color: textTert, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Unchanged ({comparison.unchanged.length})</Flex>
                  <Flex gap={4} flexWrap="wrap">
                    {comparison.unchanged.map((cap) => (
                      <Flex key={cap.name} alignItems="center" gap={4} style={{ padding: "2px 8px", borderRadius: 4, border: `1px solid ${border}`, fontSize: 11 }}>
                        <Text style={{ width: 5, height: 5, borderRadius: "50%", background: cap.color, flexShrink: 0 }} />
                        <Text style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{cap.name}</Text>
                        <Text style={{ color: textTert, whiteSpace: "nowrap" }}>{dimension === "utilization" ? cap.currUtilization : cap.currScore}%</Text>
                      </Flex>
                    ))}
                  </Flex>
                </Flex>
              )}
            </Flex>
          </Flex>

          {/* Expanded Radar Modal */}
          <ExpandableChartModal open={expandedRadar} onClose={() => setExpandedRadar(false)} title={`${dimension === "coverage" ? "Coverage" : "Utilization"} Comparison`}>
            <Flex flexDirection="column" style={{ width: "100%", height: "100%" }}>
              <CovUtilRadar
                data={comparison.capDiffs.map(c => ({
                  name: c.name,
                  coverage: dimension === "coverage" ? c.currScore : c.currUtilization,
                  utilization: dimension === "coverage" ? c.prevScore : c.prevUtilization,
                  color: c.color,
                }))}
                coverageColor="#134fc9"
                utilizationColor="#d56b1a"
                legendLabels={[`A ${fmtShort(comparison.current.timestamp)}`, `B ${fmtShort(comparison.baseline.timestamp)}`]}
              />
            </Flex>
          </ExpandableChartModal>

        </Flex>
      )}

    </Flex>
  );
};

/* ── Sub-components ── */

function KpiCard({ dk, card, border, label, value, sub, accent }: { dk: boolean; card: string; border: string; label: string; value: string; sub: React.ReactNode; accent?: string }) {
  return (
    <Flex flexDirection="column" style={{ background: card, border: `1px solid ${accent ? accent + "33" : border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
      <Text style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: accent || Colors.Text.Neutral.Disabled, marginBottom: 6 }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: 800, color: accent || Colors.Text.Neutral.Default }}>{value}</Text>
      <Flex flexDirection="column" style={{ marginTop: 4 }}>{sub}</Flex>
    </Flex>
  );
}

function CapabilityBar({ cap, dk, border, textSec, textTert, forceOpen, onHeaderClick, dimension = "coverage" }: { cap: CapDiff; dk: boolean; border: string; textSec: string; textTert: string; forceOpen?: boolean; onHeaderClick?: () => void; dimension?: "coverage" | "utilization" }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen ?? localOpen;
  const isUtil = dimension === "utilization";
  const prev = isUtil ? cap.prevUtilization : cap.prevScore;
  const curr = isUtil ? cap.currUtilization : cap.currScore;
  const d = isUtil ? cap.utilizationDelta : cap.delta;
  const capBarRef = useRef<HTMLDivElement>(null);
  const gainedCount = cap.critDiffs.filter(c => c.pointsDelta > 0).length;
  const lostCount = cap.critDiffs.filter(c => c.pointsDelta < 0).length;

  useEffect(() => {
    if (forceOpen && capBarRef.current) {
      capBarRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [forceOpen]);

  return (
    <Flex flexDirection="column" ref={capBarRef} style={{ marginBottom: 4 }}>
      <Flex onClick={(e) => { e.stopPropagation(); if (onHeaderClick) onHeaderClick(); else setLocalOpen(!localOpen); }}
        role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (onHeaderClick) onHeaderClick(); else setLocalOpen(!localOpen); } }} alignItems="center" gap={6} style={{ padding: "4px 0", cursor: "pointer", borderBottom: `1px solid ${border}`, borderLeft: cap.currConsolidation < 100 ? `3px solid ${Colors.Charts.Status.Warning.Default}` : undefined, paddingLeft: cap.currConsolidation < 100 ? 6 : 0 }}>
        <Text style={{ width: 8, height: 8, borderRadius: "50%", background: cap.color, flexShrink: 0 }} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cap.name}</Text>
        <Text style={{ fontSize: 12, color: textSec, fontVariantNumeric: "tabular-nums" }}>{prev}%</Text>
        <Text style={{ fontSize: 12, color: textTert }}>→</Text>
        <Text style={{ fontSize: 12, fontWeight: 700, color: scoreColor(curr), fontVariantNumeric: "tabular-nums" }}>{curr}%</Text>
        {d !== 0 && <Text style={{ fontSize: 12, fontWeight: 700, color: deltaColor(d), minWidth: 36, textAlign: "right" }}>{d > 0 ? "+" : ""}{d}%</Text>}
        {(gainedCount > 0 || lostCount > 0) && (
          <Flex alignItems="center" gap={2} style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", flexShrink: 0 }}>
            {gainedCount > 0 && <Text style={{ color: Colors.Text.Success.Default }}>{gainedCount}↑</Text>}
            {lostCount > 0 && <Text style={{ color: Colors.Text.Critical.Default }}>{lostCount}↓</Text>}
          </Flex>
        )}
        <Text style={{ fontSize: 11, color: textTert, transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▾</Text>
      </Flex>
      {/* Consolidation banner */}
      {cap.currConsolidation < 100 && (
        <Flex alignItems="center" gap={6} style={{ marginTop: 2, marginLeft: 14, padding: "2px 8px", borderRadius: 5,
          background: dk ? "rgba(255,170,50,0.08)" : "rgba(255,170,50,0.05)",
          border: `1px solid ${dk ? "rgba(255,170,50,0.15)" : "rgba(255,170,50,0.12)"}`,
        }}>
          <Text style={{ fontSize: 9, fontWeight: 700, color: Colors.Charts.Status.Warning.Default, letterSpacing: 0.3 }}>
            CONSOLIDATION: {cap.currConsolidation}% in Dynatrace
          </Text>
        </Flex>
      )}
      {/* Score bar */}
      <Flex
        onClick={(e) => { e.stopPropagation(); if (onHeaderClick) onHeaderClick(); else setLocalOpen(!localOpen); }}
        style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1, marginLeft: 14, cursor: "pointer" }}
      >
        <Flex flexDirection="column" style={{ flex: 1, height: 3, borderRadius: 2, background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
          {/* Previous score ghost bar */}
          <Flex style={{ position: "absolute", height: "100%", width: `${prev}%`, background: dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", borderRadius: 3 }} />
          {/* Current score bar */}
          <Flex style={{ position: "absolute", height: "100%", width: `${curr}%`, background: cap.color, borderRadius: 3, opacity: 0.7, transition: "width 0.5s" }} />
        </Flex>
      </Flex>
      {/* Expandable criteria details */}
      {open && (() => {
        const changed = cap.critDiffs.filter((c) => c.pointsDelta !== 0);
        const improvable = cap.critDiffs.filter((c) => c.pointsDelta === 0 && c.currPoints === 0);
        const healthy = cap.critDiffs.filter((c) => c.pointsDelta === 0 && c.currPoints > 0);

        /* tier grouping helpers for utilization view */
        const tierLabel: Record<string, string> = { foundation: "Foundation", bestPractice: "Best Practice", excellence: "Excellence" };
        const tierColor: Record<string, string> = { foundation: Colors.Charts.Categorical.Color01.Default, bestPractice: Colors.Charts.Status.Warning.Default, excellence: Colors.Charts.Categorical.Color08.Default };
        const tierOrder = ["foundation", "bestPractice", "excellence"] as const;
        const groupByTier = (list: typeof cap.critDiffs) => {
          const groups: Record<string, typeof list> = { foundation: [], bestPractice: [], excellence: [] };
          list.forEach((cr) => { const t = CRITERION_TIERS[cr.id] || "foundation"; groups[t].push(cr); });
          return groups;
        };

        return (
          <Flex flexDirection="column" style={{ marginLeft: 18, marginTop: 8, marginBottom: 4 }}>
            {changed.length > 0 && (
              <Flex flexDirection="column" style={{
                fontSize: 12, fontWeight: 800, color: Colors.Text.Neutral.Disabled, marginBottom: 6,
                textTransform: "uppercase", letterSpacing: 0.8,
              }}>Changes ({changed.length})</Flex>
            )}
            {changed.map((cr) => {
              const rem = CRITERION_ACTIONS[cr.id];
              return (
                <Flex flexDirection="column" key={cr.id} style={{ padding: "3px 0", borderBottom: `1px solid ${border}` }}>
                  <Flex alignItems="center" gap={8} style={{ fontSize: 12 }}>
                    <Text style={{ width: 6, height: 6, borderRadius: "50%", background: cr.pointsDelta > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default, flexShrink: 0 }} />
                    <Text style={{ flex: 1, color: textSec }}>{cr.label}</Text>
                    <Text style={{ color: textTert, fontSize: 12 }}>{cr.isRatio ? `${cr.prevValue}%` : cr.prevValue} → {cr.isRatio ? `${cr.currValue}%` : cr.currValue}</Text>
                    <Text style={{ fontWeight: 700, color: deltaColor(cr.pointsDelta), fontSize: 12, minWidth: 56, textAlign: "right" }}>
                      {cr.pointsDelta > 0 ? "✓ Gained" : "✗ Lost"}
                    </Text>
                  </Flex>
                  {rem && (
                    <Flex alignItems="center" gap={4} flexWrap="wrap" style={{ marginTop: 3, paddingLeft: 16, fontSize: 12, lineHeight: "18px" }}>
                      <Text style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                        background: cr.currPoints > 0
                          ? (dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.10)")
                          : (dk ? "rgba(229,57,53,0.12)" : "rgba(229,57,53,0.10)"),
                        color: cr.currPoints > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default,
                        border: `1px solid ${cr.currPoints > 0 ? "rgba(0,200,83,0.3)" : "rgba(229,57,53,0.3)"}`,
                        flexShrink: 0,
                      }}>
                        {cr.currPoints > 0 ? "✓ Applied" : "✗ Not applied"}
                      </Text>
                      <Text style={{ color: textSec }}>{rem.action}</Text>
                      <ExternalLink href={rem.docUrl} style={{ marginLeft: 2 }}>
                        {rem.docLabel} ↗
                      </ExternalLink>
                    </Flex>
                  )}
                </Flex>
              );
            })}
            {/* ── Improvement opportunities / Healthy — grouped by tier when utilization ── */}
            {isUtil ? (
              /* UTILIZATION VIEW: group all non-changed criteria by tier */
              tierOrder.map((tier) => {
                const tiered = [...improvable, ...healthy].filter((cr) => (CRITERION_TIERS[cr.id] || "foundation") === tier);
                if (tiered.length === 0) return null;
                const tc = tierColor[tier];
                return (
                  <React.Fragment key={tier}>
                    <Flex flexDirection="column" style={{
                      fontSize: 12, fontWeight: 800, color: tc, marginTop: 12, marginBottom: 6,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      padding: "5px 12px", borderRadius: 5,
                      background: dk ? `${tc}18` : `${tc}0C`,
                      border: `1px solid ${dk ? `${tc}40` : `${tc}30`}`,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      {tierLabel[tier]} ({tiered.length})
                    </Flex>
                    {tiered.map((cr) => {
                      const rem = CRITERION_ACTIONS[cr.id];
                      const applied = cr.currPoints > 0;
                      return (
                        <Flex flexDirection="column" key={cr.id} style={{ padding: "3px 0", borderBottom: `1px solid ${border}` }}>
                          <Flex alignItems="center" gap={8} style={{ fontSize: 12 }}>
                            <Text style={{ width: 6, height: 6, borderRadius: "50%", background: applied ? Colors.Text.Success.Default : tc, flexShrink: 0 }} />
                            <Text style={{ flex: 1, color: textSec }}>{cr.label}</Text>
                            <Text style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                              background: applied
                                ? (dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.10)")
                                : (dk ? "rgba(229,57,53,0.12)" : "rgba(229,57,53,0.10)"),
                              color: applied ? Colors.Text.Success.Default : Colors.Text.Critical.Default,
                              border: `1px solid ${applied ? "rgba(0,200,83,0.3)" : "rgba(229,57,53,0.3)"}`,
                            }}>{applied ? "✓ Applied" : "✗ Not applied"}</Text>
                          </Flex>
                          {rem && (
                            <Flex flexDirection="column" style={{ marginTop: 3, paddingLeft: 16, fontSize: 12, lineHeight: "18px" }}>
                              <Text style={{ color: textSec }}>{rem.action}</Text>
                              <ExternalLink href={rem.docUrl} style={{ marginLeft: 6 }}>
                                {rem.docLabel} ↗
                              </ExternalLink>
                            </Flex>
                          )}
                        </Flex>
                      );
                    })}
                  </React.Fragment>
                );
              })
            ) : (
              /* COVERAGE VIEW: original flat sections */
              <>
                {improvable.length > 0 && (
                  <>
                    <Flex flexDirection="column" style={{
                      fontSize: 12, fontWeight: 800, color: Colors.Text.Warning.Default, marginTop: 12, marginBottom: 6,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      padding: "5px 12px", borderRadius: 5,
                      background: dk ? "rgba(245,166,35,0.10)" : "rgba(245,166,35,0.08)",
                      border: `1px solid ${dk ? "rgba(245,166,35,0.25)" : "rgba(245,166,35,0.2)"}`,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      <Text style={{ fontSize: 14 }}>💡</Text> Improvement opportunities ({improvable.length})
                    </Flex>
                    {improvable.map((cr) => {
                      const rem = CRITERION_ACTIONS[cr.id];
                      return (
                        <Flex flexDirection="column" key={cr.id} style={{ padding: "3px 0", borderBottom: `1px solid ${border}` }}>
                          <Flex alignItems="center" gap={8} style={{ fontSize: 12 }}>
                            <Text style={{ width: 6, height: 6, borderRadius: "50%", background: Colors.Text.Warning.Default, flexShrink: 0 }} />
                            <Text style={{ flex: 1, color: textSec }}>{cr.label}</Text>
                            <Text style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                              background: dk ? "rgba(229,57,53,0.12)" : "rgba(229,57,53,0.10)",
                              color: Colors.Text.Critical.Default,
                              border: "1px solid rgba(229,57,53,0.3)",
                            }}>✗ Not applied</Text>
                          </Flex>
                          {rem && (
                            <Flex flexDirection="column" style={{ marginTop: 3, paddingLeft: 16, fontSize: 12, lineHeight: "18px" }}>
                              <Text style={{ color: textSec }}>{rem.action}</Text>
                              <ExternalLink href={rem.docUrl} style={{ marginLeft: 6 }}>
                                {rem.docLabel} ↗
                              </ExternalLink>
                            </Flex>
                          )}
                        </Flex>
                      );
                    })}
                  </>
                )}
                {healthy.length > 0 && (
                  <>
                    <Flex flexDirection="column" style={{
                      fontSize: 12, fontWeight: 800, color: Colors.Text.Success.Default, marginTop: 12, marginBottom: 6,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      padding: "5px 12px", borderRadius: 5,
                      background: dk ? "rgba(0,200,83,0.08)" : "rgba(0,200,83,0.06)",
                      border: `1px solid ${dk ? "rgba(0,200,83,0.20)" : "rgba(0,200,83,0.15)"}`,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      <Text style={{ fontSize: 14 }}>✅</Text> Additional recommendations ({healthy.length})
                    </Flex>
                    {healthy.map((cr) => {
                      const rem = CRITERION_ACTIONS[cr.id];
                      return (
                        <Flex flexDirection="column" key={cr.id} style={{ padding: "3px 0", borderBottom: `1px solid ${border}` }}>
                          <Flex alignItems="center" gap={8} style={{ fontSize: 12 }}>
                            <Text style={{ width: 6, height: 6, borderRadius: "50%", background: Colors.Text.Success.Default, flexShrink: 0 }} />
                            <Text style={{ flex: 1, color: textSec }}>{cr.label}</Text>
                            <Text style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                              background: dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.10)",
                              color: Colors.Text.Success.Default,
                              border: "1px solid rgba(0,200,83,0.3)",
                            }}>✓ Applied</Text>
                          </Flex>
                          {rem && (
                            <Flex flexDirection="column" style={{ marginTop: 3, paddingLeft: 16, fontSize: 12, lineHeight: "18px" }}>
                              <Text style={{ color: textSec }}>{rem.action}</Text>
                              <ExternalLink href={rem.docUrl} style={{ marginLeft: 6 }}>
                                {rem.docLabel} ↗
                              </ExternalLink>
                            </Flex>
                          )}
                        </Flex>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </Flex>
        );
      })()}
    </Flex>
  );
}

/* ── Styles ── */
function btnStyle(dk: boolean): React.CSSProperties {
  return {
    padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", borderRadius: 6,
    border: `1px solid ${dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
    background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    color: Colors.Text.Neutral.Default,
    fontFamily: "inherit",
  };
}
