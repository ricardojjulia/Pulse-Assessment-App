import React, { useRef, useEffect, useCallback } from "react";
import type { CapabilityResult } from "../hooks/useCoverageData";
import { utilization } from "./TechRadar";

const R_RATIO = 0.34;

interface Props {
  capabilities: CapabilityResult[];
  anim: number;
  activeIdx: number | null;
  size: number;
}

export const ConnectorLines: React.FC<Props> = React.memo(({ capabilities, anim, activeIdx, size }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const N = capabilities.length;
  const SEG = (Math.PI * 2) / N;

  const draw = useCallback(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = size + "px"; c.style.height = size + "px";
    ctx.scale(dpr, dpr);
    const cx = size / 2, cy = size / 2, R = size * R_RATIO, labelR = R + size * 0.075;
    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < N; i++) {
      const cap = capabilities[i];
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      const cos = Math.cos(midA), sin = Math.sin(midA);
      const act = activeIdx === i, dim = activeIdx !== null && !act;
      const hR = Math.max(size * 0.09, 44);
      const dotSizeBase = Math.max(size * 0.016, 9);
      const hubR = hR + 6 + dotSizeBase + 4;
      const blipDotSize = act ? Math.max(size * 0.022, 12) : Math.max(size * 0.016, 9);
      const blipR = hubR + (cap.score * anim / 100) * (R - hubR);
      const startR = blipR + blipDotSize + 4;
      const alpha = dim ? 0.2 : act ? 0.95 : 0.6;
      const ml = utilization(cap.score);
      const isR = cos > 0.15, isL = cos < -0.15;

      // Label center position (matches ChartLabels labelR)
      const chartLabelR = R + size * 0.085;
      const lx = cx + cos * chartLabelR, ly = cy + sin * chartLabelR;

      // Label bounding: 2 lines of text (~16px each + 2px gap = ~34px total)
      const labelH = 34;

      const sx = cx + cos * startR, sy = cy + sin * startR;

      // Stop the dashed connector line before the label area
      const stopR = chartLabelR - labelH / 2 - 6;
      const endX = cx + cos * stopR;
      const endY = cy + sin * stopR;

      // Dashed line: segment tip → stop before label
      if (startR < stopR) {
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(endX, endY);
        ctx.strokeStyle = ml.color; ctx.globalAlpha = alpha;
        ctx.setLineDash([5, 4]); ctx.lineWidth = act ? 3 : 2; ctx.stroke(); ctx.setLineDash([]);
      }

      // Solid bar below label text
      const barY = ly + labelH / 2 + 4;
      const barW = act ? 65 : 48;
      const barStartX = isR ? lx : isL ? lx - barW : lx - barW / 2;
      const barEndX = barStartX + barW;
      ctx.beginPath(); ctx.moveTo(barStartX, barY); ctx.lineTo(barEndX, barY);
      ctx.strokeStyle = ml.color; ctx.globalAlpha = act ? 0.85 : 0.45;
      ctx.lineWidth = act ? 3.5 : 2.5; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";

      ctx.globalAlpha = 1;
    }
  }, [capabilities, anim, activeIdx, size, N, SEG]);

  useEffect(() => { draw(); }, [draw]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: size, height: size, pointerEvents: "none" }} />;
});
