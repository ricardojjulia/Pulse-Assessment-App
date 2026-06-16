import { networkZonesClient } from "@dynatrace-sdk/client-classic-environment-v2";

export default async function () {
  try {
    const response = await networkZonesClient.getAllNetworkZones();
    const zones = (response.networkZones ?? []).map((z) => ({
      id: z.id ?? "unknown",
      numOfOneAgents: z.numOfConfiguredOneAgents ?? 0,
      numOfConfiguredActiveGates: z.numOfConfiguredActiveGates ?? 0,
    }));
    return { zones, total: zones.length };
  } catch {
    return { zones: [], total: -1 };
  }
}
