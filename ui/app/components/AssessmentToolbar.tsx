import React from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ScaleTierBanner } from "./ScaleTierBanner";
import { DpsCostBadge } from "./DpsCostBadge";
import { TraceProxyBanner } from "./TraceProxyBanner";
import { SegmentedControl } from "./SegmentedControl";
import { ReportActions } from "./ReportActions";
import type { ViewMode, CapabilityResult, QueryStats, CoverageData } from "../hooks/useCoverageData";
import type { UseScaleTierResult } from "../hooks/useScaleTier";
import type { DegradedCapability } from "../hooks/useDegradationAlert";
import type { applyTraceProxyMode } from "../trace-proxy";
import type { ReportPersona, PersonaLang } from "../reports/personaReports";

type TraceProxyInfo = ReturnType<typeof applyTraceProxyMode>["info"] | null;

function formatRecords(n: number): string {
  return n.toLocaleString();
}

export interface AssessmentToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onBack: () => void;
  onRefresh: () => void;
  capabilities: CapabilityResult[];
  divergenceCount: number;
  degraded: DegradedCapability[];
  degradationDismissed: boolean;
  onDismissDegradation: () => void;
  snapshotCount: number;
  scale?: UseScaleTierResult;
  traceProxyInfo: TraceProxyInfo;
  tenant: string;
  date: string;
  stats: QueryStats | null;
  liveScannedBytes: number;
  lastRunMeta: CoverageData["lastRunMeta"];
  loading: boolean;
  exporting: boolean;
  onGeneratePersona: (persona: ReportPersona, lang: PersonaLang) => void;
  onMarkdownExport: () => void;
  onOpenCustomReport: () => void;
  onOpenSmartReport: () => void;
}

/**
 * The header area rendered during an active assessment — F4 degradation
 * alert banner, the horizontal toolbar row (Back / Refresh / view-mode
 * toggle / reports / tenant metadata), and the Scale Tier + Trace Proxy
 * info banners.
 */
export const AssessmentToolbar: React.FC<AssessmentToolbarProps> = ({
  viewMode,
  onViewModeChange,
  onBack,
  onRefresh,
  capabilities,
  divergenceCount,
  degraded,
  degradationDismissed,
  onDismissDegradation,
  snapshotCount,
  scale,
  traceProxyInfo,
  tenant,
  date,
  stats,
  liveScannedBytes,
  lastRunMeta,
  loading,
  exporting,
  onGeneratePersona,
  onMarkdownExport,
  onOpenCustomReport,
  onOpenSmartReport,
}) => {
  const navigate = useNavigate();
  const dk = useCurrentTheme() === "dark";
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  return (
    <>
      {/* F4 — Score Degradation Alert banner */}
      {degraded.length > 0 && !degradationDismissed && (
        <Flex alignItems="center" gap={8} flexWrap="wrap" style={{
          padding: "8px 16px", flexShrink: 0,
          background: Colors.Background.Container.Warning.Default,
          borderBottom: `1px solid ${Colors.Border.Warning.Default}`,
        }}>
          <Text style={{ fontSize: 13, fontWeight: 700, color: Colors.Text.Warning.Default, flexShrink: 0 }}>
            ⚠ Score drop detected:
          </Text>
          <Text style={{ fontSize: 12, color: Colors.Text.Warning.Default, flex: 1 }}>
            {degraded.map(d => `${d.name} (${d.previous} → ${d.current})`).join(", ")}
          </Text>
          <Text
            role="button"
            tabIndex={0}
            aria-label="View score history"
            onClick={() => navigate("/compare")}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/compare"); } }}
            style={{ fontSize: 12, fontWeight: 600, color: Colors.Text.Warning.Default, cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            View history →
          </Text>
          <Text
            role="button"
            tabIndex={0}
            aria-label="Dismiss degradation alert"
            onClick={onDismissDegradation}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDismissDegradation(); } }}
            style={{ fontSize: 14, fontWeight: 700, color: Colors.Text.Warning.Default, cursor: "pointer", padding: "0 4px", flexShrink: 0, lineHeight: 1 }}
          >
            ×
          </Text>
        </Flex>
      )}

      {/* Toolbar row */}
      <Flex alignItems="center" gap={8} flexWrap="wrap" style={{ padding: "6px 16px", flexShrink: 0, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}` }}>
        <Button onClick={onBack} size="condensed">← Back</Button>
        <Button onClick={onRefresh} size="condensed">↻ Refresh</Button>
        {/* View Mode Toggle */}
        <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 4 }}>
          <SegmentedControl
            value={viewMode}
            onChange={onViewModeChange}
            options={[
              { value: "coverage", label: "Coverage" },
              { value: "utilization", label: "Utilization" },
              { value: "recommendations", label: "Executive Summary" },
            ]}
          />
        </Flex>
        {/* H6 — Divergence summary chip in toolbar */}
        {divergenceCount > 0 && viewMode === "coverage" && (
          <Text
            role="button"
            tabIndex={0}
            aria-label={`${divergenceCount} capability gap${divergenceCount > 1 ? "s" : ""} — high coverage, low utilization`}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onViewModeChange("utilization"); }}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onViewModeChange("utilization"); } }}
            style={{
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              padding: "3px 10px", borderRadius: 8, userSelect: "none",
              whiteSpace: "nowrap", flexShrink: 0,
              color: Colors.Text.Warning.Default,
              background: Colors.Background.Container.Warning.Default,
              border: `1px solid ${Colors.Border.Warning.Default}`,
            }}
          >
            ⚠ {divergenceCount} gap{divergenceCount > 1 ? "s" : ""}
          </Text>
        )}
        <Button onClick={() => navigate("/compare")} variant="emphasized" color="primary">
          Evolution Over Time
          {snapshotCount > 0 && (
            <Button.Suffix>
              <Text style={{
                fontSize: 12, fontWeight: 800, color: Colors.Text.Primary.Default,
                background: Colors.Background.Surface.Default, borderRadius: 8,
                padding: "1px 6px", minWidth: 14, textAlign: "center",
                lineHeight: "14px",
              }}>{Math.min(snapshotCount, 52)}</Text>
            </Button.Suffix>
          )}
        </Button>
        <Button onClick={() => navigate("/tenant-review")} size="condensed">
          Tenant Review
        </Button>
        {/* Reports — persona PDFs (Executive / Tactical / Technical)
            and the Custom builder are client-side jsPDF and ship to
            every tenant. The Smart (Assist) item is the ONLY
            Davis-powered entry. */}
        <ReportActions
          exporting={exporting}
          onGeneratePersona={onGeneratePersona}
          onOpenSmartReport={onOpenSmartReport}
          onOpenCustomReport={onOpenCustomReport}
          onMarkdownExport={onMarkdownExport}
        />
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
          {/* DPS cost estimate — visible to all users (no dev gate). */}
          <DpsCostBadge
            stats={stats}
            liveScannedBytes={liveScannedBytes}
            lastRunMeta={lastRunMeta}
            loading={loading}
            textColor={text}
            textSecColor={textSec}
          />
        </Text>
      </Flex>

      {/* Scale Tier banner — only renders when tier !== 'exact'. */}
      {scale && (
        <Flex style={{ padding: "0 16px", marginTop: 8, flexShrink: 0 }}>
          <ScaleTierBanner scale={scale} />
        </Flex>
      )}

      {/* Trace Proxy Mode banner */}
      {traceProxyInfo && (
        <Flex style={{ padding: "0 16px", marginTop: 8, flexShrink: 0 }}>
          <TraceProxyBanner info={traceProxyInfo} />
        </Flex>
      )}
    </>
  );
};
