---
name: dt-eval-coverage
description: Pulse Assessment / Tenant Review — Dynatrace App that measures observability Coverage and Utilization across 9 capabilities and 111 criteria by executing DQL queries live against a tenant. Use when the user asks about coverage or utilization scores, wants to understand or interpret Pulse Assessment results, needs to add/modify evaluation criteria, or is developing the Tenant Review App. Complements the dtctl-based /dt-eval-* skills (which write Word reports); this skill describes the interactive App-based evaluation and its scoring model.
---

# Pulse Assessment — Tenant Review App

The **Pulse Assessment** (published as the **Tenant Review** Dynatrace App, v2.5.15) evaluates a Dynatrace tenant's observability depth live — no dtctl required. It runs 111 scored criteria across 9 capabilities by executing DQL queries against Grail, then produces two independent scores per capability: **Coverage** (breadth, simple average) and **Utilization** (quality, tier-weighted progressive). Results are displayed as a radar chart, scored capability cards, and exportable PDF reports.

| | Details |
|---|---|
| **Data collection** | DQL via `@dynatrace-sdk/client-query` — parallel execution (≤10 concurrent), polling until complete |
| **Criteria** | 111 scored checks across 9 capabilities (deduplicated to ~94 unique DQL queries at execution) |
| **Scoring** | Two independent dimensions: Coverage (0–100, simple pass/fail average) and Utilization (0–100, tier-weighted progressive with progressive gates) |
| **Cost controls** | Economy Mode (sampling or narrowed windows), Scale Tier (large/xLarge window reduction), Trace Proxy Mode (metric/topology substitutes when spans are unavailable) |
| **Output** | Interactive app UI + PDF reports in four personas (Executive, Tactical, Technical, Custom) — multilingual (EN/PT/ES) |
| **Companion skills** | `/dt-eval-tenant`, `/dt-eval-consumption`, `/dt-eval-gen3` — dtctl-based skills that produce Word deliverables; they evaluate the same tenant via a different toolchain |

---

## The 9 Capabilities

Each capability has a color, a check count, and a tier distribution (F = Foundation · BP = Best Practice · E = Excellence).

| # | Capability | Checks | F · BP · E | Color | Grail Sources |
|---|---|---|---|---|---|
| 1 | **Infrastructure Observability** | 22 | 3 · 11 · 8 | `#3B82F6` | metrics, entities, logs, spans, Davis problems |
| 2 | **Application Observability** | 13 | 3 · 4 · 6 | `#8B5CF6` | spans, entities, metrics |
| 3 | **Digital Experience** | 11 | 3 · 5 · 3 | `#EC4899` | metrics, entities |
| 4 | **Log Analytics** | 16 | 4 · 7 · 5 | `#F59E0B` | logs |
| 5 | **Application Security** | 11 | 4 · 4 · 3 | `#EF4444` | events, spans, entities, Davis problems |
| 6 | **Threat Observability** | 11 | 3 · 5 · 3 | `#F97316` | Davis problems, events, logs |
| 7 | **AI Observability** | 9 | 3 · 2 · 4 | `#06B6D4` | spans (gen_ai.* attributes, 72h window) |
| 8 | **Business Observability** | 8 | 3 · 2 · 3 | `#10B981` | bizevents |
| 9 | **Software Delivery** | 10 | 3 · 4 · 3 | `#6366F1` | events, metrics, entities |
| | **Total** | **111** | **29 · 44 · 38** | | |

> AI Observability uses a **72h window** (not 2h). GenAI workloads are bursty — a 2h window silently misses real traffic. Do not narrow this window.

---

## Scoring Model

### How a single criterion passes

Every criterion runs one DQL query (numerator) and optionally a second (denominator) or uses a `denominatorConstant`. The result is a coverage percentage capped at 100%, compared to one or more thresholds:

```
value = (numerator / denominator) × 100   [capped at 100]
passed = value meets any threshold → 1 point
failed = meets none → 0 points
```

Most thresholds are `≥1%` — the assessment rewards *any* adoption and lets tier weighting drive the utilization story. Diversity checks use higher bars (`≥20–50%`) where a minimum spread is the point.

### Coverage Score (simple average)

```
capScore     = (criteria passed / total criteria) × 100
overallScore = mean(all capability scores)
```

Bands: **N/A** 0–19 · **Low** 20–39 · **Moderate** 40–59 · **Good** 60–79 · **Excellent** 80–100

### Utilization Score (tier-weighted progressive)

Weights: **Foundation 60% · Best Practice 25% · Excellence 15%**

Progressive gates enforce that advanced tiers only count when the basics are solid:

```
effB = (foundationPct >= 0.8) ? bestPracticePct : 0
effE = (effB >= 0.6)          ? excellencePct  : 0
utilizationScore = foundationPct × 60 + effB × 25 + effE × 15
```

This means a customer with Excellence features but weak Foundation scores lower on Utilization than Coverage — and that divergence is the key insight.

### Utilization Level (L0–L3)

| Level | Label | Condition |
|---|---|---|
| **L0** | Not Adopted | Foundation < 50% |
| **L1** | Foundation | Foundation ≥ 50% |
| **L2** | Operational | Foundation = 100% AND Best Practice ≥ 50% |
| **L3** | Optimized | Foundation = 100% AND Best Practice = 100% AND Excellence ≥ 50% |

### Tier distribution (111 criteria total)

| Tier | Count | Weight | Gate |
|---|---|---|---|
| Foundation | 31 | 60% | Always counted |
| Best Practice | 46 | 25% | Requires Foundation ≥ 80% |
| Excellence | 40 | 15% | Requires Best Practice ≥ 60% |

### Reading the divergence

| Pattern | Coverage | Utilization | Meaning |
|---|---|---|---|
| Foundation 100%, BP partial | Moderate | Good | Solid base, depth missing — next step is BP |
| Excellence present, Foundation weak | Moderate | Low | Advanced features without basics — fix Foundation first |
| Everything proportional | Same | Same | Uniform adoption |
| Everything 100% | 100 | 100 | L3 Optimized |

---

## Cost and Fidelity Controls

### Economy Mode (every tier)

A full run measured 370 GB scanned; Economy Mode brings it to ~41 GB. Two levers applied per criterion:

| Lever | When applied | Effect |
|---|---|---|
| `samplingRatio: 1000` | Both sides of a ratio are plain counts, same table and window | Ratio preserved, scan drops ~1600× |
| Narrower window | Anything with `countDistinct` or `by:` grouping | 15m instead of 2h — distinct counts collapse under sampling |

Sampling is never applied to distinct counts (e.g. log sources: 63 → 28 under sampling) or to single-query criteria against an absolute threshold.

### Scale Tier (> 5k hosts)

Narrows windows further (30m/5m) to stay within Grail per-query timeouts. Applied on top of Economy Mode.

### Trace Proxy Mode (no Traces-on-Grail entitlement)

Span checks are replaced by validated metric/topology equivalents. Checks with no honest proxy are excluded from the denominator (not counted as failures). AI Observability is excluded as a whole capability — `gen_ai.*` attributes only exist on spans.

**All three controls are disclosed in the UI** — `CostModeNote`, `ScaleTierBanner`, `TraceProxyBanner`. A viewer never reads an estimated score without knowing it is one.

---

## Interpreting Scores

- **Coverage ≠ Utilization.** Coverage treats all criteria equally; Utilization weights by tier and gates progressively. They diverge when adoption is uneven across tiers.
- **Skipped criteria** (denominator = 0, e.g. no K8s when checking K8s namespace metrics) are flagged `skipped` and excluded from both scores — they don't count as failures.
- **Consolidation factor**: an optional per-capability adjustment (0–100%) that discounts capabilities not applicable to a customer (e.g. zero K8s → reduce Infrastructure weight). Default 100%.
- **Snapshot persistence**: results are saved to localStorage and Dynatrace Document Store (`ppa-snapshot` type), enabling comparison over time via the Evolution Over Time view.

---

## Deliverables (App)

| Report | Audience | Language | Notes |
|---|---|---|---|
| Executive | Business | EN / PT / ES | Posture, strengths/exposures, quick wins, next-stage path |
| Tactical | Team lead | EN / PT / ES | Gap landscape, improvement potential, operating cadence |
| Technical | Engineer | EN / PT / ES | Full check detail + the DQL behind every criterion |
| Custom | Any | EN / PT / ES | User picks title, capabilities, sections |
| Smart (Assist) | Any | Any | Free-text request answered by Davis CoPilot (dev-gated) |

Reports use JPEG chart exports (not PNG) for size efficiency (~20× smaller on gradient-heavy canvases). WinAnsi font limitation: characters ✓ ✗ ≈ ≥ → are replaced with OK/GAP/ERR `~` `>=` `->`.

---

## Reference Files

| File | Contents |
|---|---|
| [criteria-catalog.md](criteria-catalog.md) | All 111 criteria by capability: ID, label, tier, what it validates, pass threshold |
| [scoring-model.md](scoring-model.md) | Full Coverage and Utilization formulas with worked numerical examples |
| [data-sources.md](data-sources.md) | Grail data source (metric / entity / log / span / event / bizevent) per criterion |
| [dev-guide.md](dev-guide.md) | App development guidelines: Strato components, SDK hooks, DQL patterns, workflow |

---

## When to Use This Skill vs the dtctl Skills

| Question | Use |
|---|---|
| "What does the Pulse Assessment score mean?" | This skill |
| "Help me add a new criterion to the app" | This skill + dev-guide.md |
| "Help me interpret a tenant's coverage scores" | This skill + criteria-catalog.md |
| "Run a full technical configuration review and write a Word doc" | `/dt-eval-tenant` |
| "Assess effective consumption and write a report" | `/dt-eval-consumption` |
| "How far along is Gen3 migration?" | `/dt-eval-gen3` |

The dtctl-based skills collect probes via `dtctl` (shell-level) and produce `.docx` deliverables. The Pulse Assessment is a live Dynatrace App that runs DQL directly — no dtctl needed — and the results are interactive. Both evaluate the same tenants; they are complementary, not competing.
