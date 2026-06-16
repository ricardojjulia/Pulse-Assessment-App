import { functions } from "@dynatrace-sdk/app-utils";
import { getCached, setCache } from "../utils/cache";

export interface TokenSummary {
  totalCount: number;
  enabledCount: number;
  tokens: TokenInfo[];
}

export interface TokenInfo {
  id: string;
  name: string;
  enabled: boolean;
  creationDate: string;
  lastUsedDate?: string;
  scopes: string[];
}

/** List all API tokens with basic metadata. Cached for 5 minutes. */
export async function getTokenSummary(): Promise<TokenSummary | null> {
  const cacheKey = "tokens:summary";
  const cached = getCached<TokenSummary>(cacheKey);
  if (cached) return cached;

  try {
    const response = await functions.call("tokens");
    const data = (await response.json()) as TokenSummary;
    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}
