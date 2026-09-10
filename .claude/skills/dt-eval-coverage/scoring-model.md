# Scoring Model — Coverage and Utilization

Source of truth: `ui/app/hooks/useCoverageData.ts` (formulas) + `ui/app/data/criterionTiers.ts` (tier classification).
Version: v2.5.15 · Tenant Review App.

---

## Step 1 — Single criterion: pass or fail

Every criterion runs one or two DQL queries and resolves to a coverage percentage:

```
# When queryB exists:
value = (numeratorQuery / denominatorQuery) × 100   [capped at 100]

# When denominatorConstant is set in the criterion definition:
value = (numeratorQuery / denominatorConstant) × 100  [capped at 100]

# When no denominator (the query already returns a percentage):
value = numeratorQuery result

# Edge case — denominator is 0 (e.g. no K8s clusters):
value = 0   [flagged as "skipped", excluded from all scores]
```

The value is compared against thresholds. Meeting any threshold → **passed (1 point)**:

```
thresholds = [{min: 90}, {min: 50}, {min: 1}]   # example
passed = value >= any threshold.min ? 1 : 0
```

Most thresholds are `≥1%`. Higher thresholds appear on diversity checks (≥20–50%) where a minimum spread is the whole point of the criterion.

---

## Step 2 — Coverage Score (per capability)

Simple unweighted pass/fail ratio. This is what the radar chart shows.

```
capCoverageScore = (criteria passed / total criteria) × 100
                  rounded to integer
```

**Overall coverage**: mean of all enabled (non-skipped, non-disabled) capability coverage scores.

### Coverage bands

| Band | Score range | Color |
|---|---|---|
| N/A | 0–19 | grey |
| Low | 20–39 | red |
| Moderate | 40–59 | yellow |
| Good | 60–79 | teal |
| Excellent | 80–100 | green |

### Worked example — Infrastructure Observability (22 criteria)

Suppose 14 of 22 criteria passed:

```
coverageScore = 14 / 22 × 100 = 63.6 → 64   (band: Good)
```

---

## Step 3 — Utilization Score (per capability)

Same criteria, but grouped into three tiers with weighted, progressive gates.

### 3a — Tier percentages

```
fPct = foundationPassed / foundationTotal    (0.0–1.0)
bPct = bestPracticePassed / bestPracticeTotal
ePct = excellencePassed / excellenceTotal
```

### 3b — Progressive gates (the key rule)

BP only counts if Foundation is solid (≥80%). Excellence only counts if BP is solid (≥60%):

```
effB = (fPct >= 0.8) ? bPct : 0
effE = (effB >= 0.6) ? ePct : 0
```

This prevents a tenant with scattered Excellence passes (e.g. has OTel active) from scoring high when Foundation is weak. The gate forces depth before breadth is rewarded.

### 3c — Weighted sum

```
utilizationScore = fPct × 60 + effB × 25 + effE × 15
                  rounded to integer (0–100)
```

Weights: **Foundation 60% · Best Practice 25% · Excellence 15%**

### Worked example — Infrastructure Observability

```
Foundation:    3/3  passed → fPct = 1.00
Best Practice: 6/11 passed → bPct = 0.55
Excellence:    3/8  passed → ePct = 0.38

effB = 1.00 >= 0.8 → bPct = 0.55  (BP counts)
effE = 0.55 >= 0.6 → FALSE → effE = 0  (Excellence zeroed!)

utilizationScore = 1.00 × 60 + 0.55 × 25 + 0 × 15
                 = 60 + 13.75 + 0 = 73.75 → 74   (band: Good)
```

Note: Coverage = 55 (Moderate), Utilization = 74 (Good). The divergence tells the story:
the customer has a solid Foundation but BP is not yet solid enough to unlock Excellence credit.

---

## Step 4 — Utilization Level (L0–L3)

A discrete label derived from the raw tier percentages, independent of the utilization score:

```
fPct >= 0.5 ?
  fPct == 1.0 AND bPct >= 0.5 ?
    fPct == 1.0 AND bPct == 1.0 AND ePct >= 0.5 ?  → L3 Optimized
    else                                             → L2 Operational
  else                                               → L1 Foundation
else                                                 → L0 Not Adopted
```

| Level | Label | Meaning |
|---|---|---|
| L0 | Not Adopted | Foundation < 50% — basics missing |
| L1 | Foundation | Foundation ≥ 50% — basics present, depth missing |
| L2 | Operational | Foundation 100%, Best Practice ≥ 50% — solid base + partial depth |
| L3 | Optimized | Foundation 100%, BP 100%, Excellence ≥ 50% — full depth |

---

## Step 5 — Overall Score (across 9 capabilities)

```
overallCoverageScore    = mean(enabled capability coverage scores, adjusted by consolidation factor)
overallUtilizationScore = mean(enabled capability utilization scores, adjusted by consolidation factor)
```

### Consolidation factor

An optional per-capability adjustment (0–100%) that discounts capabilities not applicable to a customer. Default 100% (no adjustment). Example: a customer with no K8s may set Infrastructure consolidation factor to 70%, reducing its contribution to the overall score.

```
adjustedScore = rawCapabilityScore × (factor / 100)
```

---

## Coverage vs Utilization divergence scenarios

| Pattern | Coverage | Utilization | Interpretation |
|---|---|---|---|
| Foundation 100%, Excellence partial, BP weak | Mid | Mid | Scattered — fix BP before Excellence counts |
| Foundation 100%, BP partial, Excellence ~0 | Mid | Good | Solid base, go deeper on BP |
| Excellence present, Foundation weak | Mid | Low | Advanced features without basics — fix Foundation first |
| Everything proportional | Equal | Equal | Uniform adoption — progress all tiers together |
| Everything 100% | 100 | 100 | L3 Optimized |

---

## What changes scores (and what does not)

| Changes Coverage and Utilization | Does NOT change scores |
|---|---|
| Real DQL results from Grail | Dark/light theme |
| Scale Tier (narrows windows on large tenants) | Cache hit/miss (same result) |
| Disabled capabilities | App version (formulas unchanged in 2.5.x) |
| Consolidation factors | Time to execute queries |
| Threshold values (if someone edits `queries.ts`) | DPS scanned bytes (separate) |
| Tier classification (if someone edits `criterionTiers.ts`) | |

---

## Economy Mode — how executed queries differ from the catalog

The score uses the same formula regardless of Economy Mode, but the executed DQL may differ from what `queries.ts` specifies:

| Criterion type | Economy Mode lever | Effect on score |
|---|---|---|
| Both sides are plain counts, same table/window | `samplingRatio: 1000` | Ratio preserved; scan drops ~1600×; score drift < 1.5 pp |
| Uses `countDistinct` or `by:` grouping | Narrower window (2h → 15m) | Distinct count ~6% lower than catalog window; shows "Estimated" in UI |
| AI Observability | No narrowing (72h fixed) | Score accurate; window is intentional for bursty workloads |

The **cache key** is always the original catalog query string, so snapshots, cards, and PDFs are consistent across Economy Mode changes.

---

## Code locations

| What | File |
|---|---|
| DQL queries, thresholds, criteria definitions | `ui/app/queries.ts` |
| Tier classification (F/BP/E) per criterion ID | `ui/app/data/criterionTiers.ts` |
| Coverage and Utilization formulas | `ui/app/hooks/useCoverageData.ts` lines 706–870 |
| Economy Mode (sampling / window narrowing) | `ui/app/scale-tier.ts` |
| Trace Proxy Mode (span → metric/entity substitutes) | `ui/app/trace-proxy.ts` |
| Score bands (colors per band) | `ui/app/utils/colors.ts` |
