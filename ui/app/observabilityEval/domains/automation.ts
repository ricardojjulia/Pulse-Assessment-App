import { runDql, toNum } from "../queryRunner";
import { mkProbe, mkFinding, buildDomain } from "../domainUtils";
import type { ObsDomainResult } from "../types";

export async function runAutomationDomain(): Promise<ObsDomainResult> {
  const [execHealthR, deployR] = await Promise.all([
    runDql(
      "fetch events, from:now()-30d | filter event.type == \"automation.workflow.execution\" | summarize total = count(), success = countIf(success == true) | fieldsAdd successRate = if(total > 0, success * 100.0 / total, else: 0.0)"
    ),
    runDql("fetch events, from:now()-30d | filter event.type == \"CUSTOM_DEPLOYMENT\" | summarize total = count()"),
  ]);

  const totalExecs = toNum(execHealthR.records[0]?.["total"]);
  const successRate = toNum(execHealthR.records[0]?.["successRate"]);
  const deployEvents = toNum(deployR.records[0]?.["total"]);

  // P1: Workflows actively executing
  const p1Score = totalExecs >= 100 ? 100 : totalExecs >= 10 ? 80 : totalExecs >= 1 ? 60 : 0;
  const p1 = mkProbe(
    "auto.workflows", "AutomationEngine workflow activity", 0.40, p1Score,
    totalExecs === 0
      ? "No workflow executions found in last 30 days"
      : `${totalExecs.toLocaleString()} workflow execution${totalExecs !== 1 ? "s" : ""} in last 30 days`,
    "≥ 10 workflow executions in 30 days",
    totalExecs === 0 ? mkFinding(
      "auto.workflows", "No Workflow Executions Detected",
      "No AutomationEngine workflow executions found in the last 30 days.",
      "warning",
      "Create and schedule workflows to automate operational tasks such as incident response, capacity management, and reporting.",
      "0 workflow executions in 30 days"
    ) : undefined
  );

  // P2: Workflow execution health (success rate)
  const p2Score = totalExecs === 0 ? 50 : successRate >= 95 ? 100 : successRate >= 80 ? Math.round(successRate) : successRate >= 60 ? 50 : 0;
  const p2 = mkProbe(
    "auto.health", "Workflow execution success rate", 0.40, p2Score,
    totalExecs === 0
      ? "No execution data to evaluate"
      : `${successRate.toFixed(1)}% workflow execution success rate (last 30 days)`,
    "≥ 95% workflow success rate",
    totalExecs > 0 && successRate < 80 ? mkFinding(
      "auto.health", "Low Workflow Success Rate",
      `Only ${successRate.toFixed(1)}% of workflow executions succeeded in the last 30 days.`,
      successRate < 60 ? "warning" : "info",
      "Review failing workflows in the AutomationEngine UI. Common issues include credential expiry, API rate limits, and task timeouts.",
      `Success: ${Math.round(successRate * totalExecs / 100).toLocaleString()} of ${totalExecs.toLocaleString()} executions`
    ) : undefined
  );

  // P3: Deployment event tracking
  const p3Score = deployEvents >= 10 ? 100 : deployEvents >= 1 ? 70 : 0;
  const p3 = mkProbe(
    "auto.deploys", "Deployment event tracking", 0.20, p3Score,
    `${deployEvents.toLocaleString()} custom deployment event${deployEvents !== 1 ? "s" : ""} in last 30 days`,
    "≥ 1 deployment event tracked (release tracking active)",
    deployEvents === 0 ? mkFinding(
      "auto.deploys", "No Deployment Events Tracked",
      "No custom deployment events are present in Grail. Release tracking is not active.",
      "info",
      "Integrate CI/CD pipelines with Dynatrace Events API or use the Release Tracking feature to annotate deployments in the timeline.",
      "0 deployment events in 30 days"
    ) : undefined
  );

  return buildDomain("automation", "Automation & Workflows", "⚙", [p1, p2, p3]);
}
