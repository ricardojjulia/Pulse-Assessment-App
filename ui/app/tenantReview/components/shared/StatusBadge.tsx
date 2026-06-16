import React from "react";
import { Chip } from "@dynatrace/strato-components/content";
import type { AreaStatus } from "../../types/review.types";

interface StatusBadgeProps {
  status: AreaStatus;
}

const STATUS_CONFIG: Record<AreaStatus, { label: string; color: "success" | "warning" | "critical" | "neutral" }> = {
  healthy: { label: "Healthy", color: "success" },
  "needs-attention": { label: "Needs Attention", color: "warning" },
  critical: { label: "Critical", color: "critical" },
  unknown: { label: "Not Analyzed", color: "neutral" },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  return <Chip color={config.color}>{config.label}</Chip>;
};
