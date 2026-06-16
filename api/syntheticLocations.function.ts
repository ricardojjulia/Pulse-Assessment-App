import { syntheticLocationsNodesAndConfigurationClient } from "@dynatrace-sdk/client-classic-environment-v2";

export default async function () {
  try {
    const response = await syntheticLocationsNodesAndConfigurationClient.getLocations();
    const locations = (response.locations ?? []).map((l) => ({
      entityId: l.entityId ?? "unknown",
      name: l.name ?? "unknown",
      type: l.type ?? "unknown",
    }));
    const publicCount = locations.filter((l) => l.type === "PUBLIC").length;
    const privateCount = locations.filter((l) => l.type === "PRIVATE").length;
    return { locations, total: locations.length, publicCount, privateCount };
  } catch {
    return { locations: [], total: -1, publicCount: 0, privateCount: 0 };
  }
}
