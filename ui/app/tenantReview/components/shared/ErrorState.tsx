import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { SecurityCriticalIcon } from "@dynatrace/strato-icons";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => {
  return (
    <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={12} style={{ padding: "48px" }}>
      <SecurityCriticalIcon />
      <Heading level={4}>Analysis Error</Heading>
      <Text>{message}</Text>
      {onRetry && (
        <Button onClick={onRetry} variant="emphasized">
          Retry
        </Button>
      )}
    </Flex>
  );
};
