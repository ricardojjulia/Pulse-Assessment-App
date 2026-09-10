/** Shared canvas drawing utilities used by TechRadar and CovUtilRadar. */

export function hexToRgb(h: string): { r: number; g: number; b: number } {
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgba(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

export function lighten(c: { r: number; g: number; b: number }, v: number): { r: number; g: number; b: number } {
  return { r: Math.min(255, c.r + v), g: Math.min(255, c.g + v), b: Math.min(255, c.b + v) };
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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
