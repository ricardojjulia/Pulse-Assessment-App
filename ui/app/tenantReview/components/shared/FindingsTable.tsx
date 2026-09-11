import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Finding, FindingSeverity } from "../../types/review.types";

interface FindingsTableProps {
  findings: Finding[];
}

const SEVERITY_CONFIG: Record<FindingSeverity, { label: string; color: string; bgColor: string }> = {
  critical: {
    label: "Critical",
    color: Colors.Text.Critical.Default,
    bgColor: "rgba(220, 53, 69, 0.08)",
  },
  warning: {
    label: "Warning",
    color: Colors.Text.Warning.Default,
    bgColor: "rgba(255, 193, 7, 0.08)",
  },
  info: {
    label: "Info",
    color: Colors.Text.Primary.Default,
    bgColor: "rgba(128, 128, 128, 0.06)",
  },
  success: {
    label: "Excellent",
    color: Colors.Text.Success.Default,
    bgColor: "rgba(20, 184, 80, 0.08)",
  },
};

const FindingCard: React.FC<{ finding: Finding }> = ({ finding }) => {
  const config = SEVERITY_CONFIG[finding.severity];

  return (
    <Flex
      flexDirection="row"
      gap={12}
      alignItems="flex-start"
      style={{
        padding: "12px 16px",
        borderRadius: "8px",
        backgroundColor: config.bgColor,
        borderLeft: `4px solid ${config.color}`,
      }}
    >
      {/* Severity indicator dot */}
      <Flex
        alignItems="center"
        justifyContent="center"
        style={{
          minWidth: "68px",
          paddingTop: "2px",
        }}
      >
        <Text
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: config.color,
          }}
        >
          {config.label}
        </Text>
      </Flex>

      {/* Content */}
      <Flex flexDirection="column" gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: 600, fontSize: "14px" }}>
          {finding.title}
        </Text>
        <Text style={{ fontSize: "13px", opacity: 0.8 }}>
          {finding.description}
        </Text>
        {finding.detail && (
          <Text style={{ fontSize: "12px", opacity: 0.55, fontFamily: "monospace" }}>
            {finding.detail}
          </Text>
        )}
        {finding.recommendation && (
          <Text style={{ fontSize: "12px", opacity: 0.65, fontStyle: "italic" }}>
            {finding.recommendation}
          </Text>
        )}
        {finding.actionUrl && (
          <a
            href={finding.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "12px", color: config.color, marginTop: 2 }}
          >
            Open in Dynatrace →
          </a>
        )}
      </Flex>
    </Flex>
  );
};

export const FindingsTable: React.FC<FindingsTableProps> = ({ findings }) => {
  if (findings.length === 0) {
    return (
      <Flex
        justifyContent="center"
        alignItems="center"
        style={{ padding: "32px", opacity: 0.6 }}
      >
        <Heading level={4}>No findings — looking good!</Heading>
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" gap={8}>
      {findings.map((finding) => (
        <FindingCard key={finding.id} finding={finding} />
      ))}
    </Flex>
  );
};
