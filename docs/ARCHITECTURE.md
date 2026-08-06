# Architecture

## Overview

Pulse Assessment is a **Dynatrace App** built on the Dynatrace AppEngine platform. It evaluates observability coverage and utilization across 9 Dynatrace capabilities by executing DQL queries against real tenant data.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Dynatrace AppEngine                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Pulse Assessment (React SPA)                              │  │
│  │                                                            │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐ │  │
│  │  │  App.tsx  │→ │ Coverage     │  │  ComparisonPage.tsx  │ │  │
│  │  │ (Router)  │  │ Assessment   │  │  (Evolution Over     │ │  │
│  │  │          │  │ .tsx         │  │   Time)              │ │  │
│  │  └──────────┘  └──────┬───────┘  └──────────┬───────────┘ │  │
│  │                       │                      │             │  │
│  │            ┌──────────┴──────────────────────┘             │  │
│  │            ▼                                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                │  │
│  │  │ useCoverageData │  │ useAssessment   │                │  │
│  │  │ (Query Engine)  │  │ History         │                │  │
│  │  └────────┬────────┘  └────────┬────────┘                │  │
│  │           │                    │                           │  │
│  └───────────┼────────────────────┼───────────────────────────┘  │
│              ▼                    ▼                               │
│  ┌───────────────────┐  ┌──────────────────┐                    │
│  │  Grail (DQL)      │  │  Document Store  │                    │
│  │  - Entities       │  │  - Snapshots     │                    │
│  │  - Logs           │  │  (ppa-snapshot)  │                    │
│  │  - Metrics        │  │                  │                    │
│  │  - Spans          │  └──────────────────┘                    │
│  │  - Events         │                                          │
│  │  - Bizevents      │                                          │
│  └───────────────────┘                                          │
└──────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
pulse-assessment/
├── app.config.json              # App manifest (ID, scopes, version)
├── package.json                 # Dependencies and scripts
├── AGENTS.md                    # AI agent instructions
├── ui/
│   ├── main.tsx                 # Entry point (AppRoot + Router)
│   └── app/
│       ├── App.tsx              # Routes: /, /compare, /ai-insights
│       ├── queries.ts           # 9 capabilities, 111 DQL criteria
│       ├── remediationActions.ts# Remediation actions for all 111 criteria
│       ├── scale-tier.ts        # Scale tiers + Economy Mode (sampling/window)
│       ├── trace-proxy.ts       # Metric/topology substitutes for span checks
│       ├── appVersion.ts        # Version shown in the UI footer
│       ├── ai/
│       │   ├── assistIntent.ts        # sendIntent into native Assist
│       │   ├── conversationStarters.ts# Per-page Assist starters
│       │   ├── davisRecommendations.ts# Davis CoPilot per capability
│       │   ├── promptTemplates.ts     # Versioned prompts (cache key)
│       │   ├── reportPrompt.ts        # Assessment context for prompts
│       │   └── smartReport.ts         # Narrative report via Davis CoPilot
│       ├── components/
│       │   ├── CovUtilRadar.tsx       # Radar; `coverageOnly` drops 2nd series
│       │   ├── CapabilityScatter.tsx  # Coverage bars + Utilization line
│       │   ├── TechRadar.tsx          # Coverage-view radar
│       │   ├── CapabilityCards.tsx    # Capability score cards
│       │   ├── DavisInsightSection.tsx# Collapsible AI insight + follow-ups
│       │   ├── CustomReportModal.tsx  # Report builder (title/caps/sections)
│       │   ├── SmartReportModal.tsx   # Free-text report via Assist
│       │   ├── ScaleTierBanner.tsx    # Tier banner + CostModeNote
│       │   ├── TraceProxyBanner.tsx   # Proxy-mode disclosure
│       │   ├── DpsCostBadge.tsx       # Live scan/cost indicator
│       │   ├── ConsolidationPanel.tsx # "Other tools" score adjustment
│       │   ├── ExpandableChartModal.tsx, ChartLabels.tsx, ConnectorLines.tsx
│       │   └── CopyableQuery.tsx, Tooltip.tsx, ErrorBoundary.tsx
│       ├── data/
│       │   ├── criterionTiers.ts      # Tier classification (F/BP/E)
│       │   ├── criterionImportance.ts # Importance descriptions
│       │   ├── criterionRemediation.ts# Remediation descriptions
│       │   ├── appCapabilityMap.ts    # Dynatrace app id → capability
│       │   ├── capSummaries.ts, appIcon.ts
│       ├── hooks/
│       │   ├── useCoverageData.ts     # Query engine + scoring
│       │   ├── useAppAdoption.ts      # Active users per capability (0 GB)
│       │   ├── useScaleTier.ts        # Host count → tier, with override
│       │   ├── usePreflight.ts        # Scope probes + span entitlement
│       │   ├── useAssessmentHistory.ts# Snapshot persistence
│       │   ├── useDavisRecommendations.ts, useAiReport.ts, useDevMode.ts
│       ├── reports/
│       │   ├── personaReports.ts      # Executive/Tactical/Technical/Custom
│       │   └── aiNarrativePdf.ts      # Markdown answer → PDF
│       ├── pages/
│       │   ├── CoverageAssessment.tsx # Main page (3 view modes)
│       │   ├── ComparisonPage.tsx     # Evolution Over Time
│       │   └── AiInsightsPage.tsx     # Davis insights (dev-gated)
│       ├── utils/colors.ts            # Score bands
│       └── perf/                      # Instrumentation + 24h query cache
└── docs/                              # This file and friends
```

## Data Flow

### Assessment Execution

1. **Preflight** (`usePreflight.ts`): Runs 7 probe queries to validate API scopes before the real assessment.
2. **Query Collection**: All 111 criteria from `queries.ts` are collected; their DQL queries are deduplicated (~94 unique queries).
3. **Parallel Execution** (`useCoverageData.ts`): Up to 10 concurrent DQL queries via `queryExecutionClient.queryExecute()` with polling.
4. **Scoring**: Each criterion produces a value (0–100%); values are compared against thresholds to produce pass/fail.
5. **Aggregation**: Coverage score (simple average) and Utilization score (weighted + progressive) are computed per capability and overall.
6. **Snapshot**: Results are saved to localStorage (immediate) and Dynatrace Document Store (async).

### Query Types

| Type | Description | Example |
|---|---|---|
| **Direct count** | Single query counting entities matching a filter | `fetch dt.entity.host \| summarize count()` |
| **Cross-entity ratio** | Two queries (A/B) calculating coverage percentage | Services with DB spans / Total services × 100 |
| **Timeseries** | Metric-based evaluation | `timeseries avg(dt.host.cpu.usage)` |

## Cost and Fidelity Controls

Three independent layers sit between a criterion and Grail. All of them rewrite
the *executed* query while the **cache key stays the original catalog string**,
so scoring, snapshots, cards and PDFs never see the difference.

### Economy Mode (`scale-tier.ts`, every tier)
A full run was measured at 370 GB of scan; it now runs at ~41 GB. Two levers,
chosen per criterion:

| Lever | Applied when | Measured effect |
|---|---|---|
| `samplingRatio: 1000` | **Both** sides of the ratio are plain counts over the same table and window | 2h of logs: 4.99 GB → ~0.003 GB, ratio drift < 1.5 pp |
| Narrower window | Anything using `countDistinct` or `by:` grouping | 2h → 15m: 3.87 GB → 0.61 GB, keeps 94% of distinct sources |

Sampling is never applied to distinct counts — measured, they collapse (log
sources 63 → 28, AI providers 4 → 1). It is also never applied when one side is
an exact entity count, or to single-query criteria compared to an absolute
threshold, because in both cases the sampling would not cancel. Criteria whose
two sides deliberately read different windows are divided by the same factor so
the ratio they encode survives.

### Scale Tier (`scale-tier.ts`, above 5k hosts)
Narrows the window further (30m / 5m) so very large tenants finish inside the
Grail per-query timeout. Orthogonal to Economy Mode, which runs on top.

### Trace Proxy Mode (`trace-proxy.ts`)
For tenants without the Traces-on-Grail entitlement: span checks are replaced by
validated metric/topology equivalents, and the checks with no honest proxy are
**excluded from the denominator** rather than counted as failures. AI
Observability is excluded as a whole capability — `gen_ai.*` exists only on
spans. Side effect: the replacements are metric/entity queries, which measured
zero scan, so proxy mode is cheaper than a normal run.

Every one of these is disclosed in the UI — `CostModeNote`, `ScaleTierBanner`
and `TraceProxyBanner` — because a viewer should never read an estimated score
without knowing it is one.

## App Adoption

`useAppAdoption.ts` counts distinct `user.email` per `DT_APP_ID` in
`dt.system.events`, maps app ids to capabilities via `data/appCapabilityMap.ts`
and reports penetration against all active platform users. It reads a system
table, so it measured **0 GB scanned**. It is reported beside coverage and
**never feeds a score**. Honest limits, surfaced rather than hidden: only apps
that run DQL appear, API traffic has no `client.source`, and it measures
platform usage rather than data usage.

## Scoring Model

### Coverage Score
Simple pass/fail ratio per capability:
```
capScore = (passed criteria / total criteria) × 100
overallScore = average(all capability scores)
```

### Utilization Score (Progressive Weighted)

**Weights:** Foundation = 60%, Best Practice = 25%, Excellence = 15%

**Progressive gating:**
- Best Practice only counts if Foundation ≥ 80%
- Excellence only counts if Best Practice ≥ 60%

```
effB = (foundationPct >= 0.8) ? bestPracticePct : 0
effE = (effB >= 0.6) ? excellencePct : 0
utilizationScore = foundationPct × 60 + effB × 25 + effE × 15
```

### Utilization Levels

| Level | Label | Condition |
|---|---|---|
| L0 | Not Adopted | Foundation < 50% |
| L1 | Foundation | Foundation ≥ 50% |
| L2 | Operational | Foundation = 100% AND Best Practice ≥ 50% |
| L3 | Optimized | Foundation = 100% AND Best Practice = 100% AND Excellence ≥ 50% |

### Utilization Bands

| Band | Score Range |
|---|---|
| N/A | 0–19% |
| Low | 20–39% |
| Moderate | 40–59% |
| Good | 60–79% |
| Excellent | 80–100% |

## Tier Distribution (111 criteria)

| Tier | Count | Weight | Gate |
|---|---|---|---|
| Foundation | 31 | 60% | Always counted |
| Best Practice | 46 | 25% | Requires Foundation ≥ 80% |
| Excellence | 40 | 15% | Requires Best Practice ≥ 60% |

## Snapshot Persistence

**Dual-layer storage:**

1. **localStorage** (`ppa-assessment-history`): Immediate read/write for fast access
2. **Dynatrace Document Store**: Persistent Grail storage via `@dynatrace-sdk/client-document`
   - Document type: `ppa-snapshot`
   - Document IDs: `cca-{id}` (id = `Date.now().toString(36)`)
   - Retention: 12 most recent snapshots; older ones are auto-deleted

**Sync flow:** On load, documents are fetched from Grail and merged with localStorage (dedup by ID, prefer remote). On save, localStorage is updated immediately; Grail write is fire-and-forget.

## UI Architecture

### Routing
```
/            → CoverageAssessment (lazy-loaded)
/compare     → ComparisonPage (lazy-loaded)
/ai-insights → AiInsightsPage (lazy-loaded, dev-gated)
```

All routes wrapped in `<ErrorBoundary>` with `<Suspense>`.

### View Modes (CoverageAssessment)

| Mode | Description |
|---|---|
| **Coverage** | Interactive polar radar chart + capability cards. Criterion rows show met / not met; the measured value lives in the expanded detail beside its threshold |
| **Utilization** | Tier-grouped cards (Foundation/Best Practice/Excellence) with weighted scores, plus an **Adoption** row per capability (users and penetration) |
| **Executive Summary** | Headline Coverage / Utilization / Adoption, achievements vs gaps, a **Coverage-only radar**, and a **Capability Map** (coverage bars + utilization line) |

### PDF Report Generation
Client-side via jsPDF (`reports/personaReports.ts`), each in English, Portuguese
and Spanish:

- **Executive** — posture, strengths and exposures, quick wins, path to the next
  stage, improvements grouped **by team** (never by date)
- **Tactical** — gap landscape, improvement potential by team, capability board,
  operating cadence
- **Technical** — full check detail with the DQL behind every criterion
- **Custom** — the user picks title, capabilities and sections
- **Smart (Assist)** — free-text request answered by Davis CoPilot, rendered
  through `reports/aiNarrativePdf.ts` (dev-gated)

Reports embed the app's own charts as images. Charts are exported as JPEG
rather than PNG — on gradient-heavy canvases that is ~20x smaller, which took
one report from 12.4 MB to a manageable size. Percentages are used throughout;
the reports never speak in "points".

Two constraints worth knowing: jsPDF's WinAnsi fonts cannot render ✓ ✗ ≈ ≥ →,
so the generators use OK/GAP/ERR, `~`, `>=` and `->`.

### Theming
Full dark/light mode via Strato design tokens (`useCurrentTheme()`). All components adapt dynamically.

## Dependencies

| Package | Purpose |
|---|---|
| `@dynatrace-sdk/client-query` | DQL query execution against Grail |
| `@dynatrace-sdk/client-document` | Snapshot persistence in Document Store |
| `@dynatrace/strato-components` | Dynatrace Strato UI framework |
| `@dynatrace/strato-design-tokens` | Design tokens (colors, theming) |
| `chart.js` + `react-chartjs-2` | Evolution mini-chart in CoverageAssessment |
| `jspdf` | PDF report generation |
| `react-router-dom` | Client-side routing |
