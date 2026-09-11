import { useState, useCallback, useEffect, useRef } from "react";
import { documentsClient } from "@dynatrace-sdk/client-document";
import type { ObsGrade } from "./types";

export interface ObsEvalSnapshot {
  id: string;
  timestamp: string;
  tenant: string;
  overallScore: number;
  overallGrade: ObsGrade;
  segmentId?: string;
  domains: Array<{ id: string; name: string; score: number; grade: ObsGrade }>;
}

const LS_KEY = "atlas-obs-eval-history";
const DOC_TYPE = "atlas-obs-eval";
const MAX_SNAPSHOTS = 20;

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadLocal(): ObsEvalSnapshot[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistLocal(snaps: ObsEvalSnapshot[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snaps));
  } catch { /* quota */ }
}

// ── Document Store helpers ────────────────────────────────────────────────────

async function loadFromDocStore(): Promise<{ snapshots: ObsEvalSnapshot[]; remoteIds: Set<string> }> {
  const remoteIds = new Set<string>();
  try {
    const list = await documentsClient.listDocuments({
      filter: `type == '${DOC_TYPE}'`,
      sort: "-name",
      pageSize: MAX_SNAPSHOTS,
    });
    for (const doc of list.documents) remoteIds.add(doc.id);
    const snaps: ObsEvalSnapshot[] = [];
    for (const doc of list.documents) {
      try {
        const content = await documentsClient.downloadDocumentContent({ id: doc.id });
        const text = await content.get("text");
        snaps.push(JSON.parse(text) as ObsEvalSnapshot);
      } catch { /* skip corrupt */ }
    }
    snaps.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { snapshots: snaps, remoteIds };
  } catch {
    return { snapshots: [], remoteIds };
  }
}

async function saveToDocStore(snap: ObsEvalSnapshot, knownIds: Set<string>): Promise<void> {
  const docId = `obs-eval-${snap.id}`;
  if (knownIds.has(docId)) return;
  try {
    await documentsClient.createDocument({
      body: {
        name: `obs-eval-${snap.timestamp}`,
        type: DOC_TYPE,
        content: new Blob([JSON.stringify(snap)], { type: "application/json" }),
        id: docId,
      },
    });
    knownIds.add(docId);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const msg = (err instanceof Error) ? err.message : "";
    if (status === 409 || msg.includes("already exists") || msg.includes("AlreadyExists")) {
      knownIds.add(docId);
      return;
    }
    console.warn("[ObsEval] Doc Store save failed:", err);
  }
}

async function pruneDocStore(toRemove: string[], remoteIds: Set<string>): Promise<void> {
  if (toRemove.length === 0) return;
  try {
    const list = await documentsClient.listDocuments({ filter: `type == '${DOC_TYPE}'`, pageSize: 200 });
    const targets = new Set(toRemove.map(id => `obs-eval-${id}`));
    for (const doc of list.documents) {
      if (targets.has(doc.id)) {
        try {
          await documentsClient.deleteDocument({ id: doc.id, optimisticLockingVersion: doc.version });
          remoteIds.delete(doc.id);
        } catch { /* 404/409 — safe */ }
      }
    }
  } catch { /* best-effort */ }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useObsEvalHistory() {
  const [snapshots, setSnapshots] = useState<ObsEvalSnapshot[]>(loadLocal);
  const syncedRef = useRef(false);
  const remoteIdsRef = useRef(new Set<string>());

  // Load from Doc Store once on mount
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    loadFromDocStore().then(({ snapshots: remote, remoteIds }) => {
      remoteIdsRef.current = remoteIds;
      if (remote.length === 0) return;
      const merged = new Map<string, ObsEvalSnapshot>();
      for (const s of remote) merged.set(s.id, s);
      for (const s of loadLocal()) {
        if (!merged.has(s.id)) merged.set(s.id, s);
      }
      const all = [...merged.values()]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_SNAPSHOTS);
      setSnapshots(all);
      persistLocal(all);
    });
  }, []);

  const saveSnapshot = useCallback((snap: Omit<ObsEvalSnapshot, "id" | "timestamp">) => {
    const full: ObsEvalSnapshot = {
      ...snap,
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
    };
    setSnapshots(prev => {
      const all = [full, ...prev].slice(0, MAX_SNAPSHOTS);
      // Prune oldest beyond limit from remote
      const toRemove = prev.slice(MAX_SNAPSHOTS - 1).map(s => s.id);
      persistLocal(all);
      if (toRemove.length > 0) {
        Promise.resolve().then(() => pruneDocStore(toRemove, remoteIdsRef.current));
      }
      return all;
    });
    saveToDocStore(full, remoteIdsRef.current);
  }, []);

  return { snapshots, saveSnapshot };
}
