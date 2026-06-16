import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { useTaggingReview } from "../areas/tagging.data";
import { ScoreDisplay } from "../components/shared/ScoreDisplay";
import { MigrationIndicator } from "../components/shared/MigrationIndicator";
import { StatusBadge } from "../components/shared/StatusBadge";
import { ExportButtons } from "../components/shared/ExportButtons";
import { FindingsTable } from "../components/shared/FindingsTable";
import { LoadingState } from "../components/shared/LoadingState";
import { ErrorState } from "../components/shared/ErrorState";

export const TaggingOrg: React.FC = () => {
  const result = useTaggingReview();

  if (result.isLoading) return <LoadingState message="Analyzing tagging and organization..." />;
  if (result.error) return <ErrorState message={result.error} />;

  return (
    <Flex flexDirection="column" gap={20}>
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex flexDirection="column" gap={8}>
          <Heading level={1}>Tagging & Organization</Heading>
          <Text>Auto-tagging rules, management zones, ownership teams, and entity organization.</Text>
        </Flex>
        <Flex gap={12} alignItems="center">
          <ExportButtons title="Tagging & Organization" findings={result.findings} summary={[`Score: ${result.score.value}/100`, `Migration: ${result.migration.percentage}% Gen3`, `${result.score.passedChecks}/${result.score.totalChecks} checks passed`]} />
          <StatusBadge status={result.status} />
        </Flex>
      </Flex>
      <Flex gap={24} alignItems="flex-start">
        <ScoreDisplay value={result.score.value} label="Best Practices" />
        <Flex flexDirection="column" gap={8}>
          <MigrationIndicator level={result.migration.level} percentage={result.migration.percentage} />
          <Text style={{ fontSize: "13px" }}>{result.migration.summary}</Text>
          <Text style={{ fontSize: "12px", opacity: 0.6 }}>{result.score.passedChecks}/{result.score.totalChecks} checks passed</Text>
        </Flex>
      </Flex>
      <Heading level={3}>Findings</Heading>
      <FindingsTable findings={result.findings} />
    </Flex>
  );
};
