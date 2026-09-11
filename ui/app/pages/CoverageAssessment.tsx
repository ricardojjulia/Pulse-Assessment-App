import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Text } from "@dynatrace/strato-components/typography";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ProgressBar } from "@dynatrace/strato-components/content";
import type { CoverageData, ViewMode, CapabilityResult } from "../hooks/useCoverageData";
import type { UseScaleTierResult } from "../hooks/useScaleTier";
import { useDavisRecommendations, type DavisRecommendationMap } from "../hooks/useDavisRecommendations";
import { useAppAdoption } from "../hooks/useAppAdoption";
import { CAPABILITIES } from "../queries";
import { generatePersonaReport, type ReportPersona, type PersonaLang } from "../reports/personaReports";
import { downloadCompleteMarkdownReport } from "../reports/generateCompleteMarkdownReport";
import { CustomReportModal, type CustomReportRequest } from "../components/CustomReportModal";
import { SmartReportModal } from "../components/SmartReportModal";
import { applyTraceProxyMode } from "../trace-proxy";
import type { useAssessmentHistory } from "../hooks/useAssessmentHistory";
import { useDegradationAlert } from "../hooks/useDegradationAlert";
import { type CovUtilRadarHandle } from "../components/CovUtilRadar";
import { AssessmentResults } from "../components/AssessmentResults";
import { AssessmentIdle } from "../components/AssessmentIdle";
import { useSegments } from "../hooks/useSegments";

function formatRecords(n: number): string {
  return n.toLocaleString();
}

interface Props {
  history: ReturnType<typeof useAssessmentHistory>;
  coverageData: CoverageData;
  scale?: UseScaleTierResult;
}

export const CoverageAssessment: React.FC<Props> = ({ history, coverageData, scale }) => {
  const {
    capabilities, totalScore, overallUtilizationLevel, loading, idle, progress,
    error, tenant, date, stats, entityCounts, liveScannedRecords, liveScannedBytes,
    lastRunMeta, consolidation, setConsolidation, start, refresh, reset, goHome, resume,
  } = coverageData;

  const dk = useCurrentTheme() === "dark";
  const lastSavedRef = useRef<string>("");
  const [anim, setAnim] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [chartSize, setChartSize] = useState(500);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCap, setSelectedCap] = useState<string | null>(null);
  const VIEW_MODE_KEY = "atlas-view-mode";
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) ?? "coverage"
  );
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };
  const [collapseKey, setCollapseKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const radarHandleRef = useRef<CovUtilRadarHandle | null>(null);
  const wasLoadingRef = useRef(false);
  const [excludedCaps, setExcludedCaps] = useState<Set<string>>(new Set());
  const [showCustomReport, setShowCustomReport] = useState(false);
  const [showSmartReport, setShowSmartReport] = useState(false);

  const { segments } = useSegments();
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>(undefined);

  const davisHandle = useDavisRecommendations(capabilities, { enabled: true });
  const adoption = useAppAdoption(capabilities.length > 0);

  const { degraded, dismissed: degradationDismissed, dismiss: dismissDegradation } = useDegradationAlert(capabilities, history.snapshots);

  const divergenceCount = useMemo(
    () => capabilities.filter(c => c.score >= 70 && (c.utilization?.utilizationScore ?? 0) <= 30).length,
    [capabilities],
  );

  const handleDivergenceBadgeClick = useCallback((capabilityName: string) => {
    handleViewModeChange("utilization");
    setTimeout(() => {
      document.getElementById(`cap-${capabilityName}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, []);

  const explainCapability = useCallback((capName: string) => {
    const idx = capabilities.findIndex(c => c.name === capName);
    if (idx < 0) return;
    setActiveIdx(idx);
  }, [capabilities]);

  const toggleCap = useCallback((name: string) => {
    setExcludedCaps(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const [traceProxyMode, setTraceProxyMode] = useState(false);

  const startFiltered = useCallback((useProxy?: boolean) => {
    const proxy = useProxy ?? traceProxyMode;
    const selected = excludedCaps.size === 0
      ? CAPABILITIES
      : CAPABILITIES.filter(c => !excludedCaps.has(c.name));
    if (!proxy) {
      start(
        excludedCaps.size === 0 ? undefined : (selected.length > 0 ? selected : undefined),
        activeSegmentId,
      );
      return;
    }
    const { caps } = applyTraceProxyMode(selected.length > 0 ? selected : CAPABILITIES);
    start(
      caps.length > 0 ? caps : applyTraceProxyMode(CAPABILITIES).caps,
      activeSegmentId,
    );
  }, [start, excludedCaps, traceProxyMode, activeSegmentId]);

  const traceProxyInfo = useMemo(() => {
    if (!traceProxyMode) return null;
    const selected = excludedCaps.size === 0
      ? CAPABILITIES
      : CAPABILITIES.filter(c => !excludedCaps.has(c.name));
    return applyTraceProxyMode(selected.length > 0 ? selected : CAPABILITIES).info;
  }, [traceProxyMode, excludedCaps]);

  const sparklineData = useMemo<Record<string, number[]>>(() => {
    const recent = history.snapshots.slice(0, 5).reverse();
    if (recent.length < 2) return {};
    const map: Record<string, number[]> = {};
    for (const snap of recent) {
      for (const capSnap of snap.capabilities) {
        if (!map[capSnap.name]) map[capSnap.name] = [];
        map[capSnap.name].push(capSnap.score);
      }
    }
    return map;
  }, [history.snapshots]);

  const t0 = useRef<number>(0);

  /* ── Persona reports ── */
  const generatePersona = useCallback((persona: ReportPersona, lang: PersonaLang) => {
    if (exporting || capabilities.length === 0) return;
    setExporting(true);
    setTimeout(() => {
      try {
        generatePersonaReport(persona, {
          capabilities,
          totalScore,
          overallUtilizationLevel,
          tenant,
          date,
          stats,
          entityCounts: entityCounts
            ? { hosts: entityCounts.hosts, services: entityCounts.services, applications: entityCounts.applications, k8sClusters: entityCounts.k8sClusters }
            : null,
          history: history.snapshots.map(s => ({ timestamp: s.timestamp, totalScore: s.totalScore })),
          adoption: adoption.unavailable ? undefined : { windowDays: adoption.windowDays, totalUsers: adoption.totalUsers, byCapability: adoption.byCapability },
        }, lang);
      } finally {
        setExporting(false);
      }
    }, 0);
  }, [capabilities, exporting, totalScore, overallUtilizationLevel, tenant, date, stats, entityCounts, history.snapshots]);

  const handleMarkdownExport = useCallback(() => {
    if (capabilities.length === 0) return;
    downloadCompleteMarkdownReport({
      capabilities,
      totalScore,
      overallUtilizationLevel,
      tenant: tenant ?? "",
      date: date ?? "",
      stats,
      entityCounts,
      snapshots: history.snapshots,
    });
  }, [capabilities, totalScore, overallUtilizationLevel, tenant, date, stats, entityCounts, history.snapshots]);

  const generateCustomReport = useCallback((req: CustomReportRequest) => {
    if (exporting || capabilities.length === 0) return;
    const selected = capabilities.filter(c => req.caps.includes(c.name));
    if (selected.length === 0) return;
    const scopedScore = Math.round(selected.reduce((s, c) => s + c.score, 0) / selected.length);
    const scopedUtilization = Math.round(selected.reduce((s, c) => s + c.effectiveUtilizationScore, 0) / selected.length);
    setExporting(true);
    setTimeout(() => {
      try {
        generatePersonaReport("custom", {
          capabilities: selected,
          totalScore: scopedScore,
          overallUtilizationLevel: scopedUtilization,
          tenant,
          date,
          stats,
          entityCounts: entityCounts
            ? { hosts: entityCounts.hosts, services: entityCounts.services, applications: entityCounts.applications, k8sClusters: entityCounts.k8sClusters }
            : null,
          history: history.snapshots.map(s => ({ timestamp: s.timestamp, totalScore: s.totalScore })),
          adoption: adoption.unavailable ? undefined : { windowDays: adoption.windowDays, totalUsers: adoption.totalUsers, byCapability: adoption.byCapability },
        }, req.lang, { title: req.title, sections: req.sections });
      } finally {
        setExporting(false);
      }
    }, 0);
  }, [capabilities, exporting, tenant, date, stats, entityCounts, history.snapshots]);

  // Save snapshot when assessment run finishes
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

  // Auto-size chart via ResizeObserver
  useEffect(() => {
    const el = rootRef.current;
    let tid: ReturnType<typeof setTimeout>;
    const calc = () => {
      const vh = el ? el.offsetHeight || window.innerHeight : window.innerHeight;
      const vw = el ? el.offsetWidth : window.innerWidth;
      const mobile = vw < 640;
      setIsMobile(mobile);
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

  return (
    <Flex flexDirection="column" ref={rootRef}
      onMouseDown={(e) => { mouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const dp = mouseDownPos.current;
        if (dp && (Math.abs(e.clientX - dp.x) > 5 || Math.abs(e.clientY - dp.y) > 5)) return;
        setActiveIdx(null); setSelectedCap(null); setCollapseKey(k => k + 1);
      }}
      style={{
        height: "100%", overflow: "auto", boxSizing: "border-box", padding: "0",
        fontFamily: "inherit",
        background: Colors.Background.Base.Default,
        color: Colors.Text.Neutral.Default,
        transition: "background 0.4s, color 0.4s",
      }}>

      {/* Idle State */}
      {idle && !loading && (
        <AssessmentIdle
          tenant={tenant}
          start={startFiltered}
          resume={resume}
          onEnableProxyMode={() => setTraceProxyMode(true)}
          totalScore={totalScore}
          hasResults={capabilities.length > 0}
          exporting={exporting}
          onGeneratePersona={generatePersona}
          onOpenCustomReport={() => setShowCustomReport(true)}
          onOpenSmartReport={() => setShowSmartReport(true)}
          excludedCaps={excludedCaps}
          onToggleCap={toggleCap}
          onSelectAll={() => setExcludedCaps(new Set())}
          consolidation={consolidation}
          onConsolidationChange={setConsolidation}
          sparklineData={sparklineData}
          isMobile={isMobile}
          collapseKey={collapseKey}
          selectedCap={selectedCap}
          onSelectedCapChange={setSelectedCap}
          segments={segments}
          activeSegmentId={activeSegmentId}
          onSegmentChange={setActiveSegmentId}
        />
      )}

      {/* Loading State */}
      {loading && (
        <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={16} style={{ flex: 1 }}>
          <Flex flexDirection="column" style={{ fontSize: 16, fontWeight: 700, color: Colors.Text.Neutral.Default }}>Running Assessment</Flex>
          <Flex flexDirection="column" style={{ width: "clamp(280px, 50%, 480px)" }}>
            <ProgressBar value={progress} color="primary" aria-label="Assessment progress" />
          </Flex>
          <Flex flexDirection="column" alignItems="center" gap={4}>
            <Flex flexDirection="column" style={{ fontSize: 13, color: Colors.Text.Neutral.Subdued }}>{progress}% — Querying {capabilities.length > 0 ? capabilities.length : CAPABILITIES.length} capabilities via DQL</Flex>
            {liveScannedRecords > 0 && (
              <Flex flexDirection="column" style={{ fontSize: 12, color: Colors.Text.Neutral.Disabled }}>
                {formatRecords(liveScannedRecords)} records scanned
              </Flex>
            )}
          </Flex>
        </Flex>
      )}

      {/* Results State */}
      {!idle && !loading && capabilities.length > 0 && (
        <AssessmentResults
          capabilities={capabilities}
          anim={anim}
          activeIdx={activeIdx}
          onActiveIdxChange={setActiveIdx}
          chartSize={chartSize}
          isMobile={isMobile}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          collapseKey={collapseKey}
          onBack={goHome}
          onRefresh={refresh}
          divergenceCount={divergenceCount}
          degraded={degraded}
          degradationDismissed={degradationDismissed}
          onDismissDegradation={dismissDegradation}
          history={history}
          scale={scale}
          traceProxyInfo={traceProxyInfo}
          tenant={tenant}
          date={date}
          stats={stats}
          liveScannedBytes={liveScannedBytes}
          lastRunMeta={lastRunMeta}
          loading={loading}
          totalScore={totalScore}
          overallUtilizationLevel={overallUtilizationLevel}
          exporting={exporting}
          davisHandle={davisHandle}
          onDivergenceBadgeClick={handleDivergenceBadgeClick}
          explainCapability={explainCapability}
          adoption={adoption}
          onGeneratePersona={generatePersona}
          onMarkdownExport={handleMarkdownExport}
          onOpenCustomReport={() => setShowCustomReport(true)}
          onOpenSmartReport={() => setShowSmartReport(true)}
          onRadarMount={(h) => { radarHandleRef.current = h; }}
        />
      )}

      {/* Error State */}
      {error && (
        <Flex flexDirection="column" style={{ textAlign: "center", padding: 24, color: Colors.Text.Critical.Default }}>
          <Flex flexDirection="column" style={{ fontSize: 14, marginBottom: 8 }}>Assessment failed</Flex>
          <Flex flexDirection="column" style={{ fontSize: 12, color: Colors.Text.Neutral.Subdued }}>{error}</Flex>
        </Flex>
      )}

      {/* Dynamic report builder */}
      <CustomReportModal
        open={showCustomReport}
        onClose={() => setShowCustomReport(false)}
        capabilityNames={capabilities.map(c => c.name)}
        onGenerate={generateCustomReport}
        dk={dk}
      />

      {/* Smart report via Dynatrace Assist */}
      <SmartReportModal
        open={showSmartReport}
        onClose={() => setShowSmartReport(false)}
        ctx={{
          tenant: tenant ?? "(unknown)",
          date: date ?? "",
          overallCoverage: totalScore,
          overallUtilization: overallUtilizationLevel,
          capabilities,
        }}
        dk={dk}
      />
    </Flex>
  );
};
