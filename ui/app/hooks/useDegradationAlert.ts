import { useState, useMemo, useEffect, useRef } from "react";
import type { CapabilityResult } from "./useCoverageData";
import type { AssessmentSnapshot } from "./useAssessmentHistory";

const DEGRADATION_THRESHOLD = 5;

export interface DegradedCapability {
  name: string;
  previous: number;
  current: number;
  delta: number;
}

/**
 * Compares the most-recent assessment run against the previous snapshot and
 * surfaces capabilities that dropped ≥ DEGRADATION_THRESHOLD points.
 *
 * Returns:
 *   degraded  — list of capabilities with a score drop (empty when < 2 snapshots)
 *   dismissed — true once the user clicked ×
 *   dismiss   — call to set dismissed = true
 *
 * dismissed resets automatically whenever `capabilities` changes (new run).
 */
export function useDegradationAlert(
  capabilities: CapabilityResult[],
  snapshots: AssessmentSnapshot[],
) {
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissed flag whenever a new run completes (capabilities ref changes).
  const capRefRef = useRef(capabilities);
  useEffect(() => {
    if (capabilities !== capRefRef.current && capabilities.length > 0) {
      capRefRef.current = capabilities;
      setDismissed(false);
    }
  }, [capabilities]);

  const degraded = useMemo<DegradedCapability[]>(() => {
    // Guard: need at least 2 snapshots — index 0 is the run just saved,
    // index 1 is the previous run we compare against.
    if (snapshots.length < 2 || capabilities.length === 0) return [];

    const prevSnapshot = snapshots[1];
    const prevByName = new Map(prevSnapshot.capabilities.map((c) => [c.name, c.score]));

    const result: DegradedCapability[] = [];
    for (const cap of capabilities) {
      const prev = prevByName.get(cap.name);
      if (prev === undefined) continue;
      const delta = prev - cap.score; // positive = degradation
      if (delta >= DEGRADATION_THRESHOLD) {
        result.push({
          name: cap.name,
          previous: Math.round(prev),
          current: Math.round(cap.score),
          delta: Math.round(delta),
        });
      }
    }
    return result;
  }, [capabilities, snapshots]);

  const dismiss = () => setDismissed(true);

  return { degraded, dismissed, dismiss };
}
