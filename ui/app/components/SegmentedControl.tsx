import React from "react";
import Colors from "@dynatrace/strato-design-tokens/colors";

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedControlOption<T>[];
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: 6,
        background: Colors.Background.Field.Neutral.Default,
        border: `1px solid ${Colors.Border.Neutral.Default}`,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            style={{
              minHeight: 28,
              padding: "4px 10px",
              border: 0,
              borderRadius: 4,
              cursor: "pointer",
              background: selected ? Colors.Background.Container.Primary.Default : "transparent",
              color: selected ? Colors.Text.Primary.Default : Colors.Text.Neutral.Default,
              font: "inherit",
              fontSize: 12,
              fontWeight: selected ? 700 : 500,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
