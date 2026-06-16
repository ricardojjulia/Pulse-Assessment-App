/**
 * Fetch all ActiveGates via the Environment API v2 SDK.
 * Returns count, containerized/standalone breakdown, and details.
 */
import { activeGatesClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface ActiveGateSummary {
  id: string;
  hostname: string;
  group: string;
  networkZone: string;
  version: string;
  type: string;
  containerized: boolean;
  osType: string;
  online: boolean;
  autoUpdateStatus: string;
  connectedHosts: number;
}

interface ActiveGateResult {
  total: number;
  containerized: number;
  standalone: number;
  online: number;
  offline: number;
  activeGates: ActiveGateSummary[];
  error?: string;
}

export default async function (): Promise<ActiveGateResult> {
  try {
    const response = await activeGatesClient.getAllActiveGates();
    const ags = response.activeGates ?? [];

    const summaries: ActiveGateSummary[] = ags.map((ag) => ({
      id: ag.id ?? "unknown",
      hostname: ag.hostname ?? "unknown",
      group: ag.group ?? "",
      networkZone: ag.networkZone ?? "default",
      version: ag.version ?? "unknown",
      type: ag.type ?? "unknown",
      containerized: ag.containerized ?? false,
      osType: ag.osType ?? "unknown",
      online: ag.offlineSince == null,
      autoUpdateStatus: ag.autoUpdateStatus ?? "unknown",
      connectedHosts: ag.connectedHosts?.number ?? 0,
    }));

    const containerized = summaries.filter((a) => a.containerized).length;
    const online = summaries.filter((a) => a.online).length;

    return {
      total: summaries.length,
      containerized,
      standalone: summaries.length - containerized,
      online,
      offline: summaries.length - online,
      activeGates: summaries,
    };
  } catch (err) {
    return {
      total: 0, containerized: 0, standalone: 0, online: 0, offline: 0,
      activeGates: [],
      error: err instanceof Error ? err.message : "Failed to query ActiveGates",
    };
  }
}
