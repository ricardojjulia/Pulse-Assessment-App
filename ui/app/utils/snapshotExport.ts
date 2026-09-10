export interface PortableSnapshot {
  schemaVersion: 1;
  tenant: string;
  timestamp: number;
  capabilities: Array<{ name: string; score: number; utilizationScore: number }>;
}

/**
 * Download the current assessment as a portable JSON file.
 * Accepts either AssessmentSnapshot capabilities (with top-level utilizationScore)
 * or any object with name/score/utilizationScore fields.
 */
export function exportSnapshot(
  capabilities: Array<{ name: string; score: number; utilizationScore?: number }>,
  tenant: string,
): void {
  const data: PortableSnapshot = {
    schemaVersion: 1,
    tenant,
    timestamp: Date.now(),
    capabilities: capabilities.map(c => ({
      name: c.name,
      score: c.score,
      utilizationScore: c.utilizationScore ?? 0,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pulse-snapshot-${tenant}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse and validate an imported JSON file into a PortableSnapshot. */
export function importSnapshot(file: File): Promise<PortableSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = e.target!.result as string;
        const data = JSON.parse(raw);
        if (data.schemaVersion !== 1 || !Array.isArray(data.capabilities)) {
          reject(new Error("Invalid snapshot format"));
          return;
        }
        resolve(data as PortableSnapshot);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsText(file);
  });
}
