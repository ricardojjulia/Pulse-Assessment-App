import React from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { ProgressBar } from "@dynatrace/strato-components/content";
import { useObservabilityEval } from "../hooks/useObservabilityEval";
import type { EvalResults, EstimateResult } from "../hooks/useObservabilityEval";

function formatNum(n: number): string {
  return n.toLocaleString();
}

function formatGb(gb: number): string {
  if (gb < 0.001) return "< 0.001 GB";
  return `${gb.toFixed(3)} GB`;
}

function formatDps(dps: number): string {
  if (dps < 0.01) return "< $0.01";
  return `$${dps.toFixed(2)}`;
}

function coverageBarColor(pct: number): string {
  if (pct >= 80) return Colors.Charts.Status.Ideal.Default;
  if (pct >= 50) return Colors.Charts.Status.Warning.Default;
  return Colors.Charts.Status.Critical.Default;
}

function errorRateColor(rate: number): string {
  if (rate < 1) return Colors.Charts.Status.Ideal.Default;
  if (rate <= 5) return Colors.Charts.Status.Warning.Default;
  return Colors.Charts.Status.Critical.Default;
}

function logSignal(errorRate: number, warnRate: number): string {
  if (errorRate > 1) return "High";
  if (errorRate < 0.1 && warnRate < 0.5) return "Noisy";
  return "Healthy";
}

function logSignalColor(sig: string): string {
  if (sig === "High") return Colors.Charts.Status.Critical.Default;
  if (sig === "Noisy") return Colors.Text.Neutral.Subdued;
  return Colors.Charts.Status.Ideal.Default;
}

interface CardProps {
  children: React.ReactNode;
}

function Card({ children }: CardProps): React.ReactElement {
  return (
    <Flex
      flexDirection="column"
      gap={12}
      style={{
        borderRadius: 12,
        padding: "16px 20px",
        background: Colors.Background.Container.Neutral.Default,
        border: `1px solid ${Colors.Border.Neutral.Default}`,
      }}
    >
      {children}
    </Flex>
  );
}

interface SectionHeaderProps {
  icon: string;
  title: string;
  textColor: string;
}

function SectionHeader({ icon, title, textColor }: SectionHeaderProps): React.ReactElement {
  return (
    <Flex alignItems="center" gap={8}>
      <Text style={{ fontSize: 18, lineHeight: 1 }}>{icon}</Text>
      <Text style={{ fontSize: 16, fontWeight: 700, color: textColor }}>{title}</Text>
    </Flex>
  );
}

interface EstimateCardProps {
  estimate: EstimateResult;
  dk: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function EstimateCard({ estimate, dk, onConfirm, onCancel }: EstimateCardProps): React.ReactElement {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  const items: Array<{ label: string; value: string }> = [
    { label: "Process group instances", value: formatNum(estimate.pgiCount) },
    { label: "Services", value: formatNum(estimate.serviceCount) },
    { label: "Spans/hour (last 1h)", value: formatNum(estimate.spansPerHour) },
    { label: "Log events/hour (last 1h)", value: formatNum(estimate.logsPerHour) },
    { label: "Estimated 24h scan volume", value: formatGb(estimate.estimatedGb) },
    { label: "Estimated DPS cost", value: formatDps(estimate.estimatedDps) },
  ];

  const bullets = [
    "Entity Map — PGI tech breakdown and service type distribution",
    "Active Services — coverage of services with live request traffic",
    "Trace Coverage — top services by span volume and error rate, cloud function instrumentation gap",
    "Log Signal Quality — top log sources by volume, error rate, and signal classification",
  ];

  return (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 600 }}>
      <Flex
        flexDirection="column"
        gap={8}
        style={{
          borderRadius: 12,
          padding: "16px 20px",
          background: Colors.Background.Container.Neutral.Default,
          border: `1px solid ${Colors.Border.Neutral.Default}`,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 700, color: text, marginBottom: 4 }}>Estimated Scope</Text>
        {items.map((item) => (
          <Flex key={item.label} justifyContent="space-between" alignItems="center" gap={16}>
            <Text style={{ fontSize: 13, color: textSec }}>{item.label}</Text>
            <Strong style={{ fontSize: 13, color: text }}>{item.value}</Strong>
          </Flex>
        ))}

        <Flex
          flexDirection="column"
          gap={4}
          style={{
            marginTop: 8,
            padding: "10px 14px",
            borderRadius: 8,
            background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
            border: `1px solid ${Colors.Border.Neutral.Default}`,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, marginBottom: 4 }}>What will be queried:</Text>
          {bullets.map((b) => (
            <Flex key={b} gap={6} alignItems="flex-start">
              <Text style={{ fontSize: 12, color: Colors.Text.Primary.Default, flexShrink: 0, lineHeight: 1.6 }}>•</Text>
              <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>{b}</Text>
            </Flex>
          ))}
        </Flex>

        <Text style={{ fontSize: 11, color: textSec, marginTop: 4, fontStyle: "italic" }}>
          Queries run against live data in this tenant. Segment filtering active when a segment is selected.
        </Text>
      </Flex>

      <Flex gap={12} alignItems="center">
        <Button onClick={onConfirm} variant="emphasized" color="primary">
          Run Full Evaluation
        </Button>
        <Text
          role="button"
          tabIndex={0}
          onClick={onCancel}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCancel(); } }}
          style={{ fontSize: 13, color: textSec, cursor: "pointer", textDecoration: "underline" }}
        >
          Cancel
        </Text>
      </Flex>
    </Flex>
  );
}

interface EntityInventoryProps {
  results: EvalResults;
  dk: boolean;
}

function EntityInventorySection({ results, dk }: EntityInventoryProps): React.ReactElement {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;

  return (
    <Card>
      <SectionHeader icon="◈" title="Entity Inventory" textColor={text} />

      <Flex flexDirection="column" gap={4}>
        <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 1 }}>
          PGI Technology Breakdown
        </Text>
        <Flex
          flexDirection="column"
          style={{
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${borderColor}`,
          }}
        >
          <Flex
            style={{
              padding: "6px 12px",
              background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            <Text style={{ flex: 1, fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Technology</Text>
            <Text style={{ fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Count</Text>
          </Flex>
          {results.pgiByTech.length === 0 ? (
            <Flex style={{ padding: "10px 12px" }}>
              <Text style={{ fontSize: 13, color: textSec }}>No process group instances found.</Text>
            </Flex>
          ) : (
            results.pgiByTech.map((row, i) => (
              <Flex
                key={row.tech}
                alignItems="center"
                style={{
                  padding: "7px 12px",
                  borderBottom: i < results.pgiByTech.length - 1 ? `1px solid ${borderColor}` : undefined,
                  background: i % 2 === 0 ? "transparent" : (dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                }}
              >
                <Text style={{ flex: 1, fontSize: 13, color: text }}>{row.tech}</Text>
                <Text style={{ fontSize: 13, fontWeight: 600, color: text }}>{formatNum(row.count)}</Text>
              </Flex>
            ))
          )}
        </Flex>
      </Flex>

      <Flex flexDirection="column" gap={8}>
        <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 1 }}>
          Service Types
        </Text>
        <Flex flexWrap="wrap" gap={8}>
          {results.servicesByType.length === 0 ? (
            <Text style={{ fontSize: 13, color: textSec }}>No services found.</Text>
          ) : (
            results.servicesByType.map((row) => (
              <Flex
                key={row.serviceType}
                alignItems="center"
                gap={6}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  background: dk ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                  border: `1px solid ${borderColor}`,
                }}
              >
                <Text style={{ fontSize: 12, color: text, fontWeight: 600 }}>{row.serviceType}</Text>
                <Text style={{ fontSize: 12, color: textSec }}>{formatNum(row.count)}</Text>
              </Flex>
            ))
          )}
        </Flex>
      </Flex>

      <Text style={{ fontSize: 11, color: textSec }}>
        Total services: {formatNum(results.totalServiceCount)} · Total PGIs: {formatNum(results.pgiByTech.reduce((s, r) => s + r.count, 0))}
      </Text>
    </Card>
  );
}

interface ActiveGhostProps {
  results: EvalResults;
  dk: boolean;
}

function ActiveGhostSection({ results, dk }: ActiveGhostProps): React.ReactElement {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const total = results.totalServiceCount;
  const active = results.activeServiceCount;
  const ghost = Math.max(0, total - active);
  const pct = total > 0 ? Math.round((active / total) * 100) : 0;
  const barColor = coverageBarColor(pct);

  return (
    <Card>
      <SectionHeader icon="◎" title="Active vs Ghost Monitoring" textColor={text} />

      <Flex flexDirection="column" gap={8}>
        <Flex justifyContent="space-between" alignItems="center">
          <Text style={{ fontSize: 13, color: textSec }}>Active services (with request traffic last 24h)</Text>
          <Strong style={{ fontSize: 13, color: text }}>{formatNum(active)} / {formatNum(total)}</Strong>
        </Flex>
        <div
          style={{
            height: 10,
            borderRadius: 6,
            background: dk ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: barColor,
              borderRadius: 6,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <Text style={{ fontSize: 12, fontWeight: 600, color: barColor }}>{pct}% active</Text>
      </Flex>

      <Flex flexDirection="column" gap={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Text style={{ fontSize: 13, color: textSec }}>Ghost services (no request traffic last 24h)</Text>
          <Strong style={{ fontSize: 13, color: ghost > 0 ? Colors.Charts.Status.Warning.Default : Colors.Text.Neutral.Default }}>
            {formatNum(ghost)}
          </Strong>
        </Flex>
        <Flex justifyContent="space-between" alignItems="center">
          <Text style={{ fontSize: 13, color: textSec }}>Stale process groups (last seen &gt; 7 days ago)</Text>
          <Strong style={{ fontSize: 13, color: results.stalePgiCount > 0 ? Colors.Charts.Status.Warning.Default : Colors.Text.Neutral.Default }}>
            {formatNum(results.stalePgiCount)}
          </Strong>
        </Flex>
      </Flex>

      <Flex
        flexDirection="column"
        gap={4}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: dk ? "rgba(255,200,0,0.06)" : "rgba(255,200,0,0.04)",
          border: `1px solid ${Colors.Border.Warning.Default}`,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: 700, color: Colors.Text.Warning.Default }}>What are ghost services?</Text>
        <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>
          Entity exists in topology but sent no request data in the last 24h. Common causes: service was decommissioned,
          OneAgent disconnected, or deployment paused.
        </Text>
      </Flex>
    </Card>
  );
}

interface TraceCoverageProps {
  results: EvalResults;
  dk: boolean;
}

function TraceCoverageSection({ results, dk }: TraceCoverageProps): React.ReactElement {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;
  const totalCloud = results.cloudFunctions.awsLambdas + results.cloudFunctions.azureFunctions;
  const gap = Math.max(0, totalCloud - results.instrumentedCloudFunctions);

  return (
    <Card>
      <SectionHeader icon="⟳" title="Trace Coverage" textColor={text} />

      <Flex flexDirection="column" gap={4}>
        <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 1 }}>
          Top Services by Span Volume (24h)
        </Text>
        <Flex
          flexDirection="column"
          style={{
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${borderColor}`,
          }}
        >
          <Flex
            style={{
              padding: "6px 12px",
              background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            <Text style={{ flex: 1, fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Service</Text>
            <Text style={{ width: 110, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Spans (24h)</Text>
            <Text style={{ width: 90, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Error Rate</Text>
          </Flex>
          {results.topSpanServices.length === 0 ? (
            <Flex style={{ padding: "10px 12px" }}>
              <Text style={{ fontSize: 13, color: textSec }}>No span data found in the last 24h.</Text>
            </Flex>
          ) : (
            results.topSpanServices.map((row, i) => (
              <Flex
                key={row.svc}
                alignItems="center"
                style={{
                  padding: "7px 12px",
                  borderBottom: i < results.topSpanServices.length - 1 ? `1px solid ${borderColor}` : undefined,
                  background: i % 2 === 0 ? "transparent" : (dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                }}
              >
                <Text style={{ flex: 1, fontSize: 12, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.svc}</Text>
                <Text style={{ width: 110, textAlign: "right", fontSize: 12, color: text }}>{formatNum(row.total)}</Text>
                <Text style={{ width: 90, textAlign: "right", fontSize: 12, fontWeight: 600, color: errorRateColor(row.errorRate) }}>
                  {row.errorRate.toFixed(1)}%
                </Text>
              </Flex>
            ))
          )}
        </Flex>
      </Flex>

      <Flex flexDirection="column" gap={6}>
        <Text style={{ fontSize: 12, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 1 }}>
          Cloud Function Instrumentation
        </Text>
        {totalCloud === 0 ? (
          <Text style={{ fontSize: 13, color: textSec }}>No cloud function integrations detected.</Text>
        ) : (
          <>
            <Flex justifyContent="space-between" alignItems="center">
              <Text style={{ fontSize: 13, color: textSec }}>Lambda / Azure Functions known to Dynatrace</Text>
              <Strong style={{ fontSize: 13, color: text }}>
                {formatNum(results.cloudFunctions.awsLambdas)} AWS + {formatNum(results.cloudFunctions.azureFunctions)} Azure
              </Strong>
            </Flex>
            <Flex justifyContent="space-between" alignItems="center">
              <Text style={{ fontSize: 13, color: textSec }}>With active trace instrumentation (faas spans, 7d)</Text>
              <Strong style={{ fontSize: 13, color: text }}>{formatNum(results.instrumentedCloudFunctions)}</Strong>
            </Flex>
            {gap > 0 && (
              <Flex
                flexDirection="column"
                gap={4}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: dk ? "rgba(255,200,0,0.06)" : "rgba(255,200,0,0.04)",
                  border: `1px solid ${Colors.Border.Warning.Default}`,
                }}
              >
                <Text style={{ fontSize: 12, color: Colors.Text.Warning.Default, lineHeight: 1.6 }}>
                  <Strong style={{ color: Colors.Text.Warning.Default }}>Gap:</Strong> {formatNum(gap)} function{gap !== 1 ? "s" : ""} monitored at infrastructure layer but with no distributed trace data.
                </Text>
              </Flex>
            )}
          </>
        )}
      </Flex>
    </Card>
  );
}

interface LogQualityProps {
  results: EvalResults;
  dk: boolean;
}

function LogQualitySection({ results, dk }: LogQualityProps): React.ReactElement {
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const borderColor = Colors.Border.Neutral.Default;

  return (
    <Card>
      <SectionHeader icon="≡" title="Log Signal Quality" textColor={text} />

      <Flex
        flexDirection="column"
        style={{
          borderRadius: 8,
          overflow: "hidden",
          border: `1px solid ${borderColor}`,
        }}
      >
        <Flex
          style={{
            padding: "6px 12px",
            background: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <Text style={{ flex: 1, fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Source</Text>
          <Text style={{ width: 100, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Volume (24h)</Text>
          <Text style={{ width: 80, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Error %</Text>
          <Text style={{ width: 80, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Warn %</Text>
          <Text style={{ width: 70, textAlign: "right", fontSize: 11, fontWeight: 700, color: textSec, textTransform: "uppercase", letterSpacing: 0.8 }}>Signal</Text>
        </Flex>
        {results.logSources.length === 0 ? (
          <Flex style={{ padding: "10px 12px" }}>
            <Text style={{ fontSize: 13, color: textSec }}>No log data found in the last 24h.</Text>
          </Flex>
        ) : (
          results.logSources.map((row, i) => {
            const warnRate = row.total > 0 ? (row.warnings / row.total) * 100 : 0;
            const sig = logSignal(row.errorRate, warnRate);
            return (
              <Flex
                key={row.src}
                alignItems="center"
                style={{
                  padding: "7px 12px",
                  borderBottom: i < results.logSources.length - 1 ? `1px solid ${borderColor}` : undefined,
                  background: i % 2 === 0 ? "transparent" : (dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                }}
              >
                <Text style={{ flex: 1, fontSize: 12, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.src}</Text>
                <Text style={{ width: 100, textAlign: "right", fontSize: 12, color: text }}>{formatNum(row.total)}</Text>
                <Text style={{ width: 80, textAlign: "right", fontSize: 12, fontWeight: 600, color: errorRateColor(row.errorRate) }}>
                  {row.errorRate.toFixed(1)}%
                </Text>
                <Text style={{ width: 80, textAlign: "right", fontSize: 12, color: textSec }}>
                  {warnRate.toFixed(1)}%
                </Text>
                <Text style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 700, color: logSignalColor(sig) }}>{sig}</Text>
              </Flex>
            );
          })
        )}
      </Flex>
    </Card>
  );
}

interface ResultsFooterProps {
  results: EvalResults;
  textSec: string;
}

function ResultsFooter({ results, textSec }: ResultsFooterProps): React.ReactElement {
  const gb = results.scannedBytes / (1024 * 1024 * 1024);
  const dps = gb * 0.01;
  return (
    <Text style={{ fontSize: 12, color: textSec, textAlign: "center" }}>
      {formatNum(results.scannedRecords)} records scanned · ~{formatGb(gb)} · ≈{formatDps(dps)} DPS
    </Text>
  );
}

export const ObservabilityEvaluationPage: React.FC = () => {
  const navigate = useNavigate();
  const dk = useCurrentTheme() === "dark";
  const handle = useObservabilityEval();

  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  const heroBullets = [
    "Entity inventory — which process group technologies and service types are deployed in this tenant",
    "Active vs ghost monitoring — services with live traffic vs. entities known to Dynatrace but sending no data",
    "Trace coverage — top services by span volume, error rates, and cloud function instrumentation gaps",
    "Log signal quality — top log sources by volume, error rate classification, and signal health",
  ];

  return (
    <Flex
      flexDirection="column"
      gap={20}
      style={{ padding: "16px 24px", maxWidth: 900, margin: "0 auto" }}
    >
      {/* Page header */}
      <Flex alignItems="center" gap={12}>
        <Button onClick={() => navigate("/")} size="condensed">← Back to Assessment</Button>
        <Text style={{ fontSize: 20, fontWeight: 800, color: text }}>Observability Evaluation</Text>
      </Flex>

      {/* IDLE */}
      {handle.phase === "idle" && (
        <Flex
          flexDirection="column"
          gap={16}
          style={{
            borderRadius: 12,
            padding: "20px 24px",
            background: Colors.Background.Container.Neutral.Default,
            border: `1px solid ${Colors.Border.Neutral.Default}`,
            maxWidth: 600,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: 700, color: text }}>
            Get a top-down view of what's actually observable in this tenant
          </Text>
          <Flex flexDirection="column" gap={6}>
            {heroBullets.map((b) => (
              <Flex key={b} gap={8} alignItems="flex-start">
                <Text style={{ fontSize: 14, color: Colors.Text.Primary.Default, flexShrink: 0, lineHeight: 1.6 }}>•</Text>
                <Text style={{ fontSize: 13, color: textSec, lineHeight: 1.6 }}>{b}</Text>
              </Flex>
            ))}
          </Flex>
          <Text style={{ fontSize: 12, color: textSec }}>
            Starts with 4 lightweight count queries to estimate scope and cost before running the full evaluation.
          </Text>
          <Flex>
            <Button onClick={() => handle.startEstimate()} variant="emphasized" color="primary">
              Estimate Scope →
            </Button>
          </Flex>
        </Flex>
      )}

      {/* ESTIMATING */}
      {handle.phase === "estimating" && (
        <Flex flexDirection="column" gap={16} alignItems="flex-start">
          <ProgressBar value={-1} />
          <Text style={{ fontSize: 14, color: textSec }}>Scanning entity counts and telemetry volume…</Text>
        </Flex>
      )}

      {/* CONFIRMED */}
      {handle.phase === "confirmed" && handle.estimate && (
        <EstimateCard
          estimate={handle.estimate}
          dk={dk}
          onConfirm={handle.confirm}
          onCancel={handle.cancel}
        />
      )}

      {/* RUNNING */}
      {handle.phase === "running" && (
        <Flex flexDirection="column" gap={16} alignItems="flex-start">
          <ProgressBar value={-1} />
          <Text style={{ fontSize: 14, color: textSec }}>Running 8 queries…</Text>
        </Flex>
      )}

      {/* DONE */}
      {handle.phase === "done" && handle.results && (
        <Flex flexDirection="column" gap={16}>
          <EntityInventorySection results={handle.results} dk={dk} />
          <ActiveGhostSection results={handle.results} dk={dk} />
          <TraceCoverageSection results={handle.results} dk={dk} />
          <LogQualitySection results={handle.results} dk={dk} />
          <ResultsFooter results={handle.results} textSec={textSec} />
          <Flex>
            <Button onClick={handle.reset} size="condensed">↺ Run Again</Button>
          </Flex>
        </Flex>
      )}

      {/* ERROR */}
      {handle.phase === "error" && (
        <Flex
          flexDirection="column"
          gap={12}
          style={{
            borderRadius: 12,
            padding: "16px 20px",
            background: Colors.Background.Container.Critical.Default,
            border: `1px solid ${Colors.Border.Critical.Default}`,
            maxWidth: 600,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 700, color: Colors.Text.Critical.Default }}>Evaluation failed</Text>
          {handle.error && (
            <Text style={{ fontSize: 13, color: Colors.Text.Critical.Default }}>{handle.error}</Text>
          )}
          <Flex>
            <Button onClick={handle.reset}>Try Again</Button>
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};
