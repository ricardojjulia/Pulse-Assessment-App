// ui/app/components/TraceProxyBanner.tsx
//
// Visible disclosure that the assessment ran in Trace Proxy Mode — the
// tenant does not have the Traces on Grail entitlement, so span-based
// checks were either proxied from service metrics/topology or excluded.
//
// Same design contract as ScaleTierBanner: there is no scenario where a
// user should see proxied scores and not know it. Purely presentational.

import React from 'react';
import { Flex, Surface } from '@dynatrace/strato-components/layouts';
import { Text, Strong } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import type { TraceProxyInfo } from '../trace-proxy';

interface TraceProxyBannerProps {
  /** Null when Trace Proxy Mode is off — banner renders nothing. */
  info: TraceProxyInfo | null;
  className?: string;
}

export const TraceProxyBanner: React.FC<TraceProxyBannerProps> = ({ info, className }) => {
  if (!info) return null;

  const excludedTotal = info.excludedIds.length;
  const capsNote = info.excludedCapabilities.length > 0
    ? ` ${info.excludedCapabilities.join(', ')} ${info.excludedCapabilities.length > 1 ? 'were' : 'was'} excluded entirely — it requires Traces on Grail.`
    : '';

  return (
    <Surface
      className={className}
      style={{
        background: Colors.Background.Container.Warning.Default,
        borderLeft: `4px solid ${Colors.Border.Warning.Accent}`,
        padding: 12,
        marginBottom: 16,
        width: '100%',
      }}
    >
      <Flex flexDirection="column" gap={6}>
        <Flex gap={8} alignItems="baseline" flexWrap="wrap">
          <Strong>Trace Proxy Mode</Strong>
          <Text textStyle="small">Traces on Grail is not enabled on this environment</Text>
        </Flex>
        <Text textStyle="small">
          {info.proxiedIds.length} span-based checks were measured through service metrics and
          topology instead (marked “≈ proxy”); {excludedTotal} checks have no honest equivalent and
          were removed from scoring — they do not count against this environment.{capsNote}
        </Text>
      </Flex>
    </Surface>
  );
};
