import React, { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import { scoreBand, SCORE_BANDS } from "../utils/colors";

function hexToRgb(h: string) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
function rgba(c: { r: number; g: number; b: number }, a: number) { return `rgba(${c.r},${c.g},${c.b},${a})`; }
function lighten(c: { r: number; g: number; b: number }, v: number) { return { r: Math.min(255, c.r + v), g: Math.min(255, c.g + v), b: Math.min(255, c.b + v) }; }

const bandForScore = scoreBand;

/** Plain-word reading of the two axes, so a chart label never needs a
 *  percentage to be understood. Coverage answers "how much of this
 *  capability is switched on"; Utilization answers "how deeply it is
 *  actually used". */
export function adoptionWord(coverage: number): string {
  if (coverage >= 80) return "Broad";
  if (coverage >= 60) return "Wide";
  if (coverage >= 40) return "Partial";
  if (coverage >= 20) return "Narrow";
  return "Minimal";
}
export function depthWord(utilization: number): string {
  if (utilization >= 80) return "advanced";
  if (utilization >= 60) return "solid";
  if (utilization >= 40) return "basic";
  if (utilization >= 20) return "shallow";
  return "starter";
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = cur + " " + words[i];
    if (ctx.measureText(test).width <= maxWidth) { cur = test; }
    else { lines.push(cur); cur = words[i]; }
  }
  lines.push(cur);
  return lines;
}

const BANDS = SCORE_BANDS;

interface DataPoint {
  name: string;
  coverage: number;
  utilization: number;
  color: string;
  /** Raw coverage before consolidation (shown as ghost polygon when present and differs from coverage). */
  rawCoverage?: number;
  /** Raw utilization before consolidation. */
  rawUtilization?: number;
}

interface Props {
  data: DataPoint[];
  coverageColor?: string;
  utilizationColor?: string;
  legendLabels?: [string, string];
  activeIdx?: number | null;
  onSelect?: (idx: number | null) => void;
  /** Drop the second series entirely — one polygon, one hub number, one
   *  legend entry. Used where the chart is meant to answer a single
   *  question and the comparison would only add noise. */
  coverageOnly?: boolean;
}

export interface CovUtilRadarHandle {
  toDataURL: () => string | null;
}

export const CovUtilRadar = React.memo(forwardRef<CovUtilRadarHandle, Props>(function CovUtilRadar({ data, coverageColor, utilizationColor, legendLabels, activeIdx: controlledIdx, onSelect, coverageOnly = false }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dk = useCurrentTheme() === "dark";
  const COV_C = coverageColor ?? (dk ? "#00E5FF" : "#0097A7");
  const UTIL_C = utilizationColor ?? (dk ? "#D500F9" : "#9C27B0");
  const [internalIdx, setInternalIdx] = useState<number | null>(null);
  const activeIdx = controlledIdx !== undefined ? controlledIdx : internalIdx;
  const geoRef = useRef<{ cx: number; cy: number; R: number; N: number; SEG: number }>({ cx: 0, cy: 0, R: 0, N: 0, SEG: 0 });
  const legendGeoRef = useRef<{ covBox: { x: number; y: number; w: number; h: number }; utilBox: { x: number; y: number; w: number; h: number } } | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [layerState, setVisibleLayer] = useState<"both" | "coverage" | "utilization">("both");
  // In coverage-only mode the layer toggle is fixed: there is no second
  // series to switch to.
  const visibleLayer = coverageOnly ? "coverage" : layerState;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);

    const N = data.length;
    if (N === 0) return;
    const SEG = (Math.PI * 2) / N;
    const legendSpace = 22;
    const cx = w / 2;
    const cy = (h - legendSpace) / 2;
    const availH = h - legendSpace;
    // Share of the smallest dimension taken by the plot; the rest is the ring
    // of capability labels. Coverage-only mode carries a single blip per axis
    // and a one-line caption, so it can afford a bigger plot than the
    // two-series version without crowding the labels.
    const R = Math.min(w, availH) * (coverageOnly ? 0.34 : 0.28);
    geoRef.current = { cx, cy, R, N, SEG };

    ctx.clearRect(0, 0, w, h);

    // ── Concentric ring backgrounds (outer to inner — matches TechRadar) ──
    for (let i = BANDS.length - 1; i >= 0; i--) {
      const band = BANDS[i];
      const outerR = (band.max / 100) * R;
      const b = hexToRgb(band.color);
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fillStyle = rgba(b, dk ? 0.05 : 0.045);
      ctx.fill();
    }

    // ── Ring borders ──
    for (let i = 1; i <= 5; i++) {
      const rr = (i * 20 / 100) * R;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = dk ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.15)";
      ctx.lineWidth = i === 5 ? 2 : 1;
      ctx.setLineDash(i === 5 ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Sector dividing lines ──
    for (let i = 0; i < N; i++) {
      const a = i * SEG - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.strokeStyle = dk ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // ── Coverage polygon ──
    const hR = Math.max(Math.min(w, h) * 0.065, 28);
    const dotSizeBase = Math.max(Math.min(w, h) * 0.018, 10);
    const minBlipR = hR + 6 + dotSizeBase + 4; // hub visual edge + dot radius + gap
    const showCov = visibleLayer === "both" || visibleLayer === "coverage";
    const showUtil = visibleLayer === "both" || visibleLayer === "utilization";
    if (showCov) drawPoly(ctx, data.map(d => d.coverage), cx, cy, R, N, SEG, COV_C, dk, false, minBlipR);

    // ── Utilization polygon ──
    if (showUtil) drawPoly(ctx, data.map(d => d.utilization), cx, cy, R, N, SEG, UTIL_C, dk, true, minBlipR);

    // ── Raw score ghost polygons (consolidation active) — dashed outline showing original scores ──
    const hasRaw = data.some(d => d.rawCoverage !== undefined && d.rawCoverage !== d.coverage);
    if (hasRaw) {
      const RAW_C = dk ? "#ffffff" : "#888888";
      if (showCov) drawPoly(ctx, data.map(d => d.rawCoverage ?? d.coverage), cx, cy, R, N, SEG, RAW_C, dk, true, minBlipR);
      if (showUtil) drawPoly(ctx, data.map(d => d.rawUtilization ?? d.utilization), cx, cy, R, N, SEG, RAW_C, dk, true, minBlipR);
    }

    // ── Center hub (drawn before blips so blips appear on top) ──
    const avgCov = Math.round(data.reduce((a, d) => a + d.coverage, 0) / N);
    const avgUtil = Math.round(data.reduce((a, d) => a + d.utilization, 0) / N);

    ctx.beginPath(); ctx.arc(cx, cy, hR + 5, 0, Math.PI * 2);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
    ctx.lineWidth = 0.5; ctx.stroke();

    ctx.beginPath(); ctx.arc(cx, cy, hR, 0, Math.PI * 2);
    ctx.fillStyle = dk ? "#111122ee" : "#fffffffa";
    ctx.fill();
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1; ctx.stroke();

    // Progress arcs
    const ps = -Math.PI / 2;
    ctx.lineCap = "round";
    const covEnd = ps + Math.PI * 2 * (avgCov / 100);
    ctx.beginPath(); ctx.arc(cx, cy, hR + 3, ps, covEnd);
    ctx.strokeStyle = COV_C; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.7; ctx.stroke();
    if (!coverageOnly) {
      const utilEnd = ps + Math.PI * 2 * (avgUtil / 100);
      ctx.beginPath(); ctx.arc(cx, cy, hR + 6, ps, utilEnd);
      ctx.strokeStyle = UTIL_C; ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineCap = "butt";

    // Center text
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const fSize = Math.max(Math.min(w, h) * 0.028, 14);
    const hubLabel1 = legendLabels ? "A" : "COV";
    ctx.fillStyle = COV_C;
    ctx.font = `800 ${fSize}px system-ui,sans-serif`;
    if (coverageOnly) {
      // One number: centre it and hang its caption above.
      ctx.fillText(avgCov + "%", cx, cy + hR * 0.08);
      ctx.fillStyle = dk ? "#c0c0e0" : "#555570";
      ctx.font = `600 ${Math.max(fSize * 0.42, 7)}px system-ui,sans-serif`;
      ctx.fillText(hubLabel1, cx, cy - hR * 0.42);
    } else {
      ctx.fillText(avgCov + "%", cx, cy - hR * 0.22);
      ctx.fillStyle = UTIL_C;
      ctx.fillText(avgUtil + "%", cx, cy + hR * 0.22);
      ctx.fillStyle = dk ? "#c0c0e0" : "#555570";
      ctx.font = `600 ${Math.max(fSize * 0.42, 7)}px system-ui,sans-serif`;
      ctx.fillText(hubLabel1, cx, cy - hR * 0.55);
      ctx.fillText(legendLabels ? "B" : "UTL", cx, cy + hR * 0.55);
    }

    // ── Blips with gradient & score (drawn after hub so they appear on top) ──
    const dotBase = dotSizeBase;
    for (let i = 0; i < N; i++) {
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      const act = activeIdx === i;
      const dim = activeIdx !== null && activeIdx !== undefined && !act;
      const dotSize = act ? dotBase * 1.35 : dotBase;

      // Coverage blip (circle)
      const covR = minBlipR + (data[i].coverage / 100) * (R - minBlipR);
      let covX = cx + Math.cos(midA) * covR;
      let covY = cy + Math.sin(midA) * covR;

      // Utilization blip (diamond)
      const matR = minBlipR + (data[i].utilization / 100) * (R - minBlipR);
      let matX = cx + Math.cos(midA) * matR;
      let matY = cy + Math.sin(midA) * matR;

      // Separate overlapping blips perpendicular to radial axis — pointless
      // when only one series is on screen, and it would push the coverage
      // blip off its own axis.
      const blipDist = Math.hypot(covX - matX, covY - matY);
      const minSep = dotSize * 2.6;
      if (!coverageOnly && blipDist < minSep) {
        const perpX = -Math.sin(midA);
        const perpY = Math.cos(midA);
        const offset = (minSep - blipDist) / 2 + 2;
        covX += perpX * offset;
        covY += perpY * offset;
        matX -= perpX * offset;
        matY -= perpY * offset;
      }

      drawGradientBlip(ctx, covX, covY, dotSize, COV_C, data[i].coverage, dk, false, act, dim || !showCov);
      if (!coverageOnly) drawGradientBlip(ctx, matX, matY, dotSize, UTIL_C, data[i].utilization, dk, true, act, dim || !showUtil);
    }

    // ── Connector lines + capability labels ──
    // Single circular label radius = R + fixed gap — ensures all connector lines are equal length
    const labelGap = R * 0.28;  // connector line length = labelGap - small margins
    const labelR = R + labelGap;
    const fs1 = Math.max(Math.min(w, h) * 0.018, 10);
    const fs2 = Math.max(Math.min(w, h) * 0.015, 8);
    const maxLabelW = Math.max(w * 0.26, 110);
    const labelPad = 6;

    for (let i = 0; i < N; i++) {
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      const cos = Math.cos(midA);
      const sin = Math.sin(midA);
      const act = activeIdx === i;
      const dim = activeIdx !== null && activeIdx !== undefined && !act;
      const isR = cos > 0.15, isL = cos < -0.15;

      // Label anchor on circle — uniform distance from center
      let lx = cx + cos * labelR;
      let ly = cy + sin * labelR;
      if (isR) lx = Math.min(lx, w - maxLabelW - labelPad);
      else if (isL) lx = Math.max(lx, maxLabelW + labelPad);

      // Band colour of what the label actually reports
      const avgScore = coverageOnly ? data[i].coverage : (data[i].coverage + data[i].utilization) / 2;
      const ml = bandForScore(avgScore);
      const alpha = dim ? 0.2 : act ? 0.95 : 0.6;

      // ── Compute text block layout ──
      ctx.font = `${act ? 800 : 700} ${fs1}px system-ui,sans-serif`;
      const nameLines = wrapText(ctx, data[i].name, maxLabelW);
      const lineH = fs1 + 2;
      const nameBlockH = nameLines.length * lineH;
      const scorePrefix1 = legendLabels ? "A" : "C";
      const scorePrefix2 = legendLabels ? "B" : "U";
      let scoreText: string;
      if (coverageOnly) scoreText = `${Math.round(data[i].coverage)}%`;
      else if (visibleLayer === "coverage") scoreText = `${scorePrefix1} ${Math.round(data[i].coverage)}%`;
      else if (visibleLayer === "utilization") scoreText = `${scorePrefix2} ${Math.round(data[i].utilization)}%`;
      else scoreText = `${scorePrefix1} ${Math.round(data[i].coverage)}% / ${scorePrefix2} ${Math.round(data[i].utilization)}%`;
      const totalTextH = nameBlockH + 2 + fs2;
      const textTopY = ly - totalTextH / 2;
      const nameStartY = textTopY;
      const scoreY = textTopY + nameBlockH + 2;

      // ── Dashed connector line — purely radial, all same length ──
      const connStart = R + 4;
      const connEnd = labelR - totalTextH / 2 - 4;
      if (connEnd > connStart + 2) {
        const sx = cx + cos * connStart;
        const sy = cy + sin * connStart;
        const ex = cx + cos * connEnd;
        const ey = cy + sin * connEnd;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.strokeStyle = dk ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.2)";
        ctx.globalAlpha = dim ? 0.15 : 0.7;
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // ── Draw text ──
      ctx.textAlign = isR ? "left" : isL ? "right" : "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = act ? data[i].color : dk ? "#e0e0f0" : "#1a1a2e";
      ctx.font = `${act ? 800 : 700} ${fs1}px system-ui,sans-serif`;
      for (let li = 0; li < nameLines.length; li++) {
        ctx.fillText(nameLines[li], lx, nameStartY + li * lineH + lineH / 2);
      }
      // Score line — centered below name
      const maxNameW = Math.max(...nameLines.map(l => ctx.measureText(l).width));
      const nameCenterX = isR ? lx + maxNameW / 2 : isL ? lx - maxNameW / 2 : lx;
      ctx.fillStyle = ml.color;
      ctx.font = `700 ${fs2}px system-ui,sans-serif`;
      const savedAlign = ctx.textAlign;
      ctx.textAlign = "center";
      ctx.fillText(scoreText, nameCenterX, scoreY + fs2 / 2);
      ctx.textAlign = savedAlign;
      ctx.globalAlpha = 1;
    }

    // ── Legend ──
    const legFont = Math.max(Math.min(w * 0.016, 9), 7);
    const legY = h - 8;
    ctx.font = `700 ${legFont}px system-ui,sans-serif`;
    // Measure text widths for centering
    const covLabel = legendLabels?.[0] ?? "Coverage";
    const utilLabel = legendLabels?.[1] ?? "Utilization";
    const covW = ctx.measureText(covLabel).width;
    const matW = ctx.measureText(utilLabel).width;
    const iconR = 5;
    const iconGap = 8;
    const itemGap = 20;
    const totalW = coverageOnly
      ? iconR * 2 + iconGap + covW
      : iconR * 2 + iconGap + covW + itemGap + iconR * 2 + iconGap + matW;
    const startX = cx - totalW / 2;
    const legHitPad = 6;
    // Coverage legend item
    const covItemAlpha = visibleLayer === "utilization" ? 0.3 : 1;
    ctx.globalAlpha = covItemAlpha;
    ctx.fillStyle = COV_C;
    ctx.beginPath();
    ctx.arc(startX + iconR, legY, iconR, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillStyle = dk ? "#e0e0f8" : "#2a2a3e";
    ctx.fillText(covLabel, startX + iconR * 2 + iconGap, legY);
    // The "this layer is pinned" outline only makes sense when a layer could
    // be unpinned, which coverage-only mode never allows.
    if (visibleLayer === "coverage" && !coverageOnly) {
      ctx.beginPath();
      ctx.roundRect(startX - legHitPad, legY - legFont - legHitPad / 2, iconR * 2 + iconGap + covW + legHitPad * 2, legFont * 2 + legHitPad, 4);
      ctx.strokeStyle = COV_C;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Store coverage legend hit box
    const covBoxX = startX - legHitPad;
    const covBoxY = legY - legFont - legHitPad;
    const covBoxW = iconR * 2 + iconGap + covW + legHitPad * 2;
    const covBoxH = legFont * 2 + legHitPad * 2;
    // Utilization legend item
    if (coverageOnly) {
      legendGeoRef.current = {
        covBox: { x: covBoxX, y: covBoxY, w: covBoxW, h: covBoxH },
        utilBox: { x: 0, y: 0, w: 0, h: 0 },
      };
      return;
    }
    const utilItemAlpha = visibleLayer === "coverage" ? 0.3 : 1;
    ctx.globalAlpha = utilItemAlpha;
    const utilIconX = startX + iconR * 2 + iconGap + covW + itemGap + iconR;
    ctx.fillStyle = UTIL_C;
    ctx.beginPath();
    ctx.moveTo(utilIconX, legY - iconR);
    ctx.lineTo(utilIconX + iconR, legY);
    ctx.lineTo(utilIconX, legY + iconR);
    ctx.lineTo(utilIconX - iconR, legY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dk ? "#e0e0f8" : "#2a2a3e";
    ctx.fillText(utilLabel, utilIconX + iconR + iconGap, legY);
    if (visibleLayer === "utilization") {
      ctx.beginPath();
      ctx.roundRect(utilIconX - iconR - legHitPad, legY - legFont - legHitPad / 2, iconR * 2 + iconGap + matW + legHitPad * 2, legFont * 2 + legHitPad, 4);
      ctx.strokeStyle = UTIL_C;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Store utilization legend hit box
    const matBoxX = utilIconX - iconR - legHitPad;
    const matBoxY = legY - legFont - legHitPad;
    const matBoxW = iconR * 2 + iconGap + matW + legHitPad * 2;
    const matBoxH = legFont * 2 + legHitPad * 2;
    legendGeoRef.current = {
      covBox: { x: covBoxX, y: covBoxY, w: covBoxW, h: covBoxH },
      utilBox: { x: matBoxX, y: matBoxY, w: matBoxW, h: matBoxH },
    };
  }, [data, dk, COV_C, UTIL_C, activeIdx, legendLabels, visibleLayer, coverageOnly]);

  const hitTest = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return -1;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { cx, cy, R, N, SEG } = geoRef.current;
    if (N === 0) return -1;
    const w = rect.width;
    const h = rect.height;

    // Check label areas first (higher priority)
    const labelGapH = R * 0.28;
    const labelRH = R + labelGapH;
    const fs1 = Math.max(Math.min(w, h) * 0.018, 10);
    const fs2 = Math.max(Math.min(w, h) * 0.015, 8);
    const totalTextH = (fs1 + 2) + 2 + fs2;
    for (let i = 0; i < N; i++) {
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      const cos = Math.cos(midA), sin = Math.sin(midA);
      const lx = cx + cos * labelRH;
      const ly = cy + sin * labelRH;
      const isR = cos > 0.15, isL = cos < -0.15;
      const labelW = 130;
      const left = isR ? lx - 4 : isL ? lx - labelW + 4 : lx - labelW / 2;
      const top = ly - totalTextH / 2 - 4;
      if (mx >= left && mx <= left + labelW && my >= top && my <= top + totalTextH + 16) {
        return i;
      }
    }

    // Check blip positions
    const hR2 = Math.max(Math.min(w, h) * 0.065, 28);
    const dotSz = Math.max(Math.min(w, h) * 0.018, 10);
    const minR2 = hR2 + 6 + dotSz + 4;
    const hitRadius = dotSz * 2.2;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      for (const val of [data[i].coverage, data[i].utilization]) {
        const r = minR2 + (val / 100) * (R - minR2);
        const bx = cx + Math.cos(midA) * r;
        const by = cy + Math.sin(midA) * r;
        const d = Math.hypot(mx - bx, my - by);
        if (d < hitRadius && d < bestD) { best = i; bestD = d; }
      }
    }
    if (best >= 0) return best;

    // Fallback: click anywhere in a sector selects that capability
    const dx = mx - cx, dy = my - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > hR2 + 10 && dist < labelRH) {
      let angle = Math.atan2(dy, dx) + Math.PI / 2; // rotate so 0 is top
      if (angle < 0) angle += Math.PI * 2;
      const sectorIdx = Math.floor(angle / SEG);
      if (sectorIdx >= 0 && sectorIdx < N) return sectorIdx;
    }
    return best;
  }, [data]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Check legend click first — no layer to toggle in coverage-only mode
    const canvas = canvasRef.current;
    if (canvas && !coverageOnly) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const lg = legendGeoRef.current;
      if (lg) {
        const { covBox, utilBox } = lg;
        if (mx >= covBox.x && mx <= covBox.x + covBox.w && my >= covBox.y && my <= covBox.y + covBox.h) {
          setVisibleLayer(prev => prev === "coverage" ? "both" : "coverage");
          return;
        }
        if (mx >= utilBox.x && mx <= utilBox.x + utilBox.w && my >= utilBox.y && my <= utilBox.y + utilBox.h) {
          setVisibleLayer(prev => prev === "utilization" ? "both" : "utilization");
          return;
        }
      }
    }
    const idx = hitTest(e);
    const next = idx >= 0 ? (activeIdx === idx ? null : idx) : null;
    if (onSelect) onSelect(next);
    else setInternalIdx(next);
  }, [hitTest, activeIdx, onSelect, coverageOnly]);

  const [hoveredLegend, setHoveredLegend] = useState(false);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const lg = legendGeoRef.current;
      if (lg) {
        const { covBox, utilBox } = lg;
        const onLeg = (mx >= covBox.x && mx <= covBox.x + covBox.w && my >= covBox.y && my <= covBox.y + covBox.h)
          || (mx >= utilBox.x && mx <= utilBox.x + utilBox.w && my >= utilBox.y && my <= utilBox.y + utilBox.h);
        setHoveredLegend(onLeg);
      }
    }
    const idx = hitTest(e);
    setHoveredIdx(idx >= 0 ? idx : null);
    if (idx >= 0) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, [hitTest]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(null);
    setHoveredLegend(false);
  }, []);

  useImperativeHandle(ref, () => ({
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? null,
  }), []);

  useEffect(() => {
    draw();
    const obs = new ResizeObserver(() => draw());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  const hovered = hoveredIdx !== null && hoveredIdx >= 0 ? data[hoveredIdx] : null;

  return (
    <Flex ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: (hoveredIdx !== null && hoveredIdx >= 0) || hoveredLegend ? "pointer" : "default", touchAction: "none" }}
        onClick={handleClick}
        onDoubleClick={(e) => e.preventDefault()}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {hovered && (
        <div style={{
          position: "absolute",
          left: tooltipPos.x + 14,
          top: tooltipPos.y - 10,
          pointerEvents: "none",
          zIndex: 20,
          background: dk ? "rgba(15,17,35,0.95)" : "rgba(255,255,255,0.97)",
          border: `1px solid ${dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: dk ? "0 4px 16px rgba(0,0,0,0.5)" : "0 4px 16px rgba(0,0,0,0.12)",
          whiteSpace: "nowrap",
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily: "system-ui, sans-serif",
          color: dk ? "#e0e0f0" : "#1a1a2e",
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: hovered.color }}>{hovered.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: COV_C, display: "inline-block" }} />
            <span>Coverage: <strong>{Math.round(hovered.coverage)}%</strong></span>
          </div>
          {!coverageOnly && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, background: UTIL_C, display: "inline-block", transform: "rotate(45deg)" }} />
              <span>Utilization: <strong>{Math.round(hovered.utilization)}%</strong></span>
            </div>
          )}
        </div>
      )}
    </Flex>
  );
}));

function drawPoly(ctx: CanvasRenderingContext2D, values: number[], cx: number, cy: number, R: number, N: number, SEG: number, color: string, dk: boolean, dashed: boolean, minR = 3) {
  const b = hexToRgb(color);
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const r = minR + (values[i] / 100) * (R - minR);
    const px = cx + Math.cos(midA) * r;
    const py = cy + Math.sin(midA) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(b, dk ? 0.12 : 0.10);
  ctx.fill();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.strokeStyle = rgba(b, dk ? 0.35 : 0.30);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGradientBlip(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, score: number, dk: boolean, isDiamond: boolean, act = false, dim = false, showValue = true) {
  const b = hexToRgb(color);
  const band = bandForScore(score);
  const mlb = hexToRgb(band.color);

  // Glow on active
  if (act) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    if (isDiamond) { diamondPath(ctx, x, y, size + 5); }
    else { ctx.arc(x, y, size + 5, 0, Math.PI * 2); }
    ctx.fillStyle = rgba(b, 0.15);
    ctx.fill();
    ctx.restore();
  }

  // Outer ring (band color)
  ctx.beginPath();
  if (isDiamond) {
    diamondPath(ctx, x, y, size + 3);
  } else {
    ctx.arc(x, y, size + 3, 0, Math.PI * 2);
  }
  ctx.fillStyle = rgba(mlb, dim ? 0.2 : dk ? 0.65 : 0.5);
  ctx.fill();

  // Main gradient fill
  const grad = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 0, x, y, size);
  grad.addColorStop(0, rgba(lighten(b, dk ? 80 : 90), dim ? 0.4 : 1));
  grad.addColorStop(0.6, rgba(b, dim ? 0.35 : 1));
  grad.addColorStop(1, rgba(mlb, dim ? 0.3 : 0.95));
  ctx.beginPath();
  if (isDiamond) {
    diamondPath(ctx, x, y, size);
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.fillStyle = grad;
  ctx.fill();

  // Border
  ctx.beginPath();
  if (isDiamond) {
    diamondPath(ctx, x, y, size);
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
  ctx.strokeStyle = act ? rgba(lighten(b, 100), 1) : rgba(lighten(b, 60), dim ? 0.15 : 0.75);
  ctx.lineWidth = act ? 3 : 2;
  ctx.stroke();

  // Score text inside blip — suppressed in the PDF radar, which explains
  // each capability in words instead of numbers.
  if (size >= 7 && showValue) {
    const txt = Math.round(score) + "";
    const fontSize = Math.max(size * 0.9, 10);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 ${fontSize}px system-ui,sans-serif`;
    ctx.globalAlpha = dim ? 0.4 : 1;
    // Dark outline for contrast on bright backgrounds
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(txt, x, y + 0.5);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, x, y + 0.5);
    ctx.globalAlpha = 1;
  }
}

function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
}

/**
 * Renders the CovUtilRadar chart to an offscreen canvas and returns a PNG data URL.
 * Used by PDF report generators to embed a pixel-perfect chart image.
 */
export function renderRadarToDataURL(
  data: DataPoint[],
  size: number,
  options?: { coverageColor?: string; utilizationColor?: string; darkBg?: boolean; format?: "png" | "jpeg" },
): string {
  const w = Math.round(size * 1.35); // wider to fit label text
  const h = size;
  const dk = options?.darkBg ?? true;
  const COV_C = options?.coverageColor ?? (dk ? "#00E5FF" : "#0097A7");
  const UTIL_C = options?.utilizationColor ?? (dk ? "#D500F9" : "#9C27B0");

  const canvas = document.createElement("canvas");
  const dpr = 2; // high-res for PDF
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // JPEG (no alpha channel) shrinks gradient-heavy charts ~20x for PDF
  // embedding; composite onto the report's page color first.
  const exportDataURL = (): string => {
    if (options?.format === "jpeg") {
      const c2 = document.createElement("canvas");
      c2.width = canvas.width; c2.height = canvas.height;
      const x2 = c2.getContext("2d")!;
      x2.fillStyle = "#0b0b1a";
      x2.fillRect(0, 0, c2.width, c2.height);
      x2.drawImage(canvas, 0, 0);
      return c2.toDataURL("image/jpeg", 0.82);
    }
    return canvas.toDataURL("image/png");
  };

  const N = data.length;
  if (N === 0) return exportDataURL();
  const SEG = (Math.PI * 2) / N;
  const legendSpace = 22;
  const cx = w / 2;
  const cy = (h - legendSpace) / 2;
  const labelMargin = Math.max(h * 0.32, 120);
  const R = (h - legendSpace - labelMargin) / 2;

  // No painted background: the chart sits directly on the report page, so
  // the only ink is data + grid. (JPEG export composites the page colour
  // underneath; PNG keeps the alpha channel.)

  // Concentric ring backgrounds intentionally omitted — the tinted rings
  // added a "box" look without carrying information the grid doesn't.

  // Ring borders
  for (let i = 1; i <= 5; i++) {
    const rr = (i * 20 / 100) * R;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.15)";
    ctx.lineWidth = i === 5 ? 2 : 1;
    ctx.setLineDash(i === 5 ? [] : [4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Sector dividing lines
  for (let i = 0; i < N; i++) {
    const a = i * SEG - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  // Polygons
  const hR = Math.max(Math.min(w, h) * 0.09, 40);
  const dotSizeBase = Math.max(Math.min(w, h) * 0.016, 9);
  const minBlipR = hR + 6 + dotSizeBase + 4;
  drawPoly(ctx, data.map(d => d.coverage), cx, cy, R, N, SEG, COV_C, dk, false, minBlipR);
  drawPoly(ctx, data.map(d => d.utilization), cx, cy, R, N, SEG, UTIL_C, dk, true, minBlipR);

  // Raw score ghost polygons (consolidation active)
  const hasRawStatic = data.some(d => d.rawCoverage !== undefined && d.rawCoverage !== d.coverage);
  if (hasRawStatic) {
    const RAW_C = dk ? "#ffffff" : "#888888";
    drawPoly(ctx, data.map(d => d.rawCoverage ?? d.coverage), cx, cy, R, N, SEG, RAW_C, dk, true, minBlipR);
    drawPoly(ctx, data.map(d => d.rawUtilization ?? d.utilization), cx, cy, R, N, SEG, RAW_C, dk, true, minBlipR);
  }

  // Center hub
  const avgCov = Math.round(data.reduce((a, d) => a + d.coverage, 0) / N);
  const avgUtil = Math.round(data.reduce((a, d) => a + d.utilization, 0) / N);
  ctx.beginPath(); ctx.arc(cx, cy, hR + 5, 0, Math.PI * 2);
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
  ctx.lineWidth = 0.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, hR, 0, Math.PI * 2);
  ctx.fillStyle = dk ? "#111122ee" : "#fffffffa";
  ctx.fill();
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  ctx.lineWidth = 1; ctx.stroke();

  // Progress arcs
  const ps = -Math.PI / 2;
  ctx.lineCap = "round";
  const covEnd = ps + Math.PI * 2 * (avgCov / 100);
  ctx.beginPath(); ctx.arc(cx, cy, hR + 3, ps, covEnd);
  ctx.strokeStyle = COV_C; ctx.lineWidth = 3;
  ctx.globalAlpha = 0.7; ctx.stroke();
  const utilEnd = ps + Math.PI * 2 * (avgUtil / 100);
  ctx.beginPath(); ctx.arc(cx, cy, hR + 6, ps, utilEnd);
  ctx.strokeStyle = UTIL_C; ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineCap = "butt";

  // Center text — words, not scores: the hub states the overall reading
  // ("how much is on" / "how deeply it is used") in the same vocabulary
  // as the capability labels around the ring.
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const fSize = Math.max(Math.min(w, h) * 0.026, 13);
  ctx.fillStyle = COV_C;
  ctx.font = `800 ${fSize}px system-ui,sans-serif`;
  ctx.fillText(adoptionWord(avgCov), cx, cy - hR * 0.24);
  ctx.fillStyle = UTIL_C;
  ctx.fillText(depthWord(avgUtil).replace(/^./, c => c.toUpperCase()), cx, cy + hR * 0.30);
  ctx.fillStyle = dk ? "#c0c0e0" : "#555570";
  ctx.font = `600 ${Math.max(fSize * 0.40, 7)}px system-ui,sans-serif`;
  ctx.fillText("ADOPTION", cx, cy - hR * 0.58);
  ctx.fillText("USE", cx, cy + hR * 0.64);

  // Blips
  const dotBase = dotSizeBase;
  for (let i = 0; i < N; i++) {
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const dotSize = dotBase;
    const covR2 = minBlipR + (data[i].coverage / 100) * (R - minBlipR);
    const covX2 = cx + Math.cos(midA) * covR2;
    const covY2 = cy + Math.sin(midA) * covR2;
    drawGradientBlip(ctx, covX2, covY2, dotSize, COV_C, data[i].coverage, dk, false, false, false, false);
    const matR2 = minBlipR + (data[i].utilization / 100) * (R - minBlipR);
    const matX2 = cx + Math.cos(midA) * matR2;
    const matY2 = cy + Math.sin(midA) * matR2;
    drawGradientBlip(ctx, matX2, matY2, dotSize, UTIL_C, data[i].utilization, dk, true, false, false, false);
  }

  // Connector lines + capability labels
  const minGapE = R * 0.35;
  const labelRx = R + Math.max((w / 2 - R) * 0.6, minGapE);
  const labelRy = R + Math.max(((h - legendSpace) / 2 - R) * 0.6, minGapE);
  const fs1 = Math.max(Math.min(w, h) * 0.020, 10);
  const fs2 = Math.max(Math.min(w, h) * 0.016, 8);
  const labelH = fs1 + fs2 + 6;

  // ── Resolve label collisions before drawing ────────────────────────
  // Labels sit at fixed angles, so capabilities whose sectors are close
  // together (the top of the ring, especially) would print on top of each
  // other. Compute every anchor first, then push overlapping labels apart
  // vertically within their own side (left / right / centre column).
  const anchors = Array.from({ length: N }, (_, i) => {
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const cos = Math.cos(midA);
    const sin = Math.sin(midA);
    return {
      i, cos, sin,
      isR: cos > 0.15, isL: cos < -0.15,
      lx: cx + cos * labelRx,
      ly: cy + sin * labelRy,
    };
  });
  const minGapY = labelH + 4;
  for (const side of ["R", "L", "C"] as const) {
    const group = anchors
      .filter(a => (side === "R" ? a.isR : side === "L" ? a.isL : !a.isR && !a.isL))
      .sort((a, b) => a.ly - b.ly);
    for (let k = 1; k < group.length; k++) {
      const gap = group[k].ly - group[k - 1].ly;
      if (gap < minGapY) group[k].ly = group[k - 1].ly + minGapY;
    }
    // If the pushed stack ran past the canvas, shift the whole group up.
    const last = group[group.length - 1];
    if (last && last.ly > h - legendSpace - labelH / 2) {
      const shift = last.ly - (h - legendSpace - labelH / 2);
      for (const a of group) a.ly -= shift;
    }
  }

  for (let i = 0; i < N; i++) {
    const a = anchors[i];
    const cos = a.cos;
    const sin = a.sin;
    const isR = a.isR, isL = a.isL;
    const lx = a.lx;
    const ly = a.ly;
    const avgScore = (data[i].coverage + data[i].utilization) / 2;
    const ml = bandForScore(avgScore);

    // Connector from ring edge toward label
    const dlx = lx - cx, dly = ly - cy;
    const labelDist = Math.hypot(dlx, dly);
    const ux = dlx / labelDist, uy = dly / labelDist;
    const startD = R + 8;
    const stopD = labelDist - labelH / 2 - 6;
    if (startD < stopD) {
      const sx = cx + ux * startD, sy = cy + uy * startD;
      const ex = cx + ux * stopD, ey = cy + uy * stopD;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = ml.color; ctx.globalAlpha = 0.55;
      ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }

    const barY = ly + labelH / 2 + 3;
    const barW = 44;
    const barStartX = isR ? lx : isL ? lx - barW : lx - barW / 2;
    ctx.beginPath(); ctx.moveTo(barStartX, barY); ctx.lineTo(barStartX + barW, barY);
    ctx.strokeStyle = ml.color; ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";

    ctx.textAlign = isR ? "left" : isL ? "right" : "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    ctx.fillStyle = data[i].color;
    ctx.font = `700 ${fs1}px system-ui,sans-serif`;
    // Clamp label x so text stays within canvas
    let clampedLx = lx;
    if (isR) { clampedLx = Math.min(lx, w - ctx.measureText(data[i].name).width - 4); }
    else if (isL) { clampedLx = Math.max(lx, ctx.measureText(data[i].name).width + 4); }
    ctx.fillText(data[i].name, clampedLx, ly - fs2 / 2 - 1);
    ctx.fillStyle = ml.color;
    ctx.font = `700 ${fs2}px system-ui,sans-serif`;
    // Say what the two axes MEAN for this capability in plain words —
    // no percentages. "how much is adopted" x "how deeply it is used".
    ctx.fillText(
      `${adoptionWord(data[i].coverage)} adoption, ${depthWord(data[i].utilization)} use`,
      clampedLx, ly + fs1 / 2 + 1,
    );
    ctx.globalAlpha = 1;
  }

  // Legend
  const legFont = Math.max(w * 0.024, 11);
  const legY = h - 8;
  ctx.font = `700 ${legFont}px system-ui,sans-serif`;
  // Spell out what each ring means — the reader should never have to
  // guess what "Coverage" vs "Utilization" measures.
  const covLabel = "Coverage - how much is switched on";
  const utilLabel = "Utilization - how deeply it is used";
  const covW2 = ctx.measureText(covLabel).width;
  const matW2 = ctx.measureText(utilLabel).width;
  const iconR = 5;
  const iconGap = 8;
  const itemGap = 20;
  const totalW = iconR * 2 + iconGap + covW2 + itemGap + iconR * 2 + iconGap + matW2;
  const startX = cx - totalW / 2;
  ctx.fillStyle = COV_C;
  ctx.beginPath(); ctx.arc(startX + iconR, legY, iconR, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillStyle = dk ? "#e0e0f8" : "#2a2a3e";
  ctx.fillText(covLabel, startX + iconR * 2 + iconGap, legY);
  const utilIconX = startX + iconR * 2 + iconGap + covW2 + itemGap + iconR;
  ctx.fillStyle = UTIL_C;
  ctx.beginPath();
  ctx.moveTo(utilIconX, legY - iconR);
  ctx.lineTo(utilIconX + iconR, legY);
  ctx.lineTo(utilIconX, legY + iconR);
  ctx.lineTo(utilIconX - iconR, legY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dk ? "#e0e0f8" : "#2a2a3e";
  ctx.fillText(utilLabel, utilIconX + iconR + iconGap, legY);

  return exportDataURL();
}
