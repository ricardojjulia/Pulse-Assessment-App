import { useState, useCallback, useEffect, useRef } from "react";
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { CapabilityResult } from "./useCoverageData";

export interface AssessmentSnapshot {
  id: string;
  timestamp: string;
  totalScore: number;
  tenant: string;
  capabilities: {
    name: string;
    color: string;
    score: number;
    /** Consolidation factor (0–100). Defaults to 100 if absent (backwards compat). */
    consolidation?: number;
    /** Weighted utilization score (0–100). Optional for backward compatibility
     *  with snapshots saved before T4 was shipped; callers should use `|| 0`. */
    utilizationScore?: number;
    criteriaResults: {
      id: string;
      label: string;
      value: number;
      points: number;
      error: boolean;
    }[];
  }[];
}

const STORAGE_KEY = "ppa-assessment-history";
const DOC_TYPE = "ppa-snapshot";

/* ── localStorage cache helpers ── */

function loadLocal(): AssessmentSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistLocal(snapshots: AssessmentSnapshot[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch { /* quota exceeded */ }
}

/* ── Document Store helpers ── */

async function loadFromDocStore(): Promise<{ snapshots: AssessmentSnapshot[], remoteDocIds: Set<string> }> {
  const remoteDocIds = new Set<string>();
  try {
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE}'`,
      sort: "-name",
      pageSize: 200,
    });
    for (const doc of list.documents) remoteDocIds.add(doc.id);
    const snaps: AssessmentSnapshot[] = [];
    for (const doc of list.documents) {
      try {
        const content = await documentsClient.downloadDocumentContent({ id: doc.id });
        const text = await content.get("text");
        snaps.push(JSON.parse(text));
      } catch { /* skip corrupt documents */ }
    }
    snaps.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { snapshots: snaps, remoteDocIds };
  } catch (err) {
    console.warn("[CCA] Document Store load failed, using localStorage:", err);
    return { snapshots: [], remoteDocIds };
  }
}

async function saveToDocStore(snap: AssessmentSnapshot, knownIds?: Set<string>): Promise<void> {
  const docId = `cca-${snap.id}`;
  // Skip if we already know this document exists remotely
  if (knownIds?.has(docId)) return;
  try {
    await documentsClient.createDocument({
      body: {
        name: `cca-${snap.timestamp}`,
        type: DOC_TYPE,
        content: new Blob([JSON.stringify(snap)], { type: "application/json" }),
        id: docId,
      },
    });
    knownIds?.add(docId);
  } catch (err: any) {
    // 409 = document already exists — safe to ignore (duplicate save)
    const code = err?.response?.status ?? err?.code ?? err?.error?.code ?? err?.body?.error?.code;
    const msg = typeof err?.message === "string" ? err.message : "";
    if (code === 409 || msg.includes("already exists") || msg.includes("AlreadyExists")) {
      knownIds?.add(docId);
      return;
    }
    console.warn("[CCA] Document Store save failed:", err);
  }
}

/* ── Retention policy: one snapshot per day in Grail, keep 15 days ── */

const RETENTION_DAYS = 15;

/**
 * Determines which snapshot IDs should be removed from Grail.
 * Rule: keep only the latest snapshot per calendar day, drop anything older than RETENTION_DAYS.
 * Returns ALL snapshots (not pruned) so the UI can still compare same-day runs,
 * but reports which IDs should be deleted from remote storage.
 */
function applyRetention(snapshots: AssessmentSnapshot[]): {
  keep: AssessmentSnapshot[];
  removeIds: string[];
} {
  const sorted = [...snapshots].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Identify duplicates per calendar day (only the LATEST per day survives in Grail)
  const bestPerDay = new Map<string, string>(); // day → snapshot id (latest)
  const duplicateIds: string[] = [];
  for (const s of sorted) {
    const day = s.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!bestPerDay.has(day)) {
      bestPerDay.set(day, s.id);
    } else {
      duplicateIds.push(s.id); // older same-day snapshot — remove from Grail
    }
  }

  // Identify expired snapshots (older than RETENTION_DAYS)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  const expiredIds: string[] = [];
  const keep: AssessmentSnapshot[] = [];
  for (const s of sorted) {
    if (new Date(s.timestamp) >= cutoff) {
      keep.push(s); // keep ALL non-expired snapshots in the UI (even same-day)
    } else {
      expiredIds.push(s.id);
    }
  }

  return { keep, removeIds: [...duplicateIds, ...expiredIds] };
}

async function deleteSnapshotsFromDocStore(ids: string[], remoteIds?: Set<string>): Promise<void> {
  if (ids.length === 0) return;
  // Only attempt to delete IDs that we know exist remotely
  const remoteOnly = remoteIds
    ? ids.filter((id) => remoteIds.has(`cca-${id}`))
    : ids;
  if (remoteOnly.length === 0) return;
  try {
    const toDelete = new Set(remoteOnly.map((id) => `cca-${id}`));
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE}'`,
      pageSize: 200,
    });
    let cleaned = 0;
    for (const doc of list.documents) {
      if (toDelete.has(doc.id)) {
        try {
          await documentsClient.deleteDocument({ id: doc.id, optimisticLockingVersion: doc.version });
          remoteIds?.delete(doc.id);
          cleaned++;
        } catch { /* 404/409 — safe to ignore */ }
      }
    }
    if (cleaned > 0) console.log(`[CCA] Retention: removed ${cleaned} old snapshots from Grail`);
  } catch { /* best-effort */ }
}

/* ── Hook ── */

/**
 * @param enabled  When false (the default), the Document Store fetch is
 *                 skipped entirely — only localStorage is loaded.  Pass
 *                 `true` when the caller actually needs the full remote
 *                 history (e.g., on the /compare route) to avoid an
 *                 unnecessary Grail round-trip on every page load (T5).
 */
export function useAssessmentHistory(enabled: boolean = false) {
  const [snapshots, setSnapshots] = useState<AssessmentSnapshot[]>(loadLocal);
  const syncedRef = useRef(false);
  const remoteIdsRef = useRef(new Set<string>());

  // Load from Document Store when enabled, then merge with localStorage (T5).
  // The syncedRef guard prevents repeated fetches if the caller toggles
  // enabled on/off or the component re-renders with the same value.
  useEffect(() => {
    if (!enabled) return;
    if (syncedRef.current) return;
    syncedRef.current = true;
    loadFromDocStore().then(({ snapshots: remote, remoteDocIds }) => {
      remoteIdsRef.current = remoteDocIds;
      if (remote.length === 0) return; // no remote data or error — keep local
      // Merge: deduplicate by id, prefer remote
      const merged = new Map<string, AssessmentSnapshot>();
      for (const s of remote) merged.set(s.id, s);
      // Add local-only snapshots to the merged set (no remote upload — they'll be saved on next assessment)
      const local = loadLocal();
      for (const s of local) {
        if (!merged.has(s.id)) merged.set(s.id, s);
      }
      const all = [...merged.values()]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      // Apply smart retention
      const { keep, removeIds } = applyRetention(all);
      setSnapshots(keep);
      persistLocal(keep);
      if (removeIds.length > 0) deleteSnapshotsFromDocStore(removeIds, remoteIdsRef.current);
    });
  }, [enabled]);

  const saveSnapshot = useCallback((capabilities: CapabilityResult[], totalScore: number, tenant: string) => {
    const snap: AssessmentSnapshot = {
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      totalScore,
      tenant,
      capabilities: capabilities.map((c) => ({
        name: c.name,
        color: c.color,
        score: c.rawScore,
        ...(c.consolidation < 100 ? { consolidation: c.consolidation } : {}),
        utilizationScore: c.utilization.utilizationScore ?? 0,
        criteriaResults: c.criteriaResults.map((cr) => ({
          id: cr.id,
          label: cr.label,
          value: cr.value,
          points: cr.points,
          error: cr.error,
        })),
      })),
    };
    setSnapshots((prev) => {
      const all = [snap, ...prev];
      const { keep, removeIds } = applyRetention(all);
      persistLocal(keep);
      // Schedule deletion outside of state updater to avoid side effects during render
      if (removeIds.length > 0) {
        Promise.resolve().then(() => deleteSnapshotsFromDocStore(removeIds, remoteIdsRef.current));
      }
      return keep;
    });
    // Save to Document Store (fire-and-forget)
    saveToDocStore(snap, remoteIdsRef.current);
  }, []);

  const clearHistory = useCallback(() => {
    setSnapshots([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { snapshots, saveSnapshot, clearHistory };
}
