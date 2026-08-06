import React, { useRef, useEffect, useCallback } from "react";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import type { CapabilityResult } from "../hooks/useCoverageData";
import { scoreBand, SCORE_BANDS } from "../utils/colors";

function hexToRgb(h: string) { return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }; }
function rgba(c: { r: number; g: number; b: number }, a: number) { return `rgba(${c.r},${c.g},${c.b},${a})`; }
function lighten(c: { r: number; g: number; b: number }, v: number) { return { r: Math.min(255, c.r + v), g: Math.min(255, c.g + v), b: Math.min(255, c.b + v) }; }

export function utilization(s: number) { return scoreBand(s); }

const R_RATIO = 0.34;

const BANDS = SCORE_BANDS;

interface Props {
  capabilities: CapabilityResult[];
  anim: number;
  activeIdx: number | null;
  size: number;
}

export const TechRadar: React.FC<Props> = React.memo(({ capabilities, anim, activeIdx, size }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const dk = useCurrentTheme() === "dark";
  const N = capabilities.length;
  const SEG = (Math.PI * 2) / N;

  const draw = useCallback(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = size + "px"; c.style.height = size + "px";
    ctx.scale(dpr, dpr);
    const cx = size / 2, cy = size / 2, R = size * R_RATIO;
    ctx.clearRect(0, 0, size, size);

    // ── Concentric ring backgrounds (outer to inner so inner overlaps) ──
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

    // ── Filled radar polygon (connecting blips) ──
    const hR = Math.max(size * 0.09, 44);
    const dotSizeBase = Math.max(size * 0.016, 9);
    const hubR = hR + 6 + dotSizeBase + 4; // hub visual edge + dot radius + gap
    if (anim > 0 && N > 0) {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const cap = capabilities[i];
        const v = cap.score * anim;
        const blipR = hubR + (v / 100) * (R - hubR);
        const midA = i * SEG + SEG / 2 - Math.PI / 2;
        const px = cx + Math.cos(midA) * blipR;
        const py = cy + Math.sin(midA) * blipR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = dk ? "rgba(91,106,207,0.12)" : "rgba(91,106,207,0.10)";
      ctx.fill();
      ctx.strokeStyle = dk ? "rgba(91,106,207,0.35)" : "rgba(91,106,207,0.30)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Center hub (drawn before blips so blips appear on top) ──
    const avg = Math.round(capabilities.reduce((a, c) => a + c.score, 0) / N * anim);
    const ml = utilization(Math.round(capabilities.reduce((a, c) => a + c.score, 0) / N));
    ctx.beginPath(); ctx.arc(cx, cy, hR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
    ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, hR, 0, Math.PI * 2);
    ctx.fillStyle = dk ? "#111122ee" : "#fffffffa";
    ctx.fill();
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1; ctx.stroke();

    // Progress arc
    const ps = -Math.PI / 2, pe = ps + (Math.PI * 2) * (avg / 100);
    ctx.beginPath(); ctx.arc(cx, cy, hR + 3, ps, pe);
    ctx.strokeStyle = ml.color; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.globalAlpha = 0.65 * anim; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = "butt";

    // Center text
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = ml.color;
    ctx.font = `800 ${Math.max(size * 0.044, 22)}px system-ui,sans-serif`;
    ctx.fillText(avg + "%", cx, cy - hR * 0.28);
    ctx.fillStyle = dk ? "#c0c0e0" : "#555570";
    ctx.font = `700 ${Math.max(size * 0.015, 8)}px system-ui,sans-serif`;
    ctx.fillText("COVERAGE", cx, cy + hR * 0.08);
    ctx.fillStyle = ml.color;
    ctx.font = `700 ${Math.max(size * 0.018, 10)}px system-ui,sans-serif`;
    ctx.fillText(ml.label, cx, cy + hR * 0.42);

    // ── Blips (dots for each capability — drawn after hub so they appear on top) ──
    for (let i = 0; i < N; i++) {
      const cap = capabilities[i];
      const v = cap.score * anim;
      const act = activeIdx === i;
      const dim = activeIdx !== null && !act;
      const blipR = hubR + (v / 100) * (R - hubR);
      const midA = i * SEG + SEG / 2 - Math.PI / 2;
      const bx = cx + Math.cos(midA) * blipR;
      const by = cy + Math.sin(midA) * blipR;
      const b = hexToRgb(cap.color);
      const ml = utilization(cap.score);
      const mlb = hexToRgb(ml.color);
      const dotSize = act ? Math.max(size * 0.022, 12) : Math.max(size * 0.016, 9);

      // Glow on active
      if (act) {
        ctx.save();
        ctx.shadowColor = cap.color;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(bx, by, dotSize + 3, 0, Math.PI * 2);
        ctx.fillStyle = rgba(b, 0.15);
        ctx.fill();
        ctx.restore();
      }

      // Outer ring of blip (band color)
      ctx.beginPath();
      ctx.arc(bx, by, dotSize + 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(mlb, dim ? 0.2 : dk ? 0.65 : 0.5);
      ctx.fill();

      // Main blip dot
      const grad = ctx.createRadialGradient(bx - dotSize * 0.3, by - dotSize * 0.3, 0, bx, by, dotSize);
      grad.addColorStop(0, rgba(lighten(b, dk ? 80 : 90), dim ? 0.4 : 1));
      grad.addColorStop(0.6, rgba(b, dim ? 0.35 : 1));
      grad.addColorStop(1, rgba(hexToRgb(ml.color), dim ? 0.3 : 0.95));
      ctx.beginPath();
      ctx.arc(bx, by, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Border
      ctx.beginPath();
      ctx.arc(bx, by, dotSize, 0, Math.PI * 2);
      ctx.strokeStyle = act ? rgba(lighten(b, 100), 1) : rgba(lighten(b, 60), dim ? 0.15 : 0.75);
      ctx.lineWidth = act ? 3 : 2;
      ctx.stroke();

      // Score text inside blip
      if (dotSize >= 8) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = dk ? "#fff" : "#fff";
        ctx.font = `800 ${Math.max(dotSize * 0.9, 8)}px system-ui,sans-serif`;
        ctx.globalAlpha = dim ? 0.4 : 1;
        ctx.fillText(Math.round(v) + "", bx, by + 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }, [capabilities, anim, activeIdx, size, N, SEG, dk]);

  useEffect(() => { draw(); }, [draw]);

  return <canvas ref={ref} role="img" aria-label={`Tech radar showing coverage scores for ${N} capabilities`} style={{ position: "absolute", top: 0, left: 0, width: size, height: size, cursor: "pointer" }} />;
});

/**
 * Renders the TechRadar chart (with labels, connectors and legend) to an
 * offscreen canvas and returns a PNG data URL for PDF embedding.
 */
export function renderTechRadarToDataURL(
  capabilities: { name: string; score: number; color: string }[],
  size = 1000,
  opts?: { darkBg?: boolean },
): string {
  const dk = opts?.darkBg ?? true;
  const N = capabilities.length;
  if (N === 0) return "";
  const SEG = (Math.PI * 2) / N;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // No background fill — transparent

  const cx = size / 2, cy = size / 2;
  const R = size * 0.26; // smaller radar to leave room for labels
  const hR = Math.max(size * 0.07, 36);
  const dotSizeBase = Math.max(size * 0.018, 11);
  const hubR = hR + 6 + dotSizeBase + 4;

  // ── Band backgrounds ──
  for (let i = BANDS.length - 1; i >= 0; i--) {
    const band = BANDS[i];
    const outerR = (band.max / 100) * R;
    const b = hexToRgb(band.color);
    ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = rgba(b, dk ? 0.05 : 0.045);
    ctx.fill();
  }

  // ── Ring borders ──
  for (let i = 1; i <= 5; i++) {
    const rr = (i * 20 / 100) * R;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.15)";
    ctx.lineWidth = i === 5 ? 2 : 1;
    ctx.setLineDash(i === 5 ? [] : [4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }

  // ── Sector lines ──
  for (let i = 0; i < N; i++) {
    const a = i * SEG - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = dk ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
    ctx.lineWidth = 0.9; ctx.stroke();
  }

  // ── Filled polygon ──
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const blipR = hubR + (capabilities[i].score / 100) * (R - hubR);
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const px = cx + Math.cos(midA) * blipR;
    const py = cy + Math.sin(midA) * blipR;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = dk ? "rgba(91,106,207,0.12)" : "rgba(91,106,207,0.10)";
  ctx.fill();
  ctx.strokeStyle = dk ? "rgba(91,106,207,0.35)" : "rgba(91,106,207,0.30)";
  ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);

  // ── Center hub ──
  const avg = Math.round(capabilities.reduce((a, c) => a + c.score, 0) / N);
  const ml = utilization(avg);
  ctx.beginPath(); ctx.arc(cx, cy, hR + 6, 0, Math.PI * 2);
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
  ctx.lineWidth = 0.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, hR, 0, Math.PI * 2);
  ctx.fillStyle = dk ? "#111122ee" : "#fffffffa"; ctx.fill();
  ctx.strokeStyle = dk ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  ctx.lineWidth = 1; ctx.stroke();
  // Progress arc
  const ps = -Math.PI / 2, pe = ps + Math.PI * 2 * (avg / 100);
  ctx.beginPath(); ctx.arc(cx, cy, hR + 3, ps, pe);
  ctx.strokeStyle = ml.color; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.globalAlpha = 0.65; ctx.stroke(); ctx.globalAlpha = 1; ctx.lineCap = "butt";
  // Center text
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = ml.color;
  ctx.font = `800 ${Math.max(size * 0.044, 22)}px system-ui,sans-serif`;
  ctx.fillText(avg + "%", cx, cy - hR * 0.28);
  ctx.fillStyle = dk ? "#c0c0e0" : "#555570";
  ctx.font = `700 ${Math.max(size * 0.015, 8)}px system-ui,sans-serif`;
  ctx.fillText("COVERAGE", cx, cy + hR * 0.08);
  ctx.fillStyle = ml.color;
  ctx.font = `700 ${Math.max(size * 0.018, 10)}px system-ui,sans-serif`;
  ctx.fillText(ml.label, cx, cy + hR * 0.42);

  // ── Blips ──
  for (let i = 0; i < N; i++) {
    const cap = capabilities[i];
    const blipR = hubR + (cap.score / 100) * (R - hubR);
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const bx = cx + Math.cos(midA) * blipR;
    const by = cy + Math.sin(midA) * blipR;
    const b = hexToRgb(cap.color);
    const bml = utilization(cap.score);
    const mlb = hexToRgb(bml.color);
    const dotSize = dotSizeBase;

    // Outer ring
    ctx.beginPath(); ctx.arc(bx, by, dotSize + 2, 0, Math.PI * 2);
    ctx.fillStyle = rgba(mlb, dk ? 0.65 : 0.5); ctx.fill();
    // Main fill
    const grad = ctx.createRadialGradient(bx - dotSize * 0.3, by - dotSize * 0.3, 0, bx, by, dotSize);
    grad.addColorStop(0, rgba(lighten(b, dk ? 80 : 90), 1));
    grad.addColorStop(0.6, rgba(b, 1));
    grad.addColorStop(1, rgba(mlb, 0.95));
    ctx.beginPath(); ctx.arc(bx, by, dotSize, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    // Border
    ctx.beginPath(); ctx.arc(bx, by, dotSize, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(lighten(b, 60), 0.75); ctx.lineWidth = 2; ctx.stroke();
    // Score text with dark outline
    const txt = Math.round(cap.score) + "";
    const fz = Math.max(dotSize * 0.9, 10);
    ctx.font = `800 ${fz}px system-ui,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.strokeText(txt, bx, by + 0.5);
    ctx.fillStyle = "#fff"; ctx.fillText(txt, bx, by + 0.5);
  }

  // ── Connector lines + labels ──
  const labelR = R + size * 0.12;
  const fs1 = Math.max(size * 0.021, 13);
  const fs2 = Math.max(size * 0.017, 11);
  const labelH = fs1 + fs2 + 6;

  for (let i = 0; i < N; i++) {
    const cap = capabilities[i];
    const midA = i * SEG + SEG / 2 - Math.PI / 2;
    const cos = Math.cos(midA), sin = Math.sin(midA);
    const isR = cos > 0.15, isL = cos < -0.15;
    const bml = utilization(cap.score);
    const blipR = hubR + (cap.score / 100) * (R - hubR);
    const blipDot = dotSizeBase;
    const startR = blipR + blipDot + 4;
    const stopR = labelR - labelH / 2 - 6;

    // Dashed connector
    if (startR < stopR) {
      const sx = cx + cos * startR, sy = cy + sin * startR;
      const ex = cx + cos * stopR, ey = cy + sin * stopR;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = bml.color; ctx.globalAlpha = 0.55;
      ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }

    // Label position with edge clamping
    let lx = cx + cos * labelR;
    const ly = cy + sin * labelR;

    // Clamp labels so text doesn't go beyond canvas edges
    ctx.font = `800 ${fs1}px system-ui,sans-serif`;
    const nameW = ctx.measureText(cap.name).width;
    ctx.font = `700 ${fs2}px system-ui,sans-serif`;
    const scoreW = ctx.measureText(`${Math.round(cap.score)}% · ${bml.label}`).width;
    const maxTxtW = Math.max(nameW, scoreW);
    const edgePad = 6;
    if (isR) {
      lx = Math.min(lx, size - maxTxtW - edgePad);
    } else if (isL) {
      lx = Math.max(lx, maxTxtW + edgePad);
    }

    // Accent bar
    const barY = ly + labelH / 2 + 3;
    const barW = 48;
    const barStartX = isR ? lx : isL ? lx - barW : lx - barW / 2;
    ctx.beginPath(); ctx.moveTo(barStartX, barY); ctx.lineTo(barStartX + barW, barY);
    ctx.strokeStyle = bml.color; ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
    ctx.globalAlpha = 1;

    // Label text
    ctx.textAlign = isR ? "left" : isL ? "right" : "center";
    ctx.textBaseline = "middle";
    // Line 1: name
    ctx.fillStyle = dk ? "#e0e0f0" : "#1a1a2e";
    ctx.font = `800 ${fs1}px system-ui,sans-serif`;
    ctx.fillText(cap.name, lx, ly - fs2 / 2 - 1);
    // Line 2: score · band
    ctx.fillStyle = bml.color;
    ctx.font = `700 ${fs2}px system-ui,sans-serif`;
    ctx.fillText(`${Math.round(cap.score)}% · ${bml.label}`, lx, ly + fs1 / 2 + 1);
  }

  // ── Legend ──
  const legFont = Math.max(size * 0.013, 11);
  const legY = size - Math.max(size * 0.03, 16);
  ctx.font = `700 ${legFont}px system-ui,sans-serif`;
  const items = BANDS.map(b => ({ label: `${b.label} ${b.min}-${b.max - 1}%`, color: b.color }));
  const dotR = 4;
  const iGap = 8;
  const mW = items.reduce((s, it) => s + dotR * 2 + 4 + ctx.measureText(it.label).width + iGap, -iGap);
  let curX = cx - mW / 2;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(curX + dotR, legY, dotR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dk ? "#c8c8e0" : "#2a2a3e";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(it.label, curX + dotR * 2 + 4, legY);
    curX += dotR * 2 + 4 + ctx.measureText(it.label).width + iGap;
  }

  return canvas.toDataURL("image/png");
}
