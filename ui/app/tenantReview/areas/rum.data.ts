import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES, SETTINGS_SCHEMAS } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getSettingsObjectCounts } from "../services/settingsService";
import { useReviewConfig, getAreaWeight, getGen3Severity } from "../hooks/useReviewConfig";

export function useRumReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "rum",
    status: "unknown",
    score: { value: 0, weight: 0.7, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const appCount = useDql(DQL_QUERIES.applicationCount);
  const mobileAppCount = useDql(DQL_QUERIES.mobileAppCount);
  const rumEventVolume = useDql(DQL_QUERIES.rumEventVolume);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (appCount.isLoading || appCount.isPending) return;
    if (mobileAppCount.isLoading || mobileAppCount.isPending) return;
    if (rumEventVolume.isLoading || rumEventVolume.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        const counts = await getSettingsObjectCounts([
          SETTINGS_SCHEMAS.rumWeb,
          SETTINGS_SCHEMAS.sessionReplay,
        ]);
        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const apps = Number((appCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
        const rumEvents = Number((rumEventVolume.data?.records?.[0] as Record<string, unknown>)?.["total"] ?? 0);
        const rumWebConfigs = counts.get(SETTINGS_SCHEMAS.rumWeb) ?? 0;
        const sessionReplayConfigs = counts.get(SETTINGS_SCHEMAS.sessionReplay) ?? 0;

        // Check 1: Applications monitored
        checks.push({
          name: "Web applications monitored",
          weight: 0.3,
          result: apps > 0 ? "pass" : "fail",
        });
        if (apps === 0) {
          findings.push({
            id: "rum-no-apps",
            title: "No monitored web applications found",
            description: "No RUM applications are configured. Real User Monitoring provides frontend visibility.",
            severity: "warning",
            recommendation: "Configure RUM for your web applications to gain frontend performance insights.",
          });
        } else {
          findings.push({
            id: "rum-apps",
            title: `${apps} web application(s) monitored`,
            description: "RUM is actively monitoring web applications.",
            severity: "info",
            recommendation: "Ensure all customer-facing web applications have RUM configured.",
          });
        }

        // Check 2: Recent RUM user events prove utilization, not just configuration.
        if (apps > 0) {
          checks.push({
            name: "RUM user events flowing",
            weight: 0.25,
            result: rumEventVolume.error ? "partial" : rumEvents > 0 ? "pass" : "fail",
            partialValue: rumEventVolume.error ? 0.3 : undefined,
          });
          if (rumEventVolume.error) {
            findings.push({
              id: "rum-events-error",
              title: "Cannot access RUM user events",
              description: "RUM utilization could not be confirmed from Grail user events.",
              severity: "info",
              recommendation: "Verify the app has permission to query user.events data.",
            });
          } else if (rumEvents > 0) {
            findings.push({
              id: "rum-events-active",
              title: `${rumEvents.toLocaleString()} RUM user event(s) in last 30 days`,
              description: "RUM applications are actively receiving user experience data in Grail.",
              severity: "success",
              recommendation: "Use DQL over user events for frontend experience dashboards and investigations.",
            });
          } else {
            findings.push({
              id: "rum-events-none",
              title: "RUM applications configured, but no user events in last 30 days",
              description: "Configured RUM apps are not enough for Gen3 adoption; recent user-event flow proves active utilization.",
              severity: "warning",
              recommendation: "Verify JavaScript injection, beacon delivery, app detection rules, and privacy settings.",
            });
          }
        }

        // Check 3: RUM web config in Settings 2.0
        checks.push({
          name: "RUM configuration in Settings 2.0",
          weight: 0.20,
          result: apps === 0 ? "partial" : rumWebConfigs > 0 ? "pass" : "fail",
          partialValue: apps === 0 ? 0.3 : undefined,
        });
        if (apps > 0 && rumWebConfigs === 0) {
          findings.push({
            id: "rum-no-settings",
            title: "No RUM web Settings 2.0 configuration found",
            description: "RUM configuration should be managed through Settings 2.0 for Gen3 compatibility.",
            severity: "info",
            recommendation: "Review RUM configuration in Settings 2.0 (builtin:rum.web).",
          });
        }

        // Check 4: Session Replay. Optional without apps; scored only when RUM apps exist.
        if (apps > 0) {
          checks.push({
            name: "Session Replay configured",
            weight: 0.15,
            result: sessionReplayConfigs > 0 ? "pass" : "partial",
            partialValue: 0.3,
          });
        }
        if (apps > 0 && sessionReplayConfigs === 0) {
          findings.push({
            id: "rum-no-replay",
            title: "Session Replay not configured",
            description: "Session Replay captures visual recordings of user sessions for troubleshooting.",
            severity: "info",
            recommendation: "Enable Session Replay (builtin:sessionreplay.web) for critical applications.",
          });
        }

        // Check 5: DQL migration from USQL
        checks.push({
          name: "DQL migration readiness",
          weight: 0.15,
          result: "partial",
          partialValue: 0.6,
        });
        findings.push({
          id: "rum-usql-migration",
          title: "USQL to DQL migration",
          description: "USQL (User Session Query Language) is deprecated. Use DQL queries against Grail for session data analysis.",
          severity: "info",
          recommendation: "Migrate any USQL queries to DQL. Use Grail user event/session data such as user.events for frontend analysis.",
        });

        // Check 6: Mobile App Monitoring
        const mobileApps = Number((mobileAppCount.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0);
        if (config.mobileApps.enabled) {
          checks.push({
            name: "Mobile App Monitoring",
            weight: config.mobileApps.weight,
            result: mobileApps >= config.mobileApps.criticalMax ? "pass" :
              mobileApps >= config.mobileApps.warningMax ? "partial" : "fail",
            partialValue: mobileApps > 0 ? Math.min(0.4 + (mobileApps * 0.15), 0.9) : undefined,
          });
          findings.push({
            id: "rum-mobile-apps",
            title: mobileApps === 0 ? "No mobile apps monitored" : `${mobileApps} mobile app(s) monitored — iOS/Android`,
            description: mobileApps === 0
              ? "No mobile applications are being monitored. Mobile RUM provides visibility into iOS and Android app performance."
              : "Mobile RUM is active, providing visibility into iOS and Android app performance and user experience.",
            severity: getGen3Severity(mobileApps, config.mobileApps),
            recommendation: mobileApps === 0
              ? "If you have mobile apps, configure Mobile RUM to gain visibility into mobile user experience."
              : "Continue monitoring mobile apps and review crash analytics and user action performance.",
          });
        }

        // Summary
        findings.push({
          id: "rum-summary",
          title: `RUM summary: ${apps} apps, ${rumEvents.toLocaleString()} user events (30d), ${rumWebConfigs} web configs, ${sessionReplayConfigs} replay configs`,
          description: "RUM data is transitioning to Grail storage. USQL should be replaced with DQL queries.",
          severity: "info",
          recommendation: "Complete USQL to DQL migration and ensure Session Replay is enabled for critical apps.",
        });

        const area = REVIEW_AREA_MAP.get("rum")!;
        const areaWeight = getAreaWeight(config, "rum");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: RUM is in transition to Grail. Count recent user events as the utilization signal.
        const gen3Signals = (rumWebConfigs > 0 ? 1 : 0) + (sessionReplayConfigs > 0 ? 1 : 0) + (rumEvents > 0 ? 1 : 0);
        const migration = buildMigrationMetrics(
          3 - gen3Signals,
          gen3Signals,
          "{gen3} of 3 RUM Gen3 signals present ({pct}%)"
        );

        setResult({
          areaId: "rum",
          status: classifyStatus(score.value),
          score,
          migration,
          findings,
          lastUpdated: new Date(),
          isLoading: false,
        });
      } catch (err) {
        if (!cancelled) {
          setResult((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to analyze RUM",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [appCount.isLoading, appCount.isPending, appCount.data, appCount.error,
    mobileAppCount.isLoading, mobileAppCount.isPending, mobileAppCount.data, mobileAppCount.error,
    rumEventVolume.isLoading, rumEventVolume.isPending, rumEventVolume.data, rumEventVolume.error]);

  return result;
}
