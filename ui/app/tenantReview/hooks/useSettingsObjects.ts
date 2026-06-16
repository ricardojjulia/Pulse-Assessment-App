import { useEnvironmentApi } from "./useEnvironmentApi";
import { getSettingsObjectCounts } from "../services/settingsService";

/**
 * Hook to fetch settings object counts for multiple schema IDs.
 * Returns a Map<schemaId, count>.
 */
export function useSettingsObjectCounts(schemaIds: string[]) {
  return useEnvironmentApi(() => getSettingsObjectCounts(schemaIds));
}
