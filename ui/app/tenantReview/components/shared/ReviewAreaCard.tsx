import React from "react";
import { useNavigate } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { ScoreDisplay } from "./ScoreDisplay";
import { MigrationIndicator } from "./MigrationIndicator";
import { StatusBadge } from "./StatusBadge";
import type { ReviewAreaResult, ReviewAreaDefinition } from "../../types/review.types";
import { tenantReviewPath } from "../../routes";

interface ReviewAreaCardProps {
  definition: ReviewAreaDefinition;
  result: ReviewAreaResult;
}

export const ReviewAreaCard: React.FC<ReviewAreaCardProps> = ({
  definition,
  result,
}) => {
  const navigate = useNavigate();

  return (
    <Surface
      onClick={() => navigate(tenantReviewPath(definition.route))}
      style={{
        cursor: "pointer",
        padding: "16px",
        minWidth: "240px",
        flex: "1 1 240px",
        maxWidth: "320px",
      }}
    >
      <Flex flexDirection="column" gap={12}>
        <Flex justifyContent="space-between" alignItems="center">
          <Heading level={5}>{definition.shortName}</Heading>
          <StatusBadge status={result.status} />
        </Flex>

        <Flex alignItems="center" gap={16}>
          <ScoreDisplay value={result.score.value} size="small" />
          <Flex flexDirection="column" gap={4}>
            <MigrationIndicator
              level={result.migration.level}
              percentage={result.migration.percentage}
            />
            <Text style={{ fontSize: "12px" }}>
              {result.findings.length} finding{result.findings.length !== 1 ? "s" : ""}
            </Text>
          </Flex>
        </Flex>

        <Text style={{ fontSize: "12px", opacity: 0.7 }}>
          {definition.description}
        </Text>
      </Flex>
    </Surface>
  );
};
