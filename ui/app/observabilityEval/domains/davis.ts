import { runDql, toNum } from "../queryRunner";
import { getSettingsObjectCounts, getSettingsEnabledCounts } from "../../tenantReview/services/settingsService";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runDavisDomain(): Promise<ObsDomainResult> {
  const [problemsR, davisEventsR, sloR, settingsCounts, settingsEnabled] = await Promise.all([
    runDql("fetch events, from:now()-30d | filter event.kind == \"DAVIS_PROBLEM\" | summarize count()"),
    runDql("fetch events, from:now()-30d | filter event.kind == \"DAVIS_EVENT\" | summarize total = count()"),
    runDql("fetch dt.entity.service_level_objective | summarize count()"),
    getSettingsObjectCounts([
      "builtin:davis.anomaly-detectors",
      "builtin:alerting.maintenance-window",
    ]),
    getSettingsEnabledCounts([
      "builtin:alerting.profile",
    ]),
  ]);

  const problemCount = toNum(problemsR.records[0]?.["count()"]);
  const davisEventTotal = toNum(davisEventsR.records[0]?.["total"]);
  const sloCount = toNum(sloR.records[0]?.["count()"]);
  const davisDetectors = settingsCounts.get("builtin:davis.anomaly-detectors") ?? 0;
  const maintenanceWindows = settingsCounts.get("builtin:alerting.maintenance-window") ?? 0;
  const alertingProfiles = settingsEnabled.get("builtin:alerting.profile");
  const enabledAlertingProfiles = alertingProfiles?.enabled ?? 0;

  // P1: Davis anomaly detectors configured
  const p1Score = (davisDetectors ?? 0) >= 5 ? 100 : (davisDetectors ?? 0) >= 2 ? 70 : (davisDetectors ?? 0) === 1 ? 50 : 0;
  const p1 = mkProbe(
    "davis.detectors", "Davis Anomaly Detectors", 0.20, p1Score,
    `${davisDetectors ?? 0} Davis Anomaly Detector configuration${davisDetectors !== 1 ? "s" : ""}`,
    "≥ 5 Davis Anomaly Detectors configured",
    (davisDetectors ?? 0) === 0 ? mkFinding(
      "davis.detectors", "No Davis Anomaly Detectors Configured",
      "No custom Davis Anomaly Detectors are configured. Anomaly detection relies on default baselines only.",
      "warning",
      "Configure Davis Anomaly Detectors to define custom thresholds and alerting conditions for critical metrics.",
      "0 anomaly detector configurations"
    ) : (davisDetectors ?? 0) < 3 ? mkFinding(
      "davis.detectors", "Limited Davis Anomaly Detector Coverage",
      `Only ${davisDetectors} anomaly detector${davisDetectors !== 1 ? "s are" : " is"} configured.`,
      "info",
      "Expand anomaly detector coverage to critical services, infrastructure components, and SLO thresholds."
    ) : undefined
  );

  // P2: Davis AI generating events (active problem detection)
  const p2Score = davisEventTotal > 100 ? 100 : davisEventTotal > 0 ? 80 : 0;
  const p2 = mkProbe(
    "davis.events", "Davis AI event activity", 0.15, p2Score,
    `${davisEventTotal.toLocaleString()} Davis events detected in last 30 days`,
    "> 0 Davis events (AI is actively evaluating)",
    davisEventTotal === 0 ? mkFinding(
      "davis.events", "Davis AI Not Generating Events",
      "No Davis events in the last 30 days — Davis AI may not be actively evaluating telemetry.",
      "warning",
      "Verify that Davis AI is enabled and that baseline data is sufficient for anomaly detection."
    ) : undefined
  );

  // P3: Problem count trend (open problems as health signal)
  const p3Score = problemCount === 0 ? 100 : problemCount < 10 ? 90 : problemCount < 50 ? 70 : problemCount < 200 ? 50 : 30;
  const p3 = mkProbe(
    "davis.problems", "Open problem count", 0.15, p3Score,
    `${problemCount.toLocaleString()} Davis problem${problemCount !== 1 ? "s" : ""} in last 30 days`,
    "Fewer active problems indicates healthy environment"
  );

  // P4: Alerting profiles (Gen3)
  const p4Score = enabledAlertingProfiles >= 3 ? 100 : enabledAlertingProfiles >= 1 ? 70 : 0;
  const p4 = mkProbe(
    "davis.alerting", "Alerting profiles configured", 0.20, p4Score,
    `${enabledAlertingProfiles} enabled alerting profile${enabledAlertingProfiles !== 1 ? "s" : ""}`,
    "≥ 3 alerting profiles configured",
    enabledAlertingProfiles === 0 ? mkFinding(
      "davis.alerting", "No Alerting Profiles Configured",
      "No alerting profiles are enabled. Davis problems will not trigger notifications.",
      "critical",
      "Configure alerting profiles to route Davis problems to the appropriate notification channels and teams.",
      "0 enabled alerting profiles"
    ) : enabledAlertingProfiles < 3 ? mkFinding(
      "davis.alerting", "Limited Alerting Profile Coverage",
      `Only ${enabledAlertingProfiles} alerting profile${enabledAlertingProfiles !== 1 ? "s are" : " is"} enabled.`,
      "info",
      "Create alerting profiles per team or environment to route notifications with appropriate severity filters."
    ) : undefined
  );

  // P5: SLOs defined
  const p5Score = sloCount >= 10 ? 100 : sloCount >= 5 ? 80 : sloCount >= 1 ? 60 : 0;
  const p5 = mkProbe(
    "davis.slos", "Service Level Objectives defined", 0.15, p5Score,
    `${sloCount} SLO${sloCount !== 1 ? "s" : ""} defined`,
    "≥ 10 SLOs defined for critical services",
    sloCount === 0 ? mkFinding(
      "davis.slos", "No Service Level Objectives Defined",
      "No SLOs are defined. Without SLOs, reliability targets are unmeasured and burn-rate alerts are unavailable.",
      "warning",
      "Define SLOs for critical services to establish reliability targets and enable Davis AI SLO-based alerting.",
      "0 SLO definitions"
    ) : sloCount < 5 ? mkFinding(
      "davis.slos", "Limited SLO Coverage",
      `Only ${sloCount} SLO${sloCount !== 1 ? "s are" : " is"} defined across all services.`,
      "info",
      "Expand SLO coverage to all customer-facing services and critical internal dependencies."
    ) : undefined
  );

  // P6: Maintenance windows
  const p6Score = (maintenanceWindows ?? 0) >= 1 ? 100 : 50;
  const p6 = mkProbe(
    "davis.maintenance", "Maintenance windows configured", 0.15, p6Score,
    `${maintenanceWindows ?? 0} maintenance window${maintenanceWindows !== 1 ? "s" : ""} configured`,
    "≥ 1 maintenance window defined",
    (maintenanceWindows ?? 0) === 0 ? mkFinding(
      "davis.maintenance", "No Maintenance Windows Configured",
      "No maintenance windows are defined. Planned maintenance activities will trigger false-positive Davis problems.",
      "info",
      "Create maintenance window schedules to suppress alerting during planned outages and deployments."
    ) : undefined
  );

  return buildDomain("davis", "Davis AI & Alerting", "△", [p1, p2, p3, p4, p5, p6]);
}
