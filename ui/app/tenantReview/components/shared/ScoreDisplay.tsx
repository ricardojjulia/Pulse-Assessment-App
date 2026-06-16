import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";

interface ScoreDisplayProps {
  /** Score value 0-100 */
  value: number;
  /** Size variant */
  size?: "small" | "large";
  /** Optional label below the score */
  label?: string;
}

function scoreColor(value: number): "success" | "warning" | "critical" | "neutral" {
  if (value >= 80) return "success";
  if (value >= 50) return "warning";
  if (value > 0) return "critical";
  return "neutral";
}

export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  value,
  size = "large",
  label,
}) => {
  return (
    <Flex flexDirection="column" alignItems="center" gap={4}>
      <ProgressCircle
        value={value}
        min={0}
        max={100}
        size={size}
        color={scoreColor(value)}
        aria-label={`Score: ${value} out of 100`}
      >
        <Text style={{ fontWeight: 600, fontSize: size === "large" ? "18px" : "12px" }}>
          {value}
        </Text>
      </ProgressCircle>
      {label && (
        <Text style={{ fontSize: "12px", textAlign: "center" }}>{label}</Text>
      )}
    </Flex>
  );
};
