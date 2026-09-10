import Colors from "@dynatrace/strato-design-tokens/colors";
import { useA11yMode } from "../hooks/useA11yMode";
import { a11yScoreColor } from "./a11yColors";

/**
 * Strato design-token colors for each scoring band (for JSX / inline styles).
 * These resolve to CSS custom properties and adapt to dark/light theme automatically.
 */
export const SCORE_BAND_TOKENS = {
  "N/A":      Colors.Charts.Status.Critical.Default,
  Low:        Colors.Charts.Categorical.Color14.Default,
  Moderate:   Colors.Charts.Status.Warning.Default,
  Good:       Colors.Charts.Categorical.Color07.Default,
  Excellent:  Colors.Charts.Status.Ideal.Default,
} as const;

/**
 * Shared scoring band definitions — single source of truth for the entire app.
 * `color` values are plain hex strings for canvas-rendering compatibility.
 * For JSX use the corresponding `token` (CSS custom property).
 */
export const SCORE_BANDS = [
  { min: 0,  max: 20,  label: "N/A",       color: "#CD3C44", token: SCORE_BAND_TOKENS["N/A"] },
  { min: 20, max: 40,  label: "Low",       color: "#DC671E", token: SCORE_BAND_TOKENS.Low },
  { min: 40, max: 60,  label: "Moderate",  color: "#EEA746", token: SCORE_BAND_TOKENS.Moderate },
  { min: 60, max: 80,  label: "Good",      color: "#5EB1A9", token: SCORE_BAND_TOKENS.Good },
  { min: 80, max: 100, label: "Excellent", color: "#36B37E", token: SCORE_BAND_TOKENS.Excellent },
] as const;

/** Maps a 0–100% score to a { label, color, token } band. */
export function scoreBand(score: number): { label: string; color: string; token: string } {
  if (score >= 80) return { label: "Excellent", color: "#36B37E", token: SCORE_BAND_TOKENS.Excellent };
  if (score >= 60) return { label: "Good",      color: "#5EB1A9", token: SCORE_BAND_TOKENS.Good };
  if (score >= 40) return { label: "Moderate",  color: "#EEA746", token: SCORE_BAND_TOKENS.Moderate };
  if (score >= 20) return { label: "Low",       color: "#DC671E", token: SCORE_BAND_TOKENS.Low };
  return { label: "N/A", color: "#CD3C44", token: SCORE_BAND_TOKENS["N/A"] };
}

/** Maps a 0–100% score to a band hex color (canvas-safe). */
export function scoreColor(score: number): string {
  return scoreBand(score).color;
}

/** Maps a 0–100% score to a Strato design-token color (JSX-safe). */
export function scoreTokenColor(score: number): string {
  return scoreBand(score).token;
}

/** Maps a 0–100% score to a band label. */
export function bandLabel(score: number): string {
  return scoreBand(score).label;
}

/**
 * Hook returning a score-to-hex-color function appropriate for the current
 * accessibility mode. When color-blind mode is active it returns
 * `a11yScoreColor` (sequential blue scale); otherwise returns `scoreColor`
 * (the standard red→green palette).
 *
 * Call at the component level — this is a React hook.
 */
export function useA11yScoreColor(): (score: number) => string {
  const { a11yMode } = useA11yMode();
  return a11yMode ? a11yScoreColor : scoreColor;
}
