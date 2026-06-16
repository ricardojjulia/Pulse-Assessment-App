import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-classic-environment-v2";

export default async function () {
  try {
    const response = await serviceLevelObjectivesClient.getSlo({ pageSize: 100 });
    const slos = (response.slo ?? []).map((s) => ({
      id: s.id ?? "unknown",
      name: s.name ?? "unknown",
      enabled: s.enabled ?? false,
      status: s.status ?? "unknown",
      evaluationType: s.evaluationType ?? "unknown",
    }));
    const enabled = slos.filter((s) => s.enabled).length;
    return { slos, total: slos.length, enabled, disabled: slos.length - enabled };
  } catch {
    return { slos: [], total: -1, enabled: 0, disabled: 0 };
  }
}
