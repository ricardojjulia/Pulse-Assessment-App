// ui/app/pages/AiInsightsPage.tsx
//
// Dedicated route showing Davis CoPilot recommendations for every capability
// at once. Replaces the per-card expand workflow when the SE wants the full
// AI synthesis in one screen — ideal for QBR prep or batch review.
//
// Layout ─────────────────────────────────────────────────────────────────
//   Header     ▸ title + run metadata + "Back to assessment" + "Force refresh"
//   Stats bar  ▸ how many capabilities have insights / cached / errored
//   Grid       ▸ one card per capability, sorted by score ASC (worst first)
//                 - capability header (color dot + name + score + level)
//                 - failure summary (N failed of M criteria)
//                 - DavisInsightSection rendered inline (no expand)
//
// Why sort by score ascending ────────────────────────────────────────────
// Capabilities with the lowest scores are the ones the SE most needs
// recommendations for. Putting them at the top means the eye lands on the
// most actionable item first; perfect-score capabilities (no recommendation
// at all) sink to the bottom.
//
// Same data, same cache ──────────────────────────────────────────────────
// This page calls useDavisRecommendations() independently from
// CoverageAssessment. The hook's signature-based dedup + 24h Document Store
// cache guarantee both views share the same response per (capability,
// failure signature, prompt version). Opening this page after expanding
// cards on the assessment page hits the cache for everything.

import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Container } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import type { CoverageData } from "../hooks/useCoverageData";
import type { UseScaleTierResult } from "../hooks/useScaleTier";
import { useDavisRecommendations } from "../hooks/useDavisRecommendations";
import { DavisInsightSection } from "../components/DavisInsightSection";
import { ScaleTierBanner } from "../components/ScaleTierBanner";

interface Props {
  coverageData: CoverageData;
  scale: UseScaleTierResult;
  /** Dev flag — required to enable the page. The whole Davis surface is
   *  hidden on customer tenants; only ?dev=1 or localStorage.cca.dev
   *  unlocks it. */
}

/** Map utilization level number → human label + accent token. */
function levelMeta(level: 0 | 1 | 2 | 3): { label: string; color: string } {
  switch (level) {
    case 0: return { label: "L0 · Not Adopted", color: Colors.Text.Critical.Default };
    case 1: return { label: "L1 · Foundation", color: Colors.Charts.Status.Warning.Default };
    case 2: return { label: "L2 · Operational", color: Colors.Charts.Categorical.Color07.Default };
    case 3: return { label: "L3 · Optimized", color: Colors.Charts.Status.Ideal.Default };
  }
}

export const AiInsightsPage: React.FC<Props> = ({ coverageData, scale }) => {
  const navigate = useNavigate();
  const dk = useCurrentTheme() === "dark";
  const { capabilities, tenant, date, loading, refresh } = coverageData;

  // Dev-only — the hook is disabled outside dev mode so no SDK calls
  // ever fire from customer tenants. The empty SE-only state below
  const davisHandle = useDavisRecommendations(capabilities, { enabled: true });
  const recommendations = davisHandle.byCapability;
  const sendFollowUp = davisHandle.sendFollowUp;
  const requestInsight = davisHandle.requestInsight;

  // Sort capabilities by score ascending so the worst-performing (most
  // actionable) capability lands at the top. We rebuild this on every
  // capabilities change but the array is small (9 items) so cost is nil.
  const sorted = useMemo(() => {
    return [...capabilities].sort((a, b) => a.score - b.score);
  }, [capabilities]);

  // Aggregate stats for the header bar.
  const stats = useMemo(() => {
    let withInsight = 0;
    let cached = 0;
    let errored = 0;
    let pending = 0;
    let perfect = 0;
    let idle = 0;
    for (const cap of capabilities) {
      const state = recommendations[cap.name];
      if (!state || state.status === "skipped") {
        perfect++;
        continue;
      }
      if (state.status === "success") {
        withInsight++;
        if (state.rec?.fromCache) cached++;
      } else if (state.status === "error") {
        errored++;
      } else if (state.status === "loading") {
        pending++;
      } else if (state.status === "idle") {
        idle++;
      }
    }
    return { withInsight, cached, errored, pending, perfect, idle };
  }, [capabilities, recommendations]);

  // Theme-aware tokens.
  const bg = Colors.Background.Base.Default;
  const surface = Colors.Background.Surface.Default;
  const text = Colors.Text.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const textTert = Colors.Text.Neutral.Disabled;
  const border = Colors.Border.Neutral.Default;
  const accent = Colors.Text.Primary.Default;

  // ── Dev-only gate. Customer tenants land here only if they navigate to
  // /ai-insights directly — show a polite SE-only notice and a back link
  // rather than firing Davis calls or revealing the page structure. ──

  // ── Empty state ──
  if (capabilities.length === 0) {
    return (
      <Flex flexDirection="column" alignItems="center" justifyContent="center"
        style={{ height: "100vh", padding: 32, background: bg, color: text }}>
        <Text style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          No assessment data yet
        </Text>
        <Text style={{ fontSize: 13, color: textSec, marginBottom: 16, textAlign: "center" }}>
          Run an assessment first so Davis has data to work with.
        </Text>
        <Button onClick={() => navigate("/")} variant="default">
          ← Back to Assessment
        </Button>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" style={{
      height: "100%", overflow: "auto", background: bg, color: text,
    }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Flex flexDirection="row" alignItems="center" justifyContent="space-between"
        style={{
          padding: "12px 24px",
          borderBottom: `1px solid ${border}`,
          background: surface,
          position: "sticky", top: 0, zIndex: 10,
        }}>
        <Flex flexDirection="row" alignItems="center" gap={16}>
          <Button onClick={() => navigate("/")} size="condensed">
            ← Back
          </Button>
          <Flex flexDirection="column">
            <Text style={{ fontSize: 16, fontWeight: 700, color: text }}>
              AI Insights · Davis CoPilot
            </Text>
            <Text style={{ fontSize: 11, color: textTert }}>
              Per-capability dynamic recommendations · Tenant: <Strong>{tenant ?? "—"}</Strong>
              {date && <> · {date}</>}
            </Text>
          </Flex>
        </Flex>
        <Flex flexDirection="row" gap={8}>
          <Button
            size="condensed"
            variant="emphasized"
            color="primary"
            disabled={stats.withInsight + stats.pending + stats.errored + stats.perfect >= capabilities.length}
            onClick={() => {
              // Fire requestInsight for every capability that's still idle.
              // The hook is idempotent — already-loading/success calls
              // become no-ops — so this is safe to spray.
              for (const cap of capabilities) {
                const s = recommendations[cap.name];
                if (s && s.status === "idle") {
                  void requestInsight(cap.name);
                }
              }
            }}
            aria-label="Generate AI insight for every capability that does not yet have one"
          >
            Generate all
          </Button>
          <Button onClick={refresh} size="condensed" disabled={loading}>
            Refresh
          </Button>
        </Flex>
      </Flex>

      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <Flex flexDirection="row" gap={16} alignItems="center"
        style={{
          padding: "8px 24px",
          fontSize: 11, color: textSec,
          borderBottom: `1px solid ${border}`,
          background: dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
        }}>
        <Stat label="With insight" value={stats.withInsight} color={Colors.Text.Success.Default} />
        <Stat label="Idle (click to generate)" value={stats.idle} color={accent} />
        <Stat label="Cached" value={stats.cached} color={accent} />
        <Stat label="Pending" value={stats.pending} color={Colors.Charts.Status.Warning.Default} />
        <Stat label="Errored" value={stats.errored} color={Colors.Text.Critical.Default} />
        <Stat label="Perfect (skipped)" value={stats.perfect} color={textTert} />
      </Flex>

      {/* ── Scale tier banner (sampling warning if applicable) ─────── */}
      <Flex flexDirection="column" style={{ padding: "8px 24px 0 24px" }}>
        <ScaleTierBanner scale={scale} />
      </Flex>

      {/* ── Cards grid ─────────────────────────────────────────────── */}
      <Flex flexDirection="column" gap={12} style={{ padding: "16px 24px 32px 24px" }}>
        {sorted.map((cap) => {
          const state = recommendations[cap.name];
          const failed = cap.criteriaResults.filter(cr => cr.points === 0 && !cr.error).length;
          const total = cap.criteriaResults.length;
          const errored = cap.criteriaResults.filter(cr => cr.error).length;
          const lvl = levelMeta(cap.utilization.level);
          const isPerfect = failed === 0;

          return (
            <Container key={cap.name} color="neutral" variant="default"
              style={{ padding: 16, borderLeft: `4px solid ${cap.color}` }}>
              {/* Capability header */}
              <Flex flexDirection="row" alignItems="center" justifyContent="space-between"
                style={{ marginBottom: 8 }}>
                <Flex flexDirection="row" alignItems="center" gap={8}>
                  <Flex style={{
                    width: 12, height: 12, borderRadius: "50%", background: cap.color,
                  }} />
                  <Text style={{ fontSize: 15, fontWeight: 700, color: text }}>
                    {cap.name}
                  </Text>
                </Flex>
                <Flex flexDirection="row" alignItems="center" gap={8}>
                  <Text style={{ fontSize: 20, fontWeight: 700, color: cap.color }}>
                    {cap.score}%
                  </Text>
                  <Text style={{
                    fontSize: 10, fontWeight: 700,
                    padding: "2px 8px", borderRadius: 4,
                    background: lvl.color + "20", color: lvl.color,
                  }}>
                    {lvl.label}
                  </Text>
                  <Text style={{
                    fontSize: 10, fontWeight: 700,
                    padding: "2px 8px", borderRadius: 4,
                    background: accent + "15", color: accent,
                  }}>
                    Utilization {cap.utilization.utilizationScore}
                  </Text>
                </Flex>
              </Flex>

              {/* Failure summary */}
              <Flex flexDirection="row" gap={12} style={{ marginBottom: isPerfect ? 0 : 8 }}>
                <Text style={{ fontSize: 11, color: textSec }}>
                  <Strong style={{ color: failed > 0 ? Colors.Text.Critical.Default : Colors.Text.Success.Default }}>
                    {failed}
                  </Strong>{" "}/ {total} criteria below threshold
                </Text>
                {errored > 0 && (
                  <Text style={{ fontSize: 11, color: Colors.Text.Critical.Default }}>
                    {errored} query error{errored === 1 ? "" : "s"}
                  </Text>
                )}
              </Flex>

              {/* AI insight section (or "perfect" message) */}
              {isPerfect ? (
                <Text style={{
                  fontSize: 12, color: Colors.Text.Success.Default, fontStyle: "italic",
                  marginTop: 4,
                }}>
                  All criteria passed — no recommendation needed.
                </Text>
              ) : (
                <DavisInsightSection state={state} capabilityName={cap.name} onSendFollowUp={sendFollowUp} onRequestInsight={requestInsight} />
              )}
            </Container>
          );
        })}
      </Flex>

      {/* Footer note */}
      <Flex flexDirection="column" alignItems="center" style={{
        padding: "12px 24px 24px",
        borderTop: `1px solid ${border}`,
        background: surface,
      }}>
        <Text style={{ fontSize: 10, color: textTert, fontStyle: "italic", textAlign: "center" }}>
          AI insights generated by Davis CoPilot. Responses are cached 24h per capability per
          failure signature. Bump PROMPT_VERSION in promptTemplates.ts to invalidate.
        </Text>
      </Flex>
    </Flex>
  );
};

const Stat: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <Flex flexDirection="row" alignItems="center" gap={4}>
    <Text style={{ fontSize: 12, fontWeight: 700, color }}>{value}</Text>
    <Text style={{ fontSize: 11, color: "inherit" }}>{label}</Text>
  </Flex>
);
