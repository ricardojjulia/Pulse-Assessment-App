# Changelog

All notable changes to the Pulse Assessment app are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.5.8] — 2026-08-06

### Fixed — Trace Proxy Mode was never offered
- The preflight probe classified SDK errors by reading `err.message` only. The
  query client throws `ClientRequestError`, which carries the parsed envelope in
  **`body`** while `message` stays generic ("Request failed with status code
  403"), so `TRACE_QUERY_ENTITLEMENT_MISSING` was never seen. A tenant without
  Traces on Grail was therefore told "Permission denied — scope not granted to
  this app" — advice that cannot fix an entitlement — and **Trace Proxy Mode,
  which exists precisely for that tenant, was never offered.**
- Classification now flattens `message`, `body`, `cause` and `details` into one
  searchable string, and tests for the entitlement **before** the generic 403
  branch, since an entitlement failure is also a 403.
- `probeQuery` now returns the entitlement decision instead of leaving the
  caller to re-derive it from the human-facing `detail` string — the same
  fragility that produced the bug.
- Verified against the exact payload from a live tenant: the shipped 2.5.7 code
  returns `fail` + "scope not granted"; the fix returns `not-entitled` + the
  readable "Querying spans requires ... Trace query entitlement." A plain 403
  still classifies as `fail` and keeps the scope hint.

Note: the `Request failed: {...403}` line still appears in the browser console.
The probe queries spans deliberately to detect the entitlement, so that 403 is
the detection working; the SDK logs every failed request.

## [2.5.5] — 2026-08-05

### Added — Economy Mode (Grail/DPS cost)
- **`scale-tier.ts`** gained a cost transform that runs at **every** tier, including `exact`. A full run was measured at 370 GB of scan (~$3.70, ~$60/month over 30 days on a reference tenant, read from `dt.system.events`); it now runs at **~41 GB (~$0.41)**.
  - `samplingRatio: 1000` is applied **only** where sampling provably cancels out: both sides of the criterion must be plain counts over the same table and the same window. Measured on 2h of logs — scan 4.99 GB → ~0.003 GB, ratio drift under 1.5 percentage points.
  - Everything else gets a **narrower window** instead, because `countDistinct` collapses under sampling (distinct log sources 63 → 28; AI providers 4 → 1). Short windows go to 15 minutes, long ones are capped at 4 hours.
  - Criteria whose two sides deliberately read different windows (l10, 24h vs 2h) are divided by the same factor so the ratio they encode survives.
  - A `scanLimitGBytes` ceiling is added to every hot query; the deliberate `-1` on l11 is preserved.
- **`CostModeNote`** — on-screen disclosure that values are close estimates, rendered next to the scores at every tier.
- **App adoption in the Executive headline** — average share of active platform users who open the apps behind each capability, beside Coverage and Utilization. Never feeds a score.

### Changed — terminology
- Every user-visible **"Maturity" is now "Utilization"**, including chart labels, hub captions, tooltips, the criteria list and the Assist prompts. Internal identifiers were left alone in this release and renamed in 2.5.6.
- Criterion a12 renamed from "Service tagging maturity" to "Service tagging utilization".

### Changed — Executive Summary
- The radar now plots **Coverage only** — the Utilization series, its hub number and its legend entry are gone — and grows from 28% to 34% of the canvas.
- The Capability Map is no longer a scatter: capabilities sit on the X axis with **coverage bars plus a utilization line**. Value labels resolve collisions deterministically and are never drawn below the axis; names word-wrap and fall back to short forms rather than breaking mid-word.
- The colour-to-capability legend strip was removed — both charts name their capabilities directly.

### Changed — cards and menus
- Criterion rows show **met / not met** only; the measured value stays in the expanded detail next to the threshold that gives it meaning.
- The AI Insight panel folds on click **without collapsing its capability card**; clicks on its controls and text selections are ignored.
- Active-user counts left the Coverage cards — adoption belongs next to Utilization.
- `Custom…` is now the last item in the Reports menu.
- Assist was removed from the Evolution page.

### Fixed
- The displayed version (`appVersion.ts`) and the deployed version (`app.config.json`) are now in sync; they had drifted, which is why 2.5.4 was superseded immediately.

### Security / hygiene
- Tenant identifiers, environment URLs and the author e-mail were replaced with placeholders across code, docs and scripts. **Local dev now needs `--environment-url`** (or a local edit of `app.config.json`).

## [2.5.0] — 2026-05-22

### Added — Scale Tier (xlarge tenant support)
- **`scale-tier.ts`** — pure module that adapts DQL queries to tenant scale via three tiers:
  - `exact` (≤ 5,000 hosts) — queries returned verbatim, ground-truth coverage values, identical behavior to v2.4.x.
  - `large` (5,000–50,000 hosts) — narrows logs/spans/events/bizevents to a 30-minute window with a 200 GB `scanLimitGBytes` safety net. Distinct-count accuracy preserved on workloads with continuous ingest.
  - `xlarge` (> 50,000 hosts) — 5-minute window with a 50 GB `scanLimitGBytes` cap. Coverage values are sampled estimates (±5–10% on typical workloads). Required above 50k hosts to fit inside the Grail per-query timeout.
- **`useScaleTier`** hook — detects host count via one cheap entity query on mount, auto-selects the tier, persists manual overrides in `localStorage`.
- **`ScaleTierBanner`** component — visible disclosure that the assessment is running in a sampled tier. Hidden entirely in `exact` mode (zero presentation impact for tenants ≤ 5k hosts). Includes inline tier-switch buttons.
- `useCoverageData` now accepts an optional `tier` parameter; the executed DQL is transformed via `scaleQuery(originalQ, tier)` before hitting Grail, but the result cache remains keyed by the **original** query string so all downstream consumers (scoring, snapshots, capability cards, PDF reports) are unaffected.

### Changed
- `App.tsx` now mounts `useScaleTier()` and threads the resolved tier into `useCoverageData()` and into `CoverageAssessment` (via a new optional `scale` prop).
- `CoverageAssessment` renders the `ScaleTierBanner` below the toolbar when `tier !== 'exact'`.

### Unchanged (deliberate, by design)
- `queries.ts` — every DQL string is **bit-identical** to v2.4.2. Scale Tier transforms queries at execution time, not in the source. This keeps the assessment definition versionable, auditable and easy to review.
- Scoring logic in `useCoverageData` — formula and thresholds untouched.
- Snapshot persistence and Evolution Over Time comparison — snapshots from v2.4.x remain compatible.
- Strato components, layouts, theming — no presentation changes for tenants ≤ 5k hosts.

### Performance impact (measured on a reference tenant, 54 hosts; extrapolated to 80k hosts)
- 80k-host single assessment scan: ~176 TB (Exact) → ~3.2 TB (xLarge) — **98.2% reduction**.
- 80k-host single assessment DPS: ~$1,800 → ~$32 — **98.2% reduction**.
- 80k-host wall-time: ~30–40 min (Exact, with query timeouts) → ~3–5 min (xLarge, within timeout). See `docs/PERFORMANCE-REPORT-80K-HOSTS.md` §6 for the full matrix.

## [2.3.40] — 2025-07-17

### Changed
- **Progressive Utilization Scoring**: Updated tier weights from 50/30/20 to **60/25/15** (Foundation/Best Practice/Excellence).
- Best Practice tier now only contributes to the utilization score when **Foundation ≥ 80%**.
- Excellence tier now only contributes when **Best Practice ≥ 60%**.
- Updated all UI descriptions and footer guidance to reflect the new weights and gating rules.
- Deployed to the reference tenants.

## [2.3.39] — 2025-07-17

### Changed
- Removed Delta (Δ) row from radar chart hover tooltip on the ComparisonPage. Tooltip now shows only "Previous" and "Current" scores plus per-tier criteria summary.

## [2.3.38] — 2025-07-17

### Added
- **Radar Chart Tooltip**: Hover over data points on the ComparisonPage radar chart to see capability name, Previous/Current scores, and criteria breakdown per tier (Foundation, Best Practice, Excellence).
- Click on radar chart axes already navigates to the detailed `CapabilityBar` drill-down.

## [2.3.37] — 2025-07-16

### Fixed
- **AI Observability zero coverage**: Fixed queries returning 0% due to OpenTelemetry semantic convention rename (`gen_ai.system` → `gen_ai.provider.name`). Added `coalesce()` for backward compatibility.
- Changed DQL scan range from post-filter to inline `from:now()-72h` for AI Observability criteria to ensure spans are scanned.
- Added new AI attributes: `gen_ai.agent.name`, `gen_ai.output.type`, `gen_ai.usage.input_tokens`, guardrail and cost attributes.

## [2.3.36] — 2025-07-15

### Changed
- Code splitting: Lazy-loaded both `CoverageAssessment` and `ComparisonPage` via `React.lazy()` with `<Suspense>` fallback.
- Performance and best practices audit applied.

## [2.3.35] — 2025-07-15

### Added
- Custom app icon (`icon.svg`) displayed in Dynatrace Hub and app header.

### Changed
- Preflight validation enhanced with all 7 scope probes (entities, logs, metrics, events, spans, bizevents, buckets).

## [2.3.34] — 2025-07-14

### Fixed
- Various DQL query fixes for cross-entity ratio calculations.
- Button layout repositioning on the assessment results page.

## [2.3.33] — 2025-07-14

### Added
- Initial public version with full feature set.
- 9 capabilities, 111 criteria with DQL queries.
- Coverage and Utilization dual-scoring model.
- Interactive polar radar chart with click-to-drill-down.
- 3 view modes: Coverage, Utilization, Executive Summary.
- PDF report generation (Summary, Coverage Detail, Utilization Detail).
- Assessment snapshot persistence (localStorage + Dynatrace Document Store).
- Evolution Over Time page with A/B snapshot comparison.
- Remediation actions and documentation links for all 111 criteria.
- Preflight scope validation.
- Dark/Light theme support.
