import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { useTenantOverview } from "../hooks/useTenantOverview";
import { REVIEW_AREAS } from "../constants/reviewAreas";
import { ScoreDisplay } from "../components/shared/ScoreDisplay";
import { MigrationIndicator } from "../components/shared/MigrationIndicator";
import { ReviewAreaCard } from "../components/shared/ReviewAreaCard";
import { FindingsTable } from "../components/shared/FindingsTable";
import { ExportButtons } from "../components/shared/ExportButtons";
import type { ExportSection } from "../components/shared/ExportButtons";
import { classifyMigration } from "../constants/thresholds";
import type { AssessmentSnapshot } from "../../hooks/useAssessmentHistory";
import type { CoverageData } from "../../hooks/useCoverageData";
import { downloadCompleteMarkdownReport } from "../../reports/generateCompleteMarkdownReport";
import { useBestPracticesReview } from "../areas/bestPractices.data";

interface OverviewProps {
  coverageData: CoverageData;
  snapshots: AssessmentSnapshot[];
}

export const Overview: React.FC<OverviewProps> = ({ coverageData, snapshots }) => {
  const overview = useTenantOverview();
  const bestPractices = useBestPracticesReview();

  const isAnyLoading = overview.areaResults.some((r) => r.isLoading);
  const isCompleteExportLoading = isAnyLoading || bestPractices.isLoading;

  const exportSections: ExportSection[] = overview.areaResults
    .filter((r) => r.status !== "unknown")
    .map((r) => {
      const area = REVIEW_AREAS.find((a) => a.id === r.areaId);
      return {
        title: area?.name ?? r.areaId,
        rows: r.findings.map((f) => ({ item: f.title, value: f.severity, detail: f.recommendation })),
      };
    });

  return (
    <Flex flexDirection="column" gap={24}>
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex flexDirection="column" gap={4}>
          <Heading level={1}>Tenant Review Overview</Heading>
          <Text>
            Comprehensive review of tenant configuration, best practices compliance,
            and Gen3 migration status.
          </Text>
        </Flex>
        <ExportButtons
          title="Tenant Review Overview"
          sections={exportSections}
          summary={[`Overall Score: ${overview.overallScore}/100`, `Gen3 Migration: ${overview.overallMigrationPercentage}%`, `Total Findings: ${overview.totalFindings} (${overview.criticalFindings.length} critical)`, `Areas Needing Attention: ${overview.areasNeedingAttention.join(", ") || "None"}`]}
          completeMarkdown={{
            disabled: isCompleteExportLoading,
            onExport: () => {
              if (coverageData.capabilities.length === 0) {
                alert("No assessment has been run yet. Go to the Coverage Assessment page and run an assessment before exporting.");
                return;
              }
              try {
                downloadCompleteMarkdownReport({
                  capabilities: coverageData.capabilities,
                  totalScore: coverageData.totalScore,
                  overallMaturityLevel: coverageData.overallMaturityLevel,
                  tenant: coverageData.tenant,
                  date: coverageData.date,
                  stats: coverageData.stats,
                  entityCounts: coverageData.entityCounts,
                  snapshots,
                  tenantReview: overview,
                  bestPractices,
                });
              } catch (e) {
                alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            },
          }}
        />
      </Flex>

      {/* Summary metrics */}
      <Flex gap={32} alignItems="flex-start" style={{ flexWrap: "wrap" }}>
        <Surface style={{ padding: "20px", minWidth: "200px" }}>
          <Flex flexDirection="column" alignItems="center" gap={8}>
            <Text style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Overall Score
            </Text>
            <ScoreDisplay value={overview.overallScore} size="large" />
            {isAnyLoading && (
              <Text style={{ fontSize: "11px", fontStyle: "italic" }}>
                Still analyzing...
              </Text>
            )}
          </Flex>
        </Surface>

        <Surface style={{ padding: "20px", minWidth: "200px" }}>
          <Flex flexDirection="column" alignItems="center" gap={8}>
            <Text style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Gen3 Migration
            </Text>
            <MigrationIndicator
              level={classifyMigration(overview.overallMigrationPercentage)}
              percentage={overview.overallMigrationPercentage}
            />
          </Flex>
        </Surface>

        <Surface style={{ padding: "20px", minWidth: "200px" }}>
          <Flex flexDirection="column" alignItems="center" gap={8}>
            <Text style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Findings
            </Text>
            <Text style={{ fontSize: "28px", fontWeight: 600 }}>
              {overview.totalFindings}
            </Text>
            <Text style={{ fontSize: "12px" }}>
              {overview.criticalFindings.length} critical
            </Text>
          </Flex>
        </Surface>

        <Surface style={{ padding: "20px", minWidth: "200px" }}>
          <Flex flexDirection="column" alignItems="center" gap={8}>
            <Text style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Areas Reviewed
            </Text>
            <Text style={{ fontSize: "28px", fontWeight: 600 }}>
              {overview.areaResults.filter((r) => r.status !== "unknown").length}
              <Text style={{ fontSize: "16px", fontWeight: 400 }}>
                {" "}/ {REVIEW_AREAS.length}
              </Text>
            </Text>
          </Flex>
        </Surface>
      </Flex>

      {/* Area cards grid */}
      <Heading level={3}>Review Areas</Heading>
      <Flex gap={16} style={{ flexWrap: "wrap" }}>
        {REVIEW_AREAS.map((area) => {
          const areaResult = overview.areaResults.find((r) => r.areaId === area.id);
          if (!areaResult) return null;
          return (
            <ReviewAreaCard
              key={area.id}
              definition={area}
              result={areaResult}
            />
          );
        })}
      </Flex>

      {/* Critical findings */}
      {overview.criticalFindings.length > 0 && (
        <>
          <Heading level={3}>Critical Findings</Heading>
          <FindingsTable findings={overview.criticalFindings} />
        </>
      )}
    </Flex>
  );
};
