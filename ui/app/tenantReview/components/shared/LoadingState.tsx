import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";

interface LoadingStateProps {
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Analyzing tenant configuration...",
}) => {
  return (
    <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={16} style={{ padding: "48px" }}>
      <ProgressCircle value="indeterminate" aria-label="Loading" />
      <Text>{message}</Text>
    </Flex>
  );
};
