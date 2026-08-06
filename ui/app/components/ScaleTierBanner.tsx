// ui/app/components/ScaleTierBanner.tsx
//
// Visible disclosure that the assessment is running in a sampled tier.
//
// Why a banner ────────────────────────────────────────────────────────────
// The Scale Tier mechanism (see ../scale-tier.ts) narrows the time window
// and applies scanLimitGBytes safety nets on log/span/event/bizevent
// queries so the app remains runnable on tenants with thousands of hosts.
// In doing so, coverage values become *estimates* rather than ground truth.
// This banner makes that tradeoff visible to every viewer of the dashboard,
// PDF export and snapshot — there is no scenario where a user should see
// a sampled score and not know it.
//
// Behavior ────────────────────────────────────────────────────────────────
//   - Hidden entirely when tier === 'exact' (no behavior change for tenants
//     ≤ 5,000 hosts; presentation layer is bit-identical to v2.4.2).
//   - Yellow ish surface + Strato semantic color for "neutral / informational
//     warning". Does not block interaction.
//   - Optional override dropdown lets an operator force a specific tier
//     (e.g., switch to 'exact' on a 60k-host tenant to get ground-truth
//     numbers at the cost of wall-time).
//
// This component is purely presentational. It does not query Grail; it
// only renders what useScaleTier reports.

import React from 'react';
import { Flex, Surface } from '@dynatrace/strato-components/layouts';
import { Text, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { TIER_CONFIG, type ScaleTier } from '../scale-tier';
import type { UseScaleTierResult } from '../hooks/useScaleTier';

interface ScaleTierBannerProps {
  scale: UseScaleTierResult;
  /** Optional className passthrough for the host page layout. */
  className?: string;
}

const TIER_ORDER: ScaleTier[] = ['exact', 'large', 'xlarge'];

/** Cost mode runs at every tier, so its disclosure cannot live inside the
 *  tier banner (which hides itself on 'exact'). It is a single quiet line —
 *  the numbers are estimates and everyone reading a score should know it. */
export const CostModeNote: React.FC<{ className?: string }> = ({ className }) => (
  <Text
    className={className}
    textStyle="small"
    style={{ color: Colors.Text.Neutral.Subdued, display: 'block', marginBottom: 8 }}
  >
    Economy mode is on: ratio checks read a 1-in-1000 sample and breadth checks use a
    shorter window, so coverage values are close estimates rather than exact counts
    (measured: within ~1.5 points on ratios, ~6% lower on distinct counts). It cuts a
    full run from ~370 GB to ~41 GB of Grail scan — roughly US$ 3.70 down to US$ 0.40.
  </Text>
);

export const ScaleTierBanner: React.FC<ScaleTierBannerProps> = ({ scale, className }) => {
  // Default tier is invisible — the goal is zero presentation impact for the
  // common case (small/medium tenants). Above-threshold tenants get the disclosure.
  if (scale.tier === 'exact') return <CostModeNote className={className} />;

  const cfg = TIER_CONFIG[scale.tier];
  const isOverridden = scale.override !== null && scale.override !== scale.autoTier;
  const hostLabel =
    scale.hostCount != null && scale.hostCount > 0
      ? `${scale.hostCount.toLocaleString()} hosts detected`
      : 'host count unavailable';

  return (
    <Surface
      className={className}
      style={{
        // Strato's Background.Container.Warning gives the conventional yellow
        // tone for "informational, not blocking". A heavier border on the left
        // signals that this is a banner, not a regular card.
        background: Colors.Background.Container.Warning.Default,
        borderLeft: `4px solid ${Colors.Border.Warning.Accent}`,
        padding: 12,
        marginBottom: 16,
        width: '100%',
      }}
    >
      <Flex flexDirection="column" gap={6}>
        <Flex justifyContent="space-between" alignItems="center" gap={12} flexWrap="wrap">
          <Flex gap={8} alignItems="baseline">
            <Strong>Scale tier: {cfg.label}</Strong>
            <Text textStyle="small">
              {hostLabel}
              {isOverridden ? ' · manual override' : ' · auto-selected'}
            </Text>
          </Flex>
          <Flex gap={4}>
            {TIER_ORDER.map((t) => (
              <Button
                key={t}
                size="condensed"
                variant={t === scale.tier ? 'accent' : 'default'}
                onClick={() => scale.setOverride(t === scale.autoTier ? null : t)}
                aria-pressed={t === scale.tier}
                aria-label={`Switch to ${TIER_CONFIG[t].label} tier`}
              >
                {TIER_CONFIG[t].label}
              </Button>
            ))}
          </Flex>
        </Flex>
        <Text textStyle="small">{cfg.description}</Text>
        <CostModeNote />
      </Flex>
    </Surface>
  );
};
