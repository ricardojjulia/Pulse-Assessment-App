# Pulse Assessment — Complete Project Memory

> Everything the next developer needs to continue work on this app:
> domain model, every DQL pattern, scoring algorithm, optimization
> stack, all measured numbers, bug history, deployment journey,
> validation runbook, debugging workflows.
>
> The ONLY things omitted are tenant URLs/IDs and OAuth tokens.
> Everything else — design decisions, measurements, evidence, math
> — is here.

Document version: 2.1 — written 2026-05-29 against app version 2.5.2,
amended 2026-08-05 for v2.5.5.

> **What changed after v2.5.2 and is NOT reflected in the body below.**
> The body is a historical record and was left intact on purpose; read this
> list first, because a few of its numbers and names are now superseded.
>
> - **Economy Mode** (`scale-tier.ts`) rewrites the executed DQL at every
>   tier. Cost per full run went from a measured 370 GB / ~$3.70 to ~41 GB /
>   ~$0.41. Any scan figure below that predates this is the unoptimized
>   baseline. Sampling is applied only where both sides of a ratio are plain
>   counts; `countDistinct` gets a narrower window instead, because sampling
>   collapses it (log sources 63 → 28, AI providers 4 → 1).
> - **"Maturity" is now "Utilization"** everywhere — user-visible text in
>   v2.5.5, and the code identifiers in v2.5.6 (`utilizationScore`,
>   `cap.utilization`, `UtilizationCard`, `CovUtilRadar`). An earlier draft of
>   this note said the identifier rename was unsafe because snapshots persist
>   the key. That was wrong: a snapshot stores only name, colour, score,
>   consolidation and criteriaResults, and utilization is recomputed from the
>   criteria on load. Nothing persisted holds the word at all.
> - **App adoption** (`useAppAdoption.ts`) counts distinct users per app from
>   `dt.system.events` at zero scan cost, and reports penetration per
>   capability. It never feeds a score.
> - **Removed**: the Objectives/Projects screens and their hooks, the First Day
>   Results report, Assist on the Evolution page, and the colour legend on the
>   Executive view.
> - **Added**: persona PDF reports (Executive/Tactical/Technical + Custom +
>   Smart), Trace Proxy Mode for tenants without Traces on Grail, and a
>   Coverage-only radar plus a bar/line Capability Map on the Executive view.
> - Tenant identifiers were scrubbed from the repo; they remain in git history.

---

## Table of contents

1. [What this app does](#1-what-this-app-does)
2. [Domain model](#2-domain-model)
3. [Architecture overview](#3-architecture-overview)
4. [Capabilities and the 111 criteria](#4-capabilities-and-the-111-criteria)
5. [Complete DQL pattern reference](#5-complete-dql-pattern-reference)
6. [Scale Tier sampling](#6-scale-tier-sampling)
7. [24h persistent cache](#7-24h-persistent-cache)
8. [C3 smart-skip](#8-c3-smart-skip)
9. [Demo Mode (removed in v2.5.3)](#9-demo-mode-removed-in-v253)
10. [Perf instrumentation & JSON report](#10-perf-instrumentation-json-report)
11. [UI and presentation layer](#11-ui-and-presentation-layer)
12. [DPS cost model](#12-dps-cost-model)
13. [Snapshot persistence](#13-snapshot-persistence)
14. [Build, deploy, run](#14-build-deploy-run)
15. [Design decisions journal](#15-design-decisions-journal)
16. [The denominatorConstant migration](#16-the-denominatorconstant-migration)
17. [AI Observability window fix — full forensics](#17-ai-observability-window-fix)
18. [Concrete measurements from the test tenant](#18-concrete-measurements)
19. [Bug history](#19-bug-history)
20. [Validation runbook (MCP queries)](#20-validation-runbook)
21. [Migration from v2.4.x](#21-migration-from-v24x)
22. [Debugging workflows](#22-debugging-workflows)
23. [Known limitations and false-positive guidance](#23-known-limitations)
24. [Glossary](#24-glossary)

---

## 1. What this app does

Pulse Assessment is a native Dynatrace App that scores **observability
coverage and utilization** across 9 capability areas using ~111 DQL
criteria. The output is a radar chart + capability cards + a utilization
report card, optionally exported as a PDF.

It's designed for sales engineers, customer success teams, and platform
owners who need to answer:

- "How well is this tenant *using* Dynatrace?" (Coverage view)
- "Where is the operating utilization for each capability?" (Utilization view)
- "What's the recommended next investment?" (Executive Summary view)
- "Have we improved over time?" (Evolution Over Time comparison)

The 9 capabilities map to Dynatrace's coverage taxonomy:

| Capability | # criteria | Color | Examples |
|---|---:|---|---|
| Infrastructure Observability | 22 | `#3B82F6` blue | Host CPU/memory/disk coverage, K8s cluster coverage, Davis problem coverage |
| Application Observability | 13 | `#8B5CF6` purple | Service span coverage, distributed tracing %, root-span %, anomaly detection |
| Digital Experience | 11 | `#EC4899` pink | RUM session coverage, mobile crash tracking, synthetic checks |
| Log Analytics | 16 | `#F59E0B` amber | Log volume, structured logging %, log-source diversity, bucket usage |
| Application Security | 11 | `#EF4444` red | Security event coverage, security-event-type coverage, attack detection |
| Threat Observability | 11 | `#F97316` orange | Problem entity correlation, error-log threat coverage |
| AI Observability | 9 | `#06B6D4` cyan | AI/LLM span coverage, token tracking, provider diversity, cost tracking |
| Business Observability | 8 | `#10B981` emerald | Bizevent volume, type diversity, provider diversity |
| Software Delivery | 10 | `#6366F1` indigo | Deployment event coverage, change failure rate, lead time |

Total: **111 criteria** (count may drift ±2 across releases — current
count is `113 unique DQL strings after dedup` in v2.5.2; the dedup
collapses identical queryB strings across criteria).

---

## 2. Domain model

### 2.1 Type hierarchy

Source: `ui/app/queries.ts`:

```ts
interface Threshold {
  min: number;
}

interface Criterion {
  id: string;              // e.g. "i1", "ai3", "sd10" — stable ID
  label: string;           // shown on the capability card
  description: string;     // sentence explaining intent
  query: string;           // numerator DQL — returns one number
  queryB?: string;         // OPTIONAL denominator DQL.
                           //   coverage = query / queryB * 100
  denominatorConstant?: number;  // OPTIONAL fixed denominator,
                                 //   MUTUALLY EXCLUSIVE with queryB
                                 //   (added in v2.5.0 to eliminate
                                 //   wasteful constant-return queries)
  thresholds: Threshold[];       // value >= threshold.min ⇒ that
                                 // tier passes; usually 2-3 tiers
}

interface CapabilityDef {
  name: string;            // one of 9 hardcoded values
  color: string;           // hex
  criteria: Criterion[];
}

const CAPABILITIES: CapabilityDef[];   // single source of truth
```

### 2.2 The scoring algorithm

Implemented in `useCoverageData.runAssessment()` around lines 750–820.
Per criterion:

```text
1.  valueA = cache.get(criterion.query) ?? -1
2.  If valueA == -1:
      value = 0; error = true                  (query failed)
    Else:
3a. If criterion.queryB:
      valueB = cache.get(criterion.queryB) ?? -1
      If valueB <= 0:
        value = 0                              (no denominator data)
      Else:
        value = min( round((valueA / valueB) * 1000) / 10 , 100 )
3b. Else if criterion.denominatorConstant != null:
      const denom = criterion.denominatorConstant
      If denom <= 0:
        value = 0
      Else:
        value = min( round((valueA / denom) * 1000) / 10 , 100 )
3c. Else:
      value = valueA                           (single-source criterion)
4.  passed = criterion.thresholds.some(t => value >= t.min)
5.  points = passed ? 1 : 0
```

Notes:
- Value is always a percentage 0–100, even for single-source criteria.
- `Math.min(..., 100)` caps overshoot when valueA briefly exceeds valueB.
- Three-decimal precision then truncate to one (1234 → 12.3).

### 2.3 Capability score

```
capScore = round(passedCount / cap.criteria.length * 100)
```

Drives radar segment fill. Failed criteria (`error: true`) count as
not-passed.

### 2.4 Capability utilization score

Each criterion is mapped to a tier in `ui/app/data/criterionTiers.ts`:

```ts
type CriterionTier = 'foundation' | 'bestPractice' | 'excellence';
```

Then:

```text
fPct = foundation.passed / foundation.total
bPct = bestPractice.passed / bestPractice.total
ePct = excellence.passed / excellence.total

# Progressive gating:
effB = (fPct >= 0.8) ? bPct : 0
effE = (effB >= 0.6) ? ePct : 0

# Weighted score with hardcoded weights:
const FOUNDATION_WEIGHT     = 60
const BEST_PRACTICE_WEIGHT  = 25
const EXCELLENCE_WEIGHT     = 15

utilizationScore = round(fPct * 60 + effB * 25 + effE * 15)
```

**Do not change these weights without product approval.** They're part
of the published assessment methodology.

Utilization level (visual badge):

| Level | Label | Condition |
|---:|---|---|
| 0 | Not Adopted | default |
| 1 | Foundation | fPct >= 0.5 |
| 2 | Operational | fPct == 1 AND bPct >= 0.5 |
| 3 | Optimized | fPct == 1 AND bPct == 1 AND ePct >= 0.5 |

Utilization band:

| Band | Range |
|---|---:|
| Excellent | utilizationScore >= 80 |
| Good | utilizationScore >= 60 |
| Moderate | utilizationScore >= 40 |
| Low | utilizationScore >= 20 |
| N/A | utilizationScore < 20 |

### 2.5 Overall scores

```ts
totalScore        = round(mean of capabilities.score)
overallMaturityLv = round(mean of capabilities.effectiveUtilizationScore)
```

Shown in radar center and PDF cover.

### 2.6 Consolidation factor

User-adjustable per capability (slider in `ConsolidationPanel.tsx`,
range 0–100). Represents "how much of the real estate is in Dynatrace":

```ts
adjScore     = round(rawScore * factor / 100)
adjUtilization  = round(utilizationScore * factor / 100)
```

Stored in `useCoverageData.consolidation: Record<string, number>`.
If product wants to remove this feature, also remove the slider in
`ConsolidationPanel.tsx` and the section in
`generateFirstDayReport.ts`.

---

## 3. Architecture overview

### 3.1 Module dependency graph

```
                          ┌─────────────────┐
                          │   queries.ts    │ ← single source of truth
                          │ 9 capabilities  │   for ALL DQL definitions
                          │ ~111 criteria   │
                          └────────┬────────┘
                                   │ CAPABILITIES
                                   ▼
   ┌──────────────────┐   ┌─────────────────────┐
   │  scale-tier.ts   │   │  useCoverageData    │
   │ (pure module)    │──▶│  (THE big hook)     │
   │ scaleQuery()     │   └────────┬────────────┘
   └──────────────────┘            │  CoverageData
            ▲                       ▼
            │              ┌────────────────────┐    ┌────────────────────┐
   ┌────────┴─────────┐    │  App.tsx           │───▶│  Routes            │
   │  useScaleTier    │───▶│  composes hooks    │    │  / and /compare    │
   │  (auto detect)   │    └────────┬───────────┘    └────────┬───────────┘
   └──────────────────┘             │                          │
                                    │                          ▼
                                    │              ┌───────────────────────┐
                                    └─────────────▶│ CoverageAssessment    │
                                                   │ (radar, cards, foot)  │
                                                   └─────────┬─────────────┘
                                                             │
                              ┌──────────────────────────────┼────────────┐
                              ▼                              ▼            ▼
                  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────┐
                  │   TechRadar (svg)  │  │  CapabilityCards   │  │   etc.       │
                  └────────────────────┘  └────────────────────┘  └──────────────┘
```

### 3.2 Hook responsibilities

| Hook | Returns | Owns |
|---|---|---|
| `useScaleTier()` | `{ tier, autoTier, override, hostCount, setOverride, refreshTier, detecting }` | Host-count detection, tier resolution, localStorage override |
| `useDevMode()` | `{ isDev }` | URL `?dev=1` + localStorage `cca.dev` |
| `useCoverageData(tier, scaleMeta)` | The big `CoverageData` object | Two-phase Grail execution, scoring, perf entries, cache I/O |
| `useAssessmentHistory()` | `{ snapshots, saveSnapshot, removeSnapshot }` | Document Store snapshot persistence (separate from query cache) |
| `usePreflight()` | `{ checks, running, allPassed, runPreflight }` | OAuth scope preflight before first run; 7 cheap probe queries |

### 3.3 File map — current

| File | Lines | Purpose |
|---|---:|---|
| `ui/app/scale-tier.ts` | 162 | `scaleQuery(q, tier)`, `TIER_CONFIG`, `tierFromHostCount`, `isHotSource` |
| `ui/app/hooks/useScaleTier.ts` | ~170 | Detect host count + persist override |
| `ui/app/hooks/useDevMode.ts` | ~70 | URL/localStorage flag reader |
| `ui/app/components/ScaleTierBanner.tsx` | ~95 | Yellow banner for live Large/xLarge; hidden in Exact |
| `ui/app/components/DpsCostBadge.tsx` | 165 | Toolbar inline cost indicator |
| `ui/app/perf/types.ts` | ~280 | `PerfReport` shape, `classifySource` |
| `ui/app/perf/buildReport.ts` | ~240 | Build + download JSON |
| `ui/app/perf/queryCache.ts` | 292 | Document Store cache |
| `docs/PERFORMANCE-REPORT-80K-HOSTS.md` | 262 | Sizing study |
| `docs/HANDOFF.md` | ~430 | Quick-pickup guide for next dev |
| `docs/MEMORY.md` | this file | Full technical reference |

### 3.4 File map — modified in v2.5.x

| File | What changed |
|---|---|
| `ui/app/queries.ts` | Added `denominatorConstant?: number` to `Criterion`. 11 criteria converted (see §16). 16 substring swaps in the AI Obs block: `from:now()-2h` → `from:now()-72h` (see §17). |
| `ui/app/hooks/useCoverageData.ts` | Two-phase execution, C3 skip set, cache integration, scaleQuery, perf entry capture. **The big diff** — read §15 before editing. |
| `ui/app/pages/CoverageAssessment.tsx` | Props: `scale`, `isDev`. Toolbar wires `DpsCostBadge` + (gated by `isDev`) Force-refresh + Download perf JSON buttons. |
| `ui/app/App.tsx` | Mounts `useScaleTier`, `useDevMode`. Threads them into `CoverageAssessment`. |
| `app.config.json` | Bumped to `2.5.2`. |
| `ui/app/appVersion.ts` | `"2.5.2"`. |
| `CHANGELOG.md` | v2.5.0 entry. v2.5.1 / v2.5.2 entries still pending. |

---

## 4. Capabilities and the 111 criteria

### 4.1 ID namespace map

ID pattern: `<prefix><number>`. IDs are stable contracts — they appear
in PDF reports, snapshots, URL params, perf JSONs. **Never reuse a
retired ID** for a different criterion.

| Capability | Prefix | Range |
|---|---|---|
| Infrastructure Observability | `i` | i1–i22 |
| Application Observability | `a` | a1–a13 |
| Digital Experience | `d` | d1–d11 |
| Log Analytics | `l` | l1–l16 |
| Application Security | `s` | s1–s11 |
| Threat Observability | `t` | t1–t11 |
| AI Observability | `ai` | ai1–ai9 |
| Business Observability | `b` | b1–b8 |
| Software Delivery | `sd` | sd1–sd10 |

### 4.2 Adding a criterion checklist

1. Pick the next sequential ID for the capability (e.g. `i23`).
2. Add the criterion block in `queries.ts` inside the right capability.
3. Pick the tier in `ui/app/data/criterionTiers.ts`
   (`foundation` / `bestPractice` / `excellence`).
4. Add `description`/remediation text in
   `ui/app/data/criterionRemediation.ts` (optional — only if you want
   the criterion to show actionable advice in the Executive view).
5. Add an `importance` in `ui/app/data/criterionImportance.ts`
   (`high` / `medium` / `low`) for the Executive view sorting.
6. Run the numerator + denominator via MCP against a real tenant.
   Confirm neither always returns 0 nor always returns 100.
7. If `queryB` would be a literal constant (e.g. "expected 5 event
   kinds"), use `denominatorConstant: 5` instead — see §16.
8. Run a side-by-side capability score comparison to confirm no
   regression.
9. Bump the app version (`app.config.json` AND `appVersion.ts`).
10. Add a CHANGELOG entry.

### 4.3 Distribution of windows across criteria

```
from:now()-2h         13 criteria   (spans, AI Obs pre-v2.5.1)
from:now()-72h        27 criteria   (Davis problems, AI Obs post-fix)
| filter timestamp > now() - 2h    56 criteria   (logs, events, bizevents)
| filter timestamp > now() - 24h    7 criteria   (events 24h)
| filter timestamp > now() - 72h    1 criterion  (events 72h)
```

### 4.4 Distribution by source

For the unique post-dedup queries in v2.5.2:

| Source | Unique queries | Typical scan @ test tenant |
|---|---:|---:|
| logs | 23 | 147 GB |
| spans | 22 | 24 GB |
| metrics (timeseries) | 19 | 0 GB (metadata) |
| entity | 23 | 0 GB (metadata) |
| events | 10 | 0.4 GB |
| bizevents | 9 | 0.4 GB |
| problems (Davis) | 7 | 0.5 GB |
| **Total** | **113** | **173 GB** |

This is the post-`denominatorConstant`-fix profile. Before the fix it
was 123 unique queries / 220 GB. See §16 + §17.

---

## 5. Complete DQL pattern reference

The 111 criteria use 8 distinct DQL sources. Each has a typical pattern.
Use these as templates when adding new criteria.

### 5.1 Entity counts (cheap, no Grail scan)

Pattern: `fetch dt.entity.<class> | summarize count()`. Returns the
count of entities in Smartscape. No data scan.

```dql
fetch dt.entity.host | summarize count()
fetch dt.entity.service | summarize count()
fetch dt.entity.kubernetes_cluster | summarize count()
fetch dt.entity.application | summarize count()
fetch dt.entity.mobile_application | summarize count()
fetch dt.entity.cloud_application_namespace | summarize count()
fetch dt.entity.process_group | summarize count()
fetch dt.entity.process_group_instance | summarize count()
fetch dt.entity.disk | summarize count()
fetch dt.entity.network_interface | summarize count()
```

Used as denominators for many criteria. **Critical to C3 smart-skip** —
these run in Phase 1 of the two-phase execution. See §8.

For traversal counts (e.g. "how many hosts have a network interface"):

```dql
fetch dt.entity.network_interface
| fieldsAdd belongs_to = belongs_to[dt.entity.host]
| expand belongs_to
| summarize count = countDistinct(belongs_to)
```

Note the `countDistinct(belongs_to)` after expand — this counts the
distinct hosts, not the total number of network interfaces.

### 5.2 Metric timeseries (cheap, metadata)

Pattern: aggregate by entity, dedup, count distinct entities seen with
the metric.

```dql
timeseries val=avg(dt.host.cpu.usage), by:{dt.entity.host}
| fields dt.entity.host
| dedup dt.entity.host
| summarize c=count()
```

Used for i1–i8 (host CPU/memory/disk/availability/network/process/k8s
coverage). Zero data scan because timeseries reads only the per-series
metadata.

For per-namespace metrics:

```dql
timeseries val=avg(dt.kubernetes.container.cpu_usage), by:{k8s.cluster.name}
| fields k8s.cluster.name
| dedup k8s.cluster.name
| summarize c=count()
```

### 5.3 Logs (the heaviest source)

Window: `2h` by default. Scale Tier rewrites this in Large/xLarge.

Numerator pattern — "count logs with property X":

```dql
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(<property>)
| summarize count()
```

Denominator pattern — "total logs in the window":

```dql
fetch logs
| filter timestamp > now() - 2h
| summarize count()
```

(This denominator is used by 9 different criteria — the `Set` dedup
in `executeAllUnique` collapses them to one execution per run.)

Distinct entity count pattern:

```dql
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(dt.entity.host)
| summarize count = countDistinct(dt.entity.host)
| fields count
```

Distinct property values pattern:

```dql
fetch logs
| filter timestamp > now() - 2h
| summarize countDistinct(log.source)

fetch logs
| filter timestamp > now() - 2h
| summarize countDistinct(loglevel)
```

Per-host multi-source aggregation (l14 "multi-source host logging"):

```dql
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(dt.entity.host)
| summarize sources = countDistinct(log.source), by:{dt.entity.host}
| filter sources >= 2
| summarize count()
```

Pattern-match filter (l12 "structured logging %"):

```dql
fetch logs
| filter timestamp > now() - 2h
| filter matchesPhrase(content, "{\\\"")
| summarize count()
```

### 5.4 Spans

Window: `2h` for non-AI criteria; **72h for AI Obs criteria** (see §17).

Total span count:

```dql
fetch spans, from:now()-2h
| summarize count()
```

Distinct services in spans:

```dql
fetch spans, from:now()-2h
| summarize count = countDistinct(coalesce(dt.entity.service, service.name))
| fields count
```

Root spans only:

```dql
fetch spans, from:now()-2h
| filter request.is_root_span == true
| summarize count = countDistinct(coalesce(dt.entity.service, service.name))
| fields count
```

Cross-service trace detection (a10):

```dql
fetch spans, from:now()-2h
| summarize services = countDistinct(dt.service.name), by:{trace.id}
| filter services > 1
| summarize count()
```

DB call detection (a13):

```dql
fetch spans, from:now()-2h
| filter isNotNull(db.system)
| summarize count = countDistinct(coalesce(dt.entity.service, service.name))
```

AI/LLM span fingerprint (the canonical AI detection pattern):

```dql
fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system)
      or isNotNull(gen_ai.provider.name)
      or isNotNull(gen_ai.request.model)
      or isNotNull(gen_ai.operation.name)
```

Used as the prefix for all 9 AI Obs criteria.

### 5.5 Davis problems (sparse, 72h)

```dql
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| summarize count()
```

The `dt.davis.is_duplicate` filter is standard. Skipping it would
inflate counts because Davis emits the same root cause as multiple
problem entries during stabilisation.

Affected-entity count (i9, t2):

```dql
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| fieldsAdd affected = affected_entity_ids
| expand affected
| filter startsWith(affected, "HOST-")
| summarize count = countDistinct(affected)
```

Category diversity (t3):

```dql
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| summarize count = countDistinct(event.category)
```

Recurring entity detection (t9):

```dql
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| fieldsAdd affected = affected_entity_ids
| expand affected
| summarize problem_count = count(), by:{affected}
| filter problem_count > 1
| summarize count()
```

### 5.6 Events

Two windows in use: `2h` and `24h`. Events are continuous (every tenant
emits SYNTHETIC_EVENT, SDLC_EVENT, DAVIS_EVENT, DAVIS_PROBLEM).
Sparse-by-kind queries (`SECURITY_EVENT`, `CUSTOM_DEPLOYMENT`) may
return 0 if the tenant doesn't ingest that kind.

Event kind diversity:

```dql
fetch events
| filter timestamp > now() - 2h
| summarize countDistinct(event.kind)
```

Filter by event.kind (s2/s3 "security events", sd2 "custom deployments"):

```dql
fetch events
| filter event.kind == "SECURITY_EVENT"
| filter timestamp > now() - 24h
| summarize count = countDistinct(event.type)

fetch events
| filter event.kind == "CUSTOM_DEPLOYMENT"
| filter timestamp > now() - 24h
| summarize count()
```

Affected entity expansion (t11):

```dql
fetch events
| filter timestamp > now() - 2h
| filter isNotNull(affected_entity_ids)
| summarize count()

# Or with expand:
fetch events
| filter event.kind == "SECURITY_EVENT"
| filter timestamp > now() - 24h
| fieldsAdd affected = affected_entity_ids
| expand affected
| summarize count = countDistinct(affected)
| fields count
```

### 5.7 Bizevents

Window: `2h`. Bizevents are continuous in tenants that ingest them.

```dql
fetch bizevents
| filter timestamp > now() - 2h
| filter isNotNull(dt.entity.service)
| summarize count()

fetch bizevents
| filter timestamp > now() - 2h
| summarize count = countDistinct(event.type)

fetch bizevents
| filter timestamp > now() - 2h
| summarize count = countDistinct(event.provider)
```

### 5.8 Security and threat patterns (mixed sources)

Threat criteria mix events and logs:

```dql
# Error log threat coverage (t5)
fetch logs
| filter timestamp > now() - 2h
| filter loglevel == "ERROR"
| filter isNotNull(dt.entity.host)
| summarize count = countDistinct(dt.entity.host)
| fields count

# Trace-correlated logs (t8)
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(trace_id)
| summarize count()

# Log-based events (l15)
fetch events
| filter timestamp > now() - 24h
| filter event.kind == "LOG"
| summarize count()
```

### 5.9 Sentinel pattern — `data record(...)` (DQL constant literal)

We tried `data record(x: 5)` as a zero-scan way to provide constant
denominators. **The DQL parser rejected it** (`PARAMETER_MUST_NOT_BE_AN_AGGREGATION`).
This is why we settled on the code-level `denominatorConstant` field
in the `Criterion` type instead — see §16.

If a future DQL release supports `data record` literals, the migration
back is mechanical: replace `denominatorConstant: N` with
`queryB: "data record(c: N)"`.

---

## 6. Scale Tier sampling

Source: `ui/app/scale-tier.ts`, `ui/app/hooks/useScaleTier.ts`,
`ui/app/components/ScaleTierBanner.tsx`. Full sizing study:
`docs/PERFORMANCE-REPORT-80K-HOSTS.md`.

### 6.1 Why it exists

The default DQL queries scan `now()-2h` of logs / spans / events /
bizevents. On a small tenant that's ~12 GB; on an 80k-host tenant that
projects to ~17 TB per log query, which:
- exceeds Grail's per-query timeout (default 60 s, max 600 s),
- costs ~$1,800 per assessment at standard DPS pricing,
- saturates the per-tenant concurrency cap.

Scale Tier narrows the window AND adds `scanLimitGBytes` so the app
remains runnable on tenants of any size.

### 6.2 The three tiers

| Tier | Auto-trigger | Window | scanLimitGBytes | Sampled? |
|---|---|---|---:|---|
| `exact` | hosts ≤ 5 000 | 2 h (verbatim) | none | No — ground truth |
| `large` | 5 000 < hosts ≤ 50 000 | 30 min | 200 GB | Yes — minor drift on sparse signals |
| `xlarge` | hosts > 50 000 | 5 min | 50 GB | Yes — ±5–10% on typical workloads |

Thresholds are hardcoded in `TIER_CONFIG.minHosts` / `maxHosts`. They
were chosen to:
- Keep small/medium customers in ground-truth mode (Exact).
- Avoid Grail timeouts above ~10 GB scan per query.
- Cap xLarge cost below $50/run regardless of tenant size.

### 6.3 `scaleQuery(q, tier)` — the pure rewrite function

Input: query string + tier. Output: query string Grail will actually
run. Same input ALWAYS produces same output — pure function, no
network.

```ts
scaleQuery(q, 'exact')  // q verbatim
scaleQuery(q, 'large')  // q rewritten if isHotSource(q)
scaleQuery(q, 'xlarge') // q rewritten if isHotSource(q)
```

`isHotSource(q)` matches:

```ts
function isHotSource(query: string): boolean {
  return (
    /\bfetch\s+logs\b/i.test(query) ||
    /\bfetch\s+spans\b/i.test(query) ||
    /\bfetch\s+events\b/i.test(query) ||
    /\bfetch\s+bizevents\b/i.test(query)
  );
}
```

For a hot source, the rewrite:
1. Strips any `| filter timestamp > now() - Nh` stage.
2. Strips any `, from:now()-Nh` from the fetch clause.
3. Replaces the fetch with
   `fetch <src>, from: now()-<window>, scanLimitGBytes: <cap>`.

Concrete example for tier=`xlarge`:

```dql
# Original (criterion l1 numerator):
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(dt.entity.host)
| summarize count = countDistinct(dt.entity.host)
| fields count

# After scaleQuery(q, 'xlarge'):
fetch logs, from: now()-5m, scanLimitGBytes: 50
| filter isNotNull(dt.entity.host)
| summarize count = countDistinct(dt.entity.host)
| fields count
```

### 6.4 Sources NOT rewritten

`scaleQuery` deliberately leaves these alone:

- `fetch dt.davis.problems` — not a hot source; 72 h is intentional
- `fetch dt.entity.*` — metadata, no scan
- `timeseries` — metadata, no scan
- Any query whose source the regex doesn't match

If you add a new criterion using a new source that should NOT be
narrowed (e.g. `fetch dt.security.events`), don't add it to
`isHotSource`. Verify with `scaleQuery(q, 'xlarge')` that the rewrite
is a no-op.

### 6.5 Manual override

User clicks Exact / Large / xLarge buttons on the `ScaleTierBanner`.
Override persists in `localStorage.cca.scaleTier.override`. Clicking
the auto-detected tier clears the override.

Override is the only way to deviate from auto-detection.

### 6.6 Cache key MUST include tier

The cache key is `${tier}.${fnv32(originalQuery)}`. This is critical:
a Large-tier value is NEVER served to an Exact-tier caller, because
the rewritten query produced different data. Get this wrong and users
see wildly incorrect coverage.

See `ui/app/perf/queryCache.ts:103`.

### 6.7 Validation evidence

On our test tenant (~54 hosts):

| Query | Exact | Large | xLarge |
|---|---:|---:|---:|
| `fetch logs ... isNotNull(dt.entity.host) ... countDistinct(host)` | 11.90 GB / 31 hosts | 3.10 GB / 31 hosts | 0.42 GB / 24 hosts |
| `fetch spans ... isNotNull(db.system)` | 0.11 GB / 827 traces | 0.04 GB / 388 traces | (cap) / |
| `fetch events ... countDistinct(event.kind)` | 0.06 GB / 4 kinds | 0.01 GB / 4 kinds | / 4 kinds |

Key findings:
- Large tier on this tenant: same `countDistinct(host)` (31 = 31) —
  all active hosts emit logs within any 30-min window.
- xLarge tier: `countDistinct(host)` dropped from 31 to 24 — 7 hosts
  emit logs less than once every 5 min. Real tenants at xlarge scale
  with continuous ingest will see smaller drift.
- `countDistinct(event.kind)` identical across tiers — small,
  stable cardinality.

### 6.8 ScaleTierBanner UI states

| State | Background | Label | Buttons |
|---|---|---|---|
| `exact` | hidden entirely | — | — |
| `large` / `xlarge` | yellow `Background.Container.Warning` | `Scale tier: Large` (host count + auto/override) | Exact, Large, xLarge tier-switch |

The Scale Tier banner uses Background.Container.Warning yellow. Screenshots can be
classified at a glance.

---

## 7. 24h persistent cache

Source: `ui/app/perf/queryCache.ts`. Storage: Document Store.

### 7.1 What's cached

The numeric result of every DQL query the assessment runs, plus the
scannedBytes/records at the time of caching (for "saved" stats).
Same-day re-runs return values instantly with zero Grail cost.

### 7.2 Document shape

One document per tenant. Document ID `pulse-querycache`,
type `pulse-querycache`.

```ts
interface CacheDocument {
  schemaVersion: 1;
  tenantId: string;
  entries: Record<string, CacheEntry>;
}

interface CacheEntry {
  v: number;        // value returned by extractValue()
  ts: number;       // epoch ms when stored
  bytes: number;    // scannedBytes at write time
  records: number;  // scannedRecords at write time
}
```

For ~110 entries, the document is ~16 KB. Well below Document Store
size limits (megabytes).

### 7.3 Lifecycle within a run

```text
1. await persistentCache.load()              # one Doc Store GET
   - Parses doc, prunes entries > 24h old, populates in-mem Map
   - Captures docVersion for optimistic locking on write

2. For each unique query in this run:
     entry = persistentCache.get(query, tier)
     if entry:
       value = entry.v                        # cache hit, zero scan
       perfEntry.cached = true
       perfEntry.cacheAgeSec = (now - entry.ts) / 1000
       continue
     else:
       executedQ = scaleQuery(query, tier)
       result = await executeDql(executedQ)
       persistentCache.set(query, tier, result.value, result.bytes, result.records)
       perfEntry.cached = false

3. void persistentCache.flush()              # fire-and-forget Doc Store update
```

### 7.4 Cache key shape

```ts
makeKey(query, tier) = `${tier}.${fnv32(query)}`
```

Where `fnv32` is a tiny 32-bit FNV-1a hash producing an 8-char hex
string. Rationale:

- **Tier-segmented**: Large-tier value ≠ Exact-tier value, must not
  serve cross-tier.
- **Hashed**: query strings can be hundreds of chars; the hash keeps
  the document small.
- **Same FNV family** as the hash used elsewhere in the codebase for
  deterministic seeding.

### 7.5 TTL = 24h

Enforced at load time. Entries with `now - ts > 24h * 60 * 60 * 1000`
are dropped from the in-memory map and (eventually) overwritten on
flush.

Why 24h:
- Most assessment values change on a multi-hour scale.
- Same-day re-runs (morning + afternoon, before + after a meeting)
  pay once.
- After day rollover, full cost again — this is the right "fresh data"
  cadence for an observability assessment.

There's a deliberately-not-shipped option for tier-aware TTL (24h for
fast signals, 7d for entity counts). See §15.x or `HANDOFF.md` §7.4
for the C7 roadmap discussion. Pros: even cheaper re-runs. Cons:
drift in entity counts when topology changes mid-week.

### 7.6 Failure modes

| Failure | Behavior |
|---|---|
| HTTP 404 on load | Treated as empty cache (first run for this tenant). All queries miss. App functions normally. |
| HTTP 5xx on load | Logged warning, `loaded = false`, every query misses. App behaves exactly like pre-v2.5. |
| HTTP 409 on flush (optimistic lock conflict) | Try createDocument fallback. If that also conflicts (409), drop this run's additions. Next run re-caches what it can. |
| HTTP 5xx on flush | Logged warning, drops this run's additions. |
| Invalid JSON in document | Treated as empty (schema mismatch). |
| `loaded = false` at get-time | Returns null → cache miss → live query |

**The app NEVER fails because of cache.** Every failure path degrades
gracefully to "behave like pre-cache".

### 7.7 Force-refresh

Operator path: click 🗘 Force refresh in the toolbar (gated
by `?dev=1`).

Programmatic path:
```ts
await coverageData.forceRefresh();
coverageData.refresh();  // optional — triggers a fresh run
```

`forceRefresh()` deletes the document on the server. It does NOT
re-run the assessment — separated so callers can invalidate without
re-running (e.g. before navigating away).

### 7.8 Validation evidence

On our test tenant, immediately after a cold run:

| Metric | Cold run | Warm re-run | Δ |
|---|---:|---:|---:|
| Wall-time | 8 620 ms | 584 ms | **-93%** |
| Total scanned | 173 GB | 0 GB | **-100%** |
| DPS estimate | $1.05–$1.61 | $0–$0 | -100% |
| Cache hits | 0/113 | 113/113 | hit rate 100% |
| Cache bytes saved | — | 169 GB | — |

Per-source on the warm run:
- logs: n=23 scan=0 GB p50=1ms p95=1ms
- spans: n=22 scan=0 GB p50=1ms p95=1ms
- events: n=10 scan=0 GB p50=1ms p95=1ms
- bizevents: n=9 scan=0 GB p50=1ms p95=1ms
- metrics: n=19 scan=0 GB p50=1ms p95=1ms
- entity: n=23 scan=0 GB p50=1ms p95=1ms
- problems: n=7 scan=0 GB p50=1ms p95=1ms

Cache age at the time of the warm run: 9–10 seconds (we ran them
back-to-back).

---

## 8. C3 smart-skip

Implementation: `useCoverageData.runAssessment` two-phase pass, added
in v2.5.0.

### 8.1 What it does

If a criterion's denominator is `fetch dt.entity.X | summarize count()`
and that returns 0, the numerator is mathematically guaranteed to
produce coverage `valueA / 0 = 0`. Executing the (often heavy)
numerator is pure waste. Skip it.

### 8.2 The two phases

```text
Phase 1:
  Execute only entity-count denominators.
  isEntityCountQuery matches:
    /^\s*fetch\s+dt\.entity\.[a-z_0-9]+\s*\|\s*summarize\s+count\(\)\s*$/

Compute skip set:
  For each criterion with queryB matching isEntityCountQuery:
    If cache.get(queryB) is 0, -1, or null:
      Add criterion.id to skippedCriteria
      Add criterion.query to skippedNumerators

Phase 2:
  Execute the union of:
    - Numerators of NOT-skipped criteria
    - Denominators not already executed in Phase 1
  Both phases share the same persistentCache, so Phase 2 hits cache on
  any query Phase 1 already cached.
```

### 8.3 Why ONLY entity-count denominators

A denominator like `fetch logs | summarize count()` (total logs in 2h)
might return 0 in a brand-new tenant with no logs ingested yet — but
that's a data problem, not a topology zero. The "entity absent" signal
is unique to entity counts; we know with certainty that all
numerator queries depending on that entity will be ill-defined.

For other zero denominators, the scoring path's existing `valueB <= 0
→ value = 0` handles them correctly. C3 just avoids the wasted query.

### 8.4 What's surfaced in the perf JSON

```json
{
  "run": {
    "skippedQueries": 17,
    "skippedCriteria": ["i7", "i10", "i12", "d1", "d2", ...]
  },
  "queries": [
    {
      "originalQuery": "fetch logs | filter ... cluster ...",
      "executedQuery": "fetch logs | filter ... cluster ...",
      "source": "logs",
      "scannedBytes": 0,
      "scannedRecords": 0,
      "wallTimeMs": 0,
      "resultValue": 0,
      "ok": true,
      "skipped": true,
      "skipReason": "fetch dt.entity.kubernetes_cluster | summarize count()",
      "usedByCriteria": ["i7"]
    },
    ...
  ]
}
```

Each skipped numerator gets a synthetic `PerfQueryEntry` with
`skipped: true` and the queryB that triggered the skip. The analyzer
can build a "tenant doesn't have X → saved Y MB" report.

### 8.5 What gets skipped on a K8s-less tenant

For a hypothetical tenant where the K8s + applications entity counts
return 0, the skip set looks like this:

| Entity = 0 | queryB string | Criteria skipped |
|---|---|---|
| `kubernetes_cluster` | `fetch dt.entity.kubernetes_cluster \| summarize count()` | i7 |
| `cloud_application_namespace` | `fetch dt.entity.cloud_application_namespace \| summarize count()` | i10, i12 |
| `application` (RUM / AppMon) | `fetch dt.entity.application \| summarize count()` | i19, i20, i21, i22, d1, d2, d3, d4, d5, d6, d7, d8, d11, l8 |

Total: 17 criteria skipped. This was validated during v2.5.0–v2.5.2
using a scripted scenario that synthesised these entity zeros (the
scenario tooling was removed in v2.5.3 — see §9).

### 8.6 Live evidence on small tenants

On our small test tenant, all 7 entity classes (host, service,
application, k8sCluster, k8sNamespace, pg, pgi) returned positive counts:
- host: 54
- service: 87
- application: 2
- kubernetes_cluster: 7
- cloud_application_namespace: 65
- process_group: 397
- process_group_instance: 731

→ C3 reports `skippedQueries: 0`, no savings. This is the correct
behavior — the tenant has all those entities.

C3 is essentially dormant on full-stack tenants. The savings appear
on tenants without K8s/RUM/applications.

---

## 9. Demo Mode (removed in v2.5.3)

v2.5.0–v2.5.2 shipped a Demo Mode with five canned tenant scenarios
(small-corp, medium-bank, legacy-no-k8s, xlarge-telco, xxlarge-cloud), a
sticky magenta footer bar (`DemoControlBar`), and a `__pulseDemo()` console
helper. It existed so SEs could demo the app at tenant sizes the team
didn't have direct access to, with zero DPS consumed.

v2.5.3 removed all of it: the `ui/app/demo/` directory, the
`DemoControlBar` component, the demo branch in `useCoverageData`, the
magenta variant of `ScaleTierBanner`, the `?demo=` URL param, the
`__pulseDemo()` console helper, and `docs/DEMO-MODE.md`. The diagnostic
functions that were bundled in (Force-refresh + Download perf JSON) moved
to small buttons in the existing toolbar, still gated by `isDev`.

If you need the scenarios back as a reference, see git history
(`b35eece..21b6f76`).

## 10. Perf instrumentation & JSON report

Source: `ui/app/perf/types.ts`, `ui/app/perf/buildReport.ts`, capture
in `useCoverageData.executeAllUnique`.

### 10.1 PerfQueryEntry shape

```ts
interface PerfQueryEntry {
  index: number;              // 0-based after dedup, sorted by scan desc
  originalQuery: string;      // as in queries.ts
  executedQuery: string;      // post-scaleQuery
  source:
    | 'logs' | 'spans' | 'events' | 'bizevents'
    | 'metrics' | 'entity' | 'problems' | 'security' | 'other';
  tier: ScaleTier;
  wallTimeMs: number;         // client-side round-trip
  scannedBytes: number;       // Grail-reported
  scannedRecords: number;
  scannedDataPoints: number;
  resultValue: number;        // post-extractValue()
  ok: boolean;
  errorMessage: string | null;
  usedByCriteria: string[];   // criterion IDs that consumed this query
  cached?: boolean;
  cacheAgeSec?: number;
  skipped?: boolean;
  skipReason?: string;
}
```

### 10.2 PerfReport shape

```ts
interface PerfReport {
  schemaVersion: 1;
  generated: string;          // ISO timestamp
  app: { name: 'Pulse Assessment', version: string };

  environment: {
    tenant: string;           // short tenant identifier (subdomain)
    date: string;             // YYYY-MM-DD
    demoActive: boolean;      // always false in v2.5.3+ (kept for schema stability)
    demoScenarioId: null;     // always null in v2.5.3+
    userAgent: string;
  };

  scale: {
    tier: ScaleTier;
    autoTier: ScaleTier | null;
    manualOverride: ScaleTier | null;
    hostCount: number | null;
  };

  entityCounts: EntityCounts | null;

  run: {
    startedAt: string;
    finishedAt: string;
    wallTimeMs: number;
    concurrency: number;      // 10 (CONCURRENCY constant)
    totalUniqueQueries: number;
    totalScannedBytes: number;
    totalScannedRecords: number;
    totalScannedDataPoints: number;
    estimatedDpsUsdHigh: number;
    estimatedDpsUsdLow: number;
    queriesFailed: number;
    cacheHits: number;
    cacheMisses: number;
    cachedBytesSaved: number;
    skippedQueries: number;
    skippedCriteria: string[];
  };

  bySource: Record<source, {
    count: number;
    scannedBytes: number;
    wallTimeMs: number;       // SUM across queries in this source
    wallTimeP50: number;
    wallTimeP95: number;
    wallTimeMax: number;
    failed: number;
  }>;

  topExpensiveQueries: Array<{
    originalQuery: string;
    source: string;
    scannedBytes: number;
    wallTimeMs: number;
    usedByCriteriaCount: number;
    scanBytesPerCriterion: number;   // scannedBytes / max(1, usedByCriteriaCount)
    rank: 'raw' | 'perCrit' | 'both';
  }>;

  capabilities: Array<{
    name: string;
    color: string;
    score: number;
    utilizationScore: number;
    maturityLevel: 0 | 1 | 2 | 3;
    criteriaCount: number;
    criteriaPassed: number;
    criteriaErrored: number;
  }>;

  queries: PerfQueryEntry[];   // sorted by scannedBytes desc
}
```

### 10.3 topExpensiveQueries — mixed ranking

The first half is top-N/2 by raw `scannedBytes` (absolute cost outliers).
The second half is top-N/2 by `scanBytesPerCriterion` (one-off cost
amortisation failures — high-scan queries serving only 1 criterion).

`rank` field:
- `'raw'`: in the raw top
- `'perCrit'`: in the perCrit top
- `'both'`: in both rankings (most concerning)

This dual ranking is why the v2.5.x perf-waste audit could spot the
`fields always5 = 5` patterns: they had `scanBytesPerCriterion ≈ raw
scannedBytes` (1 criterion served), high values, easy to flag.

### 10.4 Filename convention

```
pulse-perf-<tenant>-<tierSlug>-<isoTimestamp>.json
```

- `tenant`: short identifier (Pulse strips trailing `.apps.dynatrace.com`).
- `tierSlug`: `exact`, `large`, or `xlarge`.
- `isoTimestamp`: `.` and `:` replaced with `-` for filesystem safety.

Sorted alphabetically becomes chronological-by-tenant.

### 10.5 Build pipeline

```ts
buildReport({
  startedAt, finishedAt, wallTimeMs, concurrency,
  tenant, date,
  scale: { tier, autoTier, manualOverride, hostCount },
  entityCounts,
  capabilities,                    // CapabilityResult[]
  queryConsumers,                  // Map<query, criterionIds[]>
  entries: perfEntries,            // InFlightPerfEntry[] from the run
  cacheHits, cacheMisses, cachedBytesSaved,
  skippedQueries, skippedCriteria,
}): PerfReport
```

Returns a complete report. Then:

```ts
downloadReport(report): string   // returns the filename used
```

Triggers a `Blob` download via an in-DOM `<a download>` click. The
`<a>` is appended + removed; `URL.revokeObjectURL` runs on the next
tick so the click has time to start the download (works around a
Firefox edge case).

### 10.6 Live capture during the run

Per-query in the worker loop:

```ts
const t0 = performance.now();
let result, ok = true, errorMessage = null;
try {
  result = await executeDql(executedQ);
} catch (err) {
  ok = false;
  errorMessage = err.message || String(err);
  result = { value: -1, scannedBytes: 0, ... };
}
const t1 = performance.now();
// Sentinel check
if (result.value === -1 && ok) {
  ok = false;
  errorMessage = 'executeDql returned -1 sentinel';
}
perfEntries.push({ ... });
```

The `-1` sentinel check catches "silent" failures where executeDql
returned without throwing but the result is the failure value.

---

## 11. UI and presentation layer

### 11.1 The four state branches in CoverageAssessment

```tsx
{idle && !loading && (
  // Pre-run: IdleLeftPanel + capability picker grid
)}
{loading && (
  // Centered progress bar + "Querying X capabilities"
)}
{!idle && !loading && capabilities.length > 0 && (
  // Toolbar + ScaleTierBanner + main view + How-to-Analyze footer
)}
{error && (
  // Centered error message
)}

```

The toolbar adds two extra buttons when `isDev` is true:
`📥 Perf JSON` (download the perf report) and `🗘 Force refresh`
(clear the 24h cache and trigger a fresh run).

### 11.2 The three views

Toggled via `ToggleButtonGroup` in the toolbar:

| View | Content |
|---|---|
| `coverage` | Radar (left) + capability cards (right) |
| `utilization` | Utilization scorecard with foundation / bestPractice / excellence breakdown |
| `recommendations` | Executive summary with prioritized actions per importance level |

### 11.3 Toolbar (top, when results loaded)

```
[← Back] [↻ Refresh] [View: Cov|Mat|Exec] [Evolution Over Time] [First Day Results ▼]
                                                  Tenant: X · date · stats · DPS badge
```

The DPS badge is inline at the end of the right-aligned text. Customer
visible (no dev gate).

### 11.4 Footer

| Section | Gate | Content |
|---|---|---|
| `How to Analyze` collapsible | `viewMode === 'coverage' \|\| 'utilization'` | Legend + color scale |

### 11.5 Theme

`useCurrentTheme()` from `@dynatrace/strato-components/core`. Derived
`dk` (dark mode boolean) controls every `style` computation. The app
intentionally mirrors the Dynatrace tenant theme — don't hardcode
colors.

### 11.6 Color scale (radar segments)

```
N/A      Colors.Charts.Status.Critical.Default        0–19%   Critical gaps
Low      Colors.Charts.Categorical.Color14.Default   20–39%   Early adoption
Moderate Colors.Charts.Status.Warning.Default        40–59%   Partial
Good     Colors.Charts.Categorical.Color07.Default   60–79%   Strong
Excellent Colors.Charts.Status.Ideal.Default         80–100%  Full
```

These are the published assessment color bands. Don't change without
product approval.

---

## 12. DPS cost model

Surfaces: `DpsCostBadge.tsx` in the toolbar, `PerfReport.run.estimatedDpsUsd*`
in the JSON.

### 12.1 Per-run estimate

```ts
scannedGB = run.scannedBytes / (1024 ** 3)
costHigh  = scannedGB * 0.01    // upper-bound published DPS rate
costLow   = scannedGB * 0.0065  // lower-bound
```

The badge displays `costHigh` (conservative — customers on cheaper
contracts see a number bigger than their actual cost).

### 12.2 Annual cadence projections (tooltip)

```ts
savedGB    = lastRunMeta.cachedBytesSaved / 1024**3
coldRunUsd = costHigh + savedGB * 0.01   // what we'd pay if everything was cold

weeklyYear         = coldRunUsd * 52
dailyYearWithCache = coldRunUsd * 122    // assumes 24h cache absorbs ~67% of daily re-runs
dailyYearNoCache   = coldRunUsd * 365
```

The "122" comes from a customer running 3×/day with the 24h cache:
1 cold + 2 warm per day = ~1/3 cold-equivalent runs = ~365/3 = 122
cold runs/year.

### 12.3 Badge render

```
· ≈ $1.61 DPS · 173 GB scanned                       (cold run)
· ≈ <$0.01 DPS · 0 MB scanned · cache hit            (warm run, fully cached)
· ≈ $0.12 DPS · 13 GB scanned · saved $1.50          (partial cache)
· ≈ $0.45 DPS · 48 GB scanned · (running…)           (mid-run live)
```

### 12.4 Tooltip (multi-line via title attribute)

```
Current run scanned 173 GB of Grail data.
Cost estimate at standard DPS pricing: $1.12–$1.61 per run.

Cache: 0/113 queries served from the 24h Document Store cache.

Annual cost projection at this scale (assuming similar runs):
  • Weekly:                $84 / year
  • Daily (with cache):    $196 / year
  • Daily (without cache): $587 / year

Numbers are upper-bound estimates at $0.01/GiB. Your contract may be cheaper.
```

### 12.5 Projected per-tenant-scale cost table

From the v2.5.x perf report, projected per-run cost AFTER all v2.5.x
optimizations:

| Tenant scale | Tier | Cold run | Warm run | Avg 3×/day | Annual @ daily |
|---|---|---:|---:|---:|---:|
| Small (~54 hosts) | exact | $1.12–$1.61 | $0 | $0.37–$0.54 | $135–$196 |
| Medium (~5k hosts) | large | $1.30–$8 | $0 | $0.43–$2.67 | $158–$975 |
| Large (~10k hosts) | large | $2.60–$16 | $0 | $0.87–$5.33 | $317–$1 950 |
| xLarge (~80k hosts) | xlarge | $22–$34 | $0 | $7.33–$11.33 | $2 680–$4 140 |
| xxLarge (~250k hosts) | xlarge | $68–$105 | $0 | $22.67–$35 | $8 280–$12 775 |

Without Scale Tier (forcing Exact on xlarge): projected ~$1 800/run at
80k hosts; multiple log queries would hit Grail timeout.

---

## 13. Snapshot persistence

Source: `ui/app/hooks/useAssessmentHistory.ts`. Independent of query
cache.

### 13.1 What's persisted

```ts
interface AssessmentSnapshot {
  id: string;                // generated UUID
  timestamp: string;         // ISO
  totalScore: number;
  tenant: string;            // tenant subdomain (short identifier)
  capabilities: Array<{
    name: string;
    color: string;
    score: number;
    consolidation?: number;
    criteriaResults: Array<{
      id: string;
      label: string;
      value: number;
      points: number;
      error: boolean;
    }>;
  }>;
}
```

### 13.2 Storage layout

- localStorage key: `ppa-assessment-history` (cache for fast UI startup)
- Document Store type: `ppa-snapshot`
- Document ID: `cca-<snapshot.id>`
- Retention policy: keep all snapshots for 15 days in UI, but only
  one per calendar day in Grail (latest survives, older same-day ones
  get deleted from Doc Store).

### 13.3 When a snapshot is saved

In `CoverageAssessment.tsx`'s save effect: whenever a real run transitions
`loading=true → false` AND `capabilities.length > 0` AND the capability
score signature differs from the last saved one.


### 13.4 Evolution Over Time view

`ComparisonPage.tsx` lets the user pick any two snapshots and see:
- Side-by-side radar diff (overlaid)
- Per-criterion deltas
- Tier movements (Foundation → Operational etc.)
- Per-capability score change

A "Save current run" CTA explicitly persists if the user wants to
override the auto-save dedup.

---

## 14. Build, deploy, run

### 14.1 Prerequisites

- Node.js 20+ (24 LTS recommended per dt-app's warning)
- npm 10+
- `npm ci` only — never `npm install` (package-lock pins required
  versions, particularly Strato subpath imports)
- OAuth scopes declared in `app.config.json` (11 scopes total):
  ```
  storage:logs:read, storage:events:read, storage:spans:read,
  storage:metrics:read, storage:entities:read, storage:bizevents:read,
  storage:buckets:read, storage:system:read,
  document:documents:read, document:documents:write,
  document:documents:delete
  ```

### 14.2 Commands

```sh
# Local dev with hot reload
node_modules/.bin/dt-app dev
# Opens browser to OAuth on first run; prints embedded URL.

# Typecheck only (fast, ~5 s)
npx tsc --noEmit -p ui/tsconfig.json

# Full prod bundle
node_modules/.bin/dt-app build

# Deploy to the tenant in app.config.json#environmentUrl
node_modules/.bin/dt-app deploy
```

### 14.3 Version bump procedure

Bump BOTH:
- `app.config.json` → `"version": "X.Y.Z"`
- `ui/app/appVersion.ts` → `export const APP_VERSION = "X.Y.Z"`

If you skip either, the app catalog and the PDF report will disagree.

### 14.4 Common deploy errors

| Error | Cause | Fix |
|---|---|---|
| HTTP 400 "same version already installed with different checksum" | Bumped code but not version, or vice versa | Bump version in BOTH files |
| HTTP 403 Forbidden | OAuth user lacks `app-engine:apps:install` scope on target tenant | Use `dt-app dev` (no install needed). Request install rights from the tenant admin. |
| Port 3000 already in use | Old `dt-app dev` zombie | `lsof -i :3000` → `kill <pid>`. Or accept port 3001 (dt-app picks automatically). |
| Stale tokens, prompts browser | `.dt-app/.tokens.json` exp < now | Expected. Browser SSO completes the refresh. |

### 14.5 OAuth token cache

`.dt-app/.tokens.json` in the project root. Two tokens:
- `toolkit_token` — for tooling (build, dev server). Wide scope, tied
  to user's SSO identity, includes the tenant URL.
- `app_token` — for runtime API calls during local dev. Narrower scope
  matching `app.config.json#scopes`. Per-tenant.

**Treat this file as sensitive.** Don't commit. Don't paste content.
Refresh failures (HTTP 401 from sso.dynatrace.com) require deleting
the file and re-running `dt-app dev` to get fresh tokens via SSO.

### 14.6 Deployment lessons learned during v2.5.x

- **First deploy after a feature batch should NOT skip version bump.**
  We hit HTTP 400 "same version already installed" twice during v2.5.x;
  bump to 2.5.1 / 2.5.2 fixed it. Easy mistake.
- **Browser-cached bundle survives deploy.** After deploy, hard refresh
  (Cmd+Shift+R) in the browser; otherwise users may see the old
  bundle for up to several minutes.
- **OAuth tokens auto-refresh on `dt-app dev`, but only if the refresh
  token is still valid.** Refresh tokens expire on a ~weeks scale.
  When that happens you'll see "UNSUCCESSFUL_OAUTH_REFRESH_TOKEN_VALIDATION_FAILED";
  delete `.dt-app/.tokens.json` and re-authenticate.

---

## 15. Design decisions journal

These are deliberate choices that look weird in code but have a
specific reason. Don't "fix" them without understanding why.

### 15.1 The 24h cache is keyed by ORIGINAL query string

The in-memory `cache: Map<string, number>` in
`useCoverageData.executeAllUnique` uses the ORIGINAL query string as
the key. The actual Grail call uses `scaleQuery(q, tier)`. This is
intentional — downstream scoring looks up results by the criterion's
`query`/`queryB` fields. Switching to scaled keys would require
rewriting the entire scoring path.

### 15.2 Two-phase execution adds latency the first time

Phase 1 (entity counts) adds ~100–500 ms of wall time even when no
skips happen. Measured on our test tenant: 620 ms total instead of
~520 ms. Worth it because: (a) entity counts hit the cache on day-2
anyway, (b) the savings on tenants WHERE skips happen are large
(17 numerator queries pruned on a K8s-less tenant — see §8.5).

### 15.3 `useCoverageData(tier, scaleMeta)` accepts an optional 2nd arg

`scaleMeta` exists ONLY so the perf JSON can record `autoTier` and
`manualOverride` (the data lives in `useScaleTier`'s state, but the
JSON builder is in `useCoverageData`). Don't promote `scaleMeta` to
required — backward compat for callers that use `useCoverageData(tier)`.

### 15.4 `denominatorConstant` and `queryB` are mutually exclusive

Set ONE per criterion, never both. Scoring honors `queryB` first if
both are set, which silently masks the constant. TypeScript can't
catch this. The contract is the comment block in `queries.ts:22-30`
and a code review rule.

### 15.5 AI Obs uses 72h; other span queries use 2h

Pre-v2.5.1 AI Obs used 2h to match the rest. On our test tenant, MCP
confirmed the 2h window returned 0 gen_ai spans while 72h returned
244 964 (workload is bursty: LLM batch jobs, async). Switched to 72h
for ai1–ai9 only. Other span-based criteria (Application Observability)
stay at 2h because their workloads are continuous (microservices,
constant request traffic).

When adding a new span criterion, ask: is the signal continuous or
bursty? Continuous → 2h. Bursty (queues, batch jobs, infrequent user
actions) → 24h–72h.

### 15.6 `scaleQuery` does NOT rewrite Davis problems queries

`isHotSource(q)` matches only `fetch logs|spans|events|bizevents`.
Problem queries (`fetch dt.davis.problems`) stay verbatim across
tiers because:
- They already use 72h (sparse signal).
- Narrowing to 5 min would zero them out.
- Davis dedup keeps them small anyway.

If you add a new criterion using `fetch dt.security.events` and want it
narrowed in Large/xLarge, add `'security'` to the `isHotSource` regex.
Otherwise it'll always run at the verbatim window.

### 15.7 Strato banner color is semantic

Yellow `Background.Container.Warning` for live Large/xLarge tier
("informational, sampled estimate"). The yellow banner is the only
state — Exact tier doesn't show a banner at all.

### 15.8 `forceRefresh` is separated from `refresh`

`refresh` triggers a new assessment run (`setRunId(n+1)`). `forceRefresh`
clears the cache but doesn't re-run. The Force-refresh button calls
both in sequence — common case. But callers that want to invalidate
without re-running can call only `forceRefresh` (e.g. before navigating
away).

### 15.9 `sampled` flag on CoverageData is reserved for future use

`CoverageData` exposes `sampled: boolean` (true when `tier !== 'exact'`).
The snapshot save logic currently doesn't read it; the field is reserved
for a future "save with disclaimer" feature where Large/xLarge runs
would tag snapshots as "sampled" so the Evolution Over Time view can
visually distinguish them.

---

## 16. The denominatorConstant migration

### 16.1 The waste pattern

Pre-v2.5.0, the codebase had **11 criteria** whose `queryB` ran a heavy
Grail query and then DISCARDED the result, replacing it with a
hardcoded literal:

```dql
# Example: l9 queryB
fetch logs
| filter timestamp > now() - 2h
| summarize count = count()
| fields always5 = 5

# Example: s2 queryB
fetch events
| filter event.kind == "SECURITY_EVENT"
| filter timestamp > now() - 24h
| summarize count = countDistinct(event.type)
| fields expected = 5

# Example: t3 queryB
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| summarize count = countDistinct(event.category)
| fields expected = 4
```

The `fields <name> = N` directive replaces the output columns with a
literal. The query scans 15 GB of logs JUST to return the constant 5.

### 16.2 Discovery

Found during the v2.5.x perf-waste audit by inspecting
`topExpensiveQueries` in a real-tenant perf JSON. Three of the top-10
queries had `usedByCriteriaCount = 1` AND output suspicious literal-
like names (`always1`, `always2`, `always5`).

Then `grep -E "fields always|fields expected" queries.ts` found 11
total instances — 3 with `always{N}` (logs) and 8 with `expected = N`
(events / spans / bizevents / problems).

### 16.3 The fix

Added `denominatorConstant?: number` to the `Criterion` type:

```ts
interface Criterion {
  // ...
  queryB?: string;
  /** Hard-coded denominator when the expected value is a known constant
   *  (e.g., "5 expected log levels"). Use this INSTEAD of queryB whenever
   *  the denominator would be a query that just discards its result and
   *  returns a literal — those queries waste ~15 GB of Grail scan each
   *  for zero information gain.
   *  Mutually exclusive with queryB; useCoverageData honors queryB first. */
  denominatorConstant?: number;
  thresholds: Threshold[];
}
```

Scoring updated to handle the new field (see §2.2 step 3b).

### 16.4 Complete migration list

| Criterion | Capability | Old queryB (truncated) | New `denominatorConstant` |
|---|---|---|---:|
| l9 | Log Analytics | `fetch logs ... fields always5 = 5` | 5 |
| l11 | Log Analytics | `fetch logs ... fields always2 = 2` | 2 |
| l15 | Log Analytics | `fetch logs ... fields always1 = 1` | 1 |
| s2 | App Security | `fetch events ... fields expected = 5` | 5 |
| s7 | App Security | `fetch events ... fields expected = 5` | 5 |
| t3 | Threat Obs | `fetch dt.davis.problems ... fields expected = 4` | 4 |
| ai3 | AI Obs | `fetch spans ... fields expected = 5` | 5 |
| b2 | Biz Obs | `fetch bizevents ... fields expected = 10` | 10 |
| b4 | Biz Obs | `fetch bizevents ... fields expected = 5` | 5 |
| sd3 | Software Delivery | `fetch events ... fields expected = 5` | 5 |
| sd4 | Software Delivery | `fetch events ... fields expected = 10` | 10 |

### 16.5 Math identity verification

For criterion `t3` (Problem category coverage):
- Before: `value = valueA / queryB_result × 100 = valueA / 4 × 100`
- After:  `value = valueA / denominatorConstant × 100 = valueA / 4 × 100`

Identical. The DQL just returned `4` after scanning 60 MB of problems.

Verified by running side-by-side cold runs (pre-fix vs post-fix) and
comparing all 9 capability scores: **all identical**.

### 16.6 Measured savings

On the test tenant:
- Before fix: 123 unique queries, 220 GB scanned, $1.33–$2.05
- After fix:  113 unique queries, **173 GB scanned**, $1.05–$1.61
- **Reduction: -10 queries (-8%), -47 GB scan (-21.4%), -$0.44 (-21.5%)**

Wall-time also dropped from 9.88 s → 8.62 s (-12.7%) because the 10
extra queries took time even if they returned constants.

The 11 → 10 query count comes from dedup: `s7` and `sd3` had IDENTICAL
queryB strings, so the `Set` dedup collapsed them. Removing both
saved only 1 unique-query execution.

### 16.7 Caveats

- The `Criterion` type allows BOTH `queryB` AND `denominatorConstant`
  to be set. Scoring honors `queryB` first, silently ignoring the
  constant. TypeScript can't enforce mutual exclusion. Code review rule.
- If a future criterion legitimately needs to filter the denominator
  query (e.g. "events of kind X out of distinct kinds Y in the same
  window"), that's still a `queryB`, not a `denominatorConstant`.
- When `Math.min(..., 100)` caps the value, the constant denominator
  case behaves identically to the queryB case.

---

## 17. AI Observability window fix — full forensics

### 17.1 The symptom

On the deployed app pointing at our test tenant, the AI Observability
capability consistently showed 0% / 0 criteria passed of 9, despite
the tenant clearly running LLM workloads (visible in the Dynatrace
tenant directly).

### 17.2 The investigation via MCP

Ran the canonical AI fingerprint at three windows:

```dql
fetch spans, from:now()-2h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
      or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name)
| summarize count(), distinct_providers = countDistinct(coalesce(gen_ai.system, gen_ai.provider.name))
```

| Window | gen_ai spans | distinct providers |
|---:|---:|---:|
| 2h | 0 | 0 |
| 24h | 0 | 0 |
| **72h** | **244 964** | **4** |

→ The tenant has AI workloads, but they're bursty (batch jobs running
once a day or less frequently). The 2h window the app used since
v2.3.51 was too narrow to catch them.

### 17.3 The historical context

`CHANGELOG.md` shows v2.3.51 reduced AI Obs from 72h to 2h with
"90% cost reduction" as the motivation. That was correct for the
cost side, but introduced a hidden failure mode: tenants with
sparse AI activity score 0%.

### 17.4 The fix

Reverted just the AI Obs criteria (ai1–ai9) back to 72h. Other span
queries (Application Observability, the t-series log queries) kept
their 2h windows.

Mechanical sed replacement:
```sh
sed -i '' "${ai_block_start},${ai_block_end}s/from:now()-2h/from:now()-72h/g" queries.ts
```

16 substring swaps inside the AI Obs block (lines 684–755), 0
occurrences elsewhere in the file. Verified by `grep -c`.

### 17.5 Cost impact analysis

Per AI Obs query at 72h: ~5 GB scanned on the test tenant. There are
9 AI Obs criteria with related queries that dedup to ~5 unique queries
(some share denominators). Net additional scan: ~25 GB per run on
small tenants, OR ~$0.30 per run.

For Large/xLarge tier: `scaleQuery` STILL rewrites these to 30 min /
5 min windows because `fetch spans` is a hot source. So the cost
impact only hits Exact tier. xLarge tenants accept the AI Obs
sampling tradeoff (and may show 0% AI even if they have activity —
documented in the Scale Tier banner).

### 17.6 Post-fix verification

Re-ran the canonical query with the new window via MCP:

```dql
fetch spans, from:now()-72h | filter ... gen_ai ...
| summarize count = countDistinct(coalesce(dt.entity.service, service.name))
```

Returned `count = 2` (services with AI) — matches expectation.

Provider diversity (ai3):

```dql
fetch spans, from:now()-72h | filter ... gen_ai ...
| fieldsAdd provider = coalesce(gen_ai.system, gen_ai.provider.name)
| summarize countDistinct(provider)
```

Returned `countDistinct(provider) = 4`. With `denominatorConstant: 5`
(see §16), score = 80% — passes threshold.

Expected final AI Obs capability score on this tenant: ~22% (3 of 9
criteria passing). Up from 0%.

### 17.7 Side effects to watch

- The AI Obs scan budget per Exact-tier run increases by ~25 GB.
- xLarge tenants STILL won't see AI activity if it's >5 min between
  ingest events (Scale Tier rewrites the window). This is by design
  but customers may complain. Mitigation: the Scale Tier banner says
  "values are sampled estimates".
- If a future tenant has even more bursty AI (only fires weekly), 72h
  would also miss it. We'd need 7d for that, which raises the cost.
  Currently no signal that this is a problem.

---

## 18. Concrete measurements from the test tenant

These numbers are from real runs against our development tenant
(~54 hosts / ~87 services / etc.). They're useful as calibration when
adding new criteria or projecting cost at other scales.

### 18.1 Tenant scale snapshot

```
hosts:                    54
services:                 87
serviceMethods:            6
processGroups:           397
processInstances:        731
applications:              2
mobileApps:                0
k8sClusters:               7
k8sNamespaces:            65
k8sNodes:                 35
syntheticTests:            4
syntheticLocations:       96
httpChecks:                7
networkInterfaces:        54
disks:                    54
```

### 18.2 Raw data volume in standard windows

| Source | 2h | 24h | 72h |
|---|---:|---:|---:|
| logs | 9.4M records | ~110M | ~330M |
| spans | 1.6M records | ~20M | ~62M |
| events | 20.3K records | ~250K | ~730K |
| bizevents | 78K records | ~970K | ~2.9M |
| problems (Davis) | 110K records | n/a | 244K records |
| security events | 0 records (none ingested) | 0 | 0 |

### 18.3 Event kind distribution (72h)

```
SYNTHETIC_EVENT:  270 691  ← continuous, includes synthetic checks
DAVIS_EVENT:      191 889  ← Davis insights, dedup-heavy
SDLC_EVENT:        25 200  ← SDLC pipeline events (deploy + release)
DAVIS_PROBLEM:      9 120  ← Davis problem entries
SECURITY_EVENT:         0  ← TENANT DOES NOT INGEST
CUSTOM_DEPLOYMENT:      0  ← TENANT DOES NOT INGEST
LOG:                    0  ← TENANT DOES NOT INGEST
```

Implications for which criteria pass:
- `s1`, `s2`, `s3` (App Security on SECURITY_EVENT) will always score 0
  on this tenant. C3 doesn't catch this (the filter is on `event.kind`,
  not entity).
- `sd2` (Software Delivery on CUSTOM_DEPLOYMENT) will always score 0.
- `l15` (Log-based events on `event.kind == "LOG"`) will always score 0.

### 18.4 Bizevent metadata (72h)

```
total bizevents:                  4 373 738
distinct event.type:                    963
distinct event.provider:                 64
```

In 2h window:
```
total bizevents:                     70 135
distinct event.type:                    143
distinct event.provider:                 25
```

70K bizevents in 2h is enough for all `b1–b8` criteria to pass their
thresholds. 143 distinct types far exceeds the `b2` threshold of 10.

### 18.5 Per-source scan cost on cold run (Exact tier)

After the v2.5.x optimizations:

```
logs:        23 queries  ⇒  147 GB scanned   p50=1035ms p95=2551ms max=2889ms
spans:       22 queries  ⇒   24 GB           p50=565ms  p95=965ms  max=1876ms
events:      10 queries  ⇒  0.4 GB           p50=543ms  p95=1615ms max=1615ms
bizevents:    9 queries  ⇒  0.4 GB           p50=546ms  p95=605ms  max=605ms
metrics:     19 queries  ⇒  0 GB             p50=588ms  p95=914ms  max=914ms
entity:      23 queries  ⇒  0 GB             p50=538ms  p95=1014ms max=1107ms
problems:     7 queries  ⇒  0.5 GB           p50=546ms  p95=673ms  max=673ms
─────────────────────────────────────────────────────────────────
TOTAL:      113 queries  ⇒  173 GB
WALL-TIME (concurrent at CONCURRENCY=10):  8.62 s
DPS estimate:  $1.05 – $1.61
```

### 18.6 Top-10 expensive queries on cold run (by scannedBytes)

```
1. fetch logs ... 24h ... countDistinct(log.source)   15.18 GB  1 criterion
2. fetch logs ... 2h  ... countDistinct(log.source)   15.18 GB  3 criteria  (good dedup)
3. fetch logs ... 2h  ... countDistinct(loglevel)     15.18 GB  1 criterion
4. fetch logs scanLimitGBytes:-1 ... bucket           15.18 GB  1 criterion
5. fetch logs ... 2h | summarize count()              15.19 GB  9 criteria  (BEST dedup)
6. fetch logs ... isNotNull(dt.process_group.id)      15.18 GB  1 criterion
7. fetch logs ... isNotNull(dt.entity.host) count     15.11 GB  1 criterion
8. fetch logs ... isNotNull(dt.entity.host) distinct  15.11 GB  1 criterion
9. fetch logs ... sources by host >= 2                15.10 GB  1 criterion
10. fetch logs ... trace_id                           15.10 GB  2 criteria
```

Observation: 8 of the top 10 are log queries that scan the FULL 2h
log corpus (~15 GB on this tenant) with different filters. They have
the same scan cost because the filters happen AFTER the scan.

The dedup-amortised cost (`scanBytesPerCriterion`) reveals where
deduplication is working:
- Query #5 (`summarize count()`): 15.19 GB / 9 criteria = **1.69 GB/criterion**
- Query #1 (`countDistinct(log.source)` 24h): 15.18 GB / 1 = **15.18 GB/criterion**

Query #5 is essentially the "tax" for log denominators across multiple
criteria. Query #1 is a unique numerator that doesn't amortise.

### 18.7 Projected scan/cost at common scales

These projections informed the Scale Tier thresholds. Numbers shown
are with v2.5.x optimizations active (`denominatorConstant` + Scale
Tier + cache + C3):

| Tenant scale | Tier | Total scan (cold) | DPS cost |
|---|---|---:|---:|
| 240 hosts | exact | ~0.6 GB | ~$0.006 |
| 8 500 hosts | large | ~18 GB | ~$0.18 |
| 80 000 hosts | xlarge | ~3.2 TB | ~$32 |
| 250 000 hosts | xlarge | ~9.8 TB | ~$98 |

Without Scale Tier (forcing Exact at 80 000 hosts) the equivalent run
would scan ~176 TB and cost ~$1 800. Several log queries would also
exceed the Grail per-query timeout.

---

## 19. Bug history

Bugs found and fixed during the v2.5.x sprint, kept here so future
debugging can reference known patterns.

### 19.1 False positive: `dt.entity.service` after `expand`

**Initial claim**: a criterion's queryB pattern
`fetch dt.entity.service | fieldsAdd t = tags | expand t | summarize count = countDistinct(dt.entity.service)`
returned `FIELD_DOES_NOT_EXIST` because after `expand t`, the row
context drops `dt.entity.service`.

**Reality**: the actual `queries.ts` source at the time used
`countDistinct(id)` (correct) — the false positive was a transcription
mistake while composing the test query for MCP.

**Lesson**: when validating queries via MCP, copy the literal query
string from queries.ts, don't retype.

### 19.2 False positive: filter ordering optimization

**Initial claim**: queries like
`filter isNotNull(dt.entity.host) and isNotNull(X)` should reorder
to `filter isNotNull(X) and isNotNull(dt.entity.host)` for a 50%
scan reduction.

**Reality**: the cost spread (1.57 GB vs 11.81 GB) is driven by
which COLUMN the filter touches, not the order. Filter pushdown
isn't sensitive to order in DQL. Re-audit of queries.ts showed
all multi-filter queries already place the cheap column first.

**Lesson**: column-loading is the dominant scan cost, not pipeline
ordering. The Grail planner is smart enough about pipeline order.

### 19.3 False positive: missing concurrency cap

**Initial claim**: the assessment fires all queries via Promise.all,
needing a CONCURRENCY cap.

**Reality**: `useCoverageData.ts:222` already had `CONCURRENCY = 10`
since pre-v2.5.

**Lesson**: read the existing code before proposing fixes. Done.

### 19.4 Real bug: AI Observability 0% on bursty tenants

See §17 for the full forensics. The 2h window introduced in v2.3.51
made AI Obs invisible on tenants with bursty AI workloads.

### 19.5 Real bug: 11 wasteful constant-return queries

See §16 for the full migration. Discovered via the topExpensiveQueries
ranking with `usedByCriteriaCount = 1` filter.

### 19.6 Real artifact: `scanLimitGBytes: -1`

Criterion `l11` has a literal query with `scanLimitGBytes: -1`:

```dql
fetch logs, scanLimitGBytes:-1
| filter timestamp > now() - 2h
| summarize countDistinct(dt.system.bucket)
```

The `-1` value is suspicious — it likely means "no cap" in Grail (the
query scanned 15 GB in the test, same as a no-cap query). The intent
was probably either `scanLimitGBytes: 50` (a cap) OR omit the parameter.
Functionally identical to omitting it. Left as-is during v2.5.x because
it's not a correctness bug, just confusing syntax.

### 19.7 Operational issue: MCP rate limit

During investigation, the MCP gateway enforces a **5 calls per 20
seconds** rate limit. Hit it twice during heavy validation. NOT a
production app concern — the deployed app uses `@dynatrace-sdk/client-query`
directly, not the MCP gateway. But anyone running validation queries
manually needs to space them out.

### 19.8 Operational issue: HTTP 400 same-version-install

Hit this twice during v2.5.x deploys when forgetting to bump the
version. The dt-app dev server is OK with same-version reloads but
the cloud install endpoint requires monotonic versions. Always bump
in both files (`app.config.json` AND `appVersion.ts`).

### 19.9 Operational issue: HTTP 403 on shared tenants

Tried to deploy to a shared (non-dev) tenant. The OAuth user had toolkit
access (build succeeded) but no `app-engine:apps:install` scope on that
tenant (install failed with 403). Shared tenants are typically restricted
to admin installs.

Workaround: run `dt-app dev` locally pointing at the shared tenant. No
install needed — the app runs from localhost and queries the shared
tenant's Grail in the user's SSO context.

---

## 20. Validation runbook (MCP queries)

These are the MCP queries to run when validating a change, with
expected outputs from our test tenant. Use them as regression checks.

### 20.1 Tenant scale baseline

```dql
fetch dt.entity.host | summarize count()
fetch dt.entity.service | summarize count()
fetch dt.entity.process_group_instance | summarize processes = count()
```

Expected on test tenant: 54 / 87 / 731.

### 20.2 Span volume (for App Obs queries)

```dql
fetch spans, from:now()-2h | summarize total = count()
```

Expected: ~1.6 million.

### 20.3 AI workload detection

```dql
fetch spans, from:now()-72h
| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)
      or isNotNull(gen_ai.request.model) or isNotNull(gen_ai.operation.name)
| summarize ai_total = count(),
            distinct_providers = countDistinct(coalesce(gen_ai.system, gen_ai.provider.name)),
            distinct_services = countDistinct(coalesce(dt.entity.service, service.name))
```

Expected: ~244K spans, 4 providers, 2 services. If `ai_total = 0`
even at 72h, the tenant genuinely has no AI workloads.

### 20.4 Event kind distribution

```dql
fetch events, from:now()-72h
| summarize cnt = count(), by:{event.kind}
| sort cnt desc
```

Expected kinds: SYNTHETIC_EVENT, DAVIS_EVENT, SDLC_EVENT, DAVIS_PROBLEM.
Look for SECURITY_EVENT and CUSTOM_DEPLOYMENT — if either is 0,
related criteria will score 0 (not a bug, tenant truth).

### 20.5 Bizevent diversity

```dql
fetch bizevents, from:now()-72h
| summarize total = count(),
            distinct_types = countDistinct(event.type),
            distinct_providers = countDistinct(event.provider)
```

Expected: ~4.4M / ~960 types / ~64 providers.

### 20.6 Davis problem categories (for t3)

```dql
fetch dt.davis.problems, from:now()-72h
| filter not(dt.davis.is_duplicate)
| summarize count = countDistinct(event.category)
```

Expected: 4 (matches `denominatorConstant: 4` for t3).

### 20.7 Log volume + heaviness check

```dql
fetch logs
| filter timestamp > now() - 2h
| summarize total = count()
```

Expected: ~9.4 million on the test tenant.

```dql
fetch logs
| filter timestamp > now() - 2h
| filter isNotNull(dt.entity.host)
| summarize count = countDistinct(dt.entity.host)
```

Expected: 31 hosts (the 23 hosts that don't emit logs in 2h are
either idle or use a different log path).

### 20.8 Verifying a new criterion you're adding

For any criterion with `queryB`:

```dql
{numerator}
{denominator queryB}
```

Run both. Compute `value = num / denom * 100`. Sanity check:
- Is the value between 0 and 100 (after capping)?
- Does it match what you'd expect for this tenant?
- If 100% — is that actually achievable for any tenant?
- If 0% — is the filter so restrictive that no realistic tenant
  would pass?

If the criterion uses `denominatorConstant`:
- Run only the numerator.
- Compute `value = num / constant * 100`.
- Same sanity check.

### 20.9 Verifying scaleQuery doesn't break a new criterion

For a criterion `q`, run all three:

```dql
{q}                                 # = scaleQuery(q, 'exact')
fetch <src>, from:now()-30m, scanLimitGBytes:200 | {rest of q}    # = scaleQuery(q, 'large')
fetch <src>, from:now()-5m,  scanLimitGBytes:50  | {rest of q}    # = scaleQuery(q, 'xlarge')
```

Confirm:
- All three succeed (no `PARAMETER_MUST_NOT_BE_AN_AGGREGATION` etc.).
- Result schema (column names) is identical across tiers.
- Numeric values follow the expected pattern (Large smaller than
  Exact for continuous signals, possibly 0 in xLarge for bursty
  signals).

---

## 21. Migration from v2.4.x

### 21.1 Snapshot compatibility

`AssessmentSnapshot` schema unchanged. v2.4.x snapshots load and
display in v2.5.x's Evolution Over Time view.

### 21.2 Default behavior preserved on small tenants

For tenants with ≤5 000 hosts:
- `useScaleTier` returns `tier === 'exact'` automatically.
- `scaleQuery(q, 'exact')` returns `q` verbatim.
- No banner appears.
- Cache works behind the scenes — same-day re-runs are fast, but
  the user sees the same numbers.

A v2.4.x user upgrading to v2.5.x sees:
- The DPS badge in the toolbar (NEW — customer-facing).
- Faster repeat runs (cache invisible but obvious by speed).
- Otherwise identical UX.

### 21.3 Large/xLarge tenants — opt-in banner

If a tenant's host count crosses 5 000:
- Scale Tier auto-detects, picks `large`, narrows windows.
- Yellow banner appears at the top of the assessment.
- Coverage values become sampled (typically <5% drift).

This is a NEW behavior for v2.5.x. Customers running on large tenants
who previously timed out or paid $1 800 per run now get fast bounded
runs with a disclosure banner.

### 21.4 OAuth scopes — unchanged

The 11 scopes in `app.config.json` are identical to v2.4.x. No
re-consent prompt for upgrading customers.

### 21.5 Customer-facing diff summary

| What | v2.4.x | v2.5.x |
|---|---|---|
| Radar / cards / PDF | unchanged | unchanged |
| Snapshot save / EOT | unchanged | unchanged |
| Re-run within same day | full DPS | cache hit, ~$0 |
| Run on >5k host tenant | full Exact (timeouts possible) | auto Large with banner |
| Run on >50k host tenant | full Exact (timeouts very likely) | auto xLarge with banner |
| Run on tenant without K8s/RUM | full scan including impossible criteria | C3 skips them silently |
| AI Obs on bursty tenants | 0% (bug) | actual scores |
| Toolbar | tenant + records | tenant + records + DPS badge |
| Footer (customer) | How to Analyze | unchanged |

### 21.6 SE/dev diff summary

| What | v2.4.x | v2.5.x |
|---|---|---|
| Perf observability | none | per-run JSON download (`?dev=1` toolbar button) |
| Force-refresh | reload page (still ran cold) | dedicated toolbar button, clears Doc Store cache |

---

## 22. Debugging workflows

### 22.1 "Customer reports 0% on capability X"

```
1. Is the tenant in xLarge tier?
   → Banner visible, coverage is sampled estimate.
   → Try forcing Exact tier to confirm — if value > 0, it's sampling.

2. Run an MCP query for the numerator of one criterion in that capability.
   → If 0: data isn't present (tenant truth, not a bug).
   → If > 0 but app shows 0: bug, investigate further.

3. Check if the queryB is an entity-count denominator that's 0.
   → If yes, C3 is correctly skipping → expected 0.

4. Check if the criterion has denominatorConstant set.
   → If yes, verify the value isn't 0 or negative.

5. Check the perf JSON for `cached: true` on those queries.
   → If yes, the value is stale from before the data change.
   → Force-refresh.
```

### 22.2 "App is too expensive on tenant Y"

```
1. Download the perf JSON.
2. Sort by scannedBytes desc — look at topExpensiveQueries.
3. Group by source — is logs > 95% of cost? (Expected.)
4. Look at scanBytesPerCriterion — high values flag one-off queries.
5. Check the tier — is it auto-detected correctly for this tenant?
6. If tier is exact but the tenant is large: prompt for manual tier
   switch or wait for next host-count detection.
```

### 22.3 "Run is slow"

```
1. Check the perf JSON's bySource wallTimeP95.
   → If > 5s on logs: legitimate cold cost.
   → If logs are < 1s p95: cache is hitting.
2. Check `cacheHits / totalUniqueQueries`.
   → < 50%: mostly cold, expected for first run of day.
   → > 90%: cache is mostly hitting but something else is slow.
3. Check `bySource.entity.wallTimeP95`. Should be < 1s.
   → If > 1s: Smartscape query slow (Dynatrace internal issue).
```

### 22.4 "Score changed between Exact and Large/xLarge"

This is expected. The Scale Tier mechanism narrows the window in
Large/xLarge tiers to bound cost. Values become sampled estimates,
typically drifting <5% from ground truth. The banner discloses this.

If you need to confirm a specific value:
1. Force Exact tier via the banner buttons.
2. Click Refresh.
3. Compare — Exact is the source of truth.

### 22.5 "Cache hit rate is lower than expected"

```
1. Check cache document age via Doc Store API.
2. Are entries from > 24h ago? They should auto-prune.
3. Did the tier change since last run? Cache keys include tier,
   so a tier switch invalidates all entries.
4. Did the version bump trigger cache invalidation? (No — cache
   docs survive deploys. They only expire by TTL.)
```

### 22.6 "Snapshot is wrong"

```
1. Was the assessment in Large/xLarge tier? Values are sampled
   estimates — small drift vs Exact is normal.
2. The snapshot signature dedup means runs with identical capability
   scores are NOT re-saved. To force a new snapshot, change one
   criterion's value (impossible without changing data).
```

---

## 23. Known limitations and false-positive guidance

### 23.1 Capabilities that score low because of missing data, not bugs

| Capability | Common low-score cause | How to confirm |
|---|---|---|
| Application Security ~70–80% | Tenant doesn't ingest `event.kind == "SECURITY_EVENT"` | MCP: `fetch events, from:now()-72h \| filter event.kind == "SECURITY_EVENT" \| summarize count()` returns 0 |
| Business Observability ~60–70% | Specific bizevent providers absent | MCP: `fetch bizevents \| summarize countDistinct(event.provider)` then check filter against the list |
| Threat Observability (t4) | Same as AppSec | Same query |
| Software Delivery (sd2) | Tenant doesn't emit `event.kind == "CUSTOM_DEPLOYMENT"` | MCP: `fetch events \| filter event.kind == "CUSTOM_DEPLOYMENT" \| summarize count()` |
| Log Analytics (l15) | Tenant doesn't emit `event.kind == "LOG"` | Same pattern |

These are tenant truth, not query bugs. C3 doesn't catch them
because the filter is on `event.kind` not on entity count.

### 23.2 Sampling-related differences are NOT bugs

Large / xLarge tier runs produce sampled estimates. Coverage values
will differ from Exact-tier ground truth (typically <10% drift). The
ScaleTierBanner discloses this. If a customer asks "why does my
coverage drop after auto-switching to Large", the answer is "window
was narrowed for cost; sampled estimate".

### 23.3 Cache staleness is intentional

A value can be up to 24h old when served. If a customer fixes a
coverage gap and re-runs an hour later, they see the old number.
Paths forward:
- Click 🗘 Force refresh (dev mode only)
- Wait for 24h TTL expiration

Don't shorten the TTL to "1h" — defeats the purpose for iterative
remediation teams.

### 23.4 Concurrency cap = 10

`CONCURRENCY = 10` worker promises. Tested up to 20 (no improvement,
Grail concurrency cap limits throughput) and down to 4 (slower
without freeing tenant capacity). Don't change without benchmarking
on a multi-thousand-host tenant.

### 23.5 `extractValue` is forgiving

`useCoverageData.extractValue(record)` iterates `Object.values(record)`
and returns the first numeric. For result objects like `{count: 42}`,
`{c: 42}`, `{always5: 5}`, it just works. If a future query returns
multiple numerics in one row and we care about a specific column,
add a field-name parameter.

### 23.6 The Document Store cache document grows during the day

Cache entries are pruned at load time (24h TTL). Within a single day,
every unique query becomes an entry. Upper bound: ~130 entries
× ~100 bytes ≈ 13 KB per tenant per day. Document Store handles
megabytes per doc; we're orders of magnitude below limits.

### 23.7 The dev tenant doesn't have a Workflow runner installed

Some criteria measure things only visible to a properly-installed
workflow runner. On a tenant without it, those criteria default to
the lower threshold tier or fail. Future enhancement: detect Workflow
runner presence and gate the affected criteria.

---

## 24. Glossary

| Term | Meaning |
|---|---|
| Capability | One of 9 top-level scoring areas (Infrastructure, AppObs, DigEx, Logs, AppSec, Threat, AI, BizObs, Delivery) |
| Criterion | One of ~111 fine-grained measurements, identified by `<prefix><number>` (e.g. `ai3`, `sd10`) |
| Threshold | Numeric cutoff a criterion's value must meet to pass at a given tier |
| Coverage | The criterion-pass-rate-based score (0–100%). Mean across capabilities = `totalScore`. |
| Utilization | Weighted score (Foundation 60% / Best Practice 25% / Excellence 15%) with progressive gating |
| Foundation tier | Basic-must-have criteria for a capability |
| Best Practice tier | Mature operating criteria, counted only if Foundation ≥ 80% |
| Excellence tier | Stretch goals, counted only if Best Practice ≥ 60% |
| Scale Tier | Execution mode (exact / large / xlarge) determining window + scan cap |
| C3 smart-skip | Two-phase optimization skipping numerators when entity-count denominators are 0 |
| denominatorConstant | Code-level numeric replacing a queryB that would have returned a literal |
| Cold run | First assessment of the day for a tenant; pays full DPS cost |
| Warm run | Re-run within 24h; serves results from cache, ~zero cost |
| Hot source | DQL data source that scales linearly with ingest (logs / spans / events / bizevents). Subject to `scaleQuery` rewriting. |
| Bursty workload | Signal that fires intermittently (LLM batch jobs, deploys). Needs wider window to be visible. |
| Dev Mode | Flag exposing diagnostic UI (perf JSON download, force-refresh) to SEs. Hidden from customers. |
| PerfReport | Downloadable JSON with per-query timing, scan, cache, skip data |
| DPS | Davis Pipeline Storage — Dynatrace's per-GiB-scanned billing metric |
| MCP | Model Context Protocol — used during development to run DQL directly for validation |
| Grail | Dynatrace's query engine — what `executeDql` calls |
| Strato | Dynatrace's design system — UI components and tokens we use |
| `useCoverageData` | The main hook — runs the assessment and exposes results |
| `executeAllUnique` | Inner function — runs the worker pool with cache + scaleQuery + perf capture |
| `runAssessment` | Outer callback — orchestrates the two phases of execution |
| `extractValue` | Numeric coercion from a Grail result record |
| `extractNumeric` | Helper inside `extractValue` for arrays, bigints, etc. |
| `scaleQuery` | Pure function that rewrites hot-source queries per tier |
| `isHotSource` | Predicate selecting which queries `scaleQuery` rewrites |
| `tierFromHostCount` | Auto-selection from observed host count |
| `fnv32` | Tiny hash used as cache key suffix |
| `classifySource` | Maps a DQL query string to the source enum |
| `buildReport` | Pure function turning in-flight perf entries into a PerfReport |
| `downloadReport` | DOM helper that triggers the JSON file download |
| `useScaleTier` | Hook for detecting and persisting tier |
| `useDevMode` | Hook for exposing diagnostic UI |
| `useAssessmentHistory` | Hook for snapshot persistence |
| `usePreflight` | Hook for OAuth scope probe |
| `CONCURRENCY` | The worker pool size constant (= 10) |
| `TIER_CONFIG` | Per-tier configuration object (window, cap, label) |
| `CAPABILITIES` | The single source of truth — exported from `queries.ts` |

---

End of memory file. Combined with `HANDOFF.md`, `PERFORMANCE-REPORT-80K-HOSTS.md`,
`CHANGELOG.md`, and the inline code comments, this should be everything a
new developer needs to understand the app in depth.
