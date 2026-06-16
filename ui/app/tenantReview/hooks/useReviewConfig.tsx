import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ReviewConfig, CheckThresholdConfig, CheckConfigKey, BetaFeaturesConfig } from "../types/config.types";
import { DEFAULT_CONFIG, DEFAULT_AREA_WEIGHTS } from "../types/config.types";
import { functions } from "@dynatrace-sdk/app-utils";

const LOCAL_STORAGE_KEY = "tenant-review-config";
const MODE_STORAGE_KEY = "tenant-review-config-mode";
const BETA_STORAGE_KEY = "tenant-review-beta-features";

/** Storage mode: "local" = browser only (default), "global" = Dynatrace App Settings (shared) */
export type ConfigMode = "local" | "global";

interface ReviewConfigContextValue {
  config: ReviewConfig;
  configMode: ConfigMode;
  updateCheck: (checkId: CheckConfigKey, updates: Partial<CheckThresholdConfig>) => void;
  updateAreaWeight: (areaId: string, weight: number) => void;
  updateBetaFeature: (key: keyof BetaFeaturesConfig, value: boolean) => void;
  setConfigMode: (mode: ConfigMode) => void;
  resetToDefaults: () => void;
  saveGlobal: () => Promise<{ success: boolean; error?: string }>;
  loadGlobal: () => Promise<void>;
  isDefault: boolean;
  isLoading: boolean;
  globalStatus: string;
}

const ReviewConfigContext = createContext<ReviewConfigContextValue>({
  config: DEFAULT_CONFIG,
  configMode: "local",
  updateCheck: () => { /* noop */ },
  updateAreaWeight: () => { /* noop */ },
  updateBetaFeature: () => { /* noop */ },
  setConfigMode: () => { /* noop */ },
  resetToDefaults: () => { /* noop */ },
  saveGlobal: async () => ({ success: false }),
  loadGlobal: async () => { /* noop */ },
  isDefault: true,
  isLoading: false,
  globalStatus: "",
});

/** Merge a partial config with defaults so new checks get default values */
function mergeWithDefaults(partial: Partial<ReviewConfig>): ReviewConfig {
  const merged: ReviewConfig = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof ReviewConfig)[]) {
    if (key === "areaWeights" || key === "betaFeatures") continue;
    if (partial[key] && typeof partial[key] === "object") {
      merged[key] = { ...(DEFAULT_CONFIG[key] as CheckThresholdConfig), ...(partial[key] as Partial<CheckThresholdConfig>) } as never;
    }
  }
  // betaFeatures is stored separately per-user — never merged from global config
  if (partial.areaWeights && typeof partial.areaWeights === "object") {
    merged.areaWeights = { ...DEFAULT_AREA_WEIGHTS };
    for (const [areaId, aw] of Object.entries(partial.areaWeights)) {
      if (aw && typeof aw.weight === "number") {
        merged.areaWeights[areaId] = { weight: aw.weight };
      }
    }
  }
  return merged;
}

function loadLocalConfig(): ReviewConfig {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    const base = stored ? mergeWithDefaults(JSON.parse(stored) as Partial<ReviewConfig>) : { ...DEFAULT_CONFIG };
    // Load beta features from separate per-user key
    base.betaFeatures = loadBetaFeatures();
    return base;
  } catch {
    return { ...DEFAULT_CONFIG, betaFeatures: loadBetaFeatures() };
  }
}

function saveLocalConfig(config: ReviewConfig): void {
  try {
    // Exclude betaFeatures from the main config (stored separately per-user)
    const { betaFeatures: _, ...rest } = config;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(rest));
  } catch { /* ignore */ }
}

function loadBetaFeatures(): BetaFeaturesConfig {
  try {
    const stored = localStorage.getItem(BETA_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_CONFIG.betaFeatures };
    return { ...DEFAULT_CONFIG.betaFeatures, ...(JSON.parse(stored) as Partial<BetaFeaturesConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG.betaFeatures };
  }
}

function saveBetaFeatures(beta: BetaFeaturesConfig): void {
  try {
    localStorage.setItem(BETA_STORAGE_KEY, JSON.stringify(beta));
  } catch { /* ignore */ }
}

function loadMode(): ConfigMode {
  try {
    const mode = localStorage.getItem(MODE_STORAGE_KEY);
    return mode === "global" ? "global" : "local";
  } catch {
    return "local";
  }
}

function saveMode(mode: ConfigMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

async function fetchGlobalConfig(): Promise<{ config: ReviewConfig | null; error?: string }> {
  try {
    const response = await functions.call("get-config");
    const result = (await response.json()) as { success: boolean; configJson: string; error?: string };
    if (result.success && result.configJson) {
      const parsed = JSON.parse(result.configJson) as Partial<ReviewConfig>;
      const merged = mergeWithDefaults(parsed);
      // Preserve per-user beta features — never overwrite from global
      merged.betaFeatures = loadBetaFeatures();
      return { config: merged };
    }
    return { config: null };
  } catch (err) {
    return { config: null, error: err instanceof Error ? err.message : "Failed to load global config" };
  }
}

async function saveGlobalConfig(config: ReviewConfig): Promise<{ success: boolean; error?: string }> {
  try {
    // Exclude betaFeatures from global config — it's per-user only
    const { betaFeatures: _, ...globalConfig } = config;
    const response = await functions.call("save-config", {
      data: { configJson: JSON.stringify(globalConfig) },
    });
    const result = (await response.json()) as { success: boolean; error?: string };
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to save global config" };
  }
}

export const ReviewConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<ReviewConfig>(loadLocalConfig);
  const [configMode, setConfigModeState] = useState<ConfigMode>(loadMode);
  const [isLoading, setIsLoading] = useState(false);
  const [globalStatus, setGlobalStatus] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG);

  // Auto-save to localStorage on every change (debounced)
  useEffect(() => {
    if (configMode === "local" && !isDefault) {
      saveLocalConfig(config);
    }
  }, [config, isDefault, configMode]);

  // Load global config on mount if mode is global
  useEffect(() => {
    if (configMode === "global") {
      setIsLoading(true);
      setGlobalStatus("Loading global configuration...");
      fetchGlobalConfig().then(({ config: globalCfg, error }) => {
        if (globalCfg) {
          setConfig(globalCfg);
          setGlobalStatus("Global configuration loaded");
        } else if (error) {
          setGlobalStatus(`Global load failed: ${error}. Using local config.`);
        } else {
          setGlobalStatus("No global configuration found. Using defaults.");
        }
        setIsLoading(false);
      }).catch(() => {
        setGlobalStatus("Global load failed. Using local config.");
        setIsLoading(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save to global when in global mode
  const debouncedGlobalSave = useCallback((newConfig: ReviewConfig) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setGlobalStatus("Saving...");
      saveGlobalConfig(newConfig).then((result) => {
        setGlobalStatus(result.success ? "Saved globally" : `Save failed: ${result.error ?? "unknown"}`);
      }).catch(() => {
        setGlobalStatus("Save failed");
      });
    }, 1500);
  }, []);

  const updateCheck = useCallback((checkId: CheckConfigKey, updates: Partial<CheckThresholdConfig>) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        [checkId]: { ...(prev[checkId] as CheckThresholdConfig), ...updates },
      };
      if (configMode === "global") {
        saveLocalConfig(next); // backup
        debouncedGlobalSave(next);
      }
      return next;
    });
  }, [configMode, debouncedGlobalSave]);

  const updateAreaWeight = useCallback((areaId: string, weight: number) => {
    setConfig((prev) => {
      const next = {
        ...prev,
        areaWeights: { ...prev.areaWeights, [areaId]: { weight } },
      };
      if (configMode === "global") {
        saveLocalConfig(next);
        debouncedGlobalSave(next);
      }
      return next;
    });
  }, [configMode, debouncedGlobalSave]);

  const updateBetaFeature = useCallback((key: keyof BetaFeaturesConfig, value: boolean) => {
    setConfig((prev) => {
      const newBeta = { ...prev.betaFeatures, [key]: value };
      saveBetaFeatures(newBeta);
      return { ...prev, betaFeatures: newBeta };
    });
  }, []);

  const setConfigMode = useCallback((mode: ConfigMode) => {
    setConfigModeState(mode);
    saveMode(mode);
    if (mode === "global") {
      // Load global config
      setIsLoading(true);
      setGlobalStatus("Loading global configuration...");
      fetchGlobalConfig().then(({ config: globalCfg, error }) => {
        if (globalCfg) {
          setConfig(globalCfg);
          setGlobalStatus("Global configuration loaded");
        } else if (error) {
          setGlobalStatus(`Global load failed: ${error}`);
        } else {
          setGlobalStatus("No global config yet. Current settings will be used.");
        }
        setIsLoading(false);
      }).catch(() => {
        setGlobalStatus("Global load failed");
        setIsLoading(false);
      });
    } else {
      setGlobalStatus("");
      // Switch back to local — load from localStorage
      setConfig(loadLocalConfig());
    }
  }, []);

  const saveGlobal = useCallback(async () => {
    setGlobalStatus("Saving globally...");
    const result = await saveGlobalConfig(config);
    setGlobalStatus(result.success ? "Saved globally" : `Save failed: ${result.error ?? "unknown"}`);
    return result;
  }, [config]);

  const loadGlobal = useCallback(async () => {
    setIsLoading(true);
    setGlobalStatus("Loading global configuration...");
    const { config: globalCfg, error } = await fetchGlobalConfig();
    if (globalCfg) {
      setConfig(globalCfg);
      setGlobalStatus("Global configuration loaded");
    } else {
      setGlobalStatus(error ? `Load failed: ${error}` : "No global configuration found");
    }
    setIsLoading(false);
  }, []);

  const resetToDefaults = useCallback(() => {
    // Preserve per-user beta features when resetting
    setConfig((prev) => ({ ...DEFAULT_CONFIG, betaFeatures: prev.betaFeatures }));
    setGlobalStatus("");
    try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch { /* ignore */ }
    if (configMode === "global") {
      debouncedGlobalSave(DEFAULT_CONFIG);
    }
  }, [configMode, debouncedGlobalSave]);

  return (
    <ReviewConfigContext.Provider value={{
      config, configMode, updateCheck, updateAreaWeight, updateBetaFeature, setConfigMode,
      resetToDefaults, saveGlobal, loadGlobal, isDefault, isLoading, globalStatus,
    }}>
      {children}
    </ReviewConfigContext.Provider>
  );
};

/** Hook to access the review configuration */
export function useReviewConfig(): ReviewConfigContextValue {
  return useContext(ReviewConfigContext);
}

/** Get the area weight from config, falling back to the default */
export function getAreaWeight(config: ReviewConfig, areaId: string): number {
  return config.areaWeights[areaId]?.weight ?? DEFAULT_AREA_WEIGHTS[areaId]?.weight ?? 0.5;
}

/** Helper: get severity for a Gen2 debt check */
export function getGen2Severity(
  count: number,
  checkConfig: CheckThresholdConfig
): "critical" | "warning" | "info" | "success" {
  if (!checkConfig.enabled) return "info";
  if (count === 0) return "success";
  if (count > checkConfig.criticalMax) return "critical";
  if (count > checkConfig.warningMax) return "warning";
  return "info";
}

/** Helper: get severity for a Gen3 adoption check */
export function getGen3Severity(
  count: number,
  checkConfig: CheckThresholdConfig
): "critical" | "warning" | "info" | "success" {
  if (!checkConfig.enabled) return "info";
  if (count >= checkConfig.criticalMax) return "success";
  if (count >= checkConfig.warningMax) return "info";
  return "warning";
}
