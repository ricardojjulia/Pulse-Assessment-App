// Color-blind accessible palette (sequential blue scale, luminance-stepped)
// Mirrors the 5 bands in utils/colors.ts but uses blue instead of red→green
export const A11Y_BANDS = [
  { min: 80, color: "#1e3a5f", label: "Strong" },
  { min: 60, color: "#2563a8", label: "Good" },
  { min: 40, color: "#60a5e8", label: "Fair" },
  { min: 20, color: "#93c5fd", label: "Weak" },
  { min: 0,  color: "#dbeafe", label: "Critical" },
] as const;

export function a11yScoreColor(score: number): string {
  return A11Y_BANDS.find(b => score >= b.min)?.color ?? A11Y_BANDS[A11Y_BANDS.length - 1].color;
}
