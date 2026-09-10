import React, { useState, useMemo, useCallback } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { ExternalLink, Text, Strong } from "@dynatrace/strato-components/typography";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { TechRadar } from "./TechRadar";
import { ConnectorLines } from "./ConnectorLines";
import { ChartLabels } from "./ChartLabels";
import { CapabilityCards } from "./CapabilityCards";
import { ExpandableChartModal, ExpandChartButton } from "./ExpandableChartModal";
import { ScaleTierBanner } from "./ScaleTierBanner";
import { DavisInsightSection } from "./DavisInsightSection";
import { CovUtilRadar, type CovUtilRadarHandle } from "./CovUtilRadar";
import { CapabilityScatter } from "./CapabilityScatter";
import { AssessmentToolbar } from "./AssessmentToolbar";
import { Tooltip } from "./Tooltip";
import { CRITERION_IMPORTANCE } from "../data/criterionImportance";
import { CRITERION_REMEDIATION } from "../data/criterionRemediation";
import { scoreColor as utilizationBandColor, bandLabel as sharedBandLabel, SCORE_BANDS } from "../utils/colors";
import type { ViewMode, CapabilityResult, QueryStats, CoverageData } from "../hooks/useCoverageData";
import type { UseScaleTierResult } from "../hooks/useScaleTier";
import type { DegradedCapability } from "../hooks/useDegradationAlert";
import type { DavisRecommendationMap, DavisRecommendationState, useDavisRecommendations } from "../hooks/useDavisRecommendations";
import type { useAssessmentHistory } from "../hooks/useAssessmentHistory";
import type { useAppAdoption } from "../hooks/useAppAdoption";
import type { applyTraceProxyMode } from "../trace-proxy";
import type { ReportPersona, PersonaLang } from "../reports/personaReports";

type TraceProxyInfo = ReturnType<typeof applyTraceProxyMode>["info"] | null;

const R_RATIO = 0.34;

const SCALE = SCORE_BANDS.map(b => ({
  l: b.label,
  c: b.token,
  hex: b.color,
  r: `${b.min}-${b.max === 100 ? 100 : b.max - 1}%`,
}));

const TIER_META: { key: "foundation" | "bestPractice" | "excellence"; label: string; color: string }[] = [
  { key: "foundation", label: "Foundation", color: Colors.Charts.Categorical.Color01.Default },
  { key: "bestPractice", label: "Best Practice", color: Colors.Charts.Status.Warning.Default },
  { key: "excellence", label: "Excellence", color: Colors.Charts.Status.Ideal.Default },
];

function criterionTooltipContent(id: string, description: string, tier: string): string {
  const tierLabel = tier === "foundation" ? "Foundation" : tier === "bestPractice" ? "Best Practice" : "Excellence";
  const importance = CRITERION_IMPORTANCE[id];
  const remediation = CRITERION_REMEDIATION[id];
  let tip = `${description}\n\nTier: ${tierLabel}`;
  if (importance) tip += `\n\nWhy it matters:\n${importance}`;
  if (remediation) tip += `\n\nHow to fix:\n${remediation.action}`;
  return tip;
}

function isTextSelection(): boolean {
  const sel = window.getSelection();
  return !!(sel && sel.toString().length > 0);
}

const MiniBar = React.memo(({ pct, color, dk, h = 6 }: { pct: number; color: string; dk: boolean; h?: number }) => (
  <Flex flexDirection="column" style={{ width: "100%", height: h, borderRadius: h / 2, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", overflow: "hidden" }}>
    <Flex style={{ height: "100%", width: `${Math.min(100, pct)}%`, borderRadius: h / 2, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
  </Flex>
));

export interface AssessmentResultsProps {
  capabilities: CapabilityResult[];
  anim: number;
  activeIdx: number | null;
  onActiveIdxChange: (idx: number | null) => void;
  chartSize: number;
  isMobile: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  collapseKey: number;
  // Toolbar / header:
  onBack: () => void;
  onRefresh: () => void;
  divergenceCount: number;
  degraded: DegradedCapability[];
  degradationDismissed: boolean;
  onDismissDegradation: () => void;
  history: ReturnType<typeof useAssessmentHistory>;
  scale?: UseScaleTierResult;
  traceProxyInfo: TraceProxyInfo;
  tenant: string;
  date: string;
  stats: QueryStats | null;
  liveScannedBytes: number;
  lastRunMeta: CoverageData["lastRunMeta"];
  loading: boolean;
  totalScore: number;
  overallUtilizationLevel: number;
  exporting: boolean;
  // Davis:
  davisHandle: ReturnType<typeof useDavisRecommendations>;
  onDivergenceBadgeClick: (capName: string) => void;
  explainCapability: (capName: string) => void;
  // Adoption:
  adoption: ReturnType<typeof useAppAdoption>;
  // Reports:
  onGeneratePersona: (persona: ReportPersona, lang: PersonaLang) => void;
  onMarkdownExport: () => void;
  onOpenCustomReport: () => void;
  onOpenSmartReport: () => void;
  onRadarMount: (h: CovUtilRadarHandle | null) => void;
}

/**
 * Active-assessment view: toolbar + one of three panels (Coverage /
 * Utilization / Executive Summary) + the collapsible "How to Analyze" guide.
 */
export const AssessmentResults: React.FC<AssessmentResultsProps> = ({
  capabilities,
  anim,
  activeIdx,
  onActiveIdxChange,
  chartSize,
  isMobile,
  viewMode,
  onViewModeChange,
  collapseKey,
  onBack,
  onRefresh,
  divergenceCount,
  degraded,
  degradationDismissed,
  onDismissDegradation,
  history,
  scale,
  traceProxyInfo,
  tenant,
  date,
  stats,
  liveScannedBytes,
  lastRunMeta,
  loading,
  totalScore,
  overallUtilizationLevel,
  exporting,
  davisHandle,
  onDivergenceBadgeClick,
  explainCapability,
  adoption,
  onGeneratePersona,
  onMarkdownExport,
  onOpenCustomReport,
  onOpenSmartReport,
  onRadarMount,
}) => {
  const dk = useCurrentTheme() === "dark";
  const [showGuide, setShowGuide] = useState(false);
  const [expandedPolar, setExpandedPolar] = useState(false);

  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const textTert = Colors.Text.Neutral.Disabled;

  const hitTest = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2, R = rect.width * R_RATIO;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - cx, dy = my - cy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > R + 14 || d < chartSize * 0.09) return -1;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    const N = capabilities.length;
    return Math.floor(a / ((Math.PI * 2) / N));
  }, [capabilities.length, chartSize]);

  return (
    <>
      <AssessmentToolbar
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onBack={onBack}
        onRefresh={onRefresh}
        capabilities={capabilities}
        divergenceCount={divergenceCount}
        degraded={degraded}
        degradationDismissed={degradationDismissed}
        onDismissDegradation={onDismissDegradation}
        snapshotCount={history.snapshots.length}
        scale={scale}
        traceProxyInfo={traceProxyInfo}
        tenant={tenant}
        date={date}
        stats={stats}
        liveScannedBytes={liveScannedBytes}
        lastRunMeta={lastRunMeta}
        loading={loading}
        exporting={exporting}
        onGeneratePersona={onGeneratePersona}
        onMarkdownExport={onMarkdownExport}
        onOpenCustomReport={onOpenCustomReport}
        onOpenSmartReport={onOpenSmartReport}
      />

      {/* Main content: chart left, cards right — stacks vertically on mobile */}
      <Flex style={{ flex: 1, flexDirection: isMobile ? "column" : "row", minHeight: 0, overflow: "auto" }}>
        {viewMode === "coverage" ? (
          <>
            {/* Left: chart + scale */}
            <Flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "visible", position: "relative" }}>
              <ExpandChartButton onClick={() => setExpandedPolar(true)} style={{ position: "absolute", top: 4, right: 8, zIndex: 10 }} />
              <Flex flexDirection="column" style={{ position: "relative", width: chartSize, height: chartSize, flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const idx = hitTest(e);
                  const N = capabilities.length;
                  onActiveIdxChange(idx >= 0 && idx < N ? (activeIdx === idx ? null : idx) : null);
                }}>
                <ConnectorLines capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} />
                <TechRadar capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} />
                <ChartLabels capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} onSelect={(idx: number | null) => {
                  onActiveIdxChange(idx);
                  if (idx !== null) {
                    setTimeout(() => {
                      const card = document.querySelector(`[data-cap-idx="${idx}"]`);
                      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }, 100);
                  }
                }} />
              </Flex>
            </Flex>

            {/* Expanded TechRadar Modal */}
            <ExpandableChartModal open={expandedPolar} onClose={() => setExpandedPolar(false)} maxWidth={1100} maxHeight={1000}>
              <Flex flexDirection="column" alignItems="center" style={{ width: "100%", height: "100%" }}>
                <Flex alignItems="center" justifyContent="center" style={{ flex: 1, minHeight: 0, width: "100%" }}>
                  {(() => {
                    const modalSize = Math.min(window.innerWidth * 0.75, window.innerHeight * 0.7, 900);
                    return (
                      <Flex flexDirection="column" style={{ position: "relative", width: modalSize, height: modalSize }}>
                        <ConnectorLines capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} />
                        <TechRadar capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} />
                        <ChartLabels capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} onSelect={(idx: number | null) => onActiveIdxChange(idx)} />
                      </Flex>
                    );
                  })()}
                </Flex>
                <Flex alignItems="center" justifyContent="center" gap={4} flexWrap="wrap" style={{ padding: "8px 0 4px", flexShrink: 0 }}>
                  {SCALE.map((x) => (
                    <Flex key={x.l} alignItems="center" gap={2} style={{ padding: "2px 8px", borderRadius: 6,
                      background: x.hex + (dk ? "20" : "12") }}>
                      <Flex style={{ width: 5, height: 5, borderRadius: "50%", background: x.c }} />
                      <Text style={{ fontSize: 12, color: text, fontWeight: 600 }}>{x.l}</Text>
                      <Text style={{ fontSize: 12, color: text, fontWeight: 500 }}>{x.r}</Text>
                    </Flex>
                  ))}
                </Flex>
              </Flex>
            </ExpandableChartModal>

            {/* Right: scrollable cards */}
            <Flex flexDirection="column" style={{
              width: isMobile ? "100%" : "clamp(300px, 32%, 440px)",
              flexShrink: 0,
              overflowY: "auto",
              padding: "6px 12px",
              borderLeft: isMobile ? "none" : `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
              borderTop: isMobile ? `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` : "none",
              maxHeight: isMobile ? "50vh" : undefined,
            }}>
              <CapabilityCards
                capabilities={capabilities}
                anim={anim}
                activeIdx={activeIdx}
                onSelect={onActiveIdxChange}
                viewMode={viewMode}
                onDivergenceBadgeClick={onDivergenceBadgeClick}
                davisRecommendations={davisHandle.byCapability}
                onSendFollowUp={davisHandle.sendFollowUp}
                onRequestInsight={davisHandle.requestInsight}
                onExplain={explainCapability}
                rateLimitedUntil={davisHandle.rateLimitedUntil}
              />
            </Flex>
          </>
        ) : viewMode === "utilization" ? (
          <UtilizationView
            capabilities={capabilities}
            dk={dk}
            text={text}
            textSec={textSec}
            textTert={textTert}
            overallUtilizationLevel={overallUtilizationLevel}
            collapseKey={collapseKey}
            isMobile={isMobile}
            adoptionByCapability={adoption.unavailable ? undefined : adoption.byCapability}
            adoptionTotalUsers={adoption.totalUsers}
            davisRecommendations={davisHandle.byCapability}
            onSendFollowUp={davisHandle.sendFollowUp}
            onRequestInsight={davisHandle.requestInsight}
            onExplain={() => { /* card expands itself; no Davis call here */ }}
          />
        ) : (
          <RecommendationsView
            capabilities={capabilities}
            dk={dk}
            text={text}
            textSec={textSec}
            textTert={textTert}
            totalScore={totalScore}
            overallUtilizationLevel={overallUtilizationLevel}
            collapseKey={collapseKey}
            history={history}
            onDrilldown={onViewModeChange}
            onRadarMount={onRadarMount}
            isMobile={isMobile}
            adoption={adoption.unavailable ? undefined : { byCapability: adoption.byCapability, totalUsers: adoption.totalUsers, windowDays: adoption.windowDays }}
          />
        )}
      </Flex>

      {/* How to Analyze — collapsible footer */}
      {(viewMode === "coverage" || viewMode === "utilization") && (
        <Flex flexDirection="column" style={{ flexShrink: 0, borderTop: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"}`, background: dk ? "rgba(65,105,225,0.04)" : "rgba(65,105,225,0.02)" }}>
          <Flex alignItems="center" gap={6} style={{ padding: "6px 20px", cursor: "pointer", userSelect: "none" }}
            onClick={(e) => { e.stopPropagation(); setShowGuide(g => !g); }}>
            <Text style={{ fontSize: 12, fontWeight: 800, color: text, letterSpacing: 0.2 }}>
              How to Analyze — {viewMode === "coverage" ? "Coverage" : "Utilization"} View
            </Text>
            <Text style={{ fontSize: 10, color: textSec, transition: "transform 0.2s", transform: showGuide ? "rotate(180deg)" : "rotate(0deg)" }}>▼</Text>
          </Flex>
          {showGuide && (viewMode === "coverage" ? (
            <Flex flexDirection="column" style={{ padding: "0 20px 12px" }}>
              <Grid gridTemplateColumns={isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))"} gap={12}>
                <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>What You're Seeing</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                    The radar chart shows <Strong style={{ color: text }}>how much</Strong> of each capability is used. Each of the <Strong style={{ color: text }}>{capabilities.length} axes</Strong> represents one capability. The <Strong style={{ color: text }}>filled area</Strong> reveals adoption breadth.
                  </Text>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>How to Read the Score</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                    Each capability scores <Strong style={{ color: text }}>0–100%</Strong> based on <Strong style={{ color: text }}>criteria met</Strong>. <Text style={{ color: Colors.Text.Success.Default, fontWeight: 700 }}>Green</Text> = met, <Text style={{ color: Colors.Text.Critical.Default, fontWeight: 700 }}>red</Text> = not met. Click a capability to drill down.
                  </Text>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>What to Look For</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                    <Strong style={{ color: text }}>Flat axes</Strong> = low adoption. <Strong style={{ color: text }}>Asymmetric shapes</Strong> = uneven usage. Aim for a <Strong style={{ color: text }}>balanced, expanded radar</Strong>.
                  </Text>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>Color Scale</Flex>
                  <Flex flexDirection="column" gap={2}>
                    {[
                      { l: "N/A", c: Colors.Charts.Status.Critical.Default, t: "0–19% Critical gaps" },
                      { l: "Low", c: Colors.Charts.Categorical.Color14.Default, t: "20–39% Early adoption" },
                      { l: "Moderate", c: Colors.Charts.Status.Warning.Default, t: "40–59% Partial" },
                      { l: "Good", c: Colors.Charts.Categorical.Color07.Default, t: "60–79% Strong" },
                      { l: "Excellent", c: Colors.Charts.Status.Ideal.Default, t: "80–100% Full" },
                    ].map((s) => (
                      <Flex key={s.l} alignItems="center" gap={4}>
                        <Flex style={{ width: 6, height: 6, borderRadius: "50%", background: s.c, flexShrink: 0 }} />
                        <Text style={{ fontSize: 12, fontWeight: 700, color: s.c, minWidth: 55 }}>{s.l}</Text>
                        <Text style={{ fontSize: 12, color: textSec }}>{s.t}</Text>
                      </Flex>
                    ))}
                  </Flex>
                </Flex>
              </Grid>
            </Flex>
          ) : (
            <Flex flexDirection="column" style={{ padding: "0 20px 12px" }}>
              <Grid gridTemplateColumns={isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))"} gap={16}>
                <Flex flexDirection="column" style={{ padding: "12px 16px", borderRadius: 8, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>What You're Seeing</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.65 }}>
                    Each card shows a <Strong style={{ color: text }}>weighted Utilization score</Strong> (0–100%) per capability. The score combines three tiers: <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation</Strong> (60% weight), <Strong style={{ color: Colors.Charts.Status.Warning.Default }}>Best Practice</Strong> (25%), and <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}>Excellence</Strong> (15%). Cards are sorted from lowest to highest Utilization.
                  </Text>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "12px 16px", borderRadius: 8, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Weighted Tiers</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.65 }}>
                    <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation (60%)</Strong> — the essentials (hosts, services, basic data flow).
                    <Strong style={{ color: Colors.Charts.Status.Warning.Default }}> Best Practice (25%)</Strong> — deeper adoption (trace correlation, advanced metrics).
                    <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}> Excellence (15%)</Strong> — advanced Utilization (multi-service traces, guardrails, cost tracking).
                  </Text>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "12px 16px", borderRadius: 8, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Utilization Bands</Flex>
                  <Flex flexDirection="column" gap={4} style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Critical.Default, fontWeight: 700 }}>N/A</Text> <Text style={{ color: textSec }}>0–19% — Minimal or no adoption</Text></Flex>
                    <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Categorical.Color14.Default, fontWeight: 700 }}>Low</Text> <Text style={{ color: textSec }}>20–39% — Early stage, significant gaps</Text></Flex>
                    <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Warning.Default, fontWeight: 700 }}>Moderate</Text> <Text style={{ color: textSec }}>40–59% — Partial adoption, key areas configured</Text></Flex>
                    <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Categorical.Color07.Default, fontWeight: 700 }}>Good</Text> <Text style={{ color: textSec }}>60–79% — Strong adoption, room to optimize</Text></Flex>
                    <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Ideal.Default, fontWeight: 700 }}>Excellent</Text> <Text style={{ color: textSec }}>80–100% — Comprehensive Utilization</Text></Flex>
                  </Flex>
                </Flex>
                <Flex flexDirection="column" style={{ padding: "12px 16px", borderRadius: 8, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>What to Look For</Flex>
                  <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.65 }}>
                    Focus on <Strong style={{ color: text }}>Foundation tier first</Strong> — it carries the most weight (60%). Low-scoring capabilities need immediate attention. Click any card to see <Strong style={{ color: text }}>which specific criteria</Strong> are missing in each tier. Use <Strong style={{ color: text }}>Evolution Over Time</Strong> to track progress.
                  </Text>
                </Flex>
              </Grid>
            </Flex>
          ))}
        </Flex>
      )}
    </>
  );
};

/* ── UTILIZATION VIEW ── */

const utilizationAnimStyle = `
@keyframes utilFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes matBarFill { from { width: 0%; } }
@keyframes matScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes utilCountUp { from { opacity: 0; } to { opacity: 1; } }
`;

function UtilizationView({ capabilities, dk, text, textSec, textTert, overallUtilizationLevel, collapseKey, isMobile, davisRecommendations, onSendFollowUp, onRequestInsight, onExplain, adoptionByCapability, adoptionTotalUsers }: {
  capabilities: CapabilityResult[];
  dk: boolean; text: string; textSec: string; textTert: string;
  overallUtilizationLevel: number; collapseKey: number; isMobile: boolean;
  davisRecommendations?: DavisRecommendationMap;
  onSendFollowUp?: (capabilityName: string, text: string) => Promise<void>;
  onRequestInsight?: (capabilityName: string) => Promise<void>;
  onExplain?: (capabilityName: string) => void;
  adoptionByCapability?: Record<string, { users: number; rate: number; apps: { appId: string; users: number }[] }>;
  adoptionTotalUsers?: number;
}) {
  const utilBand = sharedBandLabel(overallUtilizationLevel);
  const utilColor = utilizationBandColor(overallUtilizationLevel);

  const totals = useMemo(() => capabilities.reduce((acc, c) => ({
    fnd: acc.fnd + c.utilization.foundation.passed,
    fndT: acc.fndT + c.utilization.foundation.total,
    bp: acc.bp + c.utilization.bestPractice.passed,
    bpT: acc.bpT + c.utilization.bestPractice.total,
    exc: acc.exc + c.utilization.excellence.passed,
    excT: acc.excT + c.utilization.excellence.total,
  }), { fnd: 0, fndT: 0, bp: 0, bpT: 0, exc: 0, excT: 0 }), [capabilities]);

  const sorted = useMemo(() => [...capabilities].sort((a, b) => a.effectiveUtilizationScore - b.effectiveUtilizationScore), [capabilities]);

  return (
    <Flex flexDirection="column" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <style>{utilizationAnimStyle}</style>

      {/* Overall utilization hero */}
      <Flex alignItems="center" gap={20} style={{ marginBottom: 20, padding: "16px 24px",
        background: dk ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.015)",
        border: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
        borderRadius: 12,
        animation: "utilFadeUp 0.5s ease both" }}>
        <Flex alignItems="baseline" gap={8}>
          <Text style={{ fontSize: 32, fontWeight: 900, color: utilColor, fontFamily: "system-ui, sans-serif", animation: "utilCountUp 0.6s ease both 0.2s" }}>{overallUtilizationLevel}%</Text>
          <Text style={{ fontSize: 14, fontWeight: 700, color: utilColor, opacity: 0.85 }}>{utilBand}</Text>
        </Flex>
        <Text style={{ width: 1, alignSelf: "stretch", margin: "4px 0", background: dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)", borderRadius: 1 }} />
        <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: 600, color: textSec, letterSpacing: 0.5 }}>Overall Utilization Level</Text>
          <Flex flexDirection="column" style={{ height: 8, borderRadius: 4, overflow: "hidden", background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
            <Flex flexDirection="column" style={{
              height: "100%", borderRadius: 4,
              width: `${overallUtilizationLevel}%`,
              background: `linear-gradient(90deg, ${utilColor}99, ${utilColor})`,
              animation: "matBarFill 0.9s ease both 0.3s",
            }} />
          </Flex>
        </Flex>
        <Flex gap={8} style={{ flexShrink: 0 }}>
          {([
            { label: "FND", color: Colors.Charts.Categorical.Color01.Default, passed: totals.fnd, total: totals.fndT },
            { label: "BP", color: Colors.Charts.Status.Warning.Default, passed: totals.bp, total: totals.bpT },
            { label: "EXC", color: Colors.Charts.Status.Ideal.Default, passed: totals.exc, total: totals.excT },
          ] as const).map((t, i) => {
            const pct = t.total > 0 ? Math.round((t.passed / t.total) * 100) : 0;
            return (
              <Flex flexDirection="column" key={t.label} style={{
                textAlign: "center", padding: "6px 12px", borderRadius: 8,
                background: t.color + (dk ? "12" : "08"),
                border: `1px solid ${t.color}20`,
                animation: `matScaleIn 0.35s ease both ${0.4 + i * 0.1}s`,
              }}>
                <Text style={{ fontSize: 14, fontWeight: 800, color: t.color, lineHeight: 1 }}>{t.passed}/{t.total}</Text>
                <Text style={{ fontSize: 12, fontWeight: 700, color: t.color, opacity: 0.75, marginTop: 2, letterSpacing: 0.5 }}>{t.label} · {pct}%</Text>
              </Flex>
            );
          })}
        </Flex>
      </Flex>

      {/* Capability cards grid */}
      <Grid gridTemplateColumns={`repeat(auto-fill, minmax(${isMobile ? "260px" : "340px"}, 1fr))`} gap={16}>
        {sorted.map((cap, i) => (
          <Flex flexDirection="column" key={cap.name} style={{ animation: `utilFadeUp 0.4s ease both ${0.15 + i * 0.06}s` }}>
            <UtilizationCard cap={cap} dk={dk} text={text} textSec={textSec} textTert={textTert} collapseKey={collapseKey} davisState={davisRecommendations?.[cap.name]} onSendFollowUp={onSendFollowUp} onRequestInsight={onRequestInsight} onExplain={onExplain} adoption={adoptionByCapability ? { users: adoptionByCapability[cap.name]?.users ?? 0, rate: adoptionByCapability[cap.name]?.rate ?? 0, totalUsers: adoptionTotalUsers ?? 0, apps: adoptionByCapability[cap.name]?.apps ?? [] } : undefined} />
          </Flex>
        ))}
      </Grid>

      {/* Quick-start guide */}
      <Flex flexDirection="column" style={{
        marginTop: 24, padding: "16px 20px", borderRadius: 12,
        background: dk ? "rgba(0,200,83,0.05)" : "rgba(0,200,83,0.03)",
        border: `1px solid ${dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.08)"}`,
        animation: `utilFadeUp 0.4s ease both ${0.15 + sorted.length * 0.06 + 0.1}s`,
      }}>
        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Suggested Approach</Flex>
        <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.7 }}>
          <Strong style={{ color: text }}>1.</Strong> Identify capabilities with <Strong style={{ color: Colors.Text.Critical.Default }}>low Utilization scores</Strong> — these need the most attention.{" "}
          <Strong style={{ color: text }}>2.</Strong> For each, complete the <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation</Strong> tier first — it carries <Strong style={{ color: text }}>60% weight</Strong>.{" "}
          <Strong style={{ color: text }}>3.</Strong> Then advance to <Strong style={{ color: Colors.Charts.Status.Warning.Default }}>Best Practice</Strong> (25% weight) and <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}>Excellence</Strong> (15% weight).{" "}
          <Strong style={{ color: text }}>4.</Strong> Click any card to see <Strong style={{ color: text }}>which specific criteria</Strong> are missing in each tier.
        </Text>
      </Flex>
    </Flex>
  );
}

/* ── Single Utilization Card ── */
function UtilizationCard({ cap, dk, text, textSec, textTert, collapseKey, davisState, onSendFollowUp, onRequestInsight, onExplain, adoption }: {
  cap: CapabilityResult;
  dk: boolean; text: string; textSec: string; textTert: string; collapseKey: number;
  davisState?: DavisRecommendationState;
  onSendFollowUp?: (capabilityName: string, text: string) => Promise<void>;
  onRequestInsight?: (capabilityName: string) => Promise<void>;
  onExplain?: (capabilityName: string) => void;
  adoption?: { users: number; rate: number; totalUsers: number; apps: { appId: string; users: number }[] };
}) {
  const [expanded, setExpanded] = useState(false);
  React.useEffect(() => { setExpanded(false); }, [collapseKey]);
  const m = cap.utilization;
  const effectiveMat = cap.effectiveUtilizationScore;
  const scoreColor = utilizationBandColor(effectiveMat);

  return (
    <Flex flexDirection="column"
      onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setExpanded(!expanded); }}
      style={{
        background: Colors.Background.Container.Neutral.Default,
        border: `1px solid ${Colors.Border.Neutral.Default}`,
        borderRadius: 12, padding: "16px 20px",
        borderLeft: `4px solid ${cap.consolidation < 100 ? Colors.Charts.Status.Warning.Default : cap.color}`,
        cursor: "pointer",
        transition: "box-shadow 0.2s, transform 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 6px 20px ${cap.color}22`; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <Flex flexDirection="column" gap={6} style={{ marginBottom: 12 }}>
        <Flex alignItems="flex-start" justifyContent="space-between" gap={8}>
          <Text style={{ fontSize: 14, fontWeight: 700, color: text, overflowWrap: "normal", wordBreak: "normal" }}>{cap.name}</Text>
          <Text style={{ fontSize: 12, color: textSec, fontWeight: 600, flexShrink: 0 }}>{expanded ? "▾" : "▸"}</Text>
        </Flex>
        <Flex alignItems="center" gap={6} flexWrap="wrap">
          {onExplain && (
            <Text
              role="button" tabIndex={0}
              aria-label={`Explain ${cap.name} results`}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpanded(true); onExplain(cap.name); }}
              onKeyDown={(e: React.KeyboardEvent) => {
                e.stopPropagation();
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(true); onExplain(cap.name); }
              }}
              style={{
                fontSize: 10, fontWeight: 700, cursor: "pointer",
                padding: "2px 8px", borderRadius: 6, userSelect: "none",
                whiteSpace: "nowrap", flexShrink: 0,
                color: Colors.Text.Primary.Default,
                background: Colors.Text.Primary.Default + (dk ? "20" : "15"),
                border: `1px solid ${Colors.Text.Primary.Default}${dk ? "40" : "30"}`,
              }}
            >
              Explain
            </Text>
          )}
          <Text style={{ fontSize: 12, fontWeight: 800, padding: "2px 12px", borderRadius: 6, background: scoreColor + (dk ? "25" : "15"), color: scoreColor, fontFamily: "system-ui, sans-serif", whiteSpace: "nowrap", flexShrink: 0 }}>{effectiveMat}%</Text>
          <Text style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 4, color: scoreColor, opacity: 0.8, whiteSpace: "nowrap", flexShrink: 0 }}>{m.utilizationBand}</Text>
        </Flex>
      </Flex>

      {cap.consolidation < 100 && (
        <Flex alignItems="center" gap={6} style={{ marginBottom: 8, padding: "3px 8px", borderRadius: 6,
          background: dk ? "rgba(255,170,50,0.08)" : "rgba(255,170,50,0.05)",
          border: `1px solid ${dk ? "rgba(255,170,50,0.15)" : "rgba(255,170,50,0.12)"}` }}>
          <Text style={{ fontSize: 10, fontWeight: 700, color: Colors.Charts.Status.Warning.Default, letterSpacing: 0.3 }}>
            CONSOLIDATION: {cap.consolidation}% in Dynatrace
          </Text>
          <Text style={{ fontSize: 10, color: dk ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)" }}>
            DT utilization {cap.utilization.utilizationScore}% → adjusted {effectiveMat}%
          </Text>
        </Flex>
      )}

      <Flex flexDirection="column" style={{ marginBottom: 12 }}>
        <Flex flexDirection="column" style={{ height: 8, borderRadius: 4, overflow: "hidden", background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
          <Flex flexDirection="column" style={{ height: "100%", borderRadius: 4, width: `${effectiveMat}%`, background: `linear-gradient(90deg, ${scoreColor}cc, ${scoreColor})`, animation: "matBarFill 0.8s ease both 0.3s" }} />
        </Flex>
      </Flex>

      {TIER_META.map((t, ti) => {
        const tier = m[t.key];
        const pct = tier.total > 0 ? Math.round((tier.passed / tier.total) * 100) : 0;
        const weight = t.key === "foundation" ? "60%" : t.key === "bestPractice" ? "25%" : "15%";
        return (
          <Flex flexDirection="column" key={t.key} style={{ marginBottom: 5 }}>
            <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: textSec }}>{t.label} <Text style={{ fontWeight: 400, color: textTert }}>({weight})</Text></Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? Colors.Text.Success.Default : pct > 0 ? text : textTert }}>{tier.passed}/{tier.total}</Text>
            </Flex>
            <Flex flexDirection="column" style={{ height: 5, borderRadius: 3, overflow: "hidden", background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              <Flex flexDirection="column" style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: pct === 100 ? Colors.Text.Success.Default : t.color, animation: `matBarFill 0.7s ease both ${0.45 + ti * 0.15}s` }} />
            </Flex>
          </Flex>
        );
      })}

      {adoption && (() => {
        const users = adoption.users;
        const pct = adoption.rate;
        const color = users === 0
          ? Colors.Charts.Status.Warning.Default
          : Colors.Charts.Categorical.Color08?.Default ?? Colors.Text.Primary.Default;
        const appNames = adoption.apps.slice(0, 2).map(a => a.appId).join(", ");
        return (
          <Flex flexDirection="column" style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${dk ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}` }}>
            <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: textSec }}>
                Adoption <Text style={{ fontWeight: 400, color: textTert }}>(last 30d)</Text>
              </Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: users === 0 ? Colors.Charts.Status.Warning.Default : text }}>
                {users === 0 ? "no users" : `${users} of ${adoption.totalUsers} (${pct}%)`}
              </Text>
            </Flex>
            <Flex flexDirection="column" style={{ height: 5, borderRadius: 3, overflow: "hidden", background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              <Flex flexDirection="column" style={{ height: "100%", borderRadius: 3, width: `${users === 0 ? 0 : Math.max(4, pct)}%`, background: color, animation: "matBarFill 0.7s ease both 0.9s" }} />
            </Flex>
            <Text style={{ fontSize: 10, color: textTert, marginTop: 3 }}>
              {users === 0 ? "Nobody opened the apps that serve this capability." : appNames ? `via ${appNames}` : ""}
            </Text>
          </Flex>
        );
      })()}

      {expanded && (
        <Flex flexDirection="column" style={{ marginTop: 12, borderTop: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`, paddingTop: 12 }}>
          {davisState !== undefined && (
            <DavisInsightSection state={davisState} capabilityName={cap.name} onSendFollowUp={onSendFollowUp} onRequestInsight={onRequestInsight} />
          )}
          {TIER_META.map(t => {
            const criteria = cap.criteriaResults.filter(cr => cr.tier === t.key);
            if (criteria.length === 0) return null;
            return (
              <Flex flexDirection="column" key={t.key} style={{ marginBottom: 12 }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: t.color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{t.label}</Flex>
                {criteria.map(cr => (
                  <UtilizationCriterionRow key={cr.id} cr={cr} dk={dk} text={text} textSec={textSec} textTert={textTert} collapseKey={collapseKey} />
                ))}
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}

/* ── Single criterion row inside UtilizationCard ── */
function UtilizationCriterionRow({ cr, dk, text, textSec, textTert, collapseKey }: {
  cr: CapabilityResult["criteriaResults"][number];
  dk: boolean; text: string; textSec: string; textTert: string; collapseKey: number;
}) {
  const [open, setOpen] = useState(false);
  React.useEffect(() => { setOpen(false); }, [collapseKey]);
  const passed = !cr.error && cr.points > 0;
  const statusColor = cr.notApplicable ? Colors.Text.Neutral.Disabled : passed ? Colors.Text.Success.Default : Colors.Text.Critical.Default;
  const importance = CRITERION_IMPORTANCE[cr.id] || "";
  const remediation = CRITERION_REMEDIATION[cr.id];

  return (
    <Flex flexDirection="column" style={{ marginBottom: 2 }}>
      <Flex
        onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setOpen(!open); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: 12, borderRadius: 6, cursor: "pointer",
          background: open ? (dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)") : "transparent",
          transition: "background 0.15s" }}
      >
        <Text style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: statusColor }} />
        <Tooltip text={criterionTooltipContent(cr.id, cr.description, cr.tier)} containerStyle={{ flex: 1 }} maxWidth={340}>
          <Flex alignItems="center" gap={6}>
            <Text style={{ color: passed ? text : textSec }}>{cr.label}</Text>
            {cr.proxied && (
              <Text style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: Colors.Text.Warning.Default, background: Colors.Background.Container.Warning.Default, border: `1px solid ${Colors.Border.Warning.Default}`, borderRadius: 6, padding: "0px 5px" }}>≈ proxy</Text>
            )}
          </Flex>
        </Tooltip>
        {cr.notApplicable ? (
          <Text style={{ fontSize: 12, color: textTert, fontWeight: 700 }}>N/A</Text>
        ) : cr.value > 0 && (
          <Text style={{ fontSize: 12, color: textTert, fontWeight: 600 }}>{cr.isRatio ? `${cr.value}%` : cr.value.toLocaleString()}</Text>
        )}
        <Text style={{ fontSize: 12, color: textTert, fontWeight: 600 }}>{open ? "▾" : "▸"}</Text>
      </Flex>

      {open && (
        <Flex flexDirection="column"
          onClick={(e) => e.stopPropagation()}
          style={{ margin: "4px 0 8px 16px", padding: "12px 16px", borderRadius: 8,
            background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.015)",
            border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
            borderLeft: `3px solid ${statusColor}`,
            animation: "fadeIn 0.2s ease" }}
        >
          <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.6, marginBottom: 12 }}>{cr.description}</Flex>

          {!passed && !cr.error && !cr.notApplicable && (
            <Flex style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12,
              padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
              border: `1px solid ${dk ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.12)"}` }}>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 12, color: textTert }}>Measured:</Text>
                <Text style={{ fontSize: 14, fontWeight: 800, color: Colors.Text.Critical.Default }}>
                  {cr.isRatio ? `${cr.value}%` : cr.value.toLocaleString()}
                </Text>
              </Flex>
              <Text style={{ color: dk ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)" }}>│</Text>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 12, color: textTert }}>Minimum:</Text>
                <Text style={{ fontSize: 14, fontWeight: 800, color: Colors.Text.Success.Default }}>
                  {cr.isRatio
                    ? `${cr.thresholds.split(", ")[0]?.match(/[≥≤](\d+)/)?.[1] ?? "1"}%`
                    : cr.thresholds.split(", ")[0]?.match(/[≥≤](\d+)/)?.[1] ?? "1"
                  }
                </Text>
              </Flex>
            </Flex>
          )}

          {cr.error && (
            <Flex style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12,
              padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
              border: `1px solid ${dk ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.12)"}`,
              fontSize: 12, color: Colors.Text.Critical.Default, fontWeight: 600 }}>
              ⚠ Query execution failed — check connectivity and permissions
            </Flex>
          )}

          {cr.notApplicable && !cr.error && (
            <Flex style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12,
              padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
              border: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
              fontSize: 12, color: textTert, fontWeight: 600 }}>
              Not applicable for this tenant based on discovered inventory or signal presence.
            </Flex>
          )}

          {importance && (
            <Flex flexDirection="column" style={{ marginBottom: 12 }}>
              <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textTert, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>Why it matters</Flex>
              <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>{importance}</Flex>
            </Flex>
          )}

          {remediation && !passed && !cr.notApplicable && (
            <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6,
              background: dk ? "rgba(0,200,83,0.06)" : "rgba(0,200,83,0.03)",
              border: `1px solid ${dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.08)"}` }}>
              <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Success.Default, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>How to Evolve</Flex>
              <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>{remediation.action}</Flex>
              {remediation.docLink && (
                <ExternalLink href={remediation.docLink} onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ display: "inline-block", marginTop: 6 }}>
                  Open Dynatrace Docs →
                </ExternalLink>
              )}
            </Flex>
          )}

          {passed && (
            <Flex alignItems="center" gap={6} style={{ padding: "6px 12px", borderRadius: 6, background: dk ? "rgba(0,200,83,0.06)" : "rgba(0,200,83,0.03)" }}>
              <Text style={{ fontSize: 14 }}>✓</Text>
              <Text style={{ fontSize: 12, color: Colors.Text.Success.Default, fontWeight: 600 }}>
                {cr.isRatio ? `Criterion met — ${cr.value}% coverage` : cr.value > 0 ? `Criterion met — ${cr.value.toLocaleString()} detected` : `Criterion met`}
              </Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

/* ── EXECUTIVE SUMMARY VIEW ── */

const recAnimStyle = `
@keyframes recFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes recBarFill { from { width: 0%; } }
@keyframes recScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes recCountUp { from { opacity: 0; } to { opacity: 1; } }
@media print {
  body, html { background: #fff !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { animation: none !important; transition: none !important; box-shadow: none !important; }
  [data-rec-root] { overflow: visible !important; height: auto !important; padding: 0 !important; }
  [data-no-print] { display: none !important; }
  [data-rec-card] { break-inside: avoid; page-break-inside: avoid; }
}
`;

function RecommendationsView({ capabilities, dk, text, textSec, textTert, totalScore, overallUtilizationLevel, collapseKey, history, onDrilldown, onRadarMount, isMobile, adoption }: {
  capabilities: CapabilityResult[];
  dk: boolean; text: string; textSec: string; textTert: string;
  totalScore: number; overallUtilizationLevel: number; collapseKey: number;
  history: ReturnType<typeof useAssessmentHistory>;
  onDrilldown: (mode: ViewMode) => void;
  onRadarMount: (handle: CovUtilRadarHandle | null) => void;
  isMobile: boolean;
  adoption?: {
    byCapability: Record<string, { users: number; rate: number }>;
    totalUsers: number;
    windowDays: number;
  };
}) {
  const borderSub = dk ? "rgba(91,106,207,0.25)" : "rgba(0,0,0,0.08)";
  const card = dk ? "rgba(20,22,40,0.85)" : "rgba(248,249,252,0.9)";
  const cardGlow = dk ? "0 0 12px rgba(91,106,207,0.12), inset 0 1px 0 rgba(255,255,255,0.04)" : "0 1px 6px rgba(0,0,0,0.06)";
  const covBandC = utilizationBandColor(totalScore);
  const utilBandC = utilizationBandColor(overallUtilizationLevel);
  const adoptionC = Colors.Charts.Categorical.Color12.Default;
  const labelC = Colors.Text.Neutral.Subdued;
  const bandLabel = sharedBandLabel;

  const adoptionPct = useMemo(() => {
    if (!adoption || adoption.totalUsers === 0) return null;
    const rates = capabilities.map(c => adoption.byCapability[c.name]?.rate ?? 0);
    if (rates.length === 0) return null;
    return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
  }, [adoption, capabilities]);

  const tierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const cap of capabilities) for (const cr of cap.criteriaResults) m[cr.id] = cr.tier;
    return m;
  }, [capabilities]);

  const sortedSnaps = useMemo(() =>
    [...history.snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [history.snapshots]
  );

  const evolution = useMemo(() => sortedSnaps.map(snap => {
    const ti: Record<string, { t: number; p: number }> = { foundation: { t: 0, p: 0 }, bestPractice: { t: 0, p: 0 }, excellence: { t: 0, p: 0 } };
    for (const cap of snap.capabilities)
      for (const cr of cap.criteriaResults) {
        const tier = tierMap[cr.id];
        if (tier && ti[tier]) { ti[tier].t++; if (!cr.error && cr.points > 0) ti[tier].p++; }
      }
    const fP = ti.foundation.t > 0 ? ti.foundation.p / ti.foundation.t : 0;
    const bP = ti.bestPractice.t > 0 ? ti.bestPractice.p / ti.bestPractice.t : 0;
    const eP = ti.excellence.t > 0 ? ti.excellence.p / ti.excellence.t : 0;
    const effB = fP >= 0.8 ? bP : 0;
    const effE = effB >= 0.6 ? eP : 0;
    return { date: snap.timestamp, cov: snap.totalScore, mat: Math.round(fP * 60 + effB * 25 + effE * 15) };
  }), [sortedSnaps, tierMap]);

  const prevSnap = evolution.length >= 2 ? evolution[evolution.length - 2] : null;
  const covDelta = prevSnap ? totalScore - prevSnap.cov : null;
  const utilDelta = prevSnap ? overallUtilizationLevel - prevSnap.mat : null;

  const capGaps = useMemo(() =>
    capabilities.map(cap => {
      const gaps = cap.criteriaResults.filter(cr => !cr.error && !cr.notApplicable && cr.points === 0);
      const critical = gaps.filter(cr => cr.value === 0).length;
      const quickWin = gaps.filter(cr => cr.isRatio && cr.value > 0 && cr.value < 100).length;
      const other = gaps.length - critical - quickWin;
      return { name: cap.name, color: cap.color, cov: cap.score, mat: cap.effectiveUtilizationScore, total: gaps.length, critical, quickWin, other };
    }).sort((a, b) => b.total - a.total),
    [capabilities]
  );
  const totalGaps = capGaps.reduce((s, c) => s + c.total, 0);

  const sorted = useMemo(() => [...capabilities].sort((a, b) => a.name.localeCompare(b.name)), [capabilities]);

  const scatterPoints = useMemo(() =>
    capabilities.map(c => ({ name: c.name, x: c.score, y: c.effectiveUtilizationScore, color: c.color })),
    [capabilities]
  );

  const totalCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.filter(cr => !cr.notApplicable).length, 0);
  const passedCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.filter(cr => !cr.error && !cr.notApplicable && cr.points > 0).length, 0);
  const totalCritical = capGaps.reduce((s, c) => s + c.critical, 0);
  const topGapCap = capGaps.length > 0 ? capGaps[0] : null;
  const bestCap = [...capabilities].sort((a, b) => b.score - a.score)[0] ?? null;
  const worstCap = [...capabilities].sort((a, b) => a.score - b.score)[0] ?? null;
  const bestMatCap = [...capabilities].sort((a, b) => b.effectiveUtilizationScore - a.effectiveUtilizationScore)[0] ?? null;
  const worstMatCap = [...capabilities].sort((a, b) => a.effectiveUtilizationScore - b.effectiveUtilizationScore)[0] ?? null;
  const excellentCount = capabilities.filter(c => c.score >= 80).length;
  const goodCount = capabilities.filter(c => c.score >= 60 && c.score < 80).length;
  const criticalCount = capabilities.filter(c => c.score < 20).length;
  const lowCount = capabilities.filter(c => c.score >= 20 && c.score < 40).length;
  const fullCoverageCaps = capabilities.filter(c => c.score === 100);

  const [expandedChart, setExpandedChart] = useState<"radar" | "bubble" | null>(null);

  return (
    <Flex data-rec-root flexDirection="column" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 20px" }}>
      <style>{recAnimStyle}</style>

      <Flex flexDirection="column" style={{ fontSize: 14, fontWeight: 800, color: text, marginBottom: 1, letterSpacing: 0.2, animation: "recFadeUp 0.3s ease both" }}>
        Executive Summary
      </Flex>
      <Flex flexDirection="column" style={{ fontSize: 11, color: textSec, marginBottom: 6, lineHeight: 1.4, animation: "recFadeUp 0.3s ease both 0.05s" }}>
        Overall assessment of observability coverage and Utilization across {capabilities.length} capabilities · {totalCriteria} criteria evaluated
      </Flex>

      {/* SECTION 1: Highlights */}
      <Flex flexDirection="column" style={{ borderRadius: 10, border: `1px solid ${borderSub}`, background: card, padding: "6px 14px", boxShadow: cardGlow, marginBottom: 6, animation: "recFadeUp 0.5s ease both" }}>
        {/* Row 1: Scores */}
        <Flex alignItems="center" gap={0} flexWrap="wrap" style={{ marginBottom: 4 }}>
          <Flex alignItems="center" gap={8} style={{ flex: "1 1 200px", padding: "2px 0" }}>
            <Flex style={{ width: 3, height: 24, borderRadius: 2, background: covBandC, boxShadow: dk ? `0 0 6px ${covBandC}40` : "none" }} />
            <Flex flexDirection="column">
              <Text style={{ fontSize: 11, fontWeight: 700, color: labelC, letterSpacing: 0.4, marginBottom: 0 }}>COVERAGE</Text>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 20, fontWeight: 900, color: covBandC, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{totalScore}%</Text>
                <Text style={{ fontSize: 11, fontWeight: 600, color: covBandC, opacity: 0.8 }}>{bandLabel(totalScore)}</Text>
                {covDelta !== null && covDelta !== 0 && (
                  <Text style={{ fontSize: 12, fontWeight: 700, color: covDelta > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default }}>
                    {covDelta > 0 ? "▲" : "▼"}{Math.abs(covDelta)}pp
                  </Text>
                )}
              </Flex>
            </Flex>
            <MiniBar pct={totalScore} color={covBandC} dk={dk} />
          </Flex>

          <Flex style={{ width: 1, height: 24, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", margin: "0 12px", flexShrink: 0 }} />

          <Flex alignItems="center" gap={8} style={{ flex: "1 1 200px", padding: "2px 0" }}>
            <Flex style={{ width: 3, height: 24, borderRadius: 2, background: utilBandC, boxShadow: dk ? `0 0 6px ${utilBandC}40` : "none" }} />
            <Flex flexDirection="column">
              <Text style={{ fontSize: 11, fontWeight: 700, color: labelC, letterSpacing: 0.4, marginBottom: 0 }}>UTILIZATION</Text>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 20, fontWeight: 900, color: utilBandC, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{overallUtilizationLevel}%</Text>
                <Text style={{ fontSize: 11, fontWeight: 600, color: utilBandC, opacity: 0.8 }}>{bandLabel(overallUtilizationLevel)}</Text>
                {utilDelta !== null && utilDelta !== 0 && (
                  <Text style={{ fontSize: 12, fontWeight: 700, color: utilDelta > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default }}>
                    {utilDelta > 0 ? "▲" : "▼"}{Math.abs(utilDelta)}pp
                  </Text>
                )}
              </Flex>
            </Flex>
            <MiniBar pct={overallUtilizationLevel} color={utilBandC} dk={dk} />
          </Flex>

          {adoptionPct !== null && (
            <>
              <Flex style={{ width: 1, height: 24, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", margin: "0 12px", flexShrink: 0 }} />
              <Flex alignItems="center" gap={8} style={{ flex: "1 1 200px", padding: "2px 0" }}>
                <Flex style={{ width: 3, height: 24, borderRadius: 2, background: adoptionC, boxShadow: dk ? `0 0 6px ${adoptionC}40` : "none" }} />
                <Flex flexDirection="column">
                  <Text style={{ fontSize: 11, fontWeight: 700, color: labelC, letterSpacing: 0.4, marginBottom: 0 }}>ADOPTION</Text>
                  <Flex alignItems="baseline" gap={4}>
                    <Text style={{ fontSize: 20, fontWeight: 900, color: adoptionC, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{adoptionPct}%</Text>
                    <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>
                      avg · {adoption!.totalUsers} active users · {adoption!.windowDays}d
                    </Text>
                  </Flex>
                </Flex>
                <MiniBar pct={adoptionPct} color={adoptionC} dk={dk} />
              </Flex>
            </>
          )}

          <Flex style={{ width: 1, height: 24, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", margin: "0 12px", flexShrink: 0 }} />
          <Flex alignItems="center" gap={12} style={{ flexShrink: 0 }}>
            <Flex flexDirection="column" style={{ textAlign: "center" as const }}>
              <Text style={{ fontSize: 14, fontWeight: 900, color: Colors.Text.Primary.Default, lineHeight: 1 }}>{capabilities.length}</Text>
              <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, marginTop: 1, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Capabilities</Text>
            </Flex>
            <Flex flexDirection="column" style={{ textAlign: "center" as const }}>
              <Flex alignItems="baseline" style={{ fontSize: 14, fontWeight: 900, color: Colors.Text.Primary.Default, lineHeight: 1, justifyContent: "center" }}>{passedCriteria}<Text style={{ fontSize: 10, fontWeight: 600, color: labelC }}>/{totalCriteria}</Text></Flex>
              <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, marginTop: 1, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Criteria Met</Text>
            </Flex>
          </Flex>
        </Flex>

        {/* Row 2: Achievements vs Gaps */}
        <Grid gridTemplateColumns={isMobile ? "1fr" : "1fr 1fr"} gap={6}>
          <Flex flexDirection="column" style={{ borderRadius: 8, padding: "4px 10px", background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)", borderLeft: "3px solid " + Colors.Text.Success.Default, animation: "recScaleIn 0.35s ease both 0.55s" }}>
            <Flex alignItems="center" gap={6} style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 13 }}>✓</Text>
              <Text style={{ fontSize: 11, fontWeight: 800, color: Colors.Text.Success.Default, letterSpacing: 0.5, textTransform: "uppercase" as const }}>Achievements</Text>
              <Text style={{ fontSize: 13, fontWeight: 900, color: text, marginLeft: "auto", fontFamily: "system-ui, sans-serif" }}>{passedCriteria}</Text>
            </Flex>
            <Flex flexDirection="column" gap={2}>
              <Flex alignItems="center" justifyContent="space-between">
                <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Criteria passed</Text>
                <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{passedCriteria}<Text style={{ color: labelC, fontWeight: 600 }}>/{totalCriteria}</Text></Text>
              </Flex>
              {excellentCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Excellent capabilities (≥80%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{excellentCount}</Text>
                </Flex>
              )}
              {goodCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Good capabilities (60–79%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{goodCount}</Text>
                </Flex>
              )}
              {fullCoverageCaps.length > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Full coverage (100%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{fullCoverageCaps.length}</Text>
                </Flex>
              )}
              {bestCap && (
                <Flex alignItems="center" justifyContent="space-between" style={{ marginTop: 1, padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: bestCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Top Capability</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{bestCap.name}</Text>
                    {bestCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{bestCap.consolidation}% DT</Text>}
                  </Flex>
                  <Flex alignItems="center" gap={4} style={{ flexShrink: 0, marginLeft: 8 }}>
                    {bestCap.consolidation < 100 && <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Disabled, textDecoration: "line-through" }}>{bestCap.rawScore}%</Text>}
                    <Text style={{ fontSize: 13, fontWeight: 900, color: utilizationBandColor(bestCap.score), fontFamily: "system-ui, sans-serif" }}>{bestCap.score}%</Text>
                  </Flex>
                </Flex>
              )}
              {bestMatCap && bestMatCap.name !== bestCap?.name && (
                <Flex alignItems="center" justifyContent="space-between" style={{ padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: bestMatCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Top Utilization</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{bestMatCap.name}</Text>
                    {bestMatCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{bestMatCap.consolidation}% DT</Text>}
                  </Flex>
                  <Text style={{ fontSize: 13, fontWeight: 900, color: utilizationBandColor(bestMatCap.effectiveUtilizationScore), fontFamily: "system-ui, sans-serif", flexShrink: 0, marginLeft: 8 }}>{bestMatCap.effectiveUtilizationScore}%</Text>
                </Flex>
              )}
            </Flex>
          </Flex>

          <Flex flexDirection="column" style={{ borderRadius: 8, padding: "4px 10px", background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)", borderLeft: "3px solid " + Colors.Text.Critical.Default, animation: "recScaleIn 0.35s ease both 0.65s" }}>
            <Flex alignItems="center" gap={6} style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 13 }}>✗</Text>
              <Text style={{ fontSize: 11, fontWeight: 800, color: Colors.Text.Critical.Default, letterSpacing: 0.5, textTransform: "uppercase" as const }}>Gaps</Text>
              <Text style={{ fontSize: 13, fontWeight: 900, color: totalGaps > 0 ? Colors.Text.Critical.Default : Colors.Text.Success.Default, marginLeft: "auto", fontFamily: "system-ui, sans-serif" }}>{totalGaps}</Text>
            </Flex>
            <Flex flexDirection="column" gap={2}>
              <Flex alignItems="center" justifyContent="space-between">
                <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Critical gaps (value = 0)</Text>
                <Text style={{ fontSize: 13, fontWeight: 800, color: totalCritical > 0 ? Colors.Text.Critical.Default : text }}>{totalCritical}</Text>
              </Flex>
              {criticalCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Critical capabilities (&lt;20%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: Colors.Text.Critical.Default }}>{criticalCount}</Text>
                </Flex>
              )}
              {lowCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Low capabilities (20–39%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: Colors.Text.Warning.Default }}>{lowCount}</Text>
                </Flex>
              )}
              {worstCap && (
                <Flex alignItems="center" justifyContent="space-between" style={{ marginTop: 1, padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: worstCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Needs Attention</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{worstCap.name}</Text>
                    {worstCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{worstCap.consolidation}% DT</Text>}
                  </Flex>
                  <Flex alignItems="center" gap={4} style={{ flexShrink: 0, marginLeft: 8 }}>
                    {worstCap.consolidation < 100 && <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Disabled, textDecoration: "line-through" }}>{worstCap.rawScore}%</Text>}
                    <Text style={{ fontSize: 13, fontWeight: 900, color: utilizationBandColor(worstCap.score), fontFamily: "system-ui, sans-serif" }}>{worstCap.score}%</Text>
                  </Flex>
                </Flex>
              )}
              {topGapCap && topGapCap.name !== worstCap?.name && (
                <Flex alignItems="center" justifyContent="space-between" style={{ padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Most Gaps</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{topGapCap.name}</Text>
                  </Flex>
                  <Text style={{ fontSize: 13, fontWeight: 900, color: Colors.Text.Warning.Default, flexShrink: 0, marginLeft: 8 }}>{topGapCap.total} gaps</Text>
                </Flex>
              )}
            </Flex>
          </Flex>
        </Grid>
      </Flex>

      {/* SECTIONS 2 & 3: Charts side by side */}
      <Flex gap={12} flexWrap="wrap" style={{ marginBottom: 0 }}>
        <Flex flexDirection="column" data-rec-card style={{ flex: "1 1 300px", minWidth: 0, borderRadius: 12, border: `1px solid ${borderSub}`, background: card, padding: "6px 14px 6px", boxShadow: cardGlow, overflow: "visible", animation: "recFadeUp 0.4s ease both 0.75s" }}>
          <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: labelC, letterSpacing: 0.5 }}>Coverage by Capability</Flex>
            <ExpandChartButton onClick={() => setExpandedChart("radar")} />
          </Flex>
          <Flex flexDirection="column" style={{ height: "clamp(300px, 44vh, 460px)", minHeight: 300 }}>
            <CovUtilRadar coverageOnly ref={(h: CovUtilRadarHandle | null) => { onRadarMount(h); }} data={sorted.map(c => ({ name: c.name, coverage: c.score, utilization: c.effectiveUtilizationScore, color: c.color, rawCoverage: c.consolidation < 100 ? c.rawScore : undefined, rawUtilization: c.consolidation < 100 ? c.utilization.utilizationScore : undefined }))} />
          </Flex>
        </Flex>

        <ExpandableChartModal open={expandedChart === "radar"} onClose={() => setExpandedChart(null)} title="Coverage by Capability">
          <Flex flexDirection="column" style={{ width: "100%", height: "100%" }}>
            <CovUtilRadar coverageOnly data={sorted.map(c => ({ name: c.name, coverage: c.score, utilization: c.effectiveUtilizationScore, color: c.color, rawCoverage: c.consolidation < 100 ? c.rawScore : undefined, rawUtilization: c.consolidation < 100 ? c.utilization.utilizationScore : undefined }))} />
          </Flex>
        </ExpandableChartModal>

        <Flex flexDirection="column" data-rec-card style={{ flex: "1 1 300px", minWidth: 0, borderRadius: 12, border: `1px solid ${borderSub}`, background: card, padding: "6px 14px 6px", boxShadow: cardGlow, overflow: "visible", animation: "recFadeUp 0.4s ease both 0.85s" }}>
          <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: labelC, letterSpacing: 0.5 }}>Capability Map — Coverage × Utilization</Flex>
            <ExpandChartButton onClick={() => setExpandedChart("bubble")} />
          </Flex>
          <Flex flexDirection="column" style={{ height: "clamp(300px, 44vh, 460px)", minHeight: 300 }}>
            <CapabilityScatter data={scatterPoints} dotRadius={5} />
          </Flex>
        </Flex>
      </Flex>

      <ExpandableChartModal open={expandedChart === "bubble"} onClose={() => setExpandedChart(null)} title="Capability Map — Coverage × Utilization">
        <Flex flexDirection="column" style={{ width: "100%", height: "100%" }}>
          <CapabilityScatter data={scatterPoints} dotRadius={7} />
        </Flex>
      </ExpandableChartModal>
    </Flex>
  );
}
