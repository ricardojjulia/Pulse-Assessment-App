import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tooltip } from "./Tooltip";
import { useA11yMode } from "../hooks/useA11yMode";

/**
 * Small toggle button that enables / disables color-blind accessible mode.
 * Persisted to localStorage under "cca.a11yMode".
 * When active the button is rendered as "emphasized"; when inactive as "default".
 * Must be rendered inside <A11yProvider>.
 */
export const A11yToggle: React.FC = () => {
  const { a11yMode, toggleA11yMode } = useA11yMode();
  return (
    <Tooltip text="Toggle color-blind mode">
      <Button
        variant={a11yMode ? "emphasized" : "default"}
        onClick={toggleA11yMode}
        size="condensed"
      >
        A11y
      </Button>
    </Tooltip>
  );
};
