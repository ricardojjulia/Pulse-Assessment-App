import React, { useRef, useState, useEffect, useCallback } from "react";

export interface ScatterPoint {
  name: string;
  x: number;   // Coverage %
  y: number;   // Utilization %
  color: string;
}

interface Props {
  data: ScatterPoint[];
  /** Radius of the markers sitting on the utilization line. */
  dotRadius?: number;
  yLabel?: string;
  activeIdx?: number | null;
  onSelect?: (idx: number | null) => void;
  /** Series key (Coverage bar / Utilization line) above the plot. */
  showLegend?: boolean;
}

// Capabilities sit on the X axis, so the plot needs room under it for the
// names (up to two word-wrapped lines) and room above it for the series key.
const PAD = { top: 30, right: 18, bottom: 50, left: 42 };
const GRID_COLOR = "rgba(140,140,140,0.18)";
const AXIS_COLOR = "rgba(160,160,160,0.5)";
const TICK_FONT = "11px -apple-system, BlinkMacSystemFont, sans-serif";
const LABEL_FONT = "bold 11px -apple-system, BlinkMacSystemFont, sans-serif";
const CAT_FONT_PX = 10;
const catFont = (px: number) => `600 ${px}px -apple-system, BlinkMacSystemFont, sans-serif`;

/** Utilization is one series across every capability, so it gets one colour
 *  — deliberately warm, since the capability palette is mostly cool. */
const LINE_DARK = "#fbbf24";
const LINE_LIGHT = "#d97706";

/** Last-resort short forms, used only when a capability name cannot be
 *  word-wrapped into the width of its column. Words are never broken
 *  mid-word: either the whole word fits, or we swap in the short form. */
const SHORT_LABEL: Record<string, string> = {
  "Infrastructure Observability": "Infra",
  "Application Observability": "Apps",
  "Digital Experience": "DEM",
  "Log Analytics": "Logs",
  "Application Security": "AppSec",
  "Threat Observability": "Threat",
  "AI Observability": "AI",
  "Business Observability": "Business",
  "Software Delivery": "Delivery",
};

/** Split a capability name into at most two lines that each fit `maxW`.
 *  Falls back to the short form rather than hyphenating a word. */
function fitCategoryLabel(ctx: CanvasRenderingContext2D, name: string, maxW: number): string[] {
  if (ctx.measureText(name).width <= maxW) return [name];
  const words = name.split(" ");
  for (let split = 1; split < words.length; split++) {
    const l1 = words.slice(0, split).join(" ");
    const l2 = words.slice(split).join(" ");
    if (ctx.measureText(l1).width <= maxW && ctx.measureText(l2).width <= maxW) return [l1, l2];
  }
  return [SHORT_LABEL[name] ?? words[0]];
}

/** True when the surrounding UI is dark, inferred from its text colour. */
function isLightText(color: string): boolean {
  const m = color.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) return true;
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function topRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export const CapabilityScatter: React.FC<Props> = ({
  data,
  dotRadius = 5,
  yLabel = "%",
  activeIdx: controlledIdx,
  onSelect,
  showLegend = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [internalIdx, setInternalIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeIdx = controlledIdx !== undefined ? controlledIdx : internalIdx;

  /** Resolve plot area dimensions */
  const getPlot = useCallback((w: number, h: number) => {
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    return { plotL: PAD.left, plotT: PAD.top, plotW, plotH };
  }, []);

  /** Centre of capability `idx`'s column, and its two plotted heights. */
  const columnGeom = useCallback((idx: number, w: number, h: number) => {
    const { plotL, plotT, plotW, plotH } = getPlot(w, h);
    const slot = plotW / Math.max(1, data.length);
    const pt = data[idx];
    return {
      slot,
      cx: plotL + slot * idx + slot / 2,
      barY: plotT + plotH - (pt.x / 100) * plotH,
      lineY: plotT + plotH - (pt.y / 100) * plotH,
      baseY: plotT + plotH,
    };
  }, [data, getPlot]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (data.length === 0) return;

    const { plotL, plotT, plotW, plotH } = getPlot(w, h);
    const hasSelection = activeIdx !== null && activeIdx !== undefined;

    const textColor = getComputedStyle(container).color || "rgba(160,160,160,0.9)";
    const lineColor = isLightText(textColor) ? LINE_DARK : LINE_LIGHT;
    const slot = plotW / data.length;
    const barW = Math.max(4, Math.min(slot * 0.46, 30));

    // Horizontal grid only — the X axis is categorical now, so vertical
    // gridlines would imply a continuous scale that isn't there.
    const ticks = [0, 20, 40, 60, 80, 100];
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const v of ticks) {
      const y = plotT + plotH - (v / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotL + plotW, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Highlight band behind the selected column
    if (hasSelection) {
      ctx.fillStyle = isLightText(textColor) ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      ctx.fillRect(plotL + slot * (activeIdx as number), plotT, slot, plotH);
    }

    // Axes
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotL, plotT);
    ctx.lineTo(plotL, plotT + plotH);
    ctx.lineTo(plotL + plotW, plotT + plotH);
    ctx.stroke();

    // Y tick labels
    ctx.font = TICK_FONT;
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of ticks) {
      const y = plotT + plotH - (v / 100) * plotH;
      ctx.fillText(`${v}`, plotL - 7, y);
    }

    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.fillStyle = textColor;
    ctx.translate(12, plotT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // ── Coverage bars ──
    for (let i = 0; i < data.length; i++) {
      const pt = data[i];
      const { cx, barY, baseY } = columnGeom(i, w, h);
      const isActive = activeIdx === i;
      const dimmed = hasSelection && !isActive;
      ctx.globalAlpha = dimmed ? 0.22 : 0.82;
      ctx.fillStyle = pt.color;
      topRoundedRect(ctx, cx - barW / 2, barY, barW, Math.max(1, baseY - barY), 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Utilization line ──
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.globalAlpha = hasSelection ? 0.55 : 1;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const { cx, lineY } = columnGeom(i, w, h);
      if (i === 0) ctx.moveTo(cx, lineY);
      else ctx.lineTo(cx, lineY);
    }
    ctx.stroke();
    ctx.restore();

    // Markers on the line, filled with the capability colour so each point
    // reads as belonging to the bar underneath it.
    for (let i = 0; i < data.length; i++) {
      const pt = data[i];
      const { cx, lineY } = columnGeom(i, w, h);
      const isActive = activeIdx === i;
      const dimmed = hasSelection && !isActive;
      const r = isActive ? dotRadius * 1.5 : dotRadius;
      ctx.globalAlpha = dimmed ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(cx, lineY, r, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
      ctx.lineWidth = isActive ? 2.5 : 1.8;
      ctx.strokeStyle = lineColor;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Category labels under the axis ──
    const maxLabelW = slot - 4;
    let fontPx = CAT_FONT_PX;
    ctx.font = catFont(fontPx);
    const labels = data.map(pt => fitCategoryLabel(ctx, pt.name, maxLabelW));
    const widest = Math.max(...labels.flat().map(l => ctx.measureText(l).width));
    if (widest > maxLabelW) {
      fontPx = Math.max(7, Math.floor(fontPx * (maxLabelW / widest)));
      ctx.font = catFont(fontPx);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < data.length; i++) {
      const { cx } = columnGeom(i, w, h);
      const isActive = activeIdx === i;
      ctx.fillStyle = isActive ? data[i].color : textColor;
      ctx.globalAlpha = hasSelection && !isActive ? 0.45 : 0.9;
      labels[i].forEach((line, li) => {
        ctx.fillText(line, cx, plotT + plotH + 8 + li * (fontPx + 2));
      });
      ctx.globalAlpha = 1;
    }

    // ── Series key ──
    if (showLegend) {
      ctx.font = TICK_FONT;
      const swW = 10;
      const label1 = "Coverage";
      const label2 = "Utilization";
      const w1 = ctx.measureText(label1).width;
      const w2 = ctx.measureText(label2).width;
      const totalW = swW + 5 + w1 + 16 + 16 + 5 + w2;
      let lx = plotL + plotW - totalW;
      const ly = PAD.top / 2;

      ctx.fillStyle = isLightText(textColor) ? "rgba(200,205,235,0.65)" : "rgba(70,75,110,0.65)";
      ctx.fillRect(lx, ly - 4, swW, 8);
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.85;
      ctx.fillText(label1, lx + swW + 5, ly);
      lx += swW + 5 + w1 + 16;

      ctx.globalAlpha = 1;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 16, ly);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx + 8, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      ctx.fillStyle = textColor;
      ctx.globalAlpha = 0.85;
      ctx.fillText(label2, lx + 16 + 5, ly);
      ctx.globalAlpha = 1;
    }
  }, [data, dotRadius, yLabel, activeIdx, getPlot, columnGeom, showLegend]);

  /** Which column the pointer is over, or null. */
  const columnAt = useCallback((mx: number, my: number, w: number, h: number): number | null => {
    const { plotL, plotT, plotW, plotH } = getPlot(w, h);
    if (my < plotT || my > plotT + plotH + PAD.bottom - 8) return null;
    if (mx < plotL || mx > plotL + plotW) return null;
    const slot = plotW / Math.max(1, data.length);
    const idx = Math.floor((mx - plotL) / slot);
    return idx >= 0 && idx < data.length ? idx : null;
  }, [data.length, getPlot]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const idx = columnAt(e.clientX - rect.left, e.clientY - rect.top, container.clientWidth, container.clientHeight);
    const next = idx === null || activeIdx === idx ? null : idx;
    if (onSelect) onSelect(next);
    else setInternalIdx(next);
  }, [activeIdx, onSelect, columnAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = columnAt(mx, my, container.clientWidth, container.clientHeight);
    setHoverIdx(idx);
    if (idx !== null) {
      const { cx, lineY, barY } = columnGeom(idx, container.clientWidth, container.clientHeight);
      setTooltipPos({ x: cx, y: Math.min(lineY, barY) });
    }
  }, [columnAt, columnGeom]);

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
  }, []);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor: "pointer" }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {hoverIdx !== null && data[hoverIdx] && (
        <div
          ref={tooltipRef}
          style={{
            position: "absolute",
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: "translate(-50%, -100%) translateY(-12px)",
            background: "rgba(20, 22, 40, 0.94)",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
            border: `2px solid ${data[hoverIdx].color}`,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: data[hoverIdx].color }}>
            {data[hoverIdx].name}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <span>C: <strong>{Math.round(data[hoverIdx].x)}%</strong></span>
            <span>U: <strong>{Math.round(data[hoverIdx].y)}%</strong></span>
          </div>
        </div>
      )}
    </div>
  );
};

/** Height / width of the chart rendered for PDF embedding. Capability names
 *  now live on the X axis instead of a legend that grew with the data, so
 *  the ratio is fixed; the parameters stay for call-site compatibility. */
const CHART_ASPECT = 0.56;
export function scatterAspectRatio(_pointCount = 0, _width = 1200): number {
  return CHART_ASPECT;
}

/**
 * Renders the capability chart to an offscreen canvas and returns a data URL.
 * Used by PDF report generators to embed the same chart the app shows.
 */
export function renderScatterToDataURL(
  data: ScatterPoint[],
  width = 1200,
  opts?: { darkBg?: boolean; format?: "png" | "jpeg" },
): string {
  const darkBg = opts?.darkBg ?? true;
  const w = width;
  const h = Math.round(width * CHART_ASPECT);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // No painted background — the chart sits directly on the report page.

  // Bottom padding carries the two-line capability names AND the series key,
  // which lives under the chart so a capability at 100% can never collide
  // with it.
  const pad = { top: 44, right: 40, bottom: 104, left: 78 };
  const plotL = pad.left;
  const plotT = pad.top;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const textColor = darkBg ? "rgba(200,200,225,0.9)" : "rgba(40,40,60,0.9)";
  const lineColor = darkBg ? LINE_DARK : LINE_LIGHT;
  const n = Math.max(1, data.length);
  const slot = plotW / n;
  const barW = Math.min(slot * 0.46, w * 0.038);
  const markerR = Math.max(w * 0.005, 5);

  // Horizontal grid
  const ticks = [0, 20, 40, 60, 80, 100];
  ctx.strokeStyle = darkBg ? "rgba(140,140,140,0.18)" : "rgba(140,140,140,0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const v of ticks) {
    const y = plotT + plotH - (v / 100) * plotH;
    ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotL + plotW, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Axes
  ctx.strokeStyle = darkBg ? "rgba(160,160,160,0.5)" : "rgba(100,100,100,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plotL, plotT); ctx.lineTo(plotL, plotT + plotH); ctx.lineTo(plotL + plotW, plotT + plotH);
  ctx.stroke();

  // Y tick labels
  const tickFont = `${Math.max(w * 0.013, 13)}px system-ui,sans-serif`;
  ctx.font = tickFont;
  ctx.fillStyle = textColor;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const v of ticks) {
    const y = plotT + plotH - (v / 100) * plotH;
    ctx.fillText(`${v}`, plotL - 14, y);
  }

  const lblFont = `bold ${Math.max(w * 0.016, 15)}px system-ui,sans-serif`;
  ctx.save();
  ctx.font = lblFont; ctx.fillStyle = textColor;
  ctx.translate(24, plotT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("%", 0, 0);
  ctx.restore();

  const geom = data.map((pt, i) => ({
    cx: plotL + slot * i + slot / 2,
    barY: plotT + plotH - (pt.x / 100) * plotH,
    lineY: plotT + plotH - (pt.y / 100) * plotH,
  }));

  // ── Value label placement ──────────────────────────────────────────
  // When coverage and utilization are close, the bar's value, the line
  // marker and the line's value all land within a few pixels of each other.
  // Placement is resolved up front so the three can never sit on top of one
  // another: the coverage label is pushed clear of the marker, and the
  // utilization label goes on whichever side of the marker is still free.
  const valPx = Math.max(w * 0.0115, 12);
  const valFont = `bold ${valPx}px system-ui,sans-serif`;
  const valH = valPx * 1.2;
  const GAP = 5;
  const axisY = plotT + plotH;
  const place = data.map((pt, i) => {
    const { barY, lineY } = geom[i];
    const barH = axisY - barY;
    const mTop = lineY - markerR;
    const mBot = lineY + markerR;
    let inside = barH > valH + 26;

    // Coverage: inside the bar when it is tall enough, otherwise just above
    // it — either way clear of the marker.
    let covTop = inside ? barY + 7 : barY - GAP - valH;
    if (inside && covTop < mBot + GAP && covTop + valH > mTop - GAP) {
      covTop = mBot + GAP;
      if (covTop + valH > axisY - 4) covTop = barY + 7;
    }
    let covBot = covTop + valH;

    // Utilization: above its marker by preference, below it if that clashes
    // and there is room before the axis, otherwise the two stack vertically
    // with the higher-anchored series keeping its slot. Nothing is ever
    // drawn below the axis, where the capability names live.
    const clash = (top: number) => top < covBot && top + valH > covTop;
    let utilTop = mTop - GAP - valH;
    if (clash(utilTop)) {
      const belowTop = mBot + GAP;
      if (belowTop + valH <= axisY - 4 && !clash(belowTop)) {
        utilTop = belowTop;
      } else if (mTop <= barY) {
        covTop = utilTop - 3 - valH;
        covBot = covTop + valH;
        inside = false;
      } else {
        utilTop = covTop - 3 - valH;
      }
    }
    return { inside, covTop, utilTop };
  });

  // ── Coverage bars, with the value read straight off the bar ──
  data.forEach((pt, i) => {
    const { cx, barY } = geom[i];
    const barH = Math.max(1, plotT + plotH - barY);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pt.color;
    topRoundedRect(ctx, cx - barW / 2, barY, barW, barH, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.font = valFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = place[i].inside ? "rgba(255,255,255,0.95)" : pt.color;
    ctx.fillText(`${Math.round(pt.x)}%`, cx, place[i].covTop);
  });

  // ── Utilization line ──
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(w * 0.0022, 2.5);
  ctx.lineJoin = "round";
  ctx.beginPath();
  geom.forEach((g, i) => { if (i === 0) ctx.moveTo(g.cx, g.lineY); else ctx.lineTo(g.cx, g.lineY); });
  ctx.stroke();

  data.forEach((pt, i) => {
    const { cx, lineY } = geom[i];
    ctx.beginPath();
    ctx.arc(cx, lineY, markerR, 0, Math.PI * 2);
    ctx.fillStyle = pt.color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = lineColor; ctx.stroke();

    // Utilization value in the line colour so it is never confused with the
    // coverage value on the bar; side resolved in the placement pass above.
    ctx.font = valFont;
    ctx.fillStyle = lineColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`${Math.round(pt.y)}%`, cx, place[i].utilTop);
  });

  // ── Capability names on the X axis (word-wrapped, never hyphenated) ──
  const catPx = Math.max(w * 0.0105, 11);
  ctx.font = `600 ${catPx}px system-ui,sans-serif`;
  const maxLabelW = slot - 8;
  const labels = data.map(pt => fitCategoryLabel(ctx, pt.name, maxLabelW));
  const widest = Math.max(1, ...labels.flat().map(l => ctx.measureText(l).width));
  const shrunk = widest > maxLabelW ? Math.max(8, catPx * (maxLabelW / widest)) : catPx;
  ctx.font = `600 ${shrunk}px system-ui,sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  labels.forEach((lines, i) => {
    lines.forEach((line, li) => {
      ctx.fillText(line, geom[i].cx, plotT + plotH + 14 + li * (shrunk + 4));
    });
  });

  // ── Series key ──
  ctx.font = `${Math.max(w * 0.012, 12)}px system-ui,sans-serif`;
  const swW = w * 0.014;
  const gapT = w * 0.005;
  const l1 = "Coverage %", l2 = "Utilization %";
  const w1 = ctx.measureText(l1).width, w2 = ctx.measureText(l2).width;
  const lineW = w * 0.024;
  const totalW = swW + gapT + w1 + w * 0.025 + lineW + gapT + w2;
  let lx = plotL + (plotW - totalW) / 2;
  const ly = h - 18;

  ctx.fillStyle = darkBg ? "rgba(190,195,230,0.6)" : "rgba(70,75,110,0.6)";
  ctx.fillRect(lx, ly - swW / 2.4, swW, swW / 1.2);
  ctx.fillStyle = textColor;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(l1, lx + swW + gapT, ly);
  lx += swW + gapT + w1 + w * 0.025;

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(w * 0.0022, 2.5);
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + lineW, ly); ctx.stroke();
  ctx.beginPath(); ctx.arc(lx + lineW / 2, ly, markerR * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = lineColor; ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(l2, lx + lineW + gapT, ly);

  // JPEG (no alpha) shrinks gradient-heavy charts ~20x for PDF embedding;
  // composite onto the report's page color first.
  if (opts?.format === "jpeg") {
    const c2 = document.createElement("canvas");
    c2.width = canvas.width; c2.height = canvas.height;
    const x2 = c2.getContext("2d")!;
    x2.fillStyle = "#0b0b1a";
    x2.fillRect(0, 0, c2.width, c2.height);
    x2.drawImage(canvas, 0, 0);
    return c2.toDataURL("image/jpeg", 0.82);
  }
  return canvas.toDataURL("image/png");
}
