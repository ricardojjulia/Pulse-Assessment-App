/**
 * Save global app configuration to Dynatrace App Settings.
 * Creates or updates the single config object with optimistic locking.
 */
import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings";

const SETTINGS_SCHEMA_ID = "config";

interface SavePayload {
  configJson: string;
}

interface SaveConfigResult {
  success: boolean;
  error?: string;
}

export default async function (payload: { data?: SavePayload } & SavePayload): Promise<SaveConfigResult> {
  try {
    const actualPayload = payload.data ?? payload;
    const configJson = actualPayload.configJson;

    if (typeof configJson !== "string") {
      return { success: false, error: "configJson must be a string" };
    }

    // Check if settings object already exists
    const existing = await appSettingsObjectsClient.getAppSettingsObjects({
      schemaIds: SETTINGS_SCHEMA_ID,
    });

    if (existing.items && existing.items.length > 0) {
      // UPDATE existing object
      await appSettingsObjectsClient.putAppSettingsObjectByObjectId({
        objectId: existing.items[0].objectId,
        optimisticLockingVersion: existing.items[0].version,
        body: { value: { configJson } },
      });
    } else {
      // CREATE new object
      await appSettingsObjectsClient.postAppSettingsObject({
        body: {
          schemaId: SETTINGS_SCHEMA_ID,
          value: { configJson },
        },
      });
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
