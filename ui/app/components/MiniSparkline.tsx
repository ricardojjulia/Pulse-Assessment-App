import React from "react";

interface MiniSparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

/**
 * 60×16 px inline SVG sparkline showing score trend.
 * Y-axis is fixed 0–100 (score scale).
 * Only renders when data.length >= 2.
 */
export const MiniSparkline: React.FC<MiniSparklineProps> = ({
  data,
  width = 60,
  height = 16,
}) => {
  if (data.length < 2) return null;

  const MIN_SCORE = 0;
  const MAX_SCORE = 100;

  const points = data
    .map((score, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke="#3b82f6"
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
