import type { AssessmentSnapshot } from "../hooks/useAssessmentHistory";
import type { CapabilityResult, EntityCounts, QueryStats } from "../hooks/useCoverageData";
import { CRITERION_IMPORTANCE } from "../data/criterionImportance";
import { CRITERION_REMEDIATION } from "../data/criterionRemediation";
import type { BestPracticesResult } from "../tenantReview/areas/bestPractices.data";
import { BEST_PRACTICE_NOTEBOOK_GUIDANCE } from "../tenantReview/constants/bestPracticeNotebookGuidance";
import { REVIEW_AREAS } from "../tenantReview/constants/reviewAreas";
import type { TenantOverview } from "../tenantReview/types/review.types";

export interface CompleteMarkdownReportInput {
  capabilities: CapabilityResult[];
  totalScore: number;
  overallMaturityLevel: number;
  tenant: string;
  date: string;
  stats: QueryStats | null;
  entityCounts: EntityCounts | null;
  snapshots: AssessmentSnapshot[];
  tenantReview?: TenantOverview;
  bestPractices?: BestPracticesResult;
}

function tableCell(value: unknown): string {
  return String(value ?? "N/A")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function formatValue(value: number, isRatio = false): string {
  if (!Number.isFinite(value)) return "N/A";
  const formatted = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return isRatio ? `${formatted}%` : formatted;
}

function criterionStatus(criterion: CapabilityResult["criteriaResults"][number]): string {
  if (criterion.error) return "Query failed";
  if (criterion.notApplicable) return "Not applicable";
  return criterion.points > 0 ? "Passing" : "Not passing";
}

function tierLabel(tier: CapabilityResult["criteriaResults"][number]["tier"]): string {
  if (tier === "bestPractice") return "Best Practice";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function appendCurrentAssessment(lines: string[], capabilities: CapabilityResult[]): void {
  lines.push("## Complete Current Assessment", "");

  for (const capability of capabilities) {
    lines.push(`### ${capability.name}`, "");
    lines.push(
      `- Effective score: **${capability.score}/100**`,
      `- Raw score: **${capability.rawScore}/100**`,
      `- Consolidation: **${capability.consolidation}%**`,
      `- Maturity: **${capability.maturity.levelLabel} (${capability.effectiveMaturityScore}/100)**`,
      `- Foundation checks: **${capability.maturity.foundation.passed}/${capability.maturity.foundation.total}**`,
      `- Best Practice checks: **${capability.maturity.bestPractice.passed}/${capability.maturity.bestPractice.total}**`,
      `- Excellence checks: **${capability.maturity.excellence.passed}/${capability.maturity.excellence.total}**`,
      "",
    );

    for (const criterion of capability.criteriaResults) {
      const remediation = CRITERION_REMEDIATION[criterion.id];
      const importance = CRITERION_IMPORTANCE[criterion.id];
      lines.push(`#### ${criterion.id}: ${criterion.label}`, "");
      lines.push(
        `- Tier: **${tierLabel(criterion.tier)}**`,
        `- Status: **${criterionStatus(criterion)}**`,
        `- Measured value: **${formatValue(criterion.value, criterion.isRatio)}**`,
        `- Criterion score: **${criterion.score}/100**`,
        `- Points awarded: **${criterion.points}**`,
        `- Thresholds: **${criterion.thresholds || "Not specified"}**`,
      );
      if (typeof criterion.denominator === "number") {
        lines.push(`- Denominator: **${formatValue(criterion.denominator)}**`);
      }
      lines.push("", criterion.description, "");
      if (importance) lines.push(`**Why it matters:** ${importance}`, "");
      if (remediation) {
        lines.push(`**Recommended action:** ${remediation.action}`, "");
        if (remediation.docLink) lines.push(`**Documentation:** ${remediation.docLink}`, "");
      }
      lines.push("**DQL evidence query:**", "", "```dql", criterion.query, "```", "");
    }
  }
}

function appendBestPracticeSummary(lines: string[], capabilities: CapabilityResult[]): void {
  const bestPractices = capabilities.flatMap((capability) =>
    capability.criteriaResults
      .filter((criterion) => criterion.tier === "bestPractice")
      .map((criterion) => ({ capability: capability.name, criterion })),
  );

  lines.push("## Best Practice Evaluations", "");
  lines.push(
    `All **${bestPractices.length}** Best Practice-tier evaluations are listed below. Full evidence, rationale, DQL, and remediation are included in the current assessment section.`,
    "",
    "| Capability | ID | Evaluation | Result | Value | Score | Threshold |",
    "|---|---|---|---|---:|---:|---|",
  );
  for (const { capability, criterion } of bestPractices) {
    lines.push(`| ${tableCell(capability)} | ${tableCell(criterion.id)} | ${tableCell(criterion.label)} | ${criterionStatus(criterion)} | ${tableCell(formatValue(criterion.value, criterion.isRatio))} | ${criterion.score}/100 | ${tableCell(criterion.thresholds)} |`);
  }
  lines.push("");
}

function appendAssessmentHistory(lines: string[], snapshots: AssessmentSnapshot[]): void {
  lines.push("## Assessment History", "");
  if (snapshots.length === 0) {
    lines.push("No historical assessments are available.", "");
    return;
  }

  for (const snapshot of snapshots) {
    lines.push(`### ${snapshot.timestamp}`, "");
    lines.push(`Tenant: **${snapshot.tenant}**  `, `Overall score: **${snapshot.totalScore}/100**`, "");
    for (const capability of snapshot.capabilities) {
      lines.push(`#### ${capability.name} (${capability.score}/100)`, "");
      lines.push("| ID | Evaluation | Value | Points | Result |", "|---|---|---:|---:|---|");
      for (const criterion of capability.criteriaResults) {
        const result = criterion.error ? "Query failed" : criterion.points > 0 ? "Passing" : "Not passing";
        lines.push(`| ${tableCell(criterion.id)} | ${tableCell(criterion.label)} | ${tableCell(formatValue(criterion.value))} | ${criterion.points} | ${result} |`);
      }
      lines.push("");
    }
  }
}

function appendTenantReview(lines: string[], overview: TenantOverview): void {
  lines.push(
    "## Tenant Review: All Areas",
    "",
    `- Overall score: **${overview.overallScore}/100**`,
    `- Gen3 migration: **${overview.overallMigrationPercentage}%**`,
    `- Total findings: **${overview.totalFindings}**`,
    `- Critical findings: **${overview.criticalFindings.length}**`,
    "",
  );

  for (const result of overview.areaResults) {
    const definition = REVIEW_AREAS.find((area) => area.id === result.areaId);
    lines.push(`### ${definition?.name ?? result.areaId}`, "");
    lines.push(
      `- Status: **${result.status}**`,
      `- Score: **${result.score.value}/100** (${result.score.passedChecks}/${result.score.totalChecks} checks passed)`,
      `- Gen3 migration: **${result.migration.percentage}% (${result.migration.level})**`,
      `- Classic objects: **${result.migration.classicCount}**`,
      `- Gen3 objects: **${result.migration.gen3Count}**`,
      `- Last updated: **${result.lastUpdated.toISOString()}**`,
      "",
      result.migration.summary,
      "",
    );
    if (result.error) lines.push(`**Collection error:** ${result.error}`, "");
    if (result.findings.length === 0) {
      lines.push("No findings.", "");
      continue;
    }
    for (const finding of result.findings) {
      lines.push(`#### ${finding.title}`, "");
      lines.push(`- Severity: **${finding.severity}**`, "", finding.description, "");
      if (finding.detail) lines.push(`**Evidence:** ${finding.detail}`, "");
      lines.push(`**Recommendation:** ${finding.recommendation}`, "");
      if (finding.actionUrl) lines.push(`**Action:** ${finding.actionUrl}`, "");
    }
  }
}

function appendBestPracticeRubrics(lines: string[], result: BestPracticesResult): void {
  lines.push(
    "## App and Best-Practice Rubrics",
    "",
    `- Overall rubric score: **${result.overallScore}/100**`,
    `- Checks passed: **${result.totalPassed}/${result.totalChecks}**`,
    `- Rubrics evaluated: **${result.categories.length}**`,
    "",
  );
  if (result.error) lines.push(`**Evaluation error:** ${result.error}`, "");

  for (const category of result.categories) {
    lines.push(`### ${category.name}`, "", category.description, "");
    lines.push(`Checks passed: **${category.passedChecks}/${category.totalChecks}**`, "");
    for (const finding of category.findings) {
      lines.push(`#### ${finding.title}`, "");
      lines.push(`- Severity: **${finding.severity}**`, "", finding.description, "");
      if (finding.detail) lines.push(`**Evidence:** ${finding.detail}`, "");
      lines.push(`**Recommendation:** ${finding.recommendation}`, "");
      if (finding.actionUrl) lines.push(`**Action:** ${finding.actionUrl}`, "");
    }
    const guidance = BEST_PRACTICE_NOTEBOOK_GUIDANCE[category.id];
    if (guidance?.references.length) {
      lines.push("#### Notebook Guidance", "");
      for (const reference of guidance.references) {
        lines.push(`- [${reference.series} - ${reference.title}](${reference.url}): ${reference.focus}`);
      }
      lines.push("");
    }
  }
}

export function buildCompleteMarkdownReport(input: CompleteMarkdownReportInput): string {
  const generatedAt = new Date().toISOString();
  const totalCriteria = input.capabilities.reduce((total, capability) => total + capability.criteriaResults.length, 0);
  const passingCriteria = input.capabilities.reduce(
    (total, capability) => total + capability.criteriaResults.filter((criterion) => !criterion.error && !criterion.notApplicable && criterion.points > 0).length,
    0,
  );
  const lines: string[] = [
    "# ESA Tenant Evaluator: Complete Results",
    "",
    `> Tenant: \`${input.tenant}\` | Assessment date: ${input.date || "N/A"} | Exported: ${generatedAt}`,
    "",
    "This file is generated in the browser and is not saved by the application.",
    "",
    "## Executive Summary",
    "",
    `- Overall assessment score: **${input.totalScore}/100**`,
    `- Overall maturity level: **${input.overallMaturityLevel}**`,
    `- Capabilities assessed: **${input.capabilities.length}**`,
    `- Criteria passing: **${passingCriteria}/${totalCriteria}**`,
    `- Historical assessments included: **${input.snapshots.length}**`,
    "",
  ];

  lines.push("## Collection Statistics", "");
  if (input.stats) {
    lines.push(
      `- Queries: **${input.stats.succeeded}/${input.stats.total} succeeded**, ${input.stats.failed} failed`,
      `- Records scanned: **${input.stats.scannedRecords.toLocaleString()}**`,
      `- Bytes scanned: **${input.stats.scannedBytes.toLocaleString()}**`,
      `- Data points scanned: **${input.stats.scannedDataPoints.toLocaleString()}**`,
      "",
    );
  } else {
    lines.push("Collection statistics are not available.", "");
  }

  lines.push("## Tenant Inventory", "");
  if (input.entityCounts) {
    lines.push("| Entity | Count |", "|---|---:|");
    for (const [entity, count] of Object.entries(input.entityCounts)) {
      const label = entity.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
      lines.push(`| ${label} | ${count.toLocaleString()} |`);
    }
    lines.push("");
  } else {
    lines.push("Tenant inventory is not available.", "");
  }

  appendBestPracticeSummary(lines, input.capabilities);
  appendCurrentAssessment(lines, input.capabilities);
  appendAssessmentHistory(lines, input.snapshots);
  if (input.tenantReview) appendTenantReview(lines, input.tenantReview);
  if (input.bestPractices) appendBestPracticeRubrics(lines, input.bestPractices);

  return `${lines.join("\n")}\n`;
}

export function downloadCompleteMarkdownReport(input: CompleteMarkdownReportInput): void {
  const content = buildCompleteMarkdownReport(input);
  const tenant = input.tenant.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "tenant";
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${tenant}-complete-assessment-${date}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}