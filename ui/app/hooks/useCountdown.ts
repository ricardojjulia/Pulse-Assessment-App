// ui/app/hooks/useCountdown.ts
//
// Minimal countdown timer hook. Takes a target epoch-ms timestamp and returns
// the remaining seconds plus a formatted "MM:SS" label, updated every second.
//
// Contract ────────────────────────────────────────────────────────────────
//   Input:  targetMs — epoch ms when the countdown expires, or undefined
//   Output: { remaining: number | null, label: string | null }
//             remaining — positive integer seconds left, or null when expired
//             label     — "MM:SS" string, e.g. "14:23", or null when expired
//
// The interval is registered with setInterval(1000) and cleaned up on unmount
// or whenever targetMs changes (React useEffect dependency array).
//
// Usage example ───────────────────────────────────────────────────────────
//   const { label } = useCountdown(rateLimitedUntil);
//   // label === "14:23" while counting, null when done

import { useEffect, useState } from "react";

function secondsRemaining(targetMs: number): number | null {
  const diff = Math.ceil((targetMs - Date.now()) / 1000);
  return diff > 0 ? diff : null;
}

function formatLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface CountdownResult {
  /** Remaining seconds (positive integer), or null when expired. */
  remaining: number | null;
  /** Formatted "MM:SS" label, or null when expired. */
  label: string | null;
}

export function useCountdown(targetMs: number | undefined): CountdownResult {
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (targetMs === undefined) return null;
    return secondsRemaining(targetMs);
  });

  useEffect(() => {
    if (targetMs === undefined) {
      setRemaining(null);
      return;
    }

    // Compute immediately so the first render reflects the current state.
    setRemaining(secondsRemaining(targetMs));

    const id = setInterval(() => {
      const r = secondsRemaining(targetMs);
      setRemaining(r);
      if (r === null) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [targetMs]);

  const label = remaining !== null ? formatLabel(remaining) : null;
  return { remaining, label };
}
