import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import type { MigrationLevel } from "../../types/review.types";
import { MIGRATION_LABELS } from "../../constants/thresholds";

interface MigrationIndicatorProps {
  level: MigrationLevel;
  percentage: number;
}

function migrationColor(level: MigrationLevel): "success" | "warning" | "critical" | "neutral" | "primary" {
  switch (level) {
    case "complete":
      return "success";
    case "mostly":
      return "primary";
    case "partial":
      return "warning";
    case "not-started":
      return "neutral";
  }
}

export const MigrationIndicator: React.FC<MigrationIndicatorProps> = ({
  level,
  percentage,
}) => {
  return (
    <Chip color={migrationColor(level)}>
      {MIGRATION_LABELS[level]} ({percentage}%)
    </Chip>
  );
};
