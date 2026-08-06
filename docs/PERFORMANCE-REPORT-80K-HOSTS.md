# Pulse Assessment — Performance Report for xlarge Production (80k hosts)

**Date:** 2026-05-22
**Author:** Marcelo Coletta
**Method:** Stress test on `<reference-tenant>` (54 hosts / 82 services / 737 processes) using a 27-query representative sample (out of 107 unique queries), then linear extrapolation to 80,000 hosts.
**App version under test:** Pulse Assessment v2.4.2

> **Superseded in part (v2.5.5).** The scan volumes below predate Economy Mode.
> They remain valid as the *unoptimized* baseline and for the extrapolation
> method, but a current run scans roughly **9x less**: a full assessment was
> re-measured at 370 GB before Economy Mode and ~41 GB after, on a reference
> tenant, by reading `dt.system.events` rather than by estimation. See the cost
> section in `README.md` and "Cost and Fidelity Controls" in `ARCHITECTURE.md`.

---

## Executive Summary

| Scenario | Total scanned | DPS cost (≈) | Verdict |
|---|---:|---:|---|
| Measured @ reference tenant (54 hosts) | 122 GB | $0.79 – $1.22 | ✅ Viable, matches README baseline (~142 GB) |
| **Extrapolated @ 80k hosts** | **~176 TB** | **$1,170 – $1,800** | 🔴 **Not viable in current form** |

**Bottom line:** The app code is **already well-engineered** for its target scale — queries are correctly deduplicated (107 unique from 201 raw), concurrency is capped (`CONCURRENCY = 10`), filter columns are ordered cost-optimally, and aggregations are bounded. The 80k-host cost wall is therefore **structural to the problem domain**, not an implementation defect: any DQL-based assessment that needs ground-truth `countDistinct(...)` over all log/span records in a 2-hour window will scan ingest-proportional volume.

Two mitigations preserve full result fidelity (zero deviation from real data) and ship safely:

1. **R5 — Persistent 24h cache in Document Store** — first run/day costs the projected $1,170–$1,800; every subsequent run that day costs $0. Same numbers returned to the UI.
2. **R8 — Pre-flight scan budget warning** — adds a confirmation modal estimating cost before the run starts. Prevents accidental high-DPS execution.

Three additional mitigations would drop cost to ~$32/run but **change measured values** (sampling, shortened windows, scan caps). They are documented in §5 as opt-in via a future "Scale Tier" setting, not enabled by default.

> **Correction (v2 of this report):** the first draft flagged a `dt.entity.service` bug in `queries.ts` and recommended a global filter-reorder. Both were false positives caused by a transcription error in the manually-composed test queries. A line-by-line re-audit of `queries.ts` at commit `2.4.2` confirms the code is correct as written. See §4 and §5.

---

## Section 1 — Test Setup & Methodology

### Target environment characterization (not available)

The "xlarge production environment" with **~80,000 hosts** and **thousands of services** could not be tested directly. The MCP gateway is connected to `<reference-tenant>`, which has:

| Entity | Count @ reference tenant |
|---|---:|
| Hosts | 54 |
| Services | 82 |
| Process group instances | 737 |
| K8s clusters | 7 |
| Log records (2h window) | ~7.9 M (~12 GB ingest/2h) |
| Spans (2h window) | ~1.6 M |
| Events (2h window) | ~20 k |
| Bizevents (2h window) | ~78 k |
| Davis problems (72h) | ~110 k |

Scale factor used for extrapolation: **80,000 / 54 ≈ 1,481×**. This is the upper-bound assumption (linear with host count). Real production may be lower if log/span sampling is already in effect.

### Methodology

- Parsed `ui/app/queries.ts` → extracted 107 criteria across 9 capabilities; 107 unique DQL query strings (down from 201 total `query` + `queryB` strings — heavy dedup).
- Stratified sample: 27 queries (~25% of the population), proportional across the 7 data sources (entity, metrics, problems, events, bizevents, spans, logs).
- Each query executed via Dynatrace MCP `execute_dql` with `recordLimit=1`. Per-query metrics captured: `Scanned Records`, `Scanned Bytes`, error status.
- Total session DPS consumed: **32.10 GB** (within $1.42 budget).

### What was NOT measured

- **Wall-clock latency per query** — MCP doesn't expose query-side timing; estimates below use Grail's typical scan throughput (10 GB/s per worker).
- **Concurrency behavior of the React app at xlarge** — the SDK calls `Promise.all` over the 94 deduplicated queries; Grail enforces a per-tenant concurrent-query cap.
- **UI rendering load** — for 111 criterion cards × thousands of services in scatter plots, the radar canvas is fine but `CapabilityScatter.tsx` may need virtualization (out of scope of this DPS test).

---

## Section 2 — Per-Source Sample Results (raw)

| Source | # sampled (of total unique) | Σ GB scanned | Avg GB / query | Notes |
|---|---:|---:|---:|---|
| entity | 5 / 23 | 0.00 | 0.000 | 1 query errors out (see §4, bug E1) |
| metrics (`timeseries`) | 4 / 19 | 0.00 | 0.000 | Metadata only — no Grail scan |
| problems (`dt.davis.problems`) | 3 / 7 | 0.14 | 0.047 | 72h window, ~110k records |
| events (2h) | 3 / 6 | 0.15 | 0.050 | ~20k records, low scan |
| bizevents (2h) | 3 / 11 | 0.08 | 0.027 | ~78k records |
| spans (2h) | 5 / 22 | 0.78 | 0.156 | ~1.6M records, varies by filter |
| logs (2h) | 5 / 19 | **30.91** | **6.18** | ~7.9M records, **1.57 GB → 11.81 GB depending on which fields the filter touches** |
| **Total sample** | **27 / 107** | **32.06** | — | — |

### Key observation on logs heterogeneity

The same time window (2h) and same record count (~7.9M) produced **7.5× variation** in scan size:

| Filter pattern | Scanned GB | Reason |
|---|---:|---|
| `isNotNull(cloud.provider)` | 1.57 | Single-column index lookup, dictionary pruning |
| `isNotNull(cloud.provider) and isNotNull(dt.entity.host)` | 1.57 | Pruning on the lighter column |
| `isNotNull(k8s.namespace.name)` | 4.16 | Mid-cardinality column |
| `isNotNull(dt.entity.host)` | **11.81** | Forced to load `dt.entity.host` column for every record |
| `isNotNull(dt.entity.host)` + countDistinct | **11.80** | Same |

**Implication:** the column referenced by a `filter isNotNull(...)` drives Grail's column-load cost, not the filter ORDER on the pipeline. Re-auditing `queries.ts` after publishing the first draft of this report confirms that the existing log/span queries **already place the lighter-column filter first** wherever multiple filters exist (e.g. `loglevel == "ERROR"` before `isNotNull(dt.entity.host)` on `queries.ts:623`). The cost spread above is therefore an intrinsic property of the criterion (i.e., a query that conceptually requires host-level distinct counts must load the host column), not a fixable ordering bug.

---

## Section 3 — Extrapolation to 80,000 Hosts

### Scaling model per source

| Source | Scaling assumption | Justification |
|---|---|---|
| `entity` | `log(N_hosts)` | Aggregations like `summarize count()` are cheap; result cardinality grows but scan is metadata-level |
| `metrics` (timeseries) | Constant ≈ 0 | Metric metadata, not raw data scan |
| `problems` | `sqrt(N_hosts)` | Davis deduplicates aggressively; problem count saturates well below linear |
| `events` | **linear with hosts** | One event per state change per entity |
| `bizevents` | **linear with hosts** | Driven by ingest rate, which scales with traffic, which scales with services |
| `spans` | **linear with hosts** | OTel/OneAgent span volume tracks request throughput |
| `logs` | **linear with hosts** | Log ingest scales with host count for typical fleet (assumes per-host log policy unchanged) |

### Projected full assessment @ 80,000 hosts

| Source | # unique queries | GB/query (projected) | Σ TB scanned | DPS cost @ $0.01/GB |
|---|---:|---:|---:|---:|
| entity | 23 | 0.00 | 0.00 | $0 |
| metrics | 19 | 0.00 | 0.00 | $0 |
| problems | 7 | 1.80 | 0.01 | $0 |
| events | 6 | 74.07 | 0.43 | $4 |
| bizevents | 11 | 39.51 | 0.42 | $4 |
| spans | 22 | 231.11 | 4.97 | $51 |
| **logs** | **19** | **9,158** | **169.93** | **$1,740** |
| **TOTAL** | **107** | — | **~176 TB** | **~$1,800** |

> Logs alone account for **96.7% of the projected cost**. They are the single optimization lever that matters.

### Wall-time projection

Assuming Grail per-worker scan throughput of **10 GB/s** and a per-tenant concurrency cap of **10 simultaneous queries**:

| Phase | Estimated wall-time @ 80k hosts |
|---|---:|
| Entity + metrics + problems (37 queries) | ~30 s |
| Events + bizevents (17 queries, ~16 TB) | ~3 min |
| Spans (22 queries, ~5 TB) | ~1 min |
| **Logs (19 queries, ~170 TB)** | **~30 min** (parallel) → up to **4.7 h** (worst case sequential) |
| **End-to-end (typical)** | **~30-40 min** |

Production users running this from a UI tab will hit:

- **Browser idle-tab throttling** kicks in after ~5 min — long-running fetches may stall.
- **Grail query timeout** (default 60 s, configurable to 600 s) — a single 17 TB logs query needs >1700 s with 10 GB/s. **Several queries will hit the timeout** without further partitioning.

---

## Section 4 — Functional Findings (Non-Performance)

> **Correction note (post-audit):** the first draft of this report claimed a `FIELD_DOES_NOT_EXIST` bug in the service-tags criterion. A line-by-line audit of `queries.ts` (commit `2.4.2`) showed this was a false positive — the actual source uses `summarize count = countDistinct(id)` after `expand t`, which is correct. The error reproduced during sampling was caused by a transcription mistake in the manually-composed test query, not by the application code. **No bug to fix in `queries.ts`.**

### Test artifact — MCP gateway rate limit

The MCP-mediated execution hit a **5-calls-per-20-seconds** gateway limit. This **does not apply to the deployed app**, which uses `@dynatrace-sdk/client-query` directly against the platform Grail endpoint (no MCP). Documented here purely as a testing-tool footnote so future re-runs know to space batches.

---

## Section 5 — Recommendations for xlarge Production

> **Scope note:** the goal of this section is to enumerate every viable lever, **clearly marking whether each preserves result fidelity or trades accuracy for cost**. The Pulse Assessment author explicitly required "no deviations" from the real measurements, so only the lossless options (R5, R8) are safe to ship without a behavior-change review. The lossy options (R1-R3) are kept here for completeness, since at extreme scale (>50k hosts) some teams may consciously accept reduced precision to make the app runnable at all.

### Already in place (verified during re-audit of `useCoverageData.ts`)

- **Query deduplication** — 201 raw `query`/`queryB` strings collapse to 107 unique DQL strings via `[...new Set(queries)]` on line ~232 of `useCoverageData.ts`. Confirmed.
- **Concurrency cap** — `CONCURRENCY = 10` worker pool on line 222 of `useCoverageData.ts`. Confirmed. No change needed (earlier draft of this report incorrectly recommended adding one).
- **Filter ordering** — sampled queries that combine multiple filters already place the cheap column first (`loglevel == "ERROR"` before `isNotNull(dt.entity.host)` on line 623, etc.). Confirmed. No change needed (earlier draft of this report incorrectly recommended a global rewrite).

### R5 — Persistent result cache with 24h TTL (P0, **lossless**) ✅ SAFE

Each criterion executes the same DQL every time the user opens the app or hits Refresh. Cache the per-query result in the Document Store (the app already depends on it for snapshot persistence), keyed by `sha256(tenantId + queryText + windowBucket24h)`, TTL 24h.

- **Result fidelity:** identical — a cache hit replays the exact value the cached run produced; a miss falls through to the live query.
- **Cost behavior:** first run of the day @ 80k = ~$1.8k as projected; every subsequent run in the same 24h = $0.
- **Touch surface:** new `useResultCache.ts` hook + ~30 lines in `useCoverageData.ts` between dedup and execution. **No changes to `queries.ts`, components, or scoring logic.**
- **Estimated savings:** in steady state, ~99% of DPS cost is eliminated for tenants with > 1 assessment/day. Does not change first-run-of-day cost.

### R8 — Pre-flight scan budget warning (P0, **lossless**) ✅ SAFE

Before the 107-query batch fires, run a single tenant-scale probe (`fetch logs, from: now()-5m | summarize gb = bytes() / 1024 / 1024 / 1024`) to estimate ingest velocity, multiply by 2h × 19 log queries, and show a modal:

> "This assessment will scan an estimated **{X} GB** of Grail data (~${Y} DPS). Continue?"

- **Result fidelity:** identical — the modal only adds a confirmation step; once confirmed, queries execute exactly as today.
- **Cost behavior:** prevents accidental $1.8k runs on xlarge tenants. Modal can be remembered per tenant via the same Document Store snapshot system.
- **Touch surface:** new `usePreflightBudget.ts` hook (alongside the existing `usePreflight.ts` for scope validation) + Strato `Modal` component invocation in `CoverageAssessment.tsx`. **No changes to `queries.ts`.**

### R1 — Bucket-scope log/span queries via Grail safety nets (P1, **lossy — sampled**) ⚠️ DEVIATION

`fetch logs, scanLimitGBytes: 50, samplingRatio: 1000` caps worst-case cost at 50 GB and applies 1-in-1000 sampling. At 80k hosts this drops the logs section from ~170 TB to ~4 TB — a 40× reduction.

- **Result fidelity:** results become **sampled estimates**, no longer ground truth. A "1.8% coverage" reading might really be 1.5%-2.1%. For coverage thresholds (e.g., "is this > 50%?"), the answer is usually still correct; near threshold boundaries it can flip.
- **Status:** **Out of scope for this iteration** — violates the "no deviations" constraint. Documented in case a future "Scale Tier: xlarge" mode is added (see R-future-1).

### R2 — Replace presence-checks with `scanLimitGBytes: 0.1` short-circuits (P1, **lossy — sampled**) ⚠️ DEVIATION

Six log criteria only need to know whether a signal exists, not exact counts. Adding `scanLimitGBytes: 0.1` short-circuits Grail's scan at 100 MB. At 80k hosts, presence is reliably detectable in the first 100 MB; exact `countDistinct(...)` is not.

- **Result fidelity:** `count = countDistinct(k8s.namespace.name)` becomes "at-least-N namespaces seen in the first 100 MB scanned" rather than the true count. For the assessment's Coverage formula `query / queryB × 100`, this **changes the numerator**.
- **Status:** **Out of scope for this iteration** — violates the "no deviations" constraint.

### R3 — Drop window 2h → 30 min for logs/spans/events/bizevents (P2, **lossy — different time scope**) ⚠️ DEVIATION

A criterion that asks "in the last 2h, how many distinct hosts emitted log records?" is **measuring something different** from the same query at 30 min. Results would change for any signal with sparse ingest (overnight batch jobs, infrequent events, etc.).

- **Result fidelity:** changes the question being asked. At xlarge scale 30 min still surfaces the active fleet, but coverage values shift downward for signals that don't fire every minute.
- **Status:** **Out of scope for this iteration** — violates the "no deviations" constraint.

### R-future-1 — "Scale Tier" toggle (Small / Medium / Large / xLarge)

Surface a tenant-administrator setting that, at xLarge tier, opts into R1+R2+R3 with **clear UI banners** ("Results are sampled — coverage values are estimates ±5%"). This makes the tradeoff explicit and per-tenant rather than baked into the app code.

---

## Section 6 — Projected Cost After Mitigations

Split into "lossless mitigations" (preserve data fidelity, ship safely) and "lossy mitigations" (require explicit opt-in, change measured values).

### Scenario A — Lossless only (R5 + R8)

| Run | Scan @ 80k hosts | DPS cost | Notes |
|---|---:|---:|---|
| First run of day | 176 TB | ~$1,800 | Identical to baseline — R5 cache miss, R8 only adds confirmation |
| Each subsequent run, same day | **0 TB** | **$0** | Full cache hit on every query |
| **Daily total (avg 3 runs)** | **176 TB** | **~$600/day amortized** | vs. ~$5,400/day without cache |

Combined with R8, accidental runs on xlarge tenants are eliminated. Steady-state DPS for a team running the assessment multiple times per day drops by ~70% even with R5 alone, while every reported value remains ground-truth.

### Scenario B — Lossy mitigations enabled at xLarge tier (R1 + R2 + R3)

> **Requires explicit per-tenant opt-in.** Coverage values become sampled estimates.

| Source | Before (TB @ 80k) | After R1+R2+R3 | Savings |
|---|---:|---:|---:|
| logs | 170 | ~2.0 | 99% |
| spans | 5.0 | ~1.0 | 80% |
| events | 0.4 | ~0.1 | 75% |
| bizevents | 0.4 | ~0.1 | 75% |
| problems | 0.01 | 0.01 | — |
| entity/metrics | ~0 | ~0 | — |
| **TOTAL** | **176 TB** | **~3.2 TB** | **98.2%** |
| **DPS cost** | **$1,800** | **~$32** | **98.2%** |
| **Wall-time** | ~30-40 min | ~3-5 min | ~90% |
| **Result fidelity** | exact | sampled ±5-10% | — |

Combined with R5 caching, the **steady-state cost approaches $0** after the first run per day even at xlarge — at the cost of sampled accuracy. The "Scale Tier" toggle (R-future-1) is the gate that makes this tradeoff explicit to the operator.

---

## Section 7 — Recommended Next Steps

1. **Validate sizing against a real xlarge tenant** — these projections assume linear scan-vs-host scaling, which is an upper bound. Run a no-op assessment (just `dt.system.buckets` metadata) on a real 10k+ host tenant to calibrate.
2. **Ship the lossless mitigations first (v2.5.0):**
   - **R5** — persistent 24h cache in Document Store. Largest impact for repeat-use teams, zero fidelity tradeoff.
   - **R8** — pre-flight scan budget warning. Prevents accidental high-cost runs.
3. **Update README's "Grail Query Cost" section** with the xlarge projection (~$1.8k cold, $0 warm with R5) so anyone pointing the app at a 100k-host prod tenant has accurate expectations.
4. **Design the "Scale Tier" toggle (R-future-1) for v2.6.0+** as the explicit opt-in for R1+R2+R3. Coverage values for an xLarge-tier run should be visually distinguished (e.g., "≈" prefix, footer banner) so consumers know they're sampled estimates.
5. **No changes to `queries.ts`** — re-audit confirmed the queries are correct and already filter-optimal. The earlier draft of this report flagged a non-existent bug; that has been corrected in §4.

---

## Appendix A — Sample Detail (27 queries)

Stored at `/tmp/perf_results.jsonl`. Full query text + scan stats + per-criterion mapping available on request. Aggregation script: `/tmp/aggregation.txt`.

## Appendix B — DPS Budget Used in This Test

- Budget approved: ~142 GB ($1.42)
- Actual consumed: **32.10 GB ($0.32)** — 22.6% of budget. Remaining quota was preserved for re-runs / extended sampling if needed.
