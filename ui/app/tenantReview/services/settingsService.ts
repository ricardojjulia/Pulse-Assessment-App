import { functions } from "@dynatrace-sdk/app-utils";
import { getCached, setCache } from "../utils/cache";

export interface SettingsObjectSummary {
  schemaId: string;
  objectCount: number;
}

interface SettingsCountResult {
  action: "counts";
  counts: Record<string, number | null>;
}

interface SettingsSchemasResult {
  action: "listSchemas";
  schemas: string[];
}

/** Get the count of settings objects for a given schema ID via app function. Returns null on access error. */
export async function getSettingsObjectCount(
  schemaId: string
): Promise<number | null> {
  try {
    const response = await functions.call("settingsObjects", {
      data: { action: "counts", schemaIds: [schemaId] },
    });
    const result: SettingsCountResult = await response.json();
    return result.counts[schemaId] ?? null;
  } catch {
    return null;
  }
}

/** Get counts for multiple schema IDs via app function. Cached for 5 minutes. */
export async function getSettingsObjectCounts(
  schemaIds: string[]
): Promise<Map<string, number | null>> {
  const cacheKey = `settings:counts:${schemaIds.sort().join(",")}`;
  const cached = getCached<Record<string, number | null>>(cacheKey);
  if (cached) {
    return new Map(Object.entries(cached));
  }

  const map = new Map<string, number | null>();
  try {
    const response = await functions.call("settingsObjects", {
      data: { action: "counts", schemaIds },
    });
    const result: SettingsCountResult = await response.json();
    for (const [id, count] of Object.entries(result.counts)) {
      map.set(id, count);
    }
    setCache(cacheKey, result.counts);
  } catch {
    for (const id of schemaIds) {
      map.set(id, null);
    }
  }
  return map;
}

/** Enabled/disabled breakdown for a schema */
export interface EnabledCounts {
  total: number;
  enabled: number;
  disabled: number;
}

/** Get enabled/disabled counts for multiple schema IDs. Cached for 5 minutes. */
export async function getSettingsEnabledCounts(
  schemaIds: string[]
): Promise<Map<string, EnabledCounts | null>> {
  const cacheKey = `settings:enabled:${schemaIds.sort().join(",")}`;
  const cached = getCached<Record<string, EnabledCounts | null>>(cacheKey);
  if (cached) {
    return new Map(Object.entries(cached));
  }

  const map = new Map<string, EnabledCounts | null>();
  try {
    const response = await functions.call("settingsObjects", {
      data: { action: "enabledCounts", schemaIds },
    });
    const result = (await response.json()) as {
      action: "enabledCounts";
      counts: Record<string, { total: number; enabled: number; disabled: number } | null>;
    };
    for (const [id, counts] of Object.entries(result.counts)) {
      map.set(id, counts);
    }
    setCache(cacheKey, Object.fromEntries(map));
  } catch {
    for (const id of schemaIds) {
      map.set(id, null);
    }
  }
  return map;
}

/** List all available Settings 2.0 schemas. Cached for 5 minutes. */
export async function listSettingsSchemas(): Promise<string[] | null> {
  const cacheKey = "settings:schemas";
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await functions.call("settingsObjects", {
      data: { action: "listSchemas" },
    });
    const result: SettingsSchemasResult = await response.json();
    setCache(cacheKey, result.schemas);
    return result.schemas;
  } catch {
    return null;
  }
}
