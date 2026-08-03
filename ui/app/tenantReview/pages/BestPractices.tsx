import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ExternalLink, Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useBestPracticesReview } from "../areas/bestPractices.data";
import type { BestPracticeCategory } from "../areas/bestPractices.data";
import { APP_ICON } from "../../data/appIcon";
import { APP_VERSION } from "../constants/app";
import { BEST_PRACTICE_NOTEBOOK_GUIDANCE } from "../constants/bestPracticeNotebookGuidance";
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

const APP_SUMMARY_CARDS = [
  {
    label: "Rubrics",
    value: "Defined",
    detail: "Each rubric below groups related checks and notebook guidance.",
  },
  {
    label: "App Version",
    value: APP_VERSION,
    detail: "Matches the current app build.",
  },
  {
    label: "Mode",
    value: "Dedicated View",
    detail: "App summary first, rubrics underneath.",
  },
];

const CategoryCard: React.FC<{ category: BestPracticeCategory }> = ({ category }) => {
  const [expanded, setExpanded] = useState(false);
  const notebookGuidance = BEST_PRACTICE_NOTEBOOK_GUIDANCE[category.id];

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
        <Flex flexDirection="column" gap={12} style={{ padding: "0 16px 16px" }}>
          <FindingsTable findings={category.findings} />
          {notebookGuidance && (
            <Flex
              flexDirection="column"
              gap={8}
              style={{
                padding: "12px 14px",
                borderRadius: "6px",
                border: `1px solid ${Colors.Border.Neutral.Default}`,
                backgroundColor: Colors.Background.Field.Neutral.Default,
              }}
            >
              <Flex flexDirection="column" gap={4}>
                <Text style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", color: Colors.Text.Primary.Default }}>
                  Recommended notebooks
                </Text>
                <Text style={{ fontSize: "12px", opacity: 0.72 }}>
                  {notebookGuidance.summary}
                </Text>
              </Flex>
              <Flex flexDirection="column" gap={8}>
                {notebookGuidance.references.map((ref) => (
                  <Flex
                    key={`${ref.series}-${ref.title}`}
                    flexDirection="column"
                    gap={2}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "6px",
                      backgroundColor: Colors.Background.Surface.Default,
                    }}
                  >
                    <ExternalLink href={ref.url} style={{ fontSize: "13px", fontWeight: 700 }}>
                      {ref.series} - {ref.title}
                    </ExternalLink>
                    <Text style={{ fontSize: "12px", opacity: 0.68 }}>
                      {ref.focus}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
};

export const BestPractices: React.FC = () => {
  const result = useBestPracticesReview();
  const navigate = useNavigate();

  if (result.isLoading) {
    return <LoadingState message="Evaluating best practices compliance..." />;
  }

  if (result.error) {
    return <ErrorState message={result.error} />;
  }

  return (
    <Flex flexDirection="column" gap={20}>
      <Flex
        flexDirection="column"
        gap={16}
        style={{
          padding: "20px 22px",
          borderRadius: 14,
          border: `1px solid ${Colors.Border.Neutral.Default}`,
          background: `linear-gradient(135deg, ${Colors.Background.Surface.Default} 0%, ${Colors.Background.Field.Neutral.Default} 100%)`,
        }}
      >
        <Flex justifyContent="space-between" alignItems="flex-start" gap={16} flexWrap="wrap">
          <Flex alignItems="center" gap={12}>
            <Flex
              alignItems="center"
              justifyContent="center"
              style={{
                width: 58,
                height: 58,
                borderRadius: 14,
                background: Colors.Background.Container.Primary.Default,
                border: `1px solid ${Colors.Border.Primary.Default}`,
                flexShrink: 0,
              }}
            >
              <img src={APP_ICON} alt="" width={34} height={34} style={{ borderRadius: 8 }} />
            </Flex>
            <Flex flexDirection="column" gap={4}>
              <Text style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.6, color: Colors.Text.Primary.Default }}>
                App
              </Text>
              <Heading level={1}>ESA Tenant Evaluator</Heading>
              <Text style={{ maxWidth: 760 }}>
                Dedicated view for the app and the rubrics used to evaluate it. The app summary appears first, then the defined rubrics with notebook guidance below.
              </Text>
            </Flex>
          </Flex>

          <Flex gap={8} flexWrap="wrap" alignItems="center">
            <Button onClick={() => { void navigate("/"); }} size="condensed">
              Back to Assessment
            </Button>
            <ExportButtons
              title="App & Rubrics"
              sections={result.categories.map((cat) => ({
                title: cat.name,
                rows: [
                  ...cat.findings.map((f) => ({ item: f.title, value: f.severity, detail: f.recommendation })),
                  ...((BEST_PRACTICE_NOTEBOOK_GUIDANCE[cat.id]?.references ?? []).map((ref) => ({
                    item: `Notebook: ${ref.series} - ${ref.title}`,
                    value: "guidance",
                    detail: `${ref.focus} (${ref.url})`,
                  }))),
                ],
              }))}
              summary={[`Score: ${result.overallScore}/100`, `${result.totalPassed}/${result.totalChecks} checks passed`, `${result.categories.length} rubrics evaluated`]}
            />
          </Flex>
        </Flex>

        <Flex gap={12} flexWrap="wrap">
          {APP_SUMMARY_CARDS.map((card) => (
            <Flex
              key={card.label}
              flexDirection="column"
              gap={4}
              style={{
                minWidth: 190,
                padding: "12px 14px",
                borderRadius: 10,
                border: `1px solid ${Colors.Border.Neutral.Default}`,
                background: Colors.Background.Surface.Default,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8, color: Colors.Text.Neutral.Subdued }}>
                {card.label}
              </Text>
              <Text style={{ fontSize: 18, fontWeight: 800, color: Colors.Text.Primary.Default }}>
                {card.value}
              </Text>
              <Text style={{ fontSize: 12, opacity: 0.72 }}>
                {card.detail}
              </Text>
            </Flex>
          ))}
        </Flex>
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

      <Heading level={3}>Defined Rubrics</Heading>
      <Flex flexDirection="column" gap={8}>
        {result.categories.map((cat) => (
          <CategoryCard key={cat.id} category={cat} />
        ))}
      </Flex>
    </Flex>
  );
};
