import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { ExternalLink, Text, Strong, Code } from "@dynatrace/strato-components/typography";
import { Flex, Grid, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Menu } from "@dynatrace/strato-components-preview/navigation";
import { ProgressBar } from "@dynatrace/strato-components/content";
import type { CoverageData, ViewMode, CapabilityResult } from "../hooks/useCoverageData";
import { TechRadar, maturity } from "../components/TechRadar";
import { ConnectorLines } from "../components/ConnectorLines";
import { ChartLabels } from "../components/ChartLabels";
import { CapabilityCards } from "../components/CapabilityCards";
import { Tooltip } from "../components/Tooltip";
import { ExpandableChartModal, ExpandChartButton } from "../components/ExpandableChartModal";
import { CAPABILITIES } from "../queries";
import { CAP_SUMMARIES } from "../data/capSummaries";
import { CRITERION_IMPORTANCE } from "../data/criterionImportance";
import { CRITERION_REMEDIATION } from "../data/criterionRemediation";
import { APP_ICON } from "../data/appIcon";
import { APP_VERSION } from "../appVersion";
import { type ReportLang } from "../reports/reportI18n";
import { generateFirstDayReport } from "../reports/generateFirstDayReport";
import { usePreflight, type PreflightCheck } from "../hooks/usePreflight";
import type { useAssessmentHistory } from "../hooks/useAssessmentHistory";
import { CovMatRadar, renderRadarToDataURL, type CovMatRadarHandle } from "../components/CovMatRadar";
import { CapabilityScatter, renderScatterToDataURL } from "../components/CapabilityScatter";
import { ConsolidationPanel } from "../components/ConsolidationPanel";
import type { ConsolidationPanelHandle } from "../components/ConsolidationPanel";
import { SegmentedControl } from "../components/SegmentedControl";

const SCALE = SCORE_BANDS.map(b => ({
  l: b.label,
  c: b.token,
  hex: b.color,
  r: `${b.min}-${b.max === 100 ? 100 : b.max - 1}%`,
  tip: b.label === "N/A" ? "Critical gaps — the capability is barely adopted or has no data flowing."
     : b.label === "Low" ? "Early adoption — some data exists but significant gaps remain."
     : b.label === "Moderate" ? "Partial coverage — key areas configured but important criteria still missing."
     : b.label === "Good" ? "Strong adoption — most criteria met with room for further optimization."
     : "Full or near-full coverage — the capability is well-adopted and comprehensive.",
}));

const R_RATIO = 0.34;

function formatRecords(n: number): string {
  return n.toLocaleString();
}

import { scoreColor as maturityBandColor, scoreTokenColor, bandLabel as sharedBandLabel, SCORE_BANDS, SCORE_BAND_TOKENS } from "../utils/colors";

const TIER_META: { key: "foundation" | "bestPractice" | "excellence"; label: string; color: string }[] = [
  { key: "foundation", label: "Foundation", color: Colors.Charts.Categorical.Color01.Default },
  { key: "bestPractice", label: "Best Practice", color: Colors.Charts.Status.Warning.Default },
  { key: "excellence", label: "Excellence", color: Colors.Charts.Status.Ideal.Default },
];

const MiniBar = React.memo(({ pct, color, dk, h = 6 }: { pct: number; color: string; dk: boolean; h?: number }) => (
  <Flex flexDirection="column" style={{ width: "100%", height: h, borderRadius: h / 2, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", overflow: "hidden" }}>
    <Flex style={{ height: "100%", width: `${Math.min(100, pct)}%`, borderRadius: h / 2, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
  </Flex>
));

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

interface Props {
  history: ReturnType<typeof useAssessmentHistory>;
  coverageData: CoverageData;
}

export const CoverageAssessment: React.FC<Props> = ({ history, coverageData }) => {
  const { capabilities, totalScore, overallMaturityLevel, loading, idle, progress, error, tenant, date, stats, entityCounts, liveScannedRecords, consolidation, setConsolidation, start, refresh, reset, goHome, resume } = coverageData;
  const navigate = useNavigate();
  const lastSavedRef = useRef<string>("");
  const [anim, setAnim] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [chartSize, setChartSize] = useState(500);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCap, setSelectedCap] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("coverage");
  const [collapseKey, setCollapseKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expandedPolar, setExpandedPolar] = useState(false);
  const radarHandleRef = useRef<CovMatRadarHandle | null>(null);
  const wasLoadingRef = useRef(false);
  const [excludedCaps, setExcludedCaps] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(false);

  const toggleCap = useCallback((name: string) => {
    setExcludedCaps(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const startFiltered = useCallback(() => {
    // If nothing excluded → full assessment (pass nothing)
    if (excludedCaps.size === 0) {
      start();
    } else {
      const filtered = CAPABILITIES.filter(c => !excludedCaps.has(c.name));
      start(filtered.length > 0 ? filtered : undefined);
    }
  }, [start, excludedCaps]);

  const t0 = useRef<number>(0);
  const dk = useCurrentTheme() === "dark";


  /* ── First Day Results Report (Value & Impact) ── */
  const generateClientReport = useCallback((lang: ReportLang = "en") => {
    if (exporting || capabilities.length === 0) return;
    setExporting(true);
    setTimeout(() => {
      try {
        generateFirstDayReport({ capabilities, totalScore, tenant, date, stats, entityCounts }, lang);
      } finally {
        setExporting(false);
      }
    }, 0);
  }, [capabilities, exporting, tenant, date, stats, entityCounts, totalScore]);

  // Save snapshot only when an assessment run finishes (loading transitions true → false)
  useEffect(() => {
    if (loading) {
      wasLoadingRef.current = true;
      return;
    }
    if (wasLoadingRef.current && capabilities.length > 0) {
      wasLoadingRef.current = false;
      const sig = capabilities.map(c => `${c.name}:${c.score}`).join(",");
      if (sig !== lastSavedRef.current) {
        lastSavedRef.current = sig;
        history.saveSnapshot(capabilities, totalScore, tenant);
      }
    }
  }, [loading, capabilities, totalScore, tenant, history]);

  // Animate on data load
  useEffect(() => {
    if (loading || capabilities.length === 0) return;
    setAnim(0);
    t0.current = performance.now();
    let animId: number;
    const run = (now: number) => {
      const p = Math.min((now - t0.current) / 1400, 1);
      setAnim(1 - Math.pow(1 - p, 3));
      if (p < 1) animId = requestAnimationFrame(run);
    };
    animId = requestAnimationFrame(run);
    return () => cancelAnimationFrame(animId);
  }, [loading, capabilities]);

  // Auto-size chart — use ResizeObserver for notebook/embedded containers
  useEffect(() => {
    const el = rootRef.current;
    let tid: ReturnType<typeof setTimeout>;
    const calc = () => {
      const vh = el ? el.offsetHeight || window.innerHeight : window.innerHeight;
      const vw = el ? el.offsetWidth : window.innerWidth;
      const mobile = vw < 640;
      setIsMobile(mobile);
      // Reserve space for toolbar (~50px) + collapsed guide bar (~32px) + padding
      const reserve = mobile ? 100 : 140;
      const maxSide = Math.min(vh - reserve, vw - (mobile ? 32 : 400), 720);
      setChartSize(Math.max(maxSide, mobile ? 200 : 220));
    };
    const debounced = () => { clearTimeout(tid); tid = setTimeout(calc, 100); };
    calc();
    if (el && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(debounced);
      ro.observe(el);
      return () => { ro.disconnect(); clearTimeout(tid); };
    }
    window.addEventListener("resize", debounced);
    return () => { window.removeEventListener("resize", debounced); clearTimeout(tid); };
  }, []);



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

  // Theme colors — using Strato design tokens for automatic dark/light adaptation
  const colors = useMemo(() => ({
    bg: Colors.Background.Base.Default,
    bgSurface: Colors.Background.Surface.Default,
    bgSubtle: Colors.Background.Container.Neutral.Subdued,
    bgPrimary: Colors.Background.Container.Primary.Default,
    text: Colors.Text.Neutral.Default,
    textSec: Colors.Text.Neutral.Subdued,
    textTert: Colors.Text.Neutral.Disabled,
    accent: Colors.Text.Primary.Default,
    border: Colors.Border.Neutral.Default,
    borderPri: Colors.Border.Primary.Default,
    borderSub: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
    bgHover: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
  }), [dk]);
  const { bg, bgSurface, bgSubtle, bgPrimary, text, textSec, textTert, accent, border, borderPri } = colors;
  const borderSub = colors.borderSub;
  const bgHover = colors.bgHover;

  return (
    <Flex flexDirection="column" ref={rootRef}
      onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const dp = mouseDownPos.current;
        if (dp && (Math.abs(e.clientX - dp.x) > 5 || Math.abs(e.clientY - dp.y) > 5)) return;
        setActiveIdx(null); setSelectedCap(null); setCollapseKey(k => k + 1);
      }} style={{ height: "100%",
      overflow: "auto", boxSizing: "border-box", padding: "0",
      fontFamily: "inherit",
      background: bg, color: text, transition: "background 0.4s, color 0.4s" }}>
      {/* Idle State — capability overview + start */}
      {idle && !loading && (
        <Grid gridTemplateColumns={isMobile ? "1fr" : "380px 1fr"} gridTemplateRows="minmax(0,1fr)" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left panel — memoized so it never re-renders on card interactions */}
          <IdleLeftPanel
            dk={dk} text={text} textSec={textSec} textTert={textTert}
            accent={accent} bgSubtle={bgSubtle} bgPrimary={bgPrimary}
            border={border} borderPri={borderPri}
            tenant={tenant} start={startFiltered} resume={resume}
            totalScore={totalScore} hasResults={capabilities.length > 0}
            exporting={exporting}
            onGenerateReport={(lang: ReportLang) => generateClientReport(lang)}
            selectedCount={CAPABILITIES.length - excludedCaps.size}
            totalCount={CAPABILITIES.length}
            consolidation={consolidation}
            onConsolidationChange={setConsolidation}
            excludedCaps={excludedCaps}
          />

          {/* Right panel — Capability cards */}
          <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ overflowY: "scroll", padding: "20px 24px", minHeight: 0 }}>
            {selectedCap ? (
              <IdleCapDetail
                cap={CAPABILITIES.find(c => c.name === selectedCap)!}
                dk={dk} text={text} textSec={textSec} textTert={textTert}
                bgSubtle={bgSubtle} border={border}
                onBack={() => setSelectedCap(null)}
                collapseKey={collapseKey}
              />
            ) : (
              <>
              <Container color="primary" variant="default" style={{ marginBottom: 16 }}>
                <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
                  <Flex flexDirection="column" style={{ fontSize: 14, fontWeight: 700, color: text }}>{CAPABILITIES.length} Capabilities Available</Flex>
                  {excludedCaps.size > 0 ? (
                    <Flex alignItems="center" gap={8}>
                      <Text style={{ fontSize: 12, fontWeight: 700, color: accent, background: accent + "15", padding: "2px 10px", borderRadius: 8 }}>{CAPABILITIES.length - excludedCaps.size} / {CAPABILITIES.length} selected</Text>
                      <Text style={{ fontSize: 11, color: accent, cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                        onClick={() => setExcludedCaps(new Set())}>Select All</Text>
                    </Flex>
                  ) : (
                    <Text style={{ fontSize: 11, fontWeight: 600, color: Colors.Text.Success.Default }}>✓ Full Assessment</Text>
                  )}
                </Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>
                  Use the <Strong style={{ color: text }}>☑ checkbox</Strong> on each card to choose which capabilities to assess.
                  Click the card body to explore criteria details.
                  {excludedCaps.size === 0 ? " All capabilities are included — the assessment will run in full." : excludedCaps.size === CAPABILITIES.length ? "" : ` ${excludedCaps.size} capability${excludedCaps.size > 1 ? "ies" : "y"} excluded — only selected ones will be evaluated.`}
                </Text>
                {excludedCaps.size === CAPABILITIES.length && (
                  <Text style={{ fontSize: 12, fontWeight: 600, color: Colors.Text.Critical.Default, marginTop: 4 }}>
                    ⚠ All capabilities are deselected. Please select at least one to run the assessment.
                  </Text>
                )}
              </Container>
              <Grid gridTemplateColumns={`repeat(auto-fill, minmax(${isMobile ? "260px" : "340px"}, 1fr))`} gap={16}>
                {CAPABILITIES.map((cap) => (
                  <IdleCapCard key={cap.name} cap={cap} dk={dk} text={text} textSec={textSec} textTert={textTert}
                    bgSurface={bgSurface} bgSubtle={bgSubtle} border={border}
                    selected={!excludedCaps.has(cap.name)}
                    onToggle={() => toggleCap(cap.name)}
                    onClick={() => setSelectedCap(cap.name)} />
                ))}
              </Grid>
              </>
            )}
          </Flex>
        </Grid>
      )}

      {/* Loading State */}
      {loading && (
        <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={16} style={{ flex: 1 }}>
          <Flex flexDirection="column" style={{ fontSize: 16, fontWeight: 700, color: text }}>Running Assessment</Flex>
          <Flex flexDirection="column" style={{ width: "clamp(280px, 50%, 480px)" }}>
            <ProgressBar value={progress} color="primary" aria-label="Assessment progress" />
          </Flex>
          <Flex flexDirection="column" alignItems="center" gap={4}>
            <Flex flexDirection="column" style={{ fontSize: 13, color: textSec }}>{progress}% — Querying {capabilities.length > 0 ? capabilities.length : CAPABILITIES.length} capabilities via DQL</Flex>
            {liveScannedRecords > 0 && (
              <Flex flexDirection="column" style={{ fontSize: 12, color: textTert }}>
                {formatRecords(liveScannedRecords)} records scanned
              </Flex>
            )}
          </Flex>
        </Flex>
      )}

      {/* Chart */}
      {!idle && !loading && capabilities.length > 0 && (
        <>
          {/* Toolbar */}
          <Flex alignItems="center" gap={8} flexWrap="wrap" style={{ padding: "6px 16px", flexShrink: 0, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` }}>
            <Button onClick={goHome} size="condensed">← Back</Button>
            <Button onClick={refresh} size="condensed">↻ Refresh</Button>
            {/* View Mode Toggle */}
            <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 4 }}>
              <SegmentedControl
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: "coverage", label: "Coverage" },
                  { value: "maturity", label: "Maturity" },
                  { value: "recommendations", label: "Executive Summary" },
                ]}
              />
            </Flex>
            <Button onClick={() => navigate("/compare")} variant="emphasized" color="primary">
              Evolution Over Time
              {history.snapshots.length > 0 && (
                <Button.Suffix>
                  <Text style={{
                    fontSize: 12, fontWeight: 800, color: Colors.Text.Primary.Default,
                    background: Colors.Background.Surface.Default, borderRadius: 8,
                    padding: "1px 6px", minWidth: 14, textAlign: "center",
                    lineHeight: "14px",
                  }}>{Math.min(history.snapshots.length, 12)}</Text>
                </Button.Suffix>
              )}
            </Button>
            <Button onClick={() => navigate("/tenant-review")} size="condensed">
              Tenant Review
            </Button>
            <Menu>
              <Menu.Trigger>
                <Button loading={exporting} size="condensed">
                  First Day Results
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onSelect={() => generateClientReport("en")}>Download English (EN)</Menu.Item>
                <Menu.Item onSelect={() => generateClientReport("pt")}>Download Portugues (PT)</Menu.Item>
                <Menu.Item onSelect={() => generateClientReport("es")}>Download Espanol (ES)</Menu.Item>
              </Menu.Content>
            </Menu>
            <Text style={{ marginLeft: "auto", fontSize: 12, color: textSec }}>
              Tenant: <Text style={{ fontWeight: 600, color: text }}>{tenant}</Text> · {date}
              {stats && (
                <Text style={{ marginLeft: 8, fontSize: 12, color: stats.failed > 0 ? Colors.Text.Warning.Default : Colors.Text.Success.Default }}>
                  · {stats.succeeded}/{stats.total} queries OK{stats.failed > 0 ? ` (${stats.failed} failed)` : ""}
                </Text>
              )}
              {stats && stats.scannedRecords > 0 && (
                <Text style={{ marginLeft: 8, fontSize: 12, color: textSec }}>
                  · {formatRecords(stats.scannedRecords)} records scanned
                </Text>
              )}
            </Text>
          </Flex>
          {/* Main content: chart left, cards right — stacks vertically on mobile */}
          <Flex style={{ flex: 1, flexDirection: isMobile ? "column" : "row", minHeight: 0, overflow: "auto" }}>
          {viewMode === "coverage" ? (<>
            {/* Left: chart + scale */}
            <Flex flexDirection="column" alignItems="center" justifyContent="center" style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "visible", position: "relative" }}>
              <ExpandChartButton onClick={() => setExpandedPolar(true)} style={{ position: "absolute", top: 4, right: 8, zIndex: 10 }} />
              <Flex flexDirection="column" style={{ position: "relative", width: chartSize, height: chartSize, flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const idx = hitTest(e);
                  const N = capabilities.length;
                  setActiveIdx(idx >= 0 && idx < N ? (activeIdx === idx ? null : idx) : null);
                }}>
                <ConnectorLines capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} />
                <TechRadar capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} />
                <ChartLabels capabilities={capabilities} anim={anim} activeIdx={activeIdx} size={chartSize} onSelect={(idx: number | null) => {
                  setActiveIdx(idx);
                  if (idx !== null) {
                    setTimeout(() => {
                      const card = document.querySelector(`[data-cap-idx="${idx}"]`);
                      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }, 100);
                  }
                }} />
              </Flex>
            </Flex>

            {/* ── Expanded TechRadar Modal ── */}
            <ExpandableChartModal open={expandedPolar} onClose={() => setExpandedPolar(false)} maxWidth={1100} maxHeight={1000}>
              <Flex flexDirection="column" alignItems="center" style={{ width: "100%", height: "100%" }}>
                <Flex alignItems="center" justifyContent="center" style={{ flex: 1, minHeight: 0, width: "100%" }}>
                  {(() => {
                    const modalSize = Math.min(window.innerWidth * 0.75, window.innerHeight * 0.7, 900);
                    return (
                      <Flex flexDirection="column" style={{ position: "relative", width: modalSize, height: modalSize }}>
                        <ConnectorLines capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} />
                        <TechRadar capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} />
                        <ChartLabels capabilities={capabilities} anim={1} activeIdx={activeIdx} size={modalSize} onSelect={(idx: number | null) => setActiveIdx(idx)} />
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
              <CapabilityCards capabilities={capabilities} anim={anim} activeIdx={activeIdx} onSelect={setActiveIdx} />
            </Flex>
          </>) : viewMode === "maturity" ? (
            <MaturityView capabilities={capabilities} dk={dk} text={text} textSec={textSec} textTert={textTert} overallMaturityLevel={overallMaturityLevel} collapseKey={collapseKey} isMobile={isMobile} />
          ) : (
            <RecommendationsView capabilities={capabilities} dk={dk} text={text} textSec={textSec} textTert={textTert} totalScore={totalScore} overallMaturityLevel={overallMaturityLevel} collapseKey={collapseKey} history={history} onDrilldown={setViewMode} onRadarMount={(h) => { radarHandleRef.current = h; }} isMobile={isMobile} />
          )}
          </Flex>

          {/* How to Analyze — collapsible footer */}
          {(viewMode === "coverage" || viewMode === "maturity") && (
          <Flex flexDirection="column" style={{ flexShrink: 0, borderTop: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"}`, background: dk ? "rgba(65,105,225,0.04)" : "rgba(65,105,225,0.02)" }}>
            <Flex alignItems="center" gap={6} style={{ padding: "6px 20px", cursor: "pointer", userSelect: "none" }}
              onClick={(e) => { e.stopPropagation(); setShowGuide(g => !g); }}>
              <Text style={{ fontSize: 12, fontWeight: 800, color: text, letterSpacing: 0.2 }}>
                How to Analyze — {viewMode === "coverage" ? "Coverage" : "Maturity"} View
              </Text>
              <Text style={{ fontSize: 10, color: textSec, transition: "transform 0.2s", transform: showGuide ? "rotate(180deg)" : "rotate(0deg)" }}>▼</Text>
            </Flex>
            {showGuide && (viewMode === "coverage" ? (
            <Flex flexDirection="column" style={{ padding: "0 20px 12px" }}>
            <Grid gridTemplateColumns={isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))"} gap={12}>

              <Flex flexDirection="column" style={{
                padding: "8px 12px", borderRadius: 6,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>What You're Seeing</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                  The radar chart shows <Strong style={{ color: text }}>how much</Strong> of each capability is used. Each of the <Strong style={{ color: text }}>{capabilities.length} axes</Strong> represents one capability. The <Strong style={{ color: text }}>filled area</Strong> reveals adoption breadth.
                </Text>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "8px 12px", borderRadius: 6,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>How to Read the Score</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                  Each capability scores <Strong style={{ color: text }}>0–100%</Strong> based on <Strong style={{ color: text }}>criteria met</Strong>. <Text style={{ color: Colors.Text.Success.Default, fontWeight: 700 }}>Green</Text> = met, <Text style={{ color: Colors.Text.Critical.Default, fontWeight: 700 }}>red</Text> = not met. Click a capability to drill down.
                </Text>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "8px 12px", borderRadius: 6,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 3 }}>What to Look For</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.55 }}>
                  <Strong style={{ color: text }}>Flat axes</Strong> = low adoption. <Strong style={{ color: text }}>Asymmetric shapes</Strong> = uneven usage. Aim for a <Strong style={{ color: text }}>balanced, expanded radar</Strong>.
                </Text>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "8px 12px", borderRadius: 6,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
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

              <Flex flexDirection="column" style={{
                padding: "12px 16px", borderRadius: 8,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>What You're Seeing</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.65 }}>
                  Each card shows a <Strong style={{ color: text }}>weighted maturity score</Strong> (0–100%) per capability. The score combines three tiers: <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation</Strong> (60% weight), <Strong style={{ color: Colors.Charts.Status.Warning.Default }}>Best Practice</Strong> (25%), and <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}>Excellence</Strong> (15%). Cards are sorted from lowest to highest maturity.
                </Text>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "12px 16px", borderRadius: 8,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Weighted Tiers</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.65 }}>
                  <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation (60%)</Strong> — the essentials (hosts, services, basic data flow).
                  <Strong style={{ color: Colors.Charts.Status.Warning.Default }}> Best Practice (25%)</Strong> — deeper adoption (trace correlation, advanced metrics).
                  <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}> Excellence (15%)</Strong> — advanced maturity (multi-service traces, guardrails, cost tracking).
                </Text>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "12px 16px", borderRadius: 8,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Maturity Bands</Flex>
                <Flex flexDirection="column" gap={4} style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Critical.Default, fontWeight: 700 }}>N/A</Text> <Text style={{ color: textSec }}>0–19% — Minimal or no adoption</Text></Flex>
                  <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Categorical.Color14.Default, fontWeight: 700 }}>Low</Text> <Text style={{ color: textSec }}>20–39% — Early stage, significant gaps</Text></Flex>
                  <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Warning.Default, fontWeight: 700 }}>Moderate</Text> <Text style={{ color: textSec }}>40–59% — Partial adoption, key areas configured</Text></Flex>
                  <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Categorical.Color07.Default, fontWeight: 700 }}>Good</Text> <Text style={{ color: textSec }}>60–79% — Strong adoption, room to optimize</Text></Flex>
                  <Flex alignItems="center" gap={4}><Text style={{ color: Colors.Charts.Status.Ideal.Default, fontWeight: 700 }}>Excellent</Text> <Text style={{ color: textSec }}>80–100% — Comprehensive maturity</Text></Flex>
                </Flex>
              </Flex>

              <Flex flexDirection="column" style={{
                padding: "12px 16px", borderRadius: 8,
                background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
              }}>
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
      )}

      {/* Error State */}
      {error && (
        <Flex flexDirection="column" style={{ textAlign: "center", padding: 24, color: Colors.Text.Critical.Default }}>
          <Flex flexDirection="column" style={{ fontSize: 14, marginBottom: 8 }}>Assessment failed</Flex>
          <Flex flexDirection="column" style={{ fontSize: 12, color: textSec }}>{error}</Flex>
        </Flex>
      )}
    </Flex>
  );
};

/* ── MATURITY VIEW ── */
const maturityAnimStyle = `
@keyframes matFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes matBarFill { from { width: 0%; } }
@keyframes matScaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes matCountUp { from { opacity: 0; } to { opacity: 1; } }
`;

function MaturityView({ capabilities, dk, text, textSec, textTert, overallMaturityLevel, collapseKey, isMobile }: {
  capabilities: CapabilityResult[];
  dk: boolean; text: string; textSec: string; textTert: string;
  overallMaturityLevel: number; collapseKey: number; isMobile: boolean;
}) {
  const matBand = sharedBandLabel(overallMaturityLevel);
  const matColor = maturityBandColor(overallMaturityLevel);

  const totals = useMemo(() => capabilities.reduce((acc, c) => ({
    fnd: acc.fnd + c.maturity.foundation.passed,
    fndT: acc.fndT + c.maturity.foundation.total,
    bp: acc.bp + c.maturity.bestPractice.passed,
    bpT: acc.bpT + c.maturity.bestPractice.total,
    exc: acc.exc + c.maturity.excellence.passed,
    excT: acc.excT + c.maturity.excellence.total,
  }), { fnd: 0, fndT: 0, bp: 0, bpT: 0, exc: 0, excT: 0 }), [capabilities]);

  const sorted = useMemo(() => [...capabilities].sort((a, b) => a.effectiveMaturityScore - b.effectiveMaturityScore), [capabilities]);

  return (
    <Flex flexDirection="column" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
      <style>{maturityAnimStyle}</style>

      {/* ── Overall maturity hero ── */}
      <Flex alignItems="center" gap={20} style={{ marginBottom: 20, padding: "16px 24px",
        background: dk ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.015)",
        border: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
        borderRadius: 12,
        animation: "matFadeUp 0.5s ease both" }}>
        {/* Score + band */}
        <Flex alignItems="baseline" gap={8}>
          <Text style={{ fontSize: 32, fontWeight: 900, color: matColor, fontFamily: "system-ui, sans-serif", animation: "matCountUp 0.6s ease both 0.2s" }}>{overallMaturityLevel}%</Text>
          <Text style={{ fontSize: 14, fontWeight: 700, color: matColor, opacity: 0.85 }}>{matBand}</Text>
        </Flex>
        <Text style={{ width: 1, alignSelf: "stretch", margin: "4px 0", background: dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)", borderRadius: 1 }} />

        {/* Overall bar */}
        <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: 600, color: textSec, letterSpacing: 0.5 }}>Overall Maturity Level</Text>
          <Flex flexDirection="column" style={{ height: 8, borderRadius: 4, overflow: "hidden", background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
            <Flex flexDirection="column" style={{
              height: "100%", borderRadius: 4,
              width: `${overallMaturityLevel}%`,
              background: `linear-gradient(90deg, ${matColor}99, ${matColor})`,
              animation: "matBarFill 0.9s ease both 0.3s",
            }} />
          </Flex>
        </Flex>

        {/* Tier pills */}
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

      {/* ── Capability cards grid ── */}
      <Grid gridTemplateColumns={`repeat(auto-fill, minmax(${isMobile ? "260px" : "340px"}, 1fr))`} gap={16}>
        {sorted.map((cap, i) => (
          <Flex flexDirection="column" key={cap.name} style={{ animation: `matFadeUp 0.4s ease both ${0.15 + i * 0.06}s` }}>
            <MaturityCard cap={cap} dk={dk} text={text} textSec={textSec} textTert={textTert} collapseKey={collapseKey} />
          </Flex>
        ))}
      </Grid>

      {/* Quick-start guide */}
      <Flex flexDirection="column" style={{
        marginTop: 24, padding: "16px 20px", borderRadius: 12,
        background: dk ? "rgba(0,200,83,0.05)" : "rgba(0,200,83,0.03)",
        border: `1px solid ${dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.08)"}`,
        animation: `matFadeUp 0.4s ease both ${0.15 + sorted.length * 0.06 + 0.1}s`,
      }}>
        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: text, marginBottom: 6 }}>Suggested Approach</Flex>
        <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.7 }}>
          <Strong style={{ color: text }}>1.</Strong> Identify capabilities with <Strong style={{ color: Colors.Text.Critical.Default }}>low maturity scores</Strong> — these need the most attention.{" "}
          <Strong style={{ color: text }}>2.</Strong> For each, complete the <Strong style={{ color: Colors.Charts.Categorical.Color01.Default }}>Foundation</Strong> tier first — it carries <Strong style={{ color: text }}>60% weight</Strong>.{" "}
          <Strong style={{ color: text }}>3.</Strong> Then advance to <Strong style={{ color: Colors.Charts.Status.Warning.Default }}>Best Practice</Strong> (25% weight) and <Strong style={{ color: Colors.Charts.Status.Ideal.Default }}>Excellence</Strong> (15% weight).{" "}
          <Strong style={{ color: text }}>4.</Strong> Click any card to see <Strong style={{ color: text }}>which specific criteria</Strong> are missing in each tier.
        </Text>
      </Flex>
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

function RecommendationsView({ capabilities, dk, text, textSec, textTert, totalScore, overallMaturityLevel, collapseKey, history, onDrilldown, onRadarMount, isMobile }: {
  capabilities: CapabilityResult[];
  dk: boolean; text: string; textSec: string; textTert: string;
  totalScore: number; overallMaturityLevel: number; collapseKey: number;
  history: ReturnType<typeof useAssessmentHistory>;
  onDrilldown: (mode: ViewMode) => void;
  onRadarMount: (handle: CovMatRadarHandle | null) => void;
  isMobile: boolean;
}) {
  const borderSub = dk ? "rgba(91,106,207,0.25)" : "rgba(0,0,0,0.08)";
  const card = dk ? "rgba(20,22,40,0.85)" : "rgba(248,249,252,0.9)";
  const cardGlow = dk ? "0 0 12px rgba(91,106,207,0.12), inset 0 1px 0 rgba(255,255,255,0.04)" : "0 1px 6px rgba(0,0,0,0.06)";
  const COV_C = Colors.Charts.Categorical.Color01.Default;
  const MAT_C = Colors.Charts.Categorical.Color08.Default;
  const covBandC = maturityBandColor(totalScore);
  const matBandC = maturityBandColor(overallMaturityLevel);
  const labelC = Colors.Text.Neutral.Subdued;
  const bandLabel = sharedBandLabel;

  // ── Criterion → Tier map ──
  const tierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const cap of capabilities) for (const cr of cap.criteriaResults) m[cr.id] = cr.tier;
    return m;
  }, [capabilities]);

  // ── Snapshots sorted chronologically ──
  const sortedSnaps = useMemo(() =>
    [...history.snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [history.snapshots]
  );

  // ── Evolution data ──
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

  // ── Deltas from previous snapshot ──
  const prevSnap = evolution.length >= 2 ? evolution[evolution.length - 2] : null;
  const covDelta = prevSnap ? totalScore - prevSnap.cov : null;
  const matDelta = prevSnap ? overallMaturityLevel - prevSnap.mat : null;

  // ── Per-capability gaps ──
  const capGaps = useMemo(() =>
    capabilities.map(cap => {
      const gaps = cap.criteriaResults.filter(cr => !cr.error && cr.points === 0);
      const critical = gaps.filter(cr => cr.value === 0).length;
      const quickWin = gaps.filter(cr => cr.isRatio && cr.value > 0 && cr.value < 100).length;
      const other = gaps.length - critical - quickWin;
      return { name: cap.name, color: cap.color, cov: cap.score, mat: cap.effectiveMaturityScore, total: gaps.length, critical, quickWin, other };
    }).sort((a, b) => b.total - a.total),
    [capabilities]
  );
  const totalGaps = capGaps.reduce((s, c) => s + c.total, 0);

  // ── Sorted capabilities for charts ──
  const sorted = useMemo(() => [...capabilities].sort((a, b) => a.name.localeCompare(b.name)), [capabilities]);

  const scatterPoints = useMemo(() =>
    capabilities.map(c => ({
      name: c.name,
      x: c.score,
      y: c.effectiveMaturityScore,
      color: c.color,
    })),
    [capabilities]
  );

  // ── KPI helpers ──
  const totalCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.length, 0);
  const passedCriteria = capabilities.reduce((s, c) => s + c.criteriaResults.filter(cr => !cr.error && cr.points > 0).length, 0);
  const totalCritical = capGaps.reduce((s, c) => s + c.critical, 0);
  const totalQuickWin = capGaps.reduce((s, c) => s + c.quickWin, 0);
  const totalOther = capGaps.reduce((s, c) => s + c.other, 0);
  const topGapCap = capGaps.length > 0 ? capGaps[0] : null;
  const bestCap = [...capabilities].sort((a, b) => b.score - a.score)[0] ?? null;
  const worstCap = [...capabilities].sort((a, b) => a.score - b.score)[0] ?? null;
  const bestMatCap = [...capabilities].sort((a, b) => b.effectiveMaturityScore - a.effectiveMaturityScore)[0] ?? null;
  const worstMatCap = [...capabilities].sort((a, b) => a.effectiveMaturityScore - b.effectiveMaturityScore)[0] ?? null;
  const excellentCount = capabilities.filter(c => c.score >= 80).length;
  const goodCount = capabilities.filter(c => c.score >= 60 && c.score < 80).length;
  const criticalCount = capabilities.filter(c => c.score < 20).length;
  const lowCount = capabilities.filter(c => c.score >= 20 && c.score < 40).length;
  const fullCoverageCaps = capabilities.filter(c => c.score === 100);
  const zeroCoverageCaps = capabilities.filter(c => c.score === 0);

  const [expandedChart, setExpandedChart] = useState<"radar" | "bubble" | null>(null);

  return (
    <Flex data-rec-root flexDirection="column" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 20px" }}>
      <style>{recAnimStyle}</style>

      <Flex flexDirection="column" style={{ fontSize: 14, fontWeight: 800, color: text, marginBottom: 1, letterSpacing: 0.2, animation: "recFadeUp 0.3s ease both" }}>
        Executive Summary
      </Flex>
      <Flex flexDirection="column" style={{ fontSize: 11, color: textSec, marginBottom: 6, lineHeight: 1.4, animation: "recFadeUp 0.3s ease both 0.05s" }}>
        Overall assessment of observability coverage and maturity across {capabilities.length} capabilities · {totalCriteria} criteria evaluated
      </Flex>

      {/* ═══ SECTION 1: Highlights ═══ */}
      <Flex flexDirection="column" style={{
        borderRadius: 10, border: `1px solid ${borderSub}`, background: card,
        padding: "6px 14px", boxShadow: cardGlow, marginBottom: 6,
        animation: "recFadeUp 0.5s ease both",
      }}>

        {/* ── Row 1: Scores ── */}
        <Flex alignItems="center" gap={0} flexWrap="wrap" style={{ marginBottom: 4 }}>

          {/* Coverage score */}
          <Flex alignItems="center" gap={8} style={{ flex: "1 1 200px", padding: "2px 0" }}>
            <Flex style={{ width: 3, height: 24, borderRadius: 2, background: covBandC, boxShadow: dk ? `0 0 6px ${covBandC}40` : "none" }} />
            <Flex flexDirection="column">
              <Text style={{ fontSize: 11, fontWeight: 700, color: labelC, letterSpacing: 0.4, marginBottom: 0 }}>COVERAGE</Text>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 20, fontWeight: 900, color: covBandC, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{totalScore}%</Text>
                <Text style={{ fontSize: 11, fontWeight: 600, color: covBandC, opacity: 0.8 }}>{bandLabel(totalScore)}</Text>
                {covDelta !== null && covDelta !== 0 && (
                  <Text style={{ fontSize: 12, fontWeight: 700, color: covDelta > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default }}>
                    {covDelta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(covDelta)}pp
                  </Text>
                )}
              </Flex>
            </Flex>
            <MiniBar pct={totalScore} color={covBandC} dk={dk} />
          </Flex>

          <Flex style={{ width: 1, height: 24, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", margin: "0 12px", flexShrink: 0 }} />

          {/* Maturity score */}
          <Flex alignItems="center" gap={8} style={{ flex: "1 1 200px", padding: "2px 0" }}>
            <Flex style={{ width: 3, height: 24, borderRadius: 2, background: matBandC, boxShadow: dk ? `0 0 6px ${matBandC}40` : "none" }} />
            <Flex flexDirection="column">
              <Text style={{ fontSize: 11, fontWeight: 700, color: labelC, letterSpacing: 0.4, marginBottom: 0 }}>MATURITY</Text>
              <Flex alignItems="baseline" gap={4}>
                <Text style={{ fontSize: 20, fontWeight: 900, color: matBandC, fontFamily: "system-ui, sans-serif", lineHeight: 1 }}>{overallMaturityLevel}%</Text>
                <Text style={{ fontSize: 11, fontWeight: 600, color: matBandC, opacity: 0.8 }}>{bandLabel(overallMaturityLevel)}</Text>
                {matDelta !== null && matDelta !== 0 && (
                  <Text style={{ fontSize: 12, fontWeight: 700, color: matDelta > 0 ? Colors.Text.Success.Default : Colors.Text.Critical.Default }}>
                    {matDelta > 0 ? "\u25B2" : "\u25BC"}{Math.abs(matDelta)}pp
                  </Text>
                )}
              </Flex>
            </Flex>
            <MiniBar pct={overallMaturityLevel} color={matBandC} dk={dk} />
          </Flex>

          <Flex style={{ width: 1, height: 24, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", margin: "0 12px", flexShrink: 0 }} />

          {/* Quick stats */}
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

        {/* ── Row 2: Achievements vs Gaps (side by side) ── */}
        <Grid gridTemplateColumns={isMobile ? "1fr" : "1fr 1fr"} gap={6}>

          {/* Achievements column */}
          <Flex flexDirection="column" style={{
            borderRadius: 8, padding: "4px 10px",
            background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
            borderLeft: "3px solid " + Colors.Text.Success.Default,
            animation: "recScaleIn 0.35s ease both 0.55s",
          }}>
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

              {/* Excellent capabilities */}
              {excellentCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Excellent capabilities (≥80%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{excellentCount}</Text>
                </Flex>
              )}

              {/* Good capabilities */}
              {goodCount > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Good capabilities (60–79%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{goodCount}</Text>
                </Flex>
              )}

              {/* Full coverage */}
              {fullCoverageCaps.length > 0 && (
                <Flex alignItems="center" justifyContent="space-between">
                  <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Full coverage (100%)</Text>
                  <Text style={{ fontSize: 13, fontWeight: 800, color: text }}>{fullCoverageCaps.length}</Text>
                </Flex>
              )}

              {/* Best capability */}
              {bestCap && (
                <Flex alignItems="center" justifyContent="space-between" style={{ marginTop: 1, padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: bestCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Top Capability</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{bestCap.name}</Text>
                    {bestCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{bestCap.consolidation}% DT</Text>}
                  </Flex>
                  <Flex alignItems="center" gap={4} style={{ flexShrink: 0, marginLeft: 8 }}>
                    {bestCap.consolidation < 100 && <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Disabled, textDecoration: "line-through" }}>{bestCap.rawScore}%</Text>}
                    <Text style={{ fontSize: 13, fontWeight: 900, color: maturityBandColor(bestCap.score), fontFamily: "system-ui, sans-serif" }}>{bestCap.score}%</Text>
                  </Flex>
                </Flex>
              )}

              {/* Best maturity */}
              {bestMatCap && bestMatCap.name !== bestCap?.name && (
                <Flex alignItems="center" justifyContent="space-between" style={{ padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: bestMatCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Top Maturity</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{bestMatCap.name}</Text>
                    {bestMatCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{bestMatCap.consolidation}% DT</Text>}
                  </Flex>
                  <Text style={{ fontSize: 13, fontWeight: 900, color: maturityBandColor(bestMatCap.effectiveMaturityScore), fontFamily: "system-ui, sans-serif", flexShrink: 0, marginLeft: 8 }}>{bestMatCap.effectiveMaturityScore}%</Text>
                </Flex>
              )}
            </Flex>
          </Flex>

          {/* Gaps column */}
          <Flex flexDirection="column" style={{
            borderRadius: 8, padding: "4px 10px",
            background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
            borderLeft: "3px solid " + Colors.Text.Critical.Default,
            animation: "recScaleIn 0.35s ease both 0.65s",
          }}>
            <Flex alignItems="center" gap={6} style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 13 }}>✗</Text>
              <Text style={{ fontSize: 11, fontWeight: 800, color: Colors.Text.Critical.Default, letterSpacing: 0.5, textTransform: "uppercase" as const }}>Gaps</Text>
              <Text style={{ fontSize: 13, fontWeight: 900, color: totalGaps > 0 ? Colors.Text.Critical.Default : Colors.Text.Success.Default, marginLeft: "auto", fontFamily: "system-ui, sans-serif" }}>{totalGaps}</Text>
            </Flex>

            <Flex flexDirection="column" gap={2}>
              {/* Gap breakdown */}
              <Flex alignItems="center" justifyContent="space-between">
                <Text style={{ fontSize: 11, fontWeight: 600, color: labelC }}>Critical gaps (value = 0)</Text>
                <Text style={{ fontSize: 13, fontWeight: 800, color: totalCritical > 0 ? Colors.Text.Critical.Default : text }}>{totalCritical}</Text>
              </Flex>

              {/* Low/Critical caps */}
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

              {/* Worst capability */}
              {worstCap && (
                <Flex alignItems="center" justifyContent="space-between" style={{ marginTop: 1, padding: "3px 10px", borderRadius: 6, background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", borderLeft: worstCap.consolidation < 100 ? `2px solid ${Colors.Charts.Status.Warning.Default}` : undefined }}>
                  <Flex alignItems="center" gap={6}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: labelC, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Needs Attention</Text>
                    <Text style={{ fontSize: 11, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{worstCap.name}</Text>
                    {worstCap.consolidation < 100 && <Text style={{ fontSize: 9, fontWeight: 600, color: Colors.Charts.Status.Warning.Default }}>{worstCap.consolidation}% DT</Text>}
                  </Flex>
                  <Flex alignItems="center" gap={4} style={{ flexShrink: 0, marginLeft: 8 }}>
                    {worstCap.consolidation < 100 && <Text style={{ fontSize: 10, color: Colors.Text.Neutral.Disabled, textDecoration: "line-through" }}>{worstCap.rawScore}%</Text>}
                    <Text style={{ fontSize: 13, fontWeight: 900, color: maturityBandColor(worstCap.score), fontFamily: "system-ui, sans-serif" }}>{worstCap.score}%</Text>
                  </Flex>
                </Flex>
              )}

              {/* Most gaps capability */}
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

      {/* ═══ SECTIONS 2 & 3: Charts side by side ═══ */}
      <Flex gap={12} flexWrap="wrap" style={{ marginBottom: 0 }}>
        {/* ── Combo Bar-Line Chart — Coverage vs Maturity ── */}
        <Flex flexDirection="column" data-rec-card style={{ flex: "1 1 300px", minWidth: 0,
          borderRadius: 12, border: `1px solid ${borderSub}`, background: card,
          padding: "6px 14px 6px",
          boxShadow: cardGlow, overflow: "visible",
          animation: "recFadeUp 0.4s ease both 0.75s" }}>
          <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: labelC, letterSpacing: 0.5 }}>
              Coverage vs Maturity by Capability
            </Flex>
            <ExpandChartButton onClick={() => setExpandedChart("radar")} />
          </Flex>
          <Flex flexDirection="column" style={{ height: "clamp(260px, 38vh, 400px)", minHeight: 260 }}>
            <CovMatRadar ref={(h: CovMatRadarHandle | null) => { onRadarMount(h); }} data={sorted.map(c => ({ name: c.name, coverage: c.score, maturity: c.effectiveMaturityScore, color: c.color, rawCoverage: c.consolidation < 100 ? c.rawScore : undefined, rawMaturity: c.consolidation < 100 ? c.maturity.maturityScore : undefined }))} />
          </Flex>
        </Flex>

        {/* ── Expanded Radar Chart Modal ── */}
        <ExpandableChartModal open={expandedChart === "radar"} onClose={() => setExpandedChart(null)} title="Coverage vs Maturity by Capability">
          <Flex flexDirection="column" style={{ width: "100%", height: "100%" }}>
            <CovMatRadar data={sorted.map(c => ({ name: c.name, coverage: c.score, maturity: c.effectiveMaturityScore, color: c.color, rawCoverage: c.consolidation < 100 ? c.rawScore : undefined, rawMaturity: c.consolidation < 100 ? c.maturity.maturityScore : undefined }))} />
          </Flex>
        </ExpandableChartModal>

        {/* ── Scatter Chart — Capability Map ── */}
        <Flex flexDirection="column" data-rec-card style={{ flex: "1 1 300px", minWidth: 0,
          borderRadius: 12, border: `1px solid ${borderSub}`, background: card,
          padding: "6px 14px 6px",
          boxShadow: cardGlow, overflow: "visible",
          animation: "recFadeUp 0.4s ease both 0.85s" }}>
        <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
          <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: labelC, letterSpacing: 0.5 }}>
            Capability Map — Coverage × Maturity
          </Flex>
          <ExpandChartButton onClick={() => setExpandedChart("bubble")} />
        </Flex>
        <Flex flexDirection="column" style={{ height: "clamp(260px, 38vh, 400px)", minHeight: 260 }}>
          <CapabilityScatter data={scatterPoints} dotRadius={10} showLegend={false} />
        </Flex>
      </Flex>
      </Flex>

      {/* ── Expanded Scatter Chart Modal ── */}
      <ExpandableChartModal open={expandedChart === "bubble"} onClose={() => setExpandedChart(null)} title="Capability Map — Coverage × Maturity">
        <Flex flexDirection="column" style={{ width: "100%", height: "100%" }}>
          <CapabilityScatter data={scatterPoints} dotRadius={12} showLegend={false} />
        </Flex>
      </ExpandableChartModal>

      {/* ═══ Unified Legend ═══ */}
      <Flex alignItems="center" justifyContent="center" flexWrap="wrap" style={{ gap: "6px 16px", marginBottom: 0, marginTop: 8, padding: "6px 16px",
        borderRadius: 10, border: `1px solid ${borderSub}`, background: card, boxShadow: cardGlow }}>
        {/* Capability dots */}
        {capabilities.map(c => (
          <Flex key={c.name} alignItems="center" gap={4}>
            <Flex style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, boxShadow: dk ? `0 0 4px ${c.color}80` : "none" }} />
            <Text style={{ fontSize: 12, fontWeight: 600, color: labelC }}>{c.name}</Text>
          </Flex>
        ))}
      </Flex>

    </Flex>
  );
}

/* ── Single Maturity Card ── */
function MaturityCard({ cap, dk, text, textSec, textTert, collapseKey }: {
  cap: CapabilityResult;
  dk: boolean; text: string; textSec: string; textTert: string; collapseKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [collapseKey]);
  const m = cap.maturity;
  const effectiveMat = cap.effectiveMaturityScore;
  const scoreColor = maturityBandColor(effectiveMat);

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
      {/* Header */}
      <Flex alignItems="center" gap={8} style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: 700, color: text, flex: 1 }}>{cap.name}</Text>
        <Text style={{
          fontSize: 12, fontWeight: 800, padding: "2px 12px", borderRadius: 6,
          background: scoreColor + (dk ? "25" : "15"),
          color: scoreColor, fontFamily: "system-ui, sans-serif",
        }}>{effectiveMat}%</Text>
        <Text style={{
          fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
          color: scoreColor, opacity: 0.8,
        }}>{m.maturityBand}</Text>
        <Text style={{ fontSize: 12, color: textSec, fontWeight: 600 }}>{expanded ? "▾" : "▸"}</Text>
      </Flex>

      {/* Consolidation banner */}
      {cap.consolidation < 100 && (
        <Flex alignItems="center" gap={6} style={{ marginBottom: 8, padding: "3px 8px", borderRadius: 6,
          background: dk ? "rgba(255,170,50,0.08)" : "rgba(255,170,50,0.05)",
          border: `1px solid ${dk ? "rgba(255,170,50,0.15)" : "rgba(255,170,50,0.12)"}`,
        }}>
          <Text style={{ fontSize: 10, fontWeight: 700, color: Colors.Charts.Status.Warning.Default, letterSpacing: 0.3 }}>
            CONSOLIDATION: {cap.consolidation}% in Dynatrace
          </Text>
          <Text style={{ fontSize: 10, color: dk ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)" }}>
            DT maturity {cap.maturity.maturityScore}% → adjusted {effectiveMat}%
          </Text>
        </Flex>
      )}

      {/* Overall maturity bar */}
      <Flex flexDirection="column" style={{ marginBottom: 12 }}>
        <Flex flexDirection="column" style={{
          height: 8, borderRadius: 4, overflow: "hidden",
          background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
        }}>
          <Flex flexDirection="column" style={{
            height: "100%", borderRadius: 4,
            width: `${effectiveMat}%`,
            background: `linear-gradient(90deg, ${scoreColor}cc, ${scoreColor})`,
            animation: "matBarFill 0.8s ease both 0.3s",
          }} />
        </Flex>
      </Flex>

      {/* Tier bars */}
      {TIER_META.map((t, ti) => {
        const tier = m[t.key];
        const pct = tier.total > 0 ? Math.round((tier.passed / tier.total) * 100) : 0;
        const weight = t.key === "foundation" ? "60%" : t.key === "bestPractice" ? "25%" : "15%";
        return (
          <Flex flexDirection="column" key={t.key} style={{ marginBottom: 5 }}>
            <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: 600, color: textSec }}>{t.label} <Text style={{ fontWeight: 400, color: textTert }}>({weight})</Text></Text>
              <Text style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? Colors.Text.Success.Default : pct > 0 ? text : textTert }}>
                {tier.passed}/{tier.total}
              </Text>
            </Flex>
            <Flex flexDirection="column" style={{
              height: 5, borderRadius: 3, overflow: "hidden",
              background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
            }}>
              <Flex flexDirection="column" style={{
                height: "100%", borderRadius: 3,
                width: `${pct}%`,
                background: pct === 100 ? Colors.Text.Success.Default : t.color,
                animation: `matBarFill 0.7s ease both ${0.45 + ti * 0.15}s`,
              }} />
            </Flex>
          </Flex>
        );
      })}

      {/* Expanded: show criteria by tier with drilldown */}
      {expanded && (
        <Flex flexDirection="column" style={{ marginTop: 12, borderTop: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`, paddingTop: 12 }}>
          {TIER_META.map(t => {
            const criteria = cap.criteriaResults.filter(cr => cr.tier === t.key);
            if (criteria.length === 0) return null;
            return (
              <Flex flexDirection="column" key={t.key} style={{ marginBottom: 12 }}>
                <Flex flexDirection="column" style={{
                  fontSize: 12, fontWeight: 700, color: t.color,
                  textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
                }}>{t.label}</Flex>
                {criteria.map(cr => (
                  <MaturityCriterionRow key={cr.id} cr={cr} dk={dk} text={text} textSec={textSec} textTert={textTert} collapseKey={collapseKey} />
                ))}
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}

/* ── Card for grid view (click to zoom) ── */
/* ── Single criterion row inside MaturityCard with drilldown ── */
function MaturityCriterionRow({ cr, dk, text, textSec, textTert, collapseKey }: {
  cr: CapabilityResult["criteriaResults"][number];
  dk: boolean; text: string; textSec: string; textTert: string; collapseKey: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [collapseKey]);
  const passed = !cr.error && cr.points > 0;
  const importance = CRITERION_IMPORTANCE[cr.id] || "";
  const remediation = CRITERION_REMEDIATION[cr.id];

  return (
    <Flex flexDirection="column" style={{ marginBottom: 2 }}>
      <Flex
        onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setOpen(!open); }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 6px", fontSize: 12, borderRadius: 6, cursor: "pointer",
          background: open ? (dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)") : "transparent",
          transition: "background 0.15s",
        }}
      >
        <Text style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: passed ? Colors.Text.Success.Default : Colors.Text.Critical.Default,
        }} />
        <Tooltip text={criterionTooltipContent(cr.id, cr.description, cr.tier)} containerStyle={{ flex: 1 }} maxWidth={340}>
          <Text style={{ color: passed ? text : textSec }}>{cr.label}</Text>
        </Tooltip>
        {cr.value > 0 && (
          <Text style={{ fontSize: 12, color: textTert, fontWeight: 600 }}>{cr.isRatio ? `${cr.value}%` : cr.value.toLocaleString()}</Text>
        )}
        <Text style={{ fontSize: 12, color: textTert, fontWeight: 600 }}>{open ? "▾" : "▸"}</Text>
      </Flex>

      {open && (
        <Flex flexDirection="column"
          onClick={(e) => e.stopPropagation()}
          style={{
            margin: "4px 0 8px 16px", padding: "12px 16px", borderRadius: 8,
            background: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.015)",
            border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
            borderLeft: `3px solid ${passed ? Colors.Text.Success.Default : Colors.Text.Critical.Default}`,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {/* Description */}
          <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.6, marginBottom: 12 }}>
            {cr.description}
          </Flex>

          {/* Measured value badge — shows current vs target for failed criteria */}
          {!passed && !cr.error && (
            <Flex style={{
              display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12,
              padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
              border: `1px solid ${dk ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.12)"}`,
            }}>
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
                    ? `${cr.thresholds.split(", ").pop()?.match(/≥(\d+)/)?.[1] ?? "1"}%`
                    : cr.thresholds.split(", ").pop()?.match(/≥(\d+)/)?.[1] ?? "1"
                  }
                </Text>
              </Flex>
            </Flex>
          )}

          {/* Error badge */}
          {cr.error && (
            <Flex style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12,
              padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(229,57,53,0.08)" : "rgba(229,57,53,0.05)",
              border: `1px solid ${dk ? "rgba(229,57,53,0.18)" : "rgba(229,57,53,0.12)"}`,
              fontSize: 12, color: Colors.Text.Critical.Default, fontWeight: 600,
            }}>
              ⚠ Query execution failed — check connectivity and permissions
            </Flex>
          )}

          {/* Why it matters */}
          {importance && (
            <Flex flexDirection="column" style={{ marginBottom: 12 }}>
              <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textTert, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>Why it matters</Flex>
              <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>{importance}</Flex>
            </Flex>
          )}

          {/* How to evolve */}
          {remediation && !passed && (
            <Flex flexDirection="column" style={{
              padding: "8px 12px", borderRadius: 6,
              background: dk ? "rgba(0,200,83,0.06)" : "rgba(0,200,83,0.03)",
              border: `1px solid ${dk ? "rgba(0,200,83,0.12)" : "rgba(0,200,83,0.08)"}`,
            }}>
              <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Success.Default, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>
                How to Evolve
              </Flex>
              <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>
                {remediation.action}
              </Flex>
              {remediation.docLink && (
                <ExternalLink
                  href={remediation.docLink}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  style={{ display: "inline-block", marginTop: 6 }}
                >
                  Open Dynatrace Docs →
                </ExternalLink>
              )}
            </Flex>
          )}

          {/* Passed — confirmation */}
          {passed && (
            <Flex alignItems="center" gap={6} style={{ padding: "6px 12px", borderRadius: 6,
              background: dk ? "rgba(0,200,83,0.06)" : "rgba(0,200,83,0.03)" }}>
              <Text style={{ fontSize: 14 }}>✓</Text>
              <Text style={{ fontSize: 12, color: Colors.Text.Success.Default, fontWeight: 600 }}>
                {cr.isRatio
                  ? `Criterion met — ${cr.value}% coverage`
                  : cr.value > 0
                    ? `Criterion met — ${cr.value.toLocaleString()} detected`
                    : `Criterion met`
                }
              </Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

/* ── Left panel — memoized to prevent re-renders during card interactions ── */
const IdleLeftPanel = React.memo(function IdleLeftPanel({ dk, text, textSec, textTert, accent, bgSubtle, bgPrimary, border, borderPri, tenant, start, resume, totalScore, hasResults, exporting, onGenerateReport, selectedCount, totalCount, consolidation, onConsolidationChange, excludedCaps }: {
  dk: boolean; text: string; textSec: string; textTert: string;
  accent: string; bgSubtle: string; bgPrimary: string; border: string; borderPri: string;
  tenant: string; start: () => void; resume: () => void;
  totalScore: number; hasResults: boolean;
  exporting: boolean;
  onGenerateReport: (lang: ReportLang) => void;
  selectedCount: number; totalCount: number;
  consolidation: Record<string, number>;
  onConsolidationChange: (factors: Record<string, number>) => void;
  excludedCaps: Set<string>;
}) {
  const navigate = useNavigate();
  const preflight = usePreflight();
  const consolidationRef = React.useRef<ConsolidationPanelHandle>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const handleRunClick = useCallback(async () => {
    consolidationRef.current?.collapse();
    if (preflight.validated) {
      start();
      return;
    }
    await preflight.runPreflight();
  }, [preflight.validated, preflight.runPreflight, start]);

  // Auto-start assessment when preflight passes
  useEffect(() => {
    if (preflight.allPassed) {
      preflight.markValidated();
      preflight.reset();
      start();
    }
  }, [preflight.allPassed, preflight.markValidated, preflight.reset, start]);
  return (
    <Flex flexDirection="column" alignItems="center" gap={20} style={{ textAlign: "center",
      padding: "24px 20px", overflowY: "auto",
      background: bgSubtle,
      borderRight: `1px solid ${border}` }}>
      <Flex flexDirection="column">
        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: accent, marginBottom: 8, opacity: 0.8 }}>
          Dynatrace Platform
        </Flex>
        <Flex alignItems="center" justifyContent="center" gap={8}>
          <img src={APP_ICON} alt="" width={36} height={36} style={{ borderRadius: 8 }} />
          <Flex flexDirection="column" style={{ fontSize: 20, fontWeight: 800, color: text, letterSpacing: -0.5, lineHeight: 1.2 }}>
            ESA Tenant Evaluator
          </Flex>
        </Flex>
      </Flex>

      {/* Run Assessment button + preflight — right below title */}
      <Flex flexDirection="column" alignItems="center">
        {/* Consolidation Context — above Run button */}
        <ConsolidationPanel
          ref={consolidationRef}
          consolidation={consolidation}
          onApply={onConsolidationChange}
          dk={dk} text={text} textSec={textSec} accent={accent} border={border}
          excludedCaps={excludedCaps}
        />
        {/* Preflight validation results */}
        {(preflight.running || preflight.hasFails) && (
          <Flex flexDirection="column" style={{
            width: "100%", maxWidth: 340, marginBottom: 12, borderRadius: 10,
            background: dk ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)",
            border: `1px solid ${preflight.hasFails ? Colors.Border.Critical.Default : border}`,
            overflow: "hidden",
          }}>
            <Flex alignItems="center" gap={8} style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700,
              color: preflight.hasFails ? Colors.Text.Critical.Default : accent,
              borderBottom: `1px solid ${border}` }}>
              {preflight.running ? "⏳" : preflight.hasFails ? "⚠" : "✓"} Pre-flight Validation
            </Flex>
            <Flex flexDirection="column" style={{ padding: "8px 16px" }}>
              {preflight.checks.map(c => (
                <Flex key={c.id} alignItems="flex-start" gap={8} style={{ padding: "6px 0", borderBottom: `1px solid ${border}20` }}>
                  <Text style={{ fontSize: 14, lineHeight: 1.2, flexShrink: 0, marginTop: 1 }}>
                    {c.status === "pending" ? "○" : c.status === "running" ? "◌" : c.status === "ok" ? "✓" : "✗"}
                  </Text>
                  <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
                    <Flex flexDirection="column" style={{
                      fontSize: 12, fontWeight: 600,
                      color: c.status === "ok" ? Colors.Text.Success.Default : c.status === "fail" ? Colors.Text.Critical.Default : textSec,
                    }}>
                      {c.label}
                    </Flex>
                    {c.status === "fail" && c.detail && (
                      <Flex flexDirection="column" style={{ fontSize: 11, color: Colors.Text.Critical.Default, marginTop: 2, lineHeight: 1.4 }}>
                        {c.detail}
                      </Flex>
                    )}
                    {c.status === "fail" && (
                      <Flex flexDirection="column" style={{ fontSize: 11, color: textTert, marginTop: 2, lineHeight: 1.4 }}>
                        Required scope: <Code style={{ fontSize: 10, padding: "1px 4px", borderRadius: 3, background: dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }}>{c.scope}</Code>
                      </Flex>
                    )}
                  </Flex>
                </Flex>
              ))}
            </Flex>
            {preflight.hasFails && (
              <Flex flexDirection="column" style={{
                padding: "12px 16px", borderTop: `1px solid ${border}`,
                fontSize: 11, color: textSec, lineHeight: 1.6,
                background: dk ? "rgba(205,60,68,0.06)" : "rgba(205,60,68,0.03)",
              }}>
                <Strong style={{ color: Colors.Text.Critical.Default }}>Assessment blocked.</Strong> Grant the missing scopes to this app in
                <Strong style={{ color: text }}> Settings → Authorization → OAuth clients</Strong>, or verify the app manifest includes all required scopes.
                <Flex flexDirection="column" style={{ marginTop: 6 }}>
                  <Button onClick={() => preflight.reset()} size="condensed" color="primary">
                    Dismiss
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        )}
        <Button
          onClick={(preflight.running || selectedCount === 0) ? undefined : handleRunClick}
          disabled={preflight.running || selectedCount === 0}
          loading={preflight.running}
          variant="emphasized"
          color="primary"
        >
          {preflight.running ? "Validating…" : selectedCount === 0 ? "Select at least 1 capability" : selectedCount < totalCount ? `Run Assessment (${selectedCount}/${totalCount})` : "Run Assessment"}
        </Button>
        <Button onClick={() => navigate("/tenant-review")} size="condensed" style={{ marginTop: 8 }}>
          Tenant Review
        </Button>
        {hasResults && (
          <Flex flexDirection="column" alignItems="center" gap={6} style={{ marginTop: 12 }}>
            <Button onClick={resume} color="primary">
              ← View Last Results ({totalScore}%)
            </Button>
            <Menu>
              <Menu.Trigger>
                <Button loading={exporting} size="condensed">
                  First Day Results
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onSelect={() => onGenerateReport("en")}>Download English (EN)</Menu.Item>
                <Menu.Item onSelect={() => onGenerateReport("pt")}>Download Portugues (PT)</Menu.Item>
                <Menu.Item onSelect={() => onGenerateReport("es")}>Download Espanol (ES)</Menu.Item>
              </Menu.Content>
            </Menu>
          </Flex>
        )}
        <Flex flexDirection="column" style={{ fontSize: 12, color: textTert, marginTop: 12 }}>
          Tenant: <Text style={{ fontWeight: 600, color: textSec }}>{tenant}</Text>
        </Flex>
      </Flex>

      <Flex gap={12}>
        {[
          { value: String(selectedCount), label: "Capabilities", color: accent, tip: selectedCount < totalCount ? `${selectedCount} of ${totalCount} capabilities selected for assessment. Deselect capabilities on the right panel to customize.` : `${totalCount} Dynatrace platform capabilities evaluated: ${CAPABILITIES.map(c => c.name).join(", ")}.` },
          { value: String(CAPABILITIES.reduce((s, c) => s + c.criteria.length, 0)), label: "Criteria", color: Colors.Text.Success.Default, tip: "Total criteria evaluated via live DQL queries. Some criteria use cross-entity coverage (two queries) to measure real adoption depth." },
        ].map((kpi) => (
          <Tooltip key={kpi.label} text={kpi.tip}>
          <Flex flexDirection="column" style={{ textAlign: "center", padding: "12px 20px", borderRadius: 10, background: kpi.color + (dk ? "15" : "10"), border: `1px solid ${kpi.color}30` }}>
            <Flex flexDirection="column" style={{ fontSize: 32, fontWeight: 900, color: kpi.color, lineHeight: 1 }}>{kpi.value}</Flex>
            <Flex flexDirection="column" style={{ fontSize: 12, color: text, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{kpi.label}</Flex>
          </Flex>
          </Tooltip>
        ))}
      </Flex>

      <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.7, maxWidth: 320, textAlign: "left" }}>
        <button
          type="button"
          onClick={() => setShowHowItWorks((value) => !value)}
          aria-expanded={showHowItWorks}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${borderPri}`,
            background: bgPrimary,
            color: accent,
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          How it works
          <span style={{ fontSize: 10, transform: showHowItWorks ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.16s" }}>▼</span>
        </button>
        {showHowItWorks && (
        <Flex flexDirection="column" style={{ marginTop: 10 }}>
        <Flex gap={8} style={{ marginBottom: 8 }}>
          <Text style={{ color: accent, fontWeight: 800, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>1.</Text>
          <Text><Strong style={{ color: text }}>Choose capabilities</Strong> on the right panel — use the checkbox on each card to include or exclude it. Then click <Strong style={{ color: text }}>Run Assessment</Strong>. If no capability is deselected, a <Strong style={{ color: text }}>full assessment</Strong> runs automatically across all {CAPABILITIES.length} capabilities.</Text>
        </Flex>
        <Flex gap={8} style={{ marginBottom: 8 }}>
          <Text style={{ color: accent, fontWeight: 800, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>2.</Text>
          <Text>Results appear in <Strong style={{ color: text }}>three views</Strong> you can toggle anytime:</Text>
        </Flex>
        <Flex flexDirection="column" gap={6} style={{ marginBottom: 8 }}>
          <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: bgPrimary, border: `1px solid ${borderPri}` }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 2 }}>Coverage</Flex>
            <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
              Radar chart showing <Strong style={{ color: text }}>how much</Strong> of each capability is adopted (0–100%). Ideal for spotting gaps and understanding breadth of platform usage.
            </Text>
          </Flex>
          <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: Colors.Background.Container.Success.Default, border: `1px solid ${Colors.Border.Success.Default}` }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Success.Default, marginBottom: 2 }}>Maturity</Flex>
            <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
              Cards showing <Strong style={{ color: text }}>how deeply</Strong> each capability is used across 3 weighted tiers (Foundation → Best Practice → Excellence). Shows a <Strong style={{ color: text }}>0–100% maturity score</Strong> per capability using the same color scale as coverage.
            </Text>
          </Flex>
          <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)", border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}` }}>
            <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Executive Summary</Flex>
            <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
              Consolidated dashboard with <Strong style={{ color: text }}>coverage vs maturity comparison</Strong>, gap analysis, achievements, and interactive charts for a complete overview.
            </Text>
          </Flex>
        </Flex>
        <Flex gap={8} style={{ marginBottom: 8 }}>
          <Text style={{ color: accent, fontWeight: 800, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>3.</Text>
          <Text>A <Strong style={{ color: text }}>snapshot is saved automatically</Strong> for historical comparison. Use <Strong style={{ color: text }}>Evolution Over Time</Strong> to track progress and identify regressions.</Text>
        </Flex>
        <Text style={{ fontSize: 12, color: textTert, marginTop: 4, lineHeight: 1.5 }}>
          Each failed criterion includes <Strong style={{ color: textSec }}>remediation guidance</Strong> with links to Dynatrace docs.
        </Text>
        <Text style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, background: Colors.Background.Container.Success.Default, border: `1px solid ${Colors.Border.Success.Default}`, color: textSec }}>
          <Strong style={{ color: Colors.Text.Success.Default }}>Tip:</Strong> You can deselect capabilities that are not relevant to your environment using the ☑ checkbox on each card. The assessment will only query the selected ones, making it faster and more focused.
        </Text>
        </Flex>
        )}
        <Text style={{ marginTop: 16, fontSize: 11, color: textTert }}>v{APP_VERSION}</Text>
      </Flex>
    </Flex>
  );
});

/* ── Card for grid view (click to zoom) ── */
function IdleCapCard({ cap, dk, text, textSec, bgSurface, bgSubtle, border, selected, onToggle, onClick }: {
  cap: { name: string; color: string; criteria: { id: string; label: string }[] };
  dk: boolean; text: string; textSec: string; textTert: string;
  bgSurface: string; bgSubtle: string; border: string;
  selected: boolean; onToggle: () => void;
  onClick: () => void;
}) {
  const summary = CAP_SUMMARIES[cap.name] || "";
  return (
    <Flex flexDirection="column" style={{ background: bgSurface,
      border: `1px solid ${selected ? border : (dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)")}`,
      borderRadius: 12, padding: "20px 24px", borderLeft: `4px solid ${selected ? cap.color : (dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)")}`,
      cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s, opacity 0.2s",
      opacity: selected ? 1 : 0.45 } as const}
    onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; onClick(); }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 16px ${cap.color}25`; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <Flex alignItems="center" gap={8} style={{ marginBottom: 12 }}>
        <Text style={{ width: 14, height: 14, borderRadius: "50%", background: selected ? cap.color : (dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"), flexShrink: 0 }} />
        <Text style={{ fontSize: 14, fontWeight: 700, color: text, flex: 1 }}>{cap.name}</Text>
        <Flex alignItems="center" gap={6}>
          <Text style={{ fontSize: 12, color: textSec, fontWeight: 700, background: bgSubtle, padding: "3px 12px", borderRadius: 10 }}>{cap.criteria.length}</Text>
          <Text
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            style={{
              width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: "pointer",
              border: `2px solid ${selected ? cap.color : (dk ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)")}`,
              background: selected ? cap.color : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 800, lineHeight: 1,
              color: selected ? "#fff" : "transparent",
              transition: "all 0.15s",
            }}
          >{selected ? "✓" : ""}</Text>
        </Flex>
      </Flex>
      <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.7, marginLeft: 24, flex: 1 }}>
        {summary}
      </Flex>
      <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, marginTop: 14, marginLeft: 24, fontWeight: 600, opacity: 0.6 }}>
        See what is analyzed →
      </Flex>
    </Flex>
  );
}

/* ── Zoomed detail view for a single capability ── */
function IdleCapDetail({ cap, dk, text, textSec, textTert, bgSubtle, border, onBack, collapseKey }: {
  cap: { name: string; color: string; criteria: { id: string; label: string; description: string }[] };
  dk: boolean; text: string; textSec: string; textTert: string;
  bgSubtle: string; border: string;
  onBack: () => void; collapseKey: number;
}) {
  return (
    <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ animation: "fadeIn 0.2s ease" }}>
      {/* Back button + header */}
      <Flex alignItems="center" gap={12} style={{ marginBottom: 16 }}>
        <Button onClick={onBack} size="condensed">← Back</Button>
        <Text style={{ width: 18, height: 18, borderRadius: "50%", background: cap.color, flexShrink: 0 }} />
        <Text style={{ fontSize: 20, fontWeight: 800, color: text }}>{cap.name}</Text>
        <Text style={{ fontSize: 12, color: textTert, marginLeft: "auto" }}>{cap.criteria.length} checks</Text>
      </Flex>

      {/* Summary */}
      <Flex flexDirection="column" style={{
        fontSize: 14, color: textSec, lineHeight: 1.6, marginBottom: 16,
        padding: "12px 16px", borderRadius: 10,
        background: "transparent",
        borderLeft: `3px solid ${border}`,
      }}>
        {CAP_SUMMARIES[cap.name]}
      </Flex>

      {/* Criteria list — detailed */}
      <Flex flexDirection="column" gap={8} style={{ paddingBottom: 16 }}>
        {cap.criteria.map((cr, i) => (
          <CriterionRow key={cr.id} cr={cr} idx={i} capColor={cap.color} dk={dk} text={text} textSec={textSec} collapseKey={collapseKey} />
        ))}
      </Flex>
    </Flex>
  );
}

/* ── Single criterion row with hover tooltip ── */

/* Helper: generate human-readable explanation from a DQL query */
function describeQuery(q: string): string {
  if (!q) return "";
  // timeseries ... by:{entity} → "Aggregates <metric> grouped by <entity>, then counts distinct entities"
  const tsMatch = q.match(/timeseries\s+\w+=\w+\(([^)]+)\).*?by:\{([^}]+)\}/);
  if (tsMatch) {
    const metric = tsMatch[1].replace(/dt\./g, "");
    const entity = tsMatch[2].replace(/dt\.entity\./g, "").replace(/_/g, " ");
    return `Aggregates metric "${metric}" per ${entity}, then counts how many distinct entities report this metric.`;
  }
  // fetch dt.entity.X ... belongs_to → "Counts parent entities that have child relationships"
  const relMatch = q.match(/fetch\s+(dt\.entity\.\w+).*?belongs_to\[(dt\.entity\.\w+)\]/);
  if (relMatch) {
    const child = relMatch[1].replace("dt.entity.", "").replace(/_/g, " ");
    const parent = relMatch[2].replace("dt.entity.", "").replace(/_/g, " ");
    return `Counts distinct ${parent} entities that have associated ${child} entities (relationship-based coverage).`;
  }
  // fetch logs/spans ... filter isNotNull(X) ... countDistinct(entity)
  const logDistinctMatch = q.match(/fetch\s+(logs|spans).*?filter\s+.*?isNotNull\(([^)]+)\).*?countDistinct\(([^)]+)\)/s);
  if (logDistinctMatch) {
    const source = logDistinctMatch[1];
    const field = logDistinctMatch[2];
    const entity = logDistinctMatch[3].replace(/dt\.entity\./g, "").replace(/_/g, " ");
    return `Queries ${source} for records where "${field}" is present, then counts how many distinct ${entity} entities are covered.`;
  }
  // fetch logs/spans ... filter ... summarize count()
  const logCountMatch = q.match(/fetch\s+(logs|spans|events|bizevents).*?filter\s+(.*?)\s*\|\s*summarize\s+count\(\)/s);
  if (logCountMatch) {
    return `Counts ${logCountMatch[1]} records matching the specified filters.`;
  }
  // fetch dt.entity.X | summarize count()
  const entityCount = q.match(/fetch\s+(dt\.entity\.\w+)\s*\|\s*summarize\s+count\(\)/);
  if (entityCount) {
    const entity = entityCount[1].replace("dt.entity.", "").replace(/_/g, " ");
    return `Counts the total number of ${entity} entities in the environment.`;
  }
  // fetch dt.davis.problems
  if (q.includes("dt.davis.problems")) {
    return "Queries Davis AI problems to find affected entities within the recent time window.";
  }
  // Generic fallback
  if (q.includes("summarize count")) return "Counts the number of matching records.";
  return "Executes a DQL query against Grail and returns a numeric result.";
}

/* ── Inline DQL code block with copy button ── */
function QueryCode({ query, dk }: { query: string; dk: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };
  return (
    <Flex flexDirection="column" style={{ position: "relative" }}>
      <Code style={{
        display: "block", fontSize: 12, padding: "8px 12px 8px 12px", borderRadius: 6,
        background: dk ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.04)",
        color: Colors.Text.Neutral.Subdued,
        fontFamily: "monospace",
        overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
        border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
      }}>{query}</Code>
      <Text style={{ position: "absolute", top: 4, right: 4 }}>
        <Button onClick={copy} size="condensed" color={copied ? "success" : "neutral"}>{copied ? "✓" : "⎘"}</Button>
      </Text>
    </Flex>
  );
}

function CriterionRow({ cr, idx, capColor, dk, text, textSec, collapseKey }: {
  cr: { id: string; label: string; description: string; query?: string; queryB?: string; thresholds?: { min: number }[] }; idx: number;
  capColor: string; dk: boolean; text: string; textSec: string; collapseKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [collapseKey]);
  const importance = CRITERION_IMPORTANCE[cr.id] || "";
  return (
    <Flex
      style={{
        display: "flex", gap: 12, padding: "12px 16px", borderRadius: 10,
        background: "transparent",
        border: `1px solid ${Colors.Border.Neutral.Default}`,
        cursor: "pointer",
        transition: "border-color 0.2s",
        borderColor: expanded ? Colors.Border.Neutral.Accent : Colors.Border.Neutral.Default,
      }}
      onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setExpanded(!expanded); }}
    >
      <Text style={{
        fontSize: 12, fontWeight: 700, color: textSec,
        background: Colors.Background.Container.Neutral.Subdued, borderRadius: 8,
        width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: 2,
      }}>{idx + 1}</Text>
      <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
        <Flex alignItems="center" gap={8} style={{ marginBottom: 4 }}>
          <Tooltip text={CRITERION_IMPORTANCE[cr.id] || cr.description} maxWidth={340}>
            <Flex flexDirection="column" style={{ fontSize: 14, fontWeight: 700, color: text }}>{cr.label}</Flex>
          </Tooltip>
          <Text style={{
            fontSize: 12, color: textSec,
            transition: "all 0.2s", fontWeight: 600, flexShrink: 0,
          }}>{expanded ? "▾" : "▸"}</Text>
        </Flex>
        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>{cr.description}</Flex>
        {/* Inline expansion with details */}
        {expanded && (
          <Flex flexDirection="column" gap={12} style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8,
            background: "transparent",
            borderLeft: `3px solid ${Colors.Border.Neutral.Default}`,
            animation: "fadeIn 0.2s ease" }}>
            {/* ── Section 1: Why it matters ── */}
            {importance && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Why it matters</Flex>
                <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>{importance}</Flex>
              </Flex>
            )}
            {/* ── Section 2: How the score is calculated ── */}
            {cr.query && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>How the score is calculated</Flex>
                <Flex flexDirection="column" gap={12} style={{ padding: "12px 16px", borderRadius: 8,
                  background: dk ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.02)",
                  border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  {cr.queryB ? (
                    <>
                      {/* Numerator (A) */}
                      <Flex flexDirection="column">
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 4 }}>Numerator (A)</Flex>
                        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5, marginBottom: 6 }}>{describeQuery(cr.query)}</Flex>
                        <QueryCode query={cr.query} dk={dk} />
                      </Flex>
                      {/* Divider */}
                      <Flex alignItems="center" gap={6} style={{ color: Colors.Text.Neutral.Disabled, fontSize: 14 }}>
                        <Text style={{ flex: 1, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }} />
                        <Text style={{ fontWeight: 700 }}>÷</Text>
                        <Text style={{ flex: 1, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }} />
                      </Flex>
                      {/* Denominator (B) */}
                      <Flex flexDirection="column">
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 4 }}>Denominator (B)</Flex>
                        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5, marginBottom: 6 }}>{describeQuery(cr.queryB)}</Flex>
                        <QueryCode query={cr.queryB} dk={dk} />
                      </Flex>
                      {/* Expected Result */}
                      <Flex flexDirection="column" style={{
                        padding: "8px 12px", borderRadius: 6,
                        background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)",
                        border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}`,
                      }}>
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Expected Result</Flex>
                        <Text style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>
                          Result = A ÷ B × 100 → a <Strong>coverage percentage</Strong>. The app compares this value against the pass thresholds below to determine the maturity tier (Foundation / Best Practice / Excellence).
                        </Text>
                      </Flex>
                    </>
                  ) : (
                    <>
                      <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>{describeQuery(cr.query)}</Flex>
                      <QueryCode query={cr.query} dk={dk} />
                      <Flex flexDirection="column" style={{
                        padding: "8px 12px", borderRadius: 6,
                        background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)",
                        border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}`,
                      }}>
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Expected Result</Flex>
                        <Text style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>
                          Returns a <Strong>numeric count</Strong>. The app compares this value against the pass thresholds below to determine the maturity tier.
                        </Text>
                      </Flex>
                    </>
                  )}
                </Flex>
              </Flex>
            )}
            {/* ── Section 3: Pass thresholds ── */}
            {cr.thresholds && cr.thresholds.length > 0 && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Pass thresholds</Flex>
                <Flex gap={6} flexWrap="wrap">
                  {[...cr.thresholds].sort((a, b) => b.min - a.min).map((t, ti) => (
                    <Text key={ti} style={{
                      fontSize: 12, padding: "3px 12px", borderRadius: 6,
                      background: Colors.Background.Container.Neutral.Subdued,
                      color: textSec, fontWeight: 600,
                    }}>≥ {t.min}</Text>
                  ))}
                </Flex>
              </Flex>
            )}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
