import { extensions_2_0Client } from "@dynatrace-sdk/client-classic-environment-v2";

interface ExtensionInfo {
  extensionName: string;
  version: string;
}

interface ExtensionsResult {
  extensions: ExtensionInfo[];
  totalCount: number;
}

export default async function (): Promise<ExtensionsResult> {
  const response = await extensions_2_0Client.listExtensions({ pageSize: 100 });
  const extensions = (response.extensions ?? []).map((ext) => ({
    extensionName: ext.extensionName ?? "unknown",
    version: ext.version ?? "unknown",
  }));
  return { extensions, totalCount: response.totalCount ?? extensions.length };
}
