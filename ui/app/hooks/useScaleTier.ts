// ui/app/hooks/useScaleTier.ts
//
// Detects the tenant's scale, picks a Scale Tier (exact / large / xlarge),
// and exposes a manual override that the user can set via the header toggle.
// See ../scale-tier.ts for the rationale and contract.
//
// Behavior ────────────────────────────────────────────────────────────────
//   - On mount, runs one cheap DQL query (entity host count, ~0 GB scan).
//   - If the user has set a manual tier (persisted in localStorage), that
//     value wins. Otherwise the auto-selected tier from the host count is
//     used.
//   - Re-running the assessment (refresh) does NOT re-detect by default —
//     tenant size doesn't change minute-to-minute. Use refreshTier() if
//     you need to force re-detection.
//
// Design note ─────────────────────────────────────────────────────────────
//   This hook is intentionally isolated from useCoverageData. Coupling them
//   would mean re-detecting host count on every assessment run, which is
//   wasteful (host count is stable across runs) and would also require
//   plumbing the tier through the existing Promise.all CONCURRENCY worker.
//   Keeping it separate lets the rest of the app consume just { tier } as
//   a piece of read-only context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import {
  TIER_CONFIG,
  tierFromHostCount,
  type ScaleTier,
} from '../scale-tier';

const STORAGE_KEY = 'cca.scaleTier.override';
const QUERY_TIMEOUT_MS = 15_000;

export interface UseScaleTierResult {
  /** Resolved tier in effect (override if set, else auto). */
  tier: ScaleTier;
  /** The auto-detected tier from host count. Useful for UI hint when override differs. */
  autoTier: ScaleTier;
  /** Observed host count. null while detecting; -1 if detection failed (treated as 'exact'). */
  hostCount: number | null;
  /** True while the initial detection query is in-flight. */
  detecting: boolean;
  /** Active manual override, if any. */
  override: ScaleTier | null;
  /** Set / clear the manual override (persists to localStorage). */
  setOverride: (tier: ScaleTier | null) => void;
  /** Force re-detection of host count. Use after a major topology change. */
  refreshTier: () => Promise<void>;
}

function readOverride(): ScaleTier | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw === 'exact' || raw === 'large' || raw === 'xlarge') return raw;
    return null;
  } catch {
    return null;
  }
}

function writeOverride(tier: ScaleTier | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (tier === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // localStorage may be unavailable (private mode, Safari quota) — silent ignore.
  }
}

/**
 * Counts hosts via a metadata-only DQL query (no Grail scan cost).
 * Returns -1 on any failure so that the consumer falls back to 'exact'
 * (the safest default — never accidentally enables sampling).
 */
async function detectHostCount(): Promise<number> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: {
        query: 'fetch dt.entity.host | summarize count = count()',
        requestTimeoutMilliseconds: QUERY_TIMEOUT_MS,
        maxResultRecords: 1,
      },
    });
    const records = (response as { result?: { records?: Array<Record<string, unknown>> } })
      .result?.records;
    if (!records || records.length === 0) return -1;
    const first = records[0];
    for (const v of Object.values(first)) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
        return Number(v);
      }
    }
    return -1;
  } catch {
    return -1;
  }
}

export function useScaleTier(): UseScaleTierResult {
  const [hostCount, setHostCount] = useState<number | null>(null);
  const [override, setOverrideState] = useState<ScaleTier | null>(() => readOverride());
  const [detecting, setDetecting] = useState(true);
  const cancelRef = useRef(0);

  const runDetection = useCallback(async () => {
    const token = ++cancelRef.current;
    setDetecting(true);
    const count = await detectHostCount();
    if (cancelRef.current !== token) return; // a newer detection started
    setHostCount(count);
    setDetecting(false);
  }, []);

  useEffect(() => {
    void runDetection();
    return () => {
      // Mark in-flight detections as stale so their results are dropped.
      cancelRef.current++;
    };
  }, [runDetection]);

  const setOverride = useCallback((tier: ScaleTier | null) => {
    setOverrideState(tier);
    writeOverride(tier);
  }, []);

  const refreshTier = useCallback(async () => {
    await runDetection();
  }, [runDetection]);

  // Conservative default: if detection hasn't returned yet or returned -1,
  // assume 'exact' — never enable sampling without confirmed host count.
  const safeCount = hostCount != null && hostCount > 0 ? hostCount : 0;
  const autoTier: ScaleTier = tierFromHostCount(safeCount);
  const tier: ScaleTier = override ?? autoTier;

  // Sanity check at runtime — bounds should always be consistent with TIER_CONFIG.
  // If a config refactor breaks this, fail loudly in dev rather than silently
  // running the wrong scan strategy.
  if (process.env.NODE_ENV !== 'production') {
    const cfg = TIER_CONFIG[tier];
    if (!cfg) {
      // eslint-disable-next-line no-console
      console.error('[useScaleTier] unknown tier resolved:', tier);
    }
  }

  return {
    tier,
    autoTier,
    hostCount,
    detecting,
    override,
    setOverride,
    refreshTier,
  };
}
