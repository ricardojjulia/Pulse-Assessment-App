import { accessTokensApiTokensClient } from "@dynatrace-sdk/client-classic-environment-v2";

interface TokenInfo {
  id: string;
  name: string;
  enabled: boolean;
  creationDate: string;
  lastUsedDate?: string;
  scopes: string[];
}

interface TokensResult {
  totalCount: number;
  enabledCount: number;
  tokens: TokenInfo[];
}

export default async function (): Promise<TokensResult> {
  const response = await accessTokensApiTokensClient.listApiTokens({
    pageSize: 500,
    fields: "+enabled,+creationDate,+lastUsedDate,+scopes",
  });

  const tokens: TokenInfo[] = (response.apiTokens ?? []).map((t) => ({
    id: t.id ?? "",
    name: t.name ?? "unnamed",
    enabled: t.enabled ?? false,
    creationDate: t.creationDate ?? "",
    lastUsedDate: t.lastUsedDate,
    scopes: t.scopes ?? [],
  }));

  return {
    totalCount: tokens.length,
    enabledCount: tokens.filter((t) => t.enabled).length,
    tokens,
  };
}
