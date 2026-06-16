import { functions } from "@dynatrace-sdk/app-utils";

export interface ExtensionInfo {
  extensionName: string;
  version: string;
}

interface ExtensionsResult {
  extensions: ExtensionInfo[];
  totalCount: number;
}

/** List all installed Extensions 2.0 via app function. Returns null on access error. */
export async function listExtensions(): Promise<ExtensionInfo[] | null> {
  try {
    const response = await functions.call("extensions");
    const result: ExtensionsResult = await response.json();
    return result.extensions;
  } catch {
    return null;
  }
}

/** Get the count of Extensions 2.0 via app function. Returns null on access error. */
export async function getExtensionCount(): Promise<number | null> {
  try {
    const response = await functions.call("extensions");
    const result: ExtensionsResult = await response.json();
    return result.totalCount;
  } catch {
    return null;
  }
}
