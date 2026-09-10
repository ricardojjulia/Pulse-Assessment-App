import { useEffect, useState } from "react";
import { filterSegmentsClient } from "@dynatrace-sdk/client-filter-segment-management";

export interface SegmentItem {
  id: string;
  name: string;
}

export interface UseSegmentsResult {
  segments: SegmentItem[];
  loading: boolean;
  error: unknown;
}

/**
 * Fetches available Filter Segments from the platform.
 *
 * Uses the `storage:filter-segments:read` scope (declared in app.config.json).
 * Only includes segments where the current user has READ permission.
 *
 * Returns an empty list (not an error) when no segments exist — the dropdown
 * in AssessmentIdle only renders when segments.length > 0.
 */
export function useSegments(): UseSegmentsResult {
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    filterSegmentsClient
      .getLeanFilterSegments()
      .then((result) => {
        if (cancelled) return;
        const readable = result.filterSegments
          .filter((s) => s.allowedOperations?.includes("READ"))
          .map((s) => ({ id: s.uid, name: s.name }));
        setSegments(readable);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { segments, loading, error };
}
