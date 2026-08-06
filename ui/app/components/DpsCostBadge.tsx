// ui/app/components/DpsCostBadge.tsx
//
// Customer-facing DPS cost indicator. Renders in the toolbar next to the
// existing "X records scanned" line so anyone running the assessment knows
// at a glance what the run cost in Grail DPS — and what Scale Tier / 24h
// cache saved them.
//
// Why customer-facing ────────────────────────────────────────────────────
// At xLarge scale a single cold assessment can scan multi-TB and cost tens
// to hundreds of USD. Hiding that number behind a developer flag means SEs
// have to dig in a downloaded JSON or estimate it offline. A small badge
// in the toolbar turns the cost into a normal product surface — same way
// every cloud console shows "estimated bill" while you're configuring
// resources.
//
// What it does NOT do ────────────────────────────────────────────────────
// It does not bill the customer or change behaviour. It only renders the
// numbers the perf instrumentation already collected (stats + lastRunMeta).
// The displayed USD is an estimate at the Dynatrace published DPS pricing
// (range $0.0065–$0.01 per GiB scanned, low/high tier of typical contracts).
// We display the HIGH bound to set conservative expectations.
//
// Layout ────────────────────────────────────────────────────────────────
//   Inline span:  "≈ $1.61 DPS · 173 GB scanned"  (always shown post-run)
//   Trailing:     " · saved $1.61 via cache"      (when cache hit > 0)
//   Title attr:   detailed breakdown + cadence projections (1×/day, 1×/week,
//                 1×/month annualised) so a hover reveals the long-term
//                 cost picture without taking screen real estate.
//
// Anyone running the app sees this. No dev / demo gate.

import React from 'react';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import type { QueryStats, CoverageData } from '../hooks/useCoverageData';

interface DpsCostBadgeProps {
  /** Final run stats. Null while the run is in flight; we fall back to live
   *  byte counters in that case. */
  stats: QueryStats | null;
  /** Live scanned-bytes counter from useCoverageData — updates during the
   *  run so the badge climbs in real time. */
  liveScannedBytes: number;
  /** Last run metadata so we can surface cache savings. */
  lastRunMeta: CoverageData['lastRunMeta'];
  /** Whether the run is in flight (we show "running…" instead of stale numbers). */
  loading: boolean;
  /** Strato text colors injected by the host so the badge follows theme. */
  textColor: string;
  textSecColor: string;
}

/** Upper-bound DPS pricing in USD per GiB scanned. Matches what Dynatrace
 *  publishes for the most common tier of customer contracts; SEs running
 *  the badge on lower-tier contracts will see a CONSERVATIVE (high) number,
 *  which is the right error direction. */
const USD_PER_GB_HIGH = 0.01;
const USD_PER_GB_LOW = 0.0065;

/** Format a bytes count compactly: <1 GiB → MB, <1024 GiB → GB, else TB. */
function fmtBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb < 0.01) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (gb < 1) return `${gb.toFixed(2)} GB`;
  if (gb < 1024) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}

/** Format a dollar amount with sensible precision: <$1 → 2 decimals,
 *  <$100 → 0 decimals, larger → rounded to nearest $10. */
function fmtUsd(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(0)}`;
  return `$${Math.round(usd / 10) * 10}`;
}

export const DpsCostBadge: React.FC<DpsCostBadgeProps> = ({
  stats,
  liveScannedBytes,
  lastRunMeta,
  loading,
  textColor,
  textSecColor,
}) => {
  // Mid-run: surface the live counter so the badge climbs as the assessment
  // progresses. Post-run: use the canonical totals from `stats`.
  const scannedBytes = stats?.scannedBytes ?? liveScannedBytes ?? 0;
  const gb = scannedBytes / (1024 ** 3);
  const usdHigh = gb * USD_PER_GB_HIGH;
  const usdLow = gb * USD_PER_GB_LOW;

  const savedBytes = lastRunMeta?.cachedBytesSaved ?? 0;
  const savedGB = savedBytes / (1024 ** 3);
  const savedUsdHigh = savedGB * USD_PER_GB_HIGH;
  const cacheHits = lastRunMeta?.cacheHits ?? 0;
  const cacheMisses = lastRunMeta?.cacheMisses ?? 0;
  const cacheTotal = cacheHits + cacheMisses;

  // Forward projection assumes the same per-run cost. If the cache is warm
  // (cacheHits == cacheTotal), subsequent runs in the same day cost ~$0; we
  // show the AVERAGE cost at typical cadences as a planning aid.
  const isFullyCached = cacheTotal > 0 && cacheHits === cacheTotal;
  // Per-run cost we'd pay if we ran NOW with a cold cache. Approximated by
  // adding back what the cache saved.
  const coldRunUsd = usdHigh + savedUsdHigh;
  // Amortised yearly cost at common cadences:
  //   weekly:  52 cold runs/year
  //   daily:   1 cold run/day + 2 warm runs ≈ 1 cold/3 = 122/year
  //   hourly:  1 cold/day + 23 warm ≈ 365/year (still 365 cold equivalents
  //            without persistent cache)
  const weeklyYear = coldRunUsd * 52;
  const dailyYear = coldRunUsd * 122; // assumes 24h cache absorbs ~67% of daily re-runs
  const dailyYearNoCache = coldRunUsd * 365;

  // Tooltip text — multi-line via newlines, Strato Text renders it as-is in
  // the title attribute.
  const tooltip = [
    `Current run scanned ${fmtBytes(scannedBytes)} of Grail data.`,
    `Cost estimate at standard DPS pricing: ${fmtUsd(usdLow)}–${fmtUsd(usdHigh)} per run.`,
    '',
    cacheTotal > 0
      ? `Cache: ${cacheHits}/${cacheTotal} queries served from the 24h Document Store cache.${savedBytes > 0 ? ` Saved ${fmtBytes(savedBytes)} (~${fmtUsd(savedUsdHigh)}) on this run.` : ''}`
      : 'Cache: not active on this run (first run of the day or force-refresh).',
    '',
    'Annual cost projection at this scale (assuming similar runs):',
    `  • Weekly:  ${fmtUsd(weeklyYear)} / year`,
    `  • Daily (with cache):  ${fmtUsd(dailyYear)} / year`,
    `  • Daily (without cache):  ${fmtUsd(dailyYearNoCache)} / year`,
    '',
    'Numbers are upper-bound estimates at $0.01/GiB. Your contract may be cheaper.',
  ].join('\n');

  // Loading state: we deliberately keep the badge visible so the operator
  // can watch the cost climb during a long xLarge run.
  const liveTag = loading && cacheTotal === 0 ? ' (running…)' : '';

  return (
    <Text
      style={{
        marginLeft: 8,
        fontSize: 12,
        color: textSecColor,
        cursor: 'help',
      }}
      title={tooltip}
    >
      · ≈ <Text style={{ fontWeight: 600, color: textColor }}>{fmtUsd(usdHigh)}</Text> DPS
      <Text style={{ color: textSecColor }}> · {fmtBytes(scannedBytes)} scanned</Text>
      {isFullyCached && (
        <Text style={{ marginLeft: 4, color: Colors.Text.Success.Default, fontWeight: 600 }}>
          · cache hit
        </Text>
      )}
      {!isFullyCached && savedBytes > 0 && (
        <Text style={{ marginLeft: 4, color: Colors.Text.Success.Default }}>
          {' '}· saved {fmtUsd(savedUsdHigh)}
        </Text>
      )}
      {liveTag && <Text style={{ marginLeft: 4 }}>{liveTag}</Text>}
    </Text>
  );
};
