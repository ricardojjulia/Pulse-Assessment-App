import React, { useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useBestPracticesReview } from "../areas/bestPractices.data";
import type { BestPracticeCategory } from "../areas/bestPractices.data";
import { FindingsTable } from "../components/shared/FindingsTable";
import { ScoreDisplay } from "../components/shared/ScoreDisplay";
import { ExportButtons } from "../components/shared/ExportButtons";
import { LoadingState } from "../components/shared/LoadingState";
import { ErrorState } from "../components/shared/ErrorState";

const SEVERITY_COLORS: Record<string, string> = {
  success: Colors.Text.Success.Default,
  info: Colors.Text.Neutral.Default,
  warning: Colors.Text.Warning.Default,
  critical: Colors.Text.Critical.Default,
};

const CategoryCard: React.FC<{ category: BestPracticeCategory }> = ({ category }) => {
  const [expanded, setExpanded] = useState(false);

  const worstSeverity = category.findings.reduce<string>((worst, f) => {
    const order = ["success", "info", "warning", "critical"];
    return order.indexOf(f.severity) > order.indexOf(worst) ? f.severity : worst;
  }, "success");

  const statusColor = SEVERITY_COLORS[worstSeverity] ?? Colors.Text.Neutral.Default;
  const ratio = category.totalChecks > 0
    ? `${category.passedChecks}/${category.totalChecks}`
    : "N/A";

  return (
    <Flex
      flexDirection="column"
      style={{
        borderRadius: "8px",
        border: `1px solid ${Colors.Border.Neutral.Default}`,
        overflow: "hidden",
      }}
    >
      <Flex
        justifyContent="space-between"
        alignItems="center"
        onClick={() => { setExpanded(!expanded); }}
        style={{
          padding: "12px 16px",
          cursor: "pointer",
          backgroundColor: expanded
            ? Colors.Background.Field.Neutral.Emphasized
            : "transparent",
          transition: "background-color 0.15s",
          userSelect: "none",
        }}
      >
        <Flex flexDirection="column" gap={2} style={{ flex: 1 }}>
          <Flex alignItems="center" gap={8}>
            <Text style={{ fontWeight: 700, fontSize: "14px" }}>
              {category.name}
            </Text>
            <Text style={{
              fontSize: "11px",
              fontWeight: 600,
              color: statusColor,
              backgroundColor: `${statusColor}18`,
              padding: "2px 8px",
              borderRadius: "4px",
            }}>
              {ratio} passed
            </Text>
          </Flex>
          <Text style={{ fontSize: "12px", opacity: 0.6 }}>
            {category.description}
          </Text>
        </Flex>
        <Text style={{ fontSize: "16px", opacity: 0.5, flexShrink: 0, marginLeft: "12px" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </Text>
      </Flex>

      {expanded && (
        <Flex flexDirection="column" style={{ padding: "0 16px 16px" }}>
          <FindingsTable findings={category.findings} />
        </Flex>
      )}
    </Flex>
  );
};

export const BestPractices: React.FC = () => {
  const result = useBestPracticesReview();

  if (result.isLoading) {
    return <LoadingState message="Evaluating best practices compliance..." />;
  }

  if (result.error) {
    return <ErrorState message={result.error} />;
  }

  return (
    <Flex flexDirection="column" gap={20}>
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex flexDirection="column" gap={8}>
          <Heading level={1}>Best Practices</Heading>
          <Text>
            Evaluates tenant configuration against platform governance and infrastructure best practices.
            Based on the USFOODS Module A workshop series (A.00–A.06).
          </Text>
        </Flex>
        <ExportButtons
          title="Best Practices"
          sections={result.categories.map((cat) => ({
            title: cat.name,
            rows: cat.findings.map((f) => ({ item: f.title, value: f.severity, detail: f.recommendation })),
          }))}
          summary={[`Score: ${result.overallScore}/100`, `${result.totalPassed}/${result.totalChecks} checks passed`, `${result.categories.length} categories evaluated`]}
        />
      </Flex>

      <Flex gap={24} alignItems="flex-start">
        <ScoreDisplay value={result.overallScore} label="Best Practices" />
        <Flex flexDirection="column" gap={8}>
          <Text style={{ fontSize: "24px", fontWeight: 700 }}>
            {result.totalPassed}/{result.totalChecks} checks passed
          </Text>
          <Text style={{ fontSize: "13px", opacity: 0.7 }}>
            Across {result.categories.length} categories covering platform architecture,
            data management, security, and operational governance.
          </Text>
          <Flex gap={12} style={{ marginTop: "4px" }}>
            {(() => {
              let successCount = 0;
              let warningCount = 0;
              let criticalCount = 0;
              let infoCount = 0;
              for (const cat of result.categories) {
                for (const f of cat.findings) {
                  if (f.severity === "success") successCount++;
                  else if (f.severity === "warning") warningCount++;
                  else if (f.severity === "critical") criticalCount++;
                  else infoCount++;
                }
              }
              return (
                <>
                  {criticalCount > 0 && (
                    <Text style={{ fontSize: "12px", fontWeight: 600, color: Colors.Text.Critical.Default }}>
                      {criticalCount} critical
                    </Text>
                  )}
                  {warningCount > 0 && (
                    <Text style={{ fontSize: "12px", fontWeight: 600, color: Colors.Text.Warning.Default }}>
                      {warningCount} warning
                    </Text>
                  )}
                  <Text style={{ fontSize: "12px", fontWeight: 600, color: Colors.Text.Success.Default }}>
                    {successCount} passed
                  </Text>
                  <Text style={{ fontSize: "12px", opacity: 0.5 }}>
                    {infoCount} informational
                  </Text>
                </>
              );
            })()}
          </Flex>
        </Flex>
      </Flex>

      <Heading level={3}>Categories</Heading>
      <Flex flexDirection="column" gap={8}>
        {result.categories.map((cat) => (
          <CategoryCard key={cat.id} category={cat} />
        ))}
      </Flex>
    </Flex>
  );
};
