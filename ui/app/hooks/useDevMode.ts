// ui/app/hooks/useDevMode.ts
//
// Tells the UI whether to expose developer / SE controls (Demo Mode chips,
// Force-refresh, perf-JSON download, scale-tier-override buttons).
//
// Production posture ─────────────────────────────────────────────────────
// A customer tenant should NEVER see the magenta "🎭 Performance
// simulation" footer bar — that's an internal SE diagnostic surface. The
// production-default app is the radar + cards + the (auto-detected) Scale
// Tier Banner only.
//
// Activation paths (any one is enough; URL param wins) ───────────────────
//   1. `?dev=1` query param                  — one-tab, shareable
//   2. `localStorage.cca.dev = '1'`          — sticky on this browser
//
// The local dev server (`localhost`) deliberately does NOT auto-enable
// dev mode: the default local view must match production exactly so the
// SE always sees what the customer sees. Opt into the diagnostic surface
// explicitly with ?dev=1 when needed.
//
// Why a tiny hook rather than a global ─────────────────────────────────
// Two reasons: (a) React components that consume it re-render on any
// future "toggle dev mode at runtime" feature; (b) the hook is the right
// place to also lazily check window/localStorage with the SSR-safety
// guards that the rest of the app uses elsewhere.

import { useState } from 'react';

const STORAGE_KEY = 'cca.dev';
const URL_PARAM = 'dev';

function readUrlFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = new URLSearchParams(window.location.search).get(URL_PARAM);
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
}

function readStorageFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
}

/** Non-hook variant for modules that need the dev answer outside React
 *  (e.g., usePreflight's simulated-entitlement guard). Same two paths
 *  as the hook, evaluated at call time. */
export function isDevEnvironment(): boolean {
  return readUrlFlag() || readStorageFlag();
}

export interface UseDevModeResult {
  /** True when diagnostic controls should be visible. */
  isDev: boolean;
}

export function useDevMode(): UseDevModeResult {
  // Resolved once on mount. The flag is sticky for the session lifetime
  // because dev controls aren't worth re-rendering everything for.
  //
  // Two explicit activation paths (any one is enough):
  //   1. ?dev=1 in the URL     → shareable one-off
  //   2. localStorage.cca.dev  → sticky on this browser
  // localhost intentionally does NOT auto-enable: the local dev server
  // must render the production view by default, and neither path is
  // reachable by a customer on a deployed tenant.
  const [isDev] = useState<boolean>(() => readUrlFlag() || readStorageFlag());
  return { isDev };
}
