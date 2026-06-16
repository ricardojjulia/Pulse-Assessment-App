/**
 * Read global app configuration from Dynatrace App Settings.
 * Returns the JSON-encoded ReviewConfig string and metadata.
 */
import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings";

const SETTINGS_SCHEMA_ID = "config";

interface GetConfigResult {
  success: boolean;
  configJson: string;
  version: string | null;
  objectId: string | null;
  error?: string;
}

export default async function (): Promise<GetConfigResult> {
  try {
    const objects = await appSettingsObjectsClient.getAppSettingsObjects({
      schemaIds: SETTINGS_SCHEMA_ID,
      addFields: "value",
    });

    if (objects.items && objects.items.length > 0) {
      const configData = objects.items[0].value as Record<string, unknown>;
      const configJson = typeof configData?.configJson === "string" ? configData.configJson : "";
      return {
        success: true,
        configJson,
        version: objects.items[0].version ?? null,
        objectId: objects.items[0].objectId ?? null,
      };
    }

    return { success: true, configJson: "", version: null, objectId: null };
  } catch (error) {
    return {
      success: false,
      configJson: "",
      version: null,
      objectId: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
