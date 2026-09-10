import React, { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Code, ExternalLink, Text, Strong } from "@dynatrace/strato-components/typography";
import { Flex, Grid, Container } from "@dynatrace/strato-components/layouts";
import { ConsolidationPanel, type ConsolidationPanelHandle } from "./ConsolidationPanel";
import { MiniSparkline } from "./MiniSparkline";
import { Tooltip } from "./Tooltip";
import { PreflightFlow } from "./PreflightFlow";
import { ReportActions } from "./ReportActions";
import { CAPABILITIES } from "../queries";
import { CAP_SUMMARIES } from "../data/capSummaries";
import { CRITERION_IMPORTANCE } from "../data/criterionImportance";
import { APP_ICON } from "../data/appIcon";
import { APP_VERSION } from "../appVersion";
import type { CapabilityResult } from "../hooks/useCoverageData";
import type { ReportPersona, PersonaLang } from "../reports/personaReports";

function isTextSelection(): boolean {
  const sel = window.getSelection();
  return !!(sel && sel.toString().length > 0);
}

/** Helper: generate human-readable explanation from a DQL query. */
function describeQuery(q: string): string {
  if (!q) return "";
  const tsMatch = q.match(/timeseries\s+\w+=\w+\(([^)]+)\).*?by:\{([^}]+)\}/);
  if (tsMatch) {
    const metric = tsMatch[1].replace(/dt\./g, "");
    const entity = tsMatch[2].replace(/dt\.entity\./g, "").replace(/_/g, " ");
    return `Aggregates metric "${metric}" per ${entity}, then counts how many distinct entities report this metric.`;
  }
  const relMatch = q.match(/fetch\s+(dt\.entity\.\w+).*?belongs_to\[(dt\.entity\.\w+)\]/);
  if (relMatch) {
    const child = relMatch[1].replace("dt.entity.", "").replace(/_/g, " ");
    const parent = relMatch[2].replace("dt.entity.", "").replace(/_/g, " ");
    return `Counts distinct ${parent} entities that have associated ${child} entities (relationship-based coverage).`;
  }
  const logDistinctMatch = q.match(/fetch\s+(logs|spans).*?filter\s+.*?isNotNull\(([^)]+)\).*?countDistinct\(([^)]+)\)/s);
  if (logDistinctMatch) {
    const source = logDistinctMatch[1];
    const field = logDistinctMatch[2];
    const entity = logDistinctMatch[3].replace(/dt\.entity\./g, "").replace(/_/g, " ");
    return `Queries ${source} for records where "${field}" is present, then counts how many distinct ${entity} entities are covered.`;
  }
  const logCountMatch = q.match(/fetch\s+(logs|spans|events|bizevents).*?filter\s+(.*?)\s*\|\s*summarize\s+count\(\)/s);
  if (logCountMatch) return `Counts ${logCountMatch[1]} records matching the specified filters.`;
  const entityCount = q.match(/fetch\s+(dt\.entity\.\w+)\s*\|\s*summarize\s+count\(\)/);
  if (entityCount) {
    const entity = entityCount[1].replace("dt.entity.", "").replace(/_/g, " ");
    return `Counts the total number of ${entity} entities in the environment.`;
  }
  if (q.includes("dt.davis.problems")) return "Queries Davis AI problems to find affected entities within the recent time window.";
  if (q.includes("summarize count")) return "Counts the number of matching records.";
  return "Executes a DQL query against Grail and returns a numeric result.";
}

/** Inline DQL code block with copy button. */
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

/** Criterion row with drilldown — used in the idle capability detail view. */
function CriterionRow({ cr, idx, capColor, dk, text, textSec, collapseKey }: {
  cr: { id: string; label: string; description: string; query?: string; queryB?: string; thresholds?: { min: number }[] };
  idx: number;
  capColor: string; dk: boolean; text: string; textSec: string; collapseKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  React.useEffect(() => { setExpanded(false); }, [collapseKey]);
  const importance = CRITERION_IMPORTANCE[cr.id] || "";
  return (
    <Flex
      style={{ display: "flex", gap: 12, padding: "12px 16px", borderRadius: 10, background: "transparent",
        border: `1px solid ${Colors.Border.Neutral.Default}`, cursor: "pointer", transition: "border-color 0.2s",
        borderColor: expanded ? Colors.Border.Neutral.Accent : Colors.Border.Neutral.Default }}
      onClick={(e) => { e.stopPropagation(); if (isTextSelection()) return; setExpanded(!expanded); }}
    >
      <Text style={{ fontSize: 12, fontWeight: 700, color: textSec,
        background: Colors.Background.Container.Neutral.Subdued, borderRadius: 8,
        width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: 2 }}>{idx + 1}</Text>
      <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
        <Flex alignItems="center" gap={8} style={{ marginBottom: 4 }}>
          <Tooltip text={CRITERION_IMPORTANCE[cr.id] || cr.description} maxWidth={340}>
            <Flex flexDirection="column" style={{ fontSize: 14, fontWeight: 700, color: text }}>{cr.label}</Flex>
          </Tooltip>
          <Text style={{ fontSize: 12, color: textSec, transition: "all 0.2s", fontWeight: 600, flexShrink: 0 }}>{expanded ? "▾" : "▸"}</Text>
        </Flex>
        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>{cr.description}</Flex>
        {expanded && (
          <Flex flexDirection="column" gap={12} style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8,
            background: "transparent", borderLeft: `3px solid ${Colors.Border.Neutral.Default}`,
            animation: "fadeIn 0.2s ease" }}>
            {importance && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Why it matters</Flex>
                <Flex flexDirection="column" style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>{importance}</Flex>
              </Flex>
            )}
            {cr.query && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>How the score is calculated</Flex>
                <Flex flexDirection="column" gap={12} style={{ padding: "12px 16px", borderRadius: 8,
                  background: dk ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.02)",
                  border: `1px solid ${dk ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}` }}>
                  {cr.queryB ? (
                    <>
                      <Flex flexDirection="column">
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 4 }}>Numerator (A)</Flex>
                        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5, marginBottom: 6 }}>{describeQuery(cr.query)}</Flex>
                        <QueryCode query={cr.query} dk={dk} />
                      </Flex>
                      <Flex alignItems="center" gap={6} style={{ color: Colors.Text.Neutral.Disabled, fontSize: 14 }}>
                        <Text style={{ flex: 1, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }} />
                        <Text style={{ fontWeight: 700 }}>÷</Text>
                        <Text style={{ flex: 1, borderBottom: `1px solid ${dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}` }} />
                      </Flex>
                      <Flex flexDirection="column">
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 4 }}>Denominator (B)</Flex>
                        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5, marginBottom: 6 }}>{describeQuery(cr.queryB)}</Flex>
                        <QueryCode query={cr.queryB} dk={dk} />
                      </Flex>
                      <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6,
                        background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)",
                        border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}` }}>
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Expected Result</Flex>
                        <Text style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>
                          Result = A ÷ B × 100 → a <Strong>coverage percentage</Strong>. The app compares this value against the pass thresholds below to determine the utilization tier (Foundation / Best Practice / Excellence).
                        </Text>
                      </Flex>
                    </>
                  ) : (
                    <>
                      <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>{describeQuery(cr.query)}</Flex>
                      <QueryCode query={cr.query} dk={dk} />
                      <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6,
                        background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)",
                        border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}` }}>
                        <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Expected Result</Flex>
                        <Text style={{ fontSize: 12, color: text, lineHeight: 1.6 }}>
                          Returns a <Strong>numeric count</Strong>. The app compares this value against the pass thresholds below to determine the utilization tier.
                        </Text>
                      </Flex>
                    </>
                  )}
                </Flex>
              </Flex>
            )}
            {cr.thresholds && cr.thresholds.length > 0 && (
              <Flex flexDirection="column">
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Pass thresholds</Flex>
                <Flex gap={6} flexWrap="wrap">
                  {[...cr.thresholds]
                    .sort((a, b) => (b.min ?? Number.NEGATIVE_INFINITY) - (a.min ?? Number.NEGATIVE_INFINITY))
                    .map((t, ti) => (
                      <Text key={ti} style={{ fontSize: 12, padding: "3px 12px", borderRadius: 6, background: Colors.Background.Container.Neutral.Subdued, color: textSec, fontWeight: 600 }}>
                        {typeof t.min === "number" ? `≥ ${t.min}` : "max" in t ? `≤ ${(t as { max: number }).max}` : ""}
                      </Text>
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

/** Card for the idle capability grid (click to zoom into detail). */
function IdleCapCard({ cap, dk, text, textSec, textTert, bgSurface, bgSubtle, border, selected, onToggle, onClick, trendData }: {
  cap: { name: string; color: string; criteria: { id: string; label: string }[] };
  dk: boolean; text: string; textSec: string; textTert: string;
  bgSurface: string; bgSubtle: string; border: string;
  selected: boolean; onToggle: () => void;
  onClick: () => void;
  trendData?: number[];
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
        <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: 700, color: text }}>{cap.name}</Text>
          {trendData && trendData.length >= 2 && (
            <Flex alignItems="center" gap={6} style={{ marginTop: 4 }}>
              <MiniSparkline data={trendData} />
              <Text style={{ fontSize: 10, color: textSec, opacity: 0.7 }}>trend</Text>
            </Flex>
          )}
        </Flex>
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

/** Zoomed detail view for a single capability in idle mode. */
function IdleCapDetail({ cap, dk, text, textSec, textTert, bgSubtle, border, onBack, collapseKey }: {
  cap: { name: string; color: string; criteria: { id: string; label: string; description: string }[] };
  dk: boolean; text: string; textSec: string; textTert: string;
  bgSubtle: string; border: string;
  onBack: () => void; collapseKey: number;
}) {
  return (
    <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ animation: "fadeIn 0.2s ease" }}>
      <Flex alignItems="center" gap={12} style={{ marginBottom: 16 }}>
        <Button onClick={onBack} size="condensed">← Back</Button>
        <Text style={{ width: 18, height: 18, borderRadius: "50%", background: cap.color, flexShrink: 0 }} />
        <Text style={{ fontSize: 20, fontWeight: 800, color: text }}>{cap.name}</Text>
        <Text style={{ fontSize: 12, color: textTert, marginLeft: "auto" }}>{cap.criteria.length} checks</Text>
      </Flex>
      <Flex flexDirection="column" style={{ fontSize: 14, color: textSec, lineHeight: 1.6, marginBottom: 16,
        padding: "12px 16px", borderRadius: 10, background: "transparent", borderLeft: `3px solid ${border}` }}>
        {CAP_SUMMARIES[cap.name]}
      </Flex>
      <Flex flexDirection="column" gap={8} style={{ paddingBottom: 16 }}>
        {cap.criteria.map((cr, i) => (
          <CriterionRow key={cr.id} cr={cr} idx={i} capColor={cap.color} dk={dk} text={text} textSec={textSec} collapseKey={collapseKey} />
        ))}
      </Flex>
    </Flex>
  );
}

/* ── Left panel — memoized to prevent re-renders during card interactions ── */
interface IdleLeftPanelProps {
  dk: boolean; text: string; textSec: string; textTert: string;
  accent: string; bgSubtle: string; bgPrimary: string; border: string; borderPri: string;
  tenant: string;
  start: (useProxy?: boolean) => void;
  resume: () => void;
  onEnableProxyMode: () => void;
  totalScore: number;
  hasResults: boolean;
  exporting: boolean;
  onGeneratePersona: (persona: ReportPersona, lang: PersonaLang) => void;
  onOpenCustomReport: () => void;
  onOpenSmartReport?: () => void;
  selectedCount: number;
  totalCount: number;
  consolidation: Record<string, number>;
  onConsolidationChange: (factors: Record<string, number>) => void;
  excludedCaps: Set<string>;
}

const IdleLeftPanel = React.memo(function IdleLeftPanel({
  dk, text, textSec, textTert, accent, bgSubtle, bgPrimary, border, borderPri,
  tenant, start, resume, onEnableProxyMode, totalScore, hasResults, exporting,
  onGeneratePersona, onOpenCustomReport, onOpenSmartReport,
  selectedCount, totalCount, consolidation, onConsolidationChange, excludedCaps,
}: IdleLeftPanelProps) {
  const navigate = useNavigate();
  const consolidationRef = useRef<ConsolidationPanelHandle>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const handleBeforeStart = useCallback(() => {
    consolidationRef.current?.collapse();
  }, []);

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

      {/* Run Assessment + Preflight */}
      <Flex flexDirection="column" alignItems="center">
        <ConsolidationPanel
          ref={consolidationRef}
          consolidation={consolidation}
          onApply={onConsolidationChange}
          dk={dk} text={text} textSec={textSec} accent={accent} border={border}
          excludedCaps={excludedCaps}
        />
        <PreflightFlow
          start={start}
          onEnableProxyMode={onEnableProxyMode}
          selectedCount={selectedCount}
          totalCount={totalCount}
          onBeforeStart={handleBeforeStart}
        />
        <Button onClick={() => navigate("/tenant-review")} variant="emphasized" color="primary" style={{ marginTop: 8 }}>
          Tenant Review
        </Button>
        {hasResults && (
          <Flex flexDirection="column" alignItems="center" gap={6} style={{ marginTop: 12 }}>
            <Button onClick={resume} color="primary">
              ← View Last Results ({totalScore}%)
            </Button>
            <ReportActions
              exporting={exporting}
              onGeneratePersona={onGeneratePersona}
              onOpenSmartReport={onOpenSmartReport}
              onOpenCustomReport={onOpenCustomReport}
            />
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
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${borderPri}`,
            background: bgPrimary, color: accent, cursor: "pointer", font: "inherit",
            fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
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
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Success.Default, marginBottom: 2 }}>Utilization</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
                  Cards showing <Strong style={{ color: text }}>how deeply</Strong> each capability is used across 3 weighted tiers (Foundation → Best Practice → Excellence). Shows a <Strong style={{ color: text }}>0–100% utilization score</Strong> per capability using the same color scale as coverage.
                </Text>
              </Flex>
              <Flex flexDirection="column" style={{ padding: "8px 12px", borderRadius: 6, background: dk ? "rgba(91,106,207,0.08)" : "rgba(91,106,207,0.04)", border: `1px solid ${dk ? "rgba(91,106,207,0.15)" : "rgba(91,106,207,0.1)"}` }}>
                <Flex flexDirection="column" style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Primary.Default, marginBottom: 2 }}>Executive Summary</Flex>
                <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.5 }}>
                  Consolidated dashboard with <Strong style={{ color: text }}>coverage vs utilization comparison</Strong>, gap analysis, achievements, and interactive charts for a complete overview.
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

/* ── Public exports ── */

export interface AssessmentIdleProps {
  tenant: string;
  start: (useProxy?: boolean) => void;
  resume: () => void;
  onEnableProxyMode: () => void;
  totalScore: number;
  hasResults: boolean;
  exporting: boolean;
  onGeneratePersona: (persona: ReportPersona, lang: PersonaLang) => void;
  onOpenCustomReport: () => void;
  onOpenSmartReport: () => void;
  excludedCaps: Set<string>;
  onToggleCap: (name: string) => void;
  onSelectAll: () => void;
  consolidation: Record<string, number>;
  onConsolidationChange: (factors: Record<string, number>) => void;
  sparklineData: Record<string, number[]>;
  isMobile: boolean;
  collapseKey: number;
  selectedCap: string | null;
  onSelectedCapChange: (cap: string | null) => void;
}

/**
 * Full idle-state view: left info/action panel and right capability card grid
 * (with per-card sparklines and a detail zoom-in on click).
 */
export const AssessmentIdle: React.FC<AssessmentIdleProps> = ({
  tenant,
  start,
  resume,
  onEnableProxyMode,
  totalScore,
  hasResults,
  exporting,
  onGeneratePersona,
  onOpenCustomReport,
  onOpenSmartReport,
  excludedCaps,
  onToggleCap,
  onSelectAll,
  consolidation,
  onConsolidationChange,
  sparklineData,
  isMobile,
  collapseKey,
  selectedCap,
  onSelectedCapChange,
}) => {
  const dk = useCurrentTheme() === "dark";

  const bg = Colors.Background.Base.Default;
  const bgSurface = Colors.Background.Surface.Default;
  const bgSubtle = Colors.Background.Container.Neutral.Subdued;
  const bgPrimary = Colors.Background.Container.Primary.Default;
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const textTert = Colors.Text.Neutral.Disabled;
  const accent = Colors.Text.Primary.Default;
  const border = Colors.Border.Neutral.Default;
  const borderPri = Colors.Border.Primary.Default;

  return (
    <Grid gridTemplateColumns={isMobile ? "1fr" : "380px 1fr"} gridTemplateRows="minmax(0,1fr)" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left panel */}
      <IdleLeftPanel
        dk={dk} text={text} textSec={textSec} textTert={textTert}
        accent={accent} bgSubtle={bgSubtle} bgPrimary={bgPrimary}
        border={border} borderPri={borderPri}
        tenant={tenant} start={start} resume={resume}
        onEnableProxyMode={onEnableProxyMode}
        totalScore={totalScore} hasResults={hasResults}
        exporting={exporting}
        onGeneratePersona={onGeneratePersona}
        onOpenCustomReport={onOpenCustomReport}
        onOpenSmartReport={onOpenSmartReport}
        selectedCount={CAPABILITIES.length - excludedCaps.size}
        totalCount={CAPABILITIES.length}
        consolidation={consolidation}
        onConsolidationChange={onConsolidationChange}
        excludedCaps={excludedCaps}
      />

      {/* Right panel — capability cards */}
      <Flex flexDirection="column" onClick={(e) => e.stopPropagation()} style={{ overflowY: "scroll", padding: "20px 24px", minHeight: 0 }}>
        {selectedCap ? (
          <IdleCapDetail
            cap={CAPABILITIES.find(c => c.name === selectedCap)!}
            dk={dk} text={text} textSec={textSec} textTert={textTert}
            bgSubtle={bgSubtle} border={border}
            onBack={() => onSelectedCapChange(null)}
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
                      onClick={() => onSelectAll()}>Select All</Text>
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
                  onToggle={() => onToggleCap(cap.name)}
                  onClick={() => onSelectedCapChange(cap.name)}
                  trendData={sparklineData[cap.name] ?? []} />
              ))}
            </Grid>
          </>
        )}
      </Flex>
    </Grid>
  );
};
