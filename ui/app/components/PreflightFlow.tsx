import React, { useCallback, useEffect } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Button } from "@dynatrace/strato-components/buttons";
import { Code, Strong, Text } from "@dynatrace/strato-components/typography";
import { Flex } from "@dynatrace/strato-components/layouts";
import { usePreflight } from "../hooks/usePreflight";

export interface PreflightFlowProps {
  start: (useProxy?: boolean) => void;
  onEnableProxyMode: () => void;
  selectedCount: number;
  totalCount: number;
  /**
   * Called immediately before starting or triggering the preflight check.
   * Used by the parent to collapse the ConsolidationPanel before the run.
   */
  onBeforeStart?: () => void;
}

/**
 * Owns the `usePreflight` hook. Renders:
 * 1. The Run Assessment button
 * 2. The preflight validation results box (checks list, error/retry, proxy-mode offer)
 *
 * Auto-starts the assessment once all preflight checks pass.
 */
export const PreflightFlow: React.FC<PreflightFlowProps> = ({
  start,
  onEnableProxyMode,
  selectedCount,
  totalCount,
  onBeforeStart,
}) => {
  const dk = useCurrentTheme() === "dark";
  const border = Colors.Border.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;
  const textTert = Colors.Text.Neutral.Disabled;
  const accent = Colors.Text.Primary.Default;

  const preflight = usePreflight();

  const handleRunClick = useCallback(async () => {
    onBeforeStart?.();
    if (preflight.validated) {
      start();
      return;
    }
    await preflight.runPreflight();
  }, [preflight.validated, preflight.runPreflight, start, onBeforeStart]);

  // Auto-start assessment when preflight passes
  useEffect(() => {
    if (preflight.allPassed) {
      preflight.markValidated();
      preflight.reset();
      start();
    }
  }, [preflight.allPassed, preflight.markValidated, preflight.reset, start]);

  return (
    <>
      {/* Preflight validation results */}
      {(preflight.running || preflight.hasFails || preflight.spansNotEntitled) && (
        <Flex flexDirection="column" style={{
          width: "100%", maxWidth: 340, marginBottom: 12, borderRadius: 10,
          background: dk ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)",
          border: `1px solid ${preflight.hasFails ? Colors.Border.Critical.Default : preflight.spansNotEntitled ? Colors.Border.Warning.Default : border}`,
          overflow: "hidden",
        }}>
          <Flex alignItems="center" gap={8} style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700,
            color: preflight.hasFails ? Colors.Text.Critical.Default : preflight.spansNotEntitled ? Colors.Text.Warning.Default : accent,
            borderBottom: `1px solid ${border}` }}>
            {preflight.running ? "⏳" : preflight.hasFails || preflight.spansNotEntitled ? "⚠" : "✓"} Pre-flight Validation
          </Flex>
          <Flex flexDirection="column" style={{ padding: "8px 16px" }}>
            {preflight.checks.map(c => (
              <Flex key={c.id} alignItems="flex-start" gap={8} style={{ padding: "6px 0", borderBottom: `1px solid ${border}20` }}>
                <Text style={{ fontSize: 14, lineHeight: 1.2, flexShrink: 0, marginTop: 1 }}>
                  {c.status === "pending" ? "○" : c.status === "running" ? "◌" : c.status === "ok" ? "✓" : c.status === "not-entitled" ? "⚠" : "✗"}
                </Text>
                <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
                  <Flex flexDirection="column" style={{
                    fontSize: 12, fontWeight: 600,
                    color: c.status === "ok" ? Colors.Text.Success.Default : c.status === "fail" ? Colors.Text.Critical.Default : c.status === "not-entitled" ? Colors.Text.Warning.Default : textSec,
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
                  {c.status === "not-entitled" && (
                    <Flex flexDirection="column" style={{ fontSize: 11, color: Colors.Text.Warning.Default, marginTop: 2, lineHeight: 1.4 }}>
                      Traces on Grail is not enabled on this environment — a tenant entitlement, not an app scope. Granting scopes will not fix this.
                    </Flex>
                  )}
                </Flex>
              </Flex>
            ))}
          </Flex>
          {preflight.spansNotEntitled && !preflight.hasFails && (
            <Flex flexDirection="column" style={{
              padding: "12px 16px", borderTop: `1px solid ${border}`,
              fontSize: 11, color: textSec, lineHeight: 1.6,
              background: dk ? "rgba(243,166,51,0.06)" : "rgba(243,166,51,0.05)",
            }}>
              <Strong style={{ color: Colors.Text.Warning.Default }}>Trace Proxy Mode available.</Strong> All other data sources are
              accessible. Span-based checks can run against service metrics and topology instead (marked "≈ proxy");
              checks with no honest equivalent — including all of <Strong style={{ color: Colors.Text.Neutral.Default }}>AI Observability</Strong> — are
              excluded from scoring rather than counted as failures.
              <Flex gap={8} style={{ marginTop: 8 }}>
                <Button
                  onClick={() => {
                    preflight.markValidated();
                    preflight.reset();
                    onEnableProxyMode();
                    start(true);
                  }}
                  size="condensed" variant="emphasized" color="primary"
                >
                  Continue in Trace Proxy Mode
                </Button>
                <Button onClick={() => preflight.reset()} size="condensed">
                  Dismiss
                </Button>
              </Flex>
            </Flex>
          )}
          {preflight.hasFails && (
            <Flex flexDirection="column" style={{
              padding: "12px 16px", borderTop: `1px solid ${border}`,
              fontSize: 11, color: textSec, lineHeight: 1.6,
              background: dk ? "rgba(205,60,68,0.06)" : "rgba(205,60,68,0.03)",
            }}>
              <Strong style={{ color: Colors.Text.Critical.Default }}>Assessment blocked.</Strong> Grant the missing scopes to this app in
              <Strong style={{ color: Colors.Text.Neutral.Default }}> Settings → Authorization → OAuth clients</Strong>, or verify the app manifest includes all required scopes.
              <Flex flexDirection="column" style={{ marginTop: 6 }}>
                <Button onClick={() => preflight.reset()} size="condensed" color="primary">
                  Dismiss
                </Button>
              </Flex>
            </Flex>
          )}
        </Flex>
      )}

      {/* Run Assessment button */}
      <Button
        onClick={(preflight.running || selectedCount === 0) ? undefined : handleRunClick}
        disabled={preflight.running || selectedCount === 0}
        loading={preflight.running}
        variant="emphasized"
        color="primary"
        style={{ width: "100%", textAlign: "center" }}
      >
        {preflight.running
          ? "Validating…"
          : selectedCount === 0
          ? "Select at least 1 capability"
          : selectedCount < totalCount
          ? `DT Capability Assessment (${selectedCount}/${totalCount})`
          : "DT Capability Assessment"}
      </Button>
    </>
  );
};
