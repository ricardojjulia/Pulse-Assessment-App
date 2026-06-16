import { useState, useEffect } from "react";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { listExtensions, getExtensionCount } from "../services/extensionService";
import { useReviewConfig, getAreaWeight } from "../hooks/useReviewConfig";

export function useExtensionsReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "extensions",
    status: "unknown",
    score: { value: 0, weight: 0.9, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const [extensions, ef2Count] = await Promise.all([
          listExtensions(),
          getExtensionCount(),
        ]);

        if (cancelled) return;

        const findings: Finding[] = [];
        const checks: Check[] = [];

        const extAccessible = extensions !== null && ef2Count !== null;

        // Check 1: EF2.0 extensions installed
        if (!extAccessible) {
          checks.push({ name: "Extensions 2.0 installed", weight: 0.4, result: "partial", partialValue: 0 });
          findings.push({
            id: "ext-no-access",
            title: "Cannot access Extensions API",
            description: "The app does not have permission to list extensions. Review results may be incomplete.",
            severity: "warning",
            recommendation: "Grant the extensions:read scope to this app.",
          });
        } else {
          checks.push({
            name: "Extensions 2.0 installed",
            weight: 0.4,
            result: (ef2Count ?? 0) > 0 ? "pass" : "fail",
          });

          if ((ef2Count ?? 0) === 0) {
            findings.push({
              id: "ext-no-ef2",
              title: "No Extensions 2.0 found",
              description: "No Extensions 2.0 are installed. If you have Extensions 1.0, they should be migrated.",
              severity: "warning",
              recommendation: "Review Extensions Hub for available Extensions 2.0 replacements for any classic extensions.",
            });
          }
        }

        // Check 2: Extension health (extensions listing is a positive signal)
        checks.push({
          name: "Extensions accessible",
          weight: 0.3,
          result: extAccessible ? "pass" : "partial",
          partialValue: extAccessible ? undefined : 0,
        });

        // Check 3: Evaluate each extension
        if (extensions && extensions.length > 0) {
          findings.push({
            id: "ext-inventory",
            title: `${extensions.length} Extensions 2.0 installed`,
            description: extensions.map((e) => `${e.extensionName} (v${e.version})`).join(", "),
            severity: "info",
            recommendation: "Verify all extensions are actively used and up to date.",
          });

          checks.push({
            name: "Multiple extensions active",
            weight: 0.3,
            result: extensions.length >= 3 ? "pass" : "partial",
            partialValue: Math.min(extensions.length / 3, 1),
          });
        } else {
          checks.push({
            name: "Extension coverage",
            weight: 0.3,
            result: "partial",
            partialValue: 0.5,
          });
        }

        // Calculate score and migration
        // For migration: EF2.0 is the Gen3 path; we can't directly count EF1.0 from this API
        // but we know EF2.0 count
        const area = REVIEW_AREA_MAP.get("extensions")!;
        const areaWeight = getAreaWeight(config, "extensions");
        const score = calculateAreaScore(checks, areaWeight);

        // Assume: if EF2.0 exists, migration is progressing
        const migration = buildMigrationMetrics(
          0, // We can't count EF1.0 directly; assume 0 classic
          ef2Count ?? 0,
          "{gen3} Extensions 2.0 installed ({pct}% migrated)"
        );

        setResult({
          areaId: "extensions",
          status: classifyStatus(score.value),
          score,
          migration,
          findings,
          lastUpdated: new Date(),
          isLoading: false,
        });
      } catch (err) {
        if (!cancelled) {
          setResult((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to analyze extensions",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, []);

  return result;
}
