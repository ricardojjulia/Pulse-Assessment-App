# Observability Evaluation — Implementation Plan

## Overview

The Observability Evaluation page (`/observability`) is being redesigned from a simple 4-section data dashboard into a **probe-based architectural review tool** — the automated equivalent of the manual AAFES/MOO/Ally Dynatrace architectural review deliverables.

**Reference benchmark:** AAFES report (36 probes, Grade B/89), Mutual of Omaha report (service health, Davis, APM deep-dive), Ally report (69-page comprehensive review).

---

## Architecture

### Domain Taxonomy — 10 Domains, 46 Probes

| # | Domain | Weight | Probes | Key Signals |
|---|---|---|---|---|
| 1 | OneAgent Deployment | 1.0 | 5 | Full-stack %, version spread, host groups, monitoring candidates, network zones |
| 2 | Infrastructure Coverage | 0.9 | 5 | Host/PGI count, active vs ghost services, stale PGIs, K8s |
| 3 | Application Observability | 1.0 | 6 | Active tracing, error rates, cloud function gaps, DB capture, OTel quality |
| 4 | Log Management & OpenPipeline | 0.9 | 5 | Grail ingest, signal quality, debug contamination, OpenPipeline, buckets |
| 5 | Digital Experience (DEM/RUM) | 0.8 | 5 | Web apps, RUM volume, session replay, synthetic monitors, Grail execution |
| 6 | Davis AI & Alerting | 1.0 | 6 | Anomaly detectors, Davis events, problems, alerting profiles, SLOs, maintenance |
| 7 | Automation & Workflows | 0.7 | 3 | Workflow execution activity, success rate, deployment tracking |
| 8 | Platform Governance | 0.9 | 5 | Management zones, ownership teams, segments, API tokens, audit trail |
| 9 | Business Observability | 0.7 | 3 | BizEvent volume, data quality, processing pipeline rules |
| 10 | Extensions & Cloud | 0.8 | 3 | ActiveGate HA (≥2), Extensions 2.0, cloud integrations |

### Grading System

```
≥ 90  →  A  (Excellent)
≥ 80  →  B  (Good)
≥ 65  →  C  (Fair)
≥ 50  →  D  (Needs Attention)
 < 50  →  F  (Critical Gaps)
```

### Scoring Engine

Each probe returns a `score` (0–100) and `weight`. Domain score = weighted average of probe scores. Overall score = weighted average of domain scores using the domain weights above.

Probe score semantics:
- **100** = pass (threshold fully met)
- **50–99** = partial (threshold partially met, or N/A)
- **50** = unknown (data unavailable, neutral)
- **0** = fail (threshold not met)

---

## File Structure

```
ui/app/observabilityEval/
├── types.ts                    # ObsGrade, ObsProbeResult, ObsDomainResult, ObsFullEvalResults
├── queryRunner.ts              # Shared DQL execution (runDql, toNum, toStr)
├── domainUtils.ts              # mkProbe, mkFinding, buildDomain, calcDomainScore
├── useObservabilityFullEval.ts # React hook — orchestrates all 10 domains
└── domains/
    ├── oneagent.ts             # Domain 1: OneAgent Deployment
    ├── infra.ts                # Domain 2: Infrastructure Coverage
    ├── apm.ts                  # Domain 3: Application Observability
    ├── logs.ts                 # Domain 4: Log Management & OpenPipeline
    ├── dem.ts                  # Domain 5: Digital Experience
    ├── davis.ts                # Domain 6: Davis AI & Alerting
    ├── automation.ts           # Domain 7: Automation & Workflows
    ├── governance.ts           # Domain 8: Platform Governance
    ├── bizobs.ts               # Domain 9: Business Observability
    └── extensions.ts           # Domain 10: Extensions & Cloud

ui/app/pages/ObservabilityEvaluationPage.tsx  # Full UI with heatmap, findings, roadmap
ui/app/tenantReview/components/shared/FindingsTable.tsx  # Fixed: now renders detail + actionUrl
ui/app/reports/observabilityEvalPdf.ts        # Phase 3: standalone PDF export
```

---

## Implementation Phases

### Phase 1 — Data Layer + UI ✅ COMPLETE (this session)
- [x] `observabilityEval/types.ts` — all type definitions + `scoreToGrade()`
- [x] `observabilityEval/queryRunner.ts` — shared DQL runner
- [x] `observabilityEval/domainUtils.ts` — probe/domain builder helpers
- [x] All 10 domain probe modules
- [x] `useObservabilityFullEval.ts` — orchestrator React hook
- [x] `ObservabilityEvaluationPage.tsx` — full page with heatmap, findings, roadmap
- [x] `FindingsTable.tsx` — fixed to render `detail` and `actionUrl` fields

### Phase 2 — UI Refinement ✅ COMPLETE
- [x] Segment selector on the idle screen (pass segmentId to startEstimate)
  - Uses `useSegments()` hook — only shown when tenant has at least one segment
  - Native `<select>` with "All data (no segment filter)" as first option
  - Passes `activeSegmentId` to `handle.startEstimate(activeSegmentId)`
- [ ] Score trend (if historical data is available)
- [ ] UI polish: loading states per domain, progress indicator

### Phase 3 — PDF Export ✅ COMPLETE
- [x] `ui/app/reports/observabilityEvalPdf.ts` — standalone PDF (Option B pattern, 300+ lines)
- [x] Sections: cover page (grade circle, KPI tiles, intro), domain scorecard table, findings by severity (critical → warning → info), domain detail (per-probe evidence table), remediation roadmap (0-30/30-60/60-90d)
- [x] "Export Full Report" button wired — triggers download `atlas-observability-eval-{tenant}-{date}.pdf`
- [x] Uses same dark navy design tokens as `aiNarrativePdf.ts` (BG, SURF, BLUE, TEAL, TXT1/2/3)

---

## Key Design Decisions

1. **Probe modules are pure async functions** — no React hooks, callable from any context
2. **Segment filtering** applies only to telemetry queries (logs, spans, events) — entity queries (`fetch dt.entity.*`) don't support `filterSegments`
3. **Unknown score (50)** is used when data is unavailable/not applicable — neutral impact on domain score
4. **All findings generated** include `id`, `title`, `description`, `severity`, `recommendation`, and optionally `detail` and `actionUrl`
5. **Remediation roadmap** is auto-generated: critical/warning → 0-30d, info → 30-60d, success → 60-90d
6. **PDF is Phase 3** — "Export Full Report" button exists but is disabled in Phase 1

---

## Reuse from Existing Infrastructure

- `tenantReview/services/settingsService.ts` — `getSettingsObjectCounts()`, `getSettingsEnabledCounts()`
- `tenantReview/services/tokenService.ts` — `getTokenSummary()`
- `tenantReview/services/extensionService.ts` — `getExtensionCount()`
- `tenantReview/types/review.types.ts` — `Finding`, `FindingSeverity` types
- `tenantReview/components/shared/FindingsTable.tsx` — findings display (enhanced)
- All 60+ DQL queries from `tenantReview/constants/queries.ts` — used verbatim

---

## Reference Documents

- AAFES Best-Practices Evaluation (36 probes, Grade B/89, domain heatmap format)
- Mutual of Omaha Architectural Review (service health, Davis, APM, prioritized roadmap)
- Ally Architectural Review (69-page, IAM, ActiveGates, DEM/RUM, OpenPipeline, governance)
