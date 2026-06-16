import { useState, useEffect, useRef } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import type { ReviewAreaResult, Finding, Check } from "../types/review.types";
import { DQL_QUERIES } from "../constants/queries";
import { REVIEW_AREA_MAP } from "../constants/reviewAreas";
import { calculateAreaScore, buildMigrationMetrics, classifyStatus } from "../utils/scoring";
import { getDashboardSummary } from "../services/dashboardService";
import { useReviewConfig, getAreaWeight, getGen2Severity, getGen3Severity } from "../hooks/useReviewConfig";
import { functions } from "@dynatrace-sdk/app-utils";
import { trashClient } from "@dynatrace-sdk/client-document";

/**
 * Dashboards & Visualization review area.
 *
 * Uses Documents API for Grail dashboards/notebooks, DQL for lookup tables,
 * and Config API v1 (via app function) for classic dashboard count.
 *
 * Classic dashboards are Gen2 legacy — high counts should warn/critical.
 * Grail dashboards, notebooks, and lookup tables are Gen3 — rewarded.
 */
export function useDashboardsReview(): ReviewAreaResult {
  const { config } = useReviewConfig();
  const [result, setResult] = useState<ReviewAreaResult>({
    areaId: "dashboards",
    status: "unknown",
    score: { value: 0, weight: 0.8, passedChecks: 0, totalChecks: 0 },
    migration: { level: "not-started", percentage: 0, classicCount: 0, gen3Count: 0, summary: "" },
    findings: [],
    lastUpdated: new Date(),
    isLoading: true,
  });

  const lookupQuery = useDql(DQL_QUERIES.lookupTableCount);
  const analyzedRef = useRef(false);

  useEffect(() => {
    if (lookupQuery.isLoading || lookupQuery.isPending) return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;

    async function analyze() {
      try {
        const summary = await getDashboardSummary();
        if (cancelled) return;

        const { grailDashboardCount, notebookCount, classicDashboardCount, classicError, sharedDocumentCount } = summary;
        const lookupTableCount = Number(
          (lookupQuery.data?.records?.[0] as Record<string, unknown>)?.["count()"] ?? 0
        );
        const findings: Finding[] = [];
        const checks: Check[] = [];

        // Count Gen3 document types in use
        const gen3TypesInUse = [grailDashboardCount > 0, notebookCount > 0, lookupTableCount > 0].filter(Boolean).length;
        const totalGen3Documents = grailDashboardCount + notebookCount + lookupTableCount;
        const classicAccessible = classicDashboardCount >= 0;

        // Check 1: Classic dashboard migration debt
        if (config.classicDashboards.enabled) {
          checks.push({
            name: "Classic dashboard migration",
            weight: config.classicDashboards.weight,
            result: !classicAccessible ? "partial" :
              classicDashboardCount === 0 ? "pass" :
              classicDashboardCount <= 50 ? "partial" : "fail",
            partialValue: !classicAccessible ? 0.3 :
              classicDashboardCount <= 50 ? Math.max(0.2, 1 - (classicDashboardCount / 80)) : undefined,
          });
          if (!classicAccessible) {
            findings.push({
              id: "dash-classic-error",
              title: "Classic dashboard count unavailable — API limitation",
              description: "The Config API v1 (classic dashboards) is not accessible from Dynatrace Apps. The platform does not proxy this API and OAuth is not supported on the live API endpoint.",
              severity: "warning",
              recommendation: "Check classic dashboard count manually: go to Dashboards (classic) in the Dynatrace menu. Any classic dashboards should be migrated to Grail dashboards with DQL.",
            });
          } else if (classicDashboardCount === 0) {
            findings.push({
              id: "dash-no-classic",
              title: "No classic dashboards — fully migrated",
              description: "No legacy classic dashboards found. All visualization is using Gen3 Grail dashboards.",
              severity: "success",
              recommendation: "Continue using Grail dashboards with DQL for all visualization needs.",
            });
          } else {
            findings.push({
              id: "dash-classic-count",
              title: `${classicDashboardCount} classic dashboard(s) — Gen2 legacy`,
              description: "Classic dashboards use USQL and classic data sources. They should be migrated to Grail dashboards with DQL for Gen3 compatibility.",
              severity: getGen2Severity(classicDashboardCount, config.classicDashboards),
              recommendation: "Migrate classic dashboards to Grail dashboards. Prioritize high-traffic operational dashboards first.",
            });
          }
        }

        // Check 2: Grail dashboards exist (Gen3 adoption signal)
        if (config.grailDashboards.enabled) {
          checks.push({
            name: "Grail dashboards created",
            weight: config.grailDashboards.weight,
            result: grailDashboardCount >= 3 ? "pass" : grailDashboardCount > 0 ? "partial" : "fail",
            partialValue: grailDashboardCount > 0 ? Math.min(0.4 + (grailDashboardCount * 0.15), 0.9) : undefined,
          });
          if (grailDashboardCount === 0) {
            findings.push({
              id: "dash-no-grail",
              title: "No Grail dashboards found",
              description: "No dashboards have been created using the Gen3 Grail dashboard format.",
              severity: "warning",
              recommendation: "Begin creating Grail-based dashboards with DQL for operational views.",
            });
          } else {
            findings.push({
              id: "dash-grail-count",
              title: `${grailDashboardCount} Grail dashboard(s) found`,
              description: "Grail dashboards support DQL queries and are the Gen3 standard for visualization.",
              severity: getGen3Severity(grailDashboardCount, config.grailDashboards),
              recommendation: grailDashboardCount >= 3
                ? "Strong Grail dashboard adoption. Continue migrating any remaining classic dashboards."
                : "Continue creating Grail dashboards to replace classic dashboard views.",
            });
          }
        }

        // Check 3: Notebooks adoption
        if (config.notebooks.enabled) {
          checks.push({
            name: "Notebooks adopted",
            weight: config.notebooks.weight,
            result: notebookCount >= 2 ? "pass" : notebookCount > 0 ? "partial" : "fail",
            partialValue: notebookCount > 0 ? Math.min(0.5 + (notebookCount * 0.15), 0.9) : undefined,
          });
          if (notebookCount >= 2) {
            findings.push({
              id: "dash-notebooks",
              title: `${notebookCount} notebook(s) found — Gen3 analysis`,
              description: "Notebooks provide interactive exploratory analysis with DQL, code cells, and visualizations.",
              severity: getGen3Severity(notebookCount, config.notebooks),
              recommendation: "Use Notebooks for ad-hoc analysis, incident investigation, and sharing analytical workflows.",
            });
          } else if (notebookCount > 0) {
            findings.push({
              id: "dash-notebooks",
              title: `${notebookCount} notebook(s) found`,
              description: "Notebooks provide exploratory analysis with DQL.",
              severity: getGen3Severity(notebookCount, config.notebooks),
              recommendation: "Create more Notebooks for ad-hoc analysis and incident investigation workflows.",
            });
          } else {
            findings.push({
              id: "dash-no-notebooks",
              title: "No notebooks found",
              description: "Notebooks are a Gen3 feature for exploratory data analysis with DQL.",
              severity: "warning",
              recommendation: "Create Notebooks for ad-hoc data exploration and incident investigation.",
            });
          }
        }

        // Check 4: Lookup tables adoption
        if (config.lookupTables.enabled) {
          checks.push({
            name: "Lookup tables used",
            weight: config.lookupTables.weight,
            result: lookupTableCount >= 2 ? "pass" : lookupTableCount > 0 ? "partial" : "partial",
            partialValue: lookupTableCount > 0 ? Math.min(0.5 + (lookupTableCount * 0.15), 0.9) : 0.3,
          });
          if (lookupTableCount >= 2) {
            findings.push({
              id: "dash-lookup-tables",
              title: `${lookupTableCount} lookup table(s) — Gen3 data enrichment`,
              description: "Lookup tables enrich DQL queries by joining external reference data for business context.",
              severity: getGen3Severity(lookupTableCount, config.lookupTables),
              recommendation: "Continue using lookup tables to map IDs to business names and enrich observability data.",
            });
          } else if (lookupTableCount > 0) {
            findings.push({
              id: "dash-lookup-tables",
              title: `${lookupTableCount} lookup table(s) found`,
              description: "Lookup tables enrich data in DQL queries by joining external reference data.",
              severity: getGen3Severity(lookupTableCount, config.lookupTables),
              recommendation: "Create more lookup tables to enrich logs, events, and entities with business context.",
            });
          } else {
            findings.push({
              id: "dash-no-lookup-tables",
              title: "No lookup tables found",
              description: "Lookup tables are a Gen3 feature for enriching DQL query results with reference data.",
              severity: "info",
              recommendation: "Create lookup tables to map IDs to business names, add ownership data, or enrich observability signals.",
            });
          }
        }

        // Check 5: Gen3 visualization breadth
        checks.push({
          name: "Gen3 visualization breadth",
          weight: 0.2,
          result: gen3TypesInUse >= 3 ? "pass" : gen3TypesInUse >= 2 ? "partial" : gen3TypesInUse === 1 ? "partial" : "fail",
          partialValue: gen3TypesInUse === 2 ? 0.7 : gen3TypesInUse === 1 ? 0.4 : undefined,
        });

        // Shared documents finding
        if (sharedDocumentCount > 0) {
          findings.push({
            id: "dash-shared-docs",
            title: `${sharedDocumentCount} shared document(s) via environment shares`,
            description: "Documents shared with the environment allow broader team access to dashboards and notebooks.",
            severity: "success",
            recommendation: "Continue sharing key operational dashboards and runbook notebooks with the team.",
          });
        } else {
          findings.push({
            id: "dash-shared-docs",
            title: "No documents shared via environment shares",
            description: "Environment shares allow you to give other users access to your dashboards and notebooks.",
            severity: "info",
            recommendation: "Consider sharing important operational dashboards and notebooks with the team using environment shares.",
          });
        }

        // Check 6: Document sharing audit
        if (config.documentSharing.enabled) {
          try {
            const shareResponse = await functions.call("documentShares");
            const shareResult = (await shareResponse.json()) as {
              totalShares: number; oversharedCount: number; error?: string;
            };

            if (!shareResult.error) {
              checks.push({
                name: "Document sharing active",
                weight: config.documentSharing.weight,
                result: shareResult.totalShares > 0 ? "pass" : "partial",
                partialValue: shareResult.totalShares === 0 ? 0.5 : undefined,
              });

              if (shareResult.oversharedCount > 0) {
                findings.push({
                  id: "dash-overshared",
                  title: `${shareResult.oversharedCount} document(s) shared with >20 individual users`,
                  description: "Documents shared with many individual users are harder to manage. Consider using group shares or environment shares instead.",
                  severity: "info",
                  recommendation: "Convert individual user shares to group or environment shares for easier management.",
                });
              }
            }
          } catch {
            // Direct shares API not accessible — skip
          }
        }

        // Check 7: Trashed documents cleanup
        if (config.trashedDocuments.enabled) {
          try {
            const trashResult = await trashClient.listTrashedDocuments({ pageSize: 1 });
            const trashCount = trashResult.totalCount;

            checks.push({
              name: "Trashed documents cleaned up",
              weight: config.trashedDocuments.weight,
              result: trashCount === 0 ? "pass" : trashCount <= config.trashedDocuments.criticalMax ? "partial" : "fail",
              partialValue: trashCount > 0 ? Math.max(0.3, 1 - (trashCount / 20)) : undefined,
            });

            if (trashCount > 10) {
              findings.push({
                id: "dash-trash-cleanup",
                title: `${trashCount} document(s) in trash — cleanup opportunity`,
                description: "Documents in trash consume space and add clutter. Permanently delete or restore them.",
                severity: getGen2Severity(trashCount, config.trashedDocuments),
                recommendation: "Review trashed documents and permanently delete those no longer needed, or restore accidentally deleted items.",
              });
            }
          } catch {
            // Trash API not accessible — skip
          }
        }

        // Summary
        findings.push({
          id: "dash-summary",
          title: `Dashboards: ${classicAccessible ? classicDashboardCount : "?"} classic, ${grailDashboardCount} Grail, ${notebookCount} notebooks, ${lookupTableCount} lookup tables${sharedDocumentCount > 0 ? `, ${sharedDocumentCount} shared` : ""}`,
          description: `${gen3TypesInUse} of 3 Gen3 document types in use (${totalGen3Documents} total).${classicAccessible && classicDashboardCount > 0 ? ` ${classicDashboardCount} classic dashboards need migration.` : ""}`,
          severity: gen3TypesInUse >= 2 && totalGen3Documents >= 3 && classicDashboardCount <= 50 ? "success" :
            classicDashboardCount > 50 ? "warning" : "info",
          recommendation: classicDashboardCount > 0
            ? "Migrate classic dashboards to Grail format. Prioritize operational dashboards used daily."
            : "Excellent Gen3 visualization adoption across all document types.",
        });

        const area = REVIEW_AREA_MAP.get("dashboards")!;
        const areaWeight = getAreaWeight(config, "dashboards");
        const score = calculateAreaScore(checks, areaWeight);

        // Migration: classic dashboards vs Gen3 documents
        const classicCount = classicAccessible && classicDashboardCount > 0 ? classicDashboardCount : 0;
        const migration = buildMigrationMetrics(
          classicCount,
          totalGen3Documents,
          "{gen3} Gen3 documents vs {classic} classic dashboards ({pct}% migrated)"
        );

        setResult({
          areaId: "dashboards",
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
            error: err instanceof Error ? err.message : "Failed to analyze dashboards",
          }));
        }
      }
    }

    void analyze();
    return () => { cancelled = true; };
  }, [lookupQuery.isLoading, lookupQuery.isPending, lookupQuery.data, lookupQuery.error]);

  return result;
}
