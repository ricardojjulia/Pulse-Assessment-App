import {
  settingsObjectsClient,
  settingsSchemasClient,
} from "@dynatrace-sdk/client-classic-environment-v2";

interface SettingsRequest {
  action: "counts" | "enabledCounts" | "listSchemas";
  schemaIds?: string[];
}

interface SettingsCountResult {
  action: "counts";
  counts: Record<string, number | null>;
}

interface SettingsEnabledCountResult {
  action: "enabledCounts";
  counts: Record<string, { total: number; enabled: number; disabled: number } | null>;
}

interface SettingsSchemasResult {
  action: "listSchemas";
  schemas: string[];
}

type SettingsResult = SettingsCountResult | SettingsEnabledCountResult | SettingsSchemasResult;

/**
 * Get total object count for a schema.
 * Uses pageSize: 1 intentionally — we only need the totalCount from the
 * response metadata, not the actual objects. No pagination is needed.
 */
async function getCount(schemaId: string): Promise<number | null> {
  try {
    const response = await settingsObjectsClient.getSettingsObjects({
      schemaIds: schemaId,
      pageSize: 1,
    });
    return response.totalCount ?? 0;
  } catch {
    return null;
  }
}

/**
 * Get total, enabled, and disabled counts for a schema.
 * Tries filtering on value.enabled; if the schema doesn't have that field,
 * falls back to total count with enabled = total (assumes all active).
 */
async function getEnabledCount(schemaId: string): Promise<{ total: number; enabled: number; disabled: number } | null> {
  try {
    // Get total count
    const totalResponse = await settingsObjectsClient.getSettingsObjects({
      schemaIds: schemaId,
      pageSize: 1,
    });
    const total = totalResponse.totalCount ?? 0;

    if (total === 0) {
      return { total: 0, enabled: 0, disabled: 0 };
    }

    // Try to get enabled count by filtering on value.enabled
    try {
      const enabledResponse = await settingsObjectsClient.getSettingsObjects({
        schemaIds: schemaId,
        pageSize: 1,
        fields: "objectId,value",
        filter: "value.enabled = true",
      });
      const enabledCount = enabledResponse.totalCount ?? 0;
      return { total, enabled: enabledCount, disabled: total - enabledCount };
    } catch {
      // Schema doesn't support value.enabled filter — assume all are active
      return { total, enabled: total, disabled: 0 };
    }
  } catch {
    return null;
  }
}

export default async function (payload: SettingsRequest): Promise<SettingsResult> {
  if (payload.action === "listSchemas") {
    const response = await settingsSchemasClient.getAvailableSchemaDefinitions();
    const schemas = (response.items ?? [])
      .map((s) => s.schemaId)
      .filter(Boolean) as string[];
    return { action: "listSchemas", schemas };
  }

  if (payload.action === "enabledCounts") {
    const schemaIds = payload.schemaIds ?? [];
    const results = await Promise.allSettled(
      schemaIds.map(async (id) => ({ schemaId: id, counts: await getEnabledCount(id) }))
    );

    const counts: Record<string, { total: number; enabled: number; disabled: number } | null> = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        counts[result.value.schemaId] = result.value.counts;
      }
    }

    return { action: "enabledCounts", counts };
  }

  // Default: counts
  const schemaIds = payload.schemaIds ?? [];
  const results = await Promise.allSettled(
    schemaIds.map(async (id) => ({ schemaId: id, count: await getCount(id) }))
  );

  const counts: Record<string, number | null> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      counts[result.value.schemaId] = result.value.count;
    }
  }

  return { action: "counts", counts };
}
