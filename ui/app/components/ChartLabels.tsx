import React from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import type { CapabilityResult } from "../hooks/useCoverageData";
import { utilization } from "./TechRadar";

const R_RATIO = 0.34;

interface Props {
  capabilities: CapabilityResult[];
  anim: number;
  activeIdx: number | null;
  size: number;
  onSelect?: (idx: number | null) => void;
}

export const ChartLabels: React.FC<Props> = React.memo(({ capabilities, anim, activeIdx, size, onSelect }) => {
  const N = capabilities.length;
  const SEG = (Math.PI * 2) / N;
  const R = size * R_RATIO, labelR = R + size * 0.085;
  const dk = useCurrentTheme() === "dark";
  const fs1 = Math.max(size * 0.023, 12.5);
  const fs2 = Math.max(size * 0.019, 11);

  return (
    <>
      {capabilities.map((cap, i) => {
        const midA = i * SEG + SEG / 2 - Math.PI / 2;
        const cos = Math.cos(midA), sin = Math.sin(midA);
        const x = size / 2 + cos * labelR, y = size / 2 + sin * labelR;
        const isR = cos > 0.15, isL = cos < -0.15;
        const act = activeIdx === i, dim = activeIdx !== null && !act;
        const sv = Math.round(cap.score * anim);
        const ml = utilization(cap.score);

        return (
          <Flex key={i} flexDirection="column" style={{
            position: "absolute",
            left: isR ? x : isL ? "auto" : x,
            right: isL ? size - x : "auto",
            top: y,
            transform: `translateY(-50%)${!isR && !isL ? " translateX(-50%)" : ""}`,
            textAlign: isR ? "left" : isL ? "right" : "center",
            pointerEvents: "auto", whiteSpace: "nowrap",
            transition: "opacity 0.3s", opacity: dim ? 0.4 : 1,
          }}>
            <Text
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onSelect?.(act ? null : i); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect?.(act ? null : i); } }}
              aria-label={`${cap.name}: ${sv}% coverage, ${ml.label}`}
              style={{
              fontSize: fs1, fontWeight: 800, lineHeight: 1.2, marginBottom: 2,
              color: act ? cap.color : Colors.Text.Neutral.Default,
              cursor: "pointer", transition: "color 0.2s",
              textShadow: dk ? "0 1px 4px rgba(0,0,0,0.7)" : "0 1px 3px rgba(255,255,255,0.8)",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
            >{cap.name}</Text>
            <Text style={{ fontSize: fs2, fontWeight: 700, color: ml.color, lineHeight: 1.2,
              textShadow: dk ? "0 1px 3px rgba(0,0,0,0.6)" : "0 1px 2px rgba(255,255,255,0.7)",
            }}>
              {sv}% · {ml.label}
            </Text>
          </Flex>
        );
      })}
    </>
  );
});
