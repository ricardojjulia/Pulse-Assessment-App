import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Heading } from "@dynatrace/strato-components/typography";

interface EmptyStateProps {
  title?: string;
  message?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = "No Data Available",
  message = "No configuration data was found for this review area.",
}) => {
  return (
    <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={8} style={{ padding: "48px" }}>
      <Heading level={4}>{title}</Heading>
      <Text>{message}</Text>
    </Flex>
  );
};
