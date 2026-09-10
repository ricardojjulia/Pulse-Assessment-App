# OpenPipeline — scoring rubric

The headline is the **OpenPipeline Health Score** — a weighted composite that grades how well an existing OpenPipeline configuration is *built*. The score is a health headline, not the deliverable. The sequenced consolidation and routing worklist is the deliverable; never let a number stand in for the actions. Bands and mechanics match the Tenant Eval so figures reconcile across reports.

**This skill does not measure whether OpenPipeline exists.** "Has this tenant adopted OpenPipeline?" belongs to Gen3's **E4** domain (classic residue `A29` vs. native `A21`/`A22`). Answering it twice on two different scales would put two numbers that look comparable, and are not, into adjacent columns of the same rollup dashboard. Where the two skills read the same fact, **E4 is the precedence authority for the adoption verdict and this skill defers to it**; this skill carries the structural depth E4 deliberately does not.

## The headline — OpenPipeline Health Score

**`Health = 0.40·R + 0.30·N + 0.30·C`** — 0–100, one decimal, family bands (A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50).

| Pillar | Weight | What it grades | Source |
|---|---|---|---|
| **R — Routing integrity** | 0.40 | Whether records land where the customer believes they land | A21, A22 |
| **N — Native adoption breadth** | 0.30 | How widely OpenPipeline is configured beyond logs, and whether masking is enforced in it | A23, A29, A38, A46, A54 |
| **C — Structural hygiene** | 0.30 | How tidily the configuration is built — duplication, orphans, redundant collection | D6, D2, B50 |

The **executable authority is [scoring.py](scoring.py)**; build scripts import it (or run it as a CLI) rather than hand-computing, so the number is reproducible across analysts and sessions. The **definitions it applies** — what counts as dangling, what counts as customer-authored, which collector duplicates which native signal — live in [pipeline-ruleset.json](pipeline-ruleset.json). Where the two disagree, `scoring.py` is right and the ruleset is the bug.

**Why routing outweighs hygiene (this is the design, not an accident).** A dangling routing entry means data does not land where the customer believes it lands — a correctness failure that surfaces as missing logs during an incident, when nobody has time to diagnose a routing table. A duplicate pipeline family means maintenance burden and drift risk. Both are real; they are not equivalent. The 0.40/0.30/0.30 split mirrors `dt-eval-prob`'s shape for the same reason: the pillar measuring whether the mechanism *works* outweighs the pillars measuring how tidily it is built.

## The adoption gate — the rule that makes the number honest

**Below `ADOPTION_FLOOR` customer-authored pipelines there is no OpenPipeline Health Score.** R and C are ⚪, the headline becomes **"OpenPipeline Adoption (configuration-only)"**, and confidence is always Low. `scoring.py` enforces this by refusing to emit a composite — it raises `NoCompositeError` rather than quietly returning a one-pillar number, the same way `noise_scoring.effectiveness()` refuses in config-only mode.

`N_authored` is the count remaining after D2's `externalId` ownership partition: `com.dynatrace.*` pipelines — the whole namespace, not only `.extension.` (widened 2026-08-10) — are platform defaults and are never the customer's configuration. This makes the partition the most load-bearing rule in the ruleset — a wrong partition moves both the gate and the C pillar.

**Why the gate exists.** Two of the three pillars measure the *absence of defects*, and a tenant that has never authored a pipeline has no defects to find: no dangling entries, no duplicate families, no orphans. An ungated composite pays a null tenant for having done nothing. The v1.0 draft of this rubric (`0.35·R + 0.30·N + 0.35·C`, ungated, with orphans double-counted across two pillars) produced:

| Tenant | Score | Grade |
|---|---|---|
| Zero OpenPipeline configuration | 70.0 | B — Strong |
| Three clean pipelines | 85.0 | A — Excellent |
| Substantial estate with real structural debt | 60.2 | C — Building |

That inversion rewards non-adoption — the Gen3-first rule stood on its head — and it reproduces the field failure `dt-eval-prob` records: a headline that reads "Strong" to a customer whose lived experience is the opposite. **A gated tenant is "not applicable yet", never "scored 0".** Reporting 0 would rank a tenant that has not started below every tenant that has.

`ADOPTION_FLOOR = 5` is a **DRAFT** value. Nothing in the test suite pins it — the acceptance criteria validate the gate's *mechanics*, not its placement — so only live runs can settle it.

## The default rule

**A check whose ✅ state is the platform default earns nothing; only its absence may move a score.**

Scoring the presence of a default is scoring the absence of work. This is the gate's logic applied at check level, and it was learned the same way: the catch-all matcher was first built as a weight-3 check inside R, but a catch-all is present by default on any Gen3 tenant, so weighting it handed 60% of the pillar to a platform default — a tenant whose *every* routing entry was dangling still scored R = 60.0. It is an **asymmetric, measured cap** now: presence earns nothing; absence caps R by the **measured fall-through share**.

**The recalibration (2026-08-10, first live run).** The absence penalty was a flat cap at 40, set believing absence meant silent data loss. It does not. Unmatched records fall through to the default pipeline and bucket — default processing, no custom security context or retention — but they are **not dropped**. The first live measurement put the fall-through at **0.027%** of a 191M-record day, and the flat cap moved that tenant a full grade band (73.5 → 50.2) for it. A penalty that size for a harm that size is a miscalibration, not a judgment call.

The cap is now `max(40, 100 − 5 − fall_through_pct)`: the measured share deducted point for point, because that share *is* the harm — the proportion of records not receiving the governance the routing table was built to apply — plus a fixed 5 for the latent risk that the destination is unchosen at all, which does not depend on today's volume. **An unmeasured share keeps the old conservative cap of 40**, so measuring is how a tenant earns the lighter penalty and a missing measurement never silently reads as a small one. Passing `0` for "not measured" is a defect, not a shortcut: it claims a measured-and-perfect result on no evidence.

Apply this test to every new check before adding it.

## The pillars

**R — Routing integrity** (A21, A22). Scored over two shares against a denominator of total routing entries: `100 × (1 − dangling ÷ total)`, where *dangling* is an enabled entry targeting a pipeline ID that does not exist; and the equivalent for entries rendered unreachable by an earlier first-match-wins entry that subsumes them. Routing is ordered and first-match-wins — read the last enabled entry before concluding anything. The catch-all applies as the cap above. **The orphan check does not live here** (see C).

**N — Native adoption breadth** (A23, A29, A38, A46, A54). Share of the signal-type family — `logs`, `bizevents`, `events`, `events.security`, `davis.problems`, `davis.events`, `events.sdlc`, `metrics` — carrying a live pipeline, plus classic-translation residue and masking-layer coverage. Residue is ✅ when empty and 💡 when not: pending translations mean migration is incomplete, which is an opportunity, and there is no trustworthy denominator to scale the count against. A29 can 500 or permission-error; that drops one check to ⚪, never the pillar, and an error is never read as "no residue."

**C — Structural hygiene** (D6, D2, B50). `100 × (1 − affected_share)`, where `affected_share` is customer-authored pipelines implicated in **at least one** hygiene defect over total customer-authored pipelines. A defect is membership in an exact-duplicate family, being an unrouted orphan (missing from **both** consumer surfaces — routing entries *and* pipeline-group membership), or sitting on a duplicate collection path. **A pipeline implicated in two defects counts once**; callers pass a set length, never a sum of per-defect counts. The v1.0 draft summed them and charged orphans to two pillars at 0.70 combined weight.

## Deliberately outside the arithmetic

Each of these is measured and reported; none adjusts the score. They inform the narrative and the remediation ordering, the way `dt-eval-prob`'s RCA-participation probes explain its signal pillar without touching it.

- **Capacity pressure** against the soft processor-per-pipeline and pipeline-per-scope tiers. Those tiers are internal, Dynatrace-adjustable, and not on the public limits page — unscorable for both reproducibility and citation reasons. Report counts against the **public** limits page and use the internal tiers only to prioritize which overloaded pipeline to split first. Lead with the structural fix (split along an existing content seam, consolidate a duplicate family), not a limit-increase request.
- **Governance drift** — identical processing, differing `securityContext`/`storage`/`costAllocation`. Drift may be deliberate: merging would silently reassign one source's security context or cost center to another's, a governance regression dressed as a simplification. **💡 capped, never ⚠️**, and it enters `affected_share` only after an analyst confirms the drift is accidental. Never recommend merging a drifted family without asking.
- **Near-duplicate family membership** — same reasoning. A pipeline processor has no general "handle N variants in one step" primitive, so a family whose deltas are genuinely source-specific is *correct* configuration. Confirmation-gated; otherwise tagged "same processing, source-specific parameters — not a mergeable clone" and reported without scoring.
- **A21↔A22 zero ID-overlap** — the usual cause is object-level read-share denial. Scoring it would report "we could not read this" as "your configuration is broken." **⚪**, with the three-step diagnosis (read-share → pipeline groups → scope/pagination) in the narrative.
- **`dt.sfm.openpipeline.routing.records` throughput (B45)** — volume and liveness context only. `pct_through_pipelines` reads ~100% on any Gen3 tenant regardless of migration depth, so it cannot discriminate.

## Missing pillars, confidence, and bands

**Missing pillars (access, not adoption).** When a pillar is ⚪ because a schema was unreadable rather than because the tenant is under the floor, renormalize the remaining weights over the pillars present and state this prominently wherever the score appears. **R is required above the floor** — an unreadable routing table means there is nothing to review, and a composite carried by the other two would imply otherwise. Never renormalize past the gate: a gated run has no composite to renormalize.

**Confidence** (High/Medium/Low) attaches to the composite and is stated wherever the score appears. It inherits the **minimum** of the pillars' own confidences, not just the composite's ⚪ count — three pillars all present is not evidence of a strong sample, and without inheritance a composite resting on a handful of pipelines reported High.

**Bands:** A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50. Client-facing labels are **Excellent / Strong / Building / Foundational**, in lock-step with `docx_style.EXTERNAL_LABELS`, `scoring_engine.GRADE_LABELS`, and `noise_scoring.GRADE_LABELS`. Keep all four in step: a sibling skill's copy of this map blended external A/B with internal C/D vocabulary until v1.17.36, and the label routes straight onto the report cover, so a tenant below 70 received internal diagnostic language on a client deliverable.

## Naming rules (hard)

1. **"Overall" never attaches to a scoped sub-score.** A pillar is always presented as "Routing integrity (sub-score)" or equivalent — never as the report's overall grade.
2. **The cover carries the composite plus a scale stat line** — e.g. "34 customer-authored pipelines · 41 routing entries · 6 of 8 signal types configured" — so page one states the size of the estate the score is computed over. A grade with no scale behind it invites the reader to over-read a small number.
3. **A gated run says so on the cover**, in the customer's terms: the tenant has not yet built enough OpenPipeline configuration for a health verdict. That is a finding in itself, not a failure of the review, and it is never presented as a poor score.
4. **A high R on a tenant with substantial duplication is a finding, not an all-clear** — state it as "records are landing correctly; the burden is maintenance debt," and let the composite carry the weight.

## Estimate labeling discipline

Every consolidation or reduction estimate carries its method tag, so nothing reads as a promise:

- **[counted]** — structural, exact: deleting K exact-duplicate pipelines, or retiring N confirmed orphans, removes a known object count.
- **[volume-weighted]** — the canonical survivor and the repointing order are chosen from each member's observed record share.
- **[derived]** — a proportional estimate with the assumption stated inline.

Never publish a bare percentage. `~30% fewer pipeline objects [counted: 9 exact duplicates and 4 orphans out of 43 customer-authored]` is publishable; `30% reduction` is not.

## Live calibration record

Every value in this rubric is DRAFT until live runs settle it. This is the evidence so far, kept here
so the next person adjusting a weight argues with data rather than intuition. Tenants are
de-identified; only the shapes matter.

| Estate | Authored pipelines | Routing | Catch-all | Orphans | Orphan share of processing |
|---|---|---|---|---|---|
| Large, logs-only | 30 | 29 | **absent** | 2 | **21.2%** |
| Mid, logs-only | 32 | 31 | **absent** | 2 | **15.8%** |
| Small | 9 | 8 | — | — | — |
| Minimal | 1 | 1 | absent | — | *gated* |

**Three things this changes, and one it does not:**

1. **A missing catch-all is the norm, not the exception.** Two of two scored estates lack one. A rule
   that caps the largest pillar into the D band on a condition most tenants share was never measuring
   a distinguishing property — more evidence the flat cap was wrong, and confirmation the scaled
   version is doing real work rather than firing on everyone equally.
2. **The weighting earns its place.** On both scored estates it moved the hygiene pillar materially
   (93.3 → 78.8 and 93.8 → 84.2), because in both cases the orphans were substantial pipelines rather
   than empty shells. The unweighted count would have called both estates near-perfect on hygiene.
3. **The duplicate-family branch has never fired.** Zero exact-duplicate families across all four
   estates. In practice `StructuralHygiene` is currently an *orphan* measure, and the duplication
   failure mode it was designed around — carried over from the detector world, where a migration tool
   ports thousands of rules — may simply be rare in OpenPipeline, where pipelines are authored
   deliberately one at a time. **Do not remove the branch on this evidence** (four estates is not a
   population, and one duplicating tenant would restore it immediately), but do not treat the pillar
   as validated for duplication either: it has only ever been exercised on orphans.

**What is not settled.** `ADOPTION_FLOOR = 5` has one real data point — the minimal estate gated
correctly at 1 authored pipeline, which tells us the mechanism works and nothing about whether 5 is
the right line. The weights have two scored estates, both logs-only, neither with duplication. A
tenant configured beyond logs, or one with duplicate families, would test parts of this rubric that
no live run has touched.

## Acceptance criteria

The weights and the floor are DRAFT, and "validate against 2–3 tenants" is unfalsifiable without a pass condition — the v1.0 inversion would have survived a validation pass that only checked the skill ran without error. All four must hold, and the first two are arithmetic on synthetic pillar values that `scoring.py --self-test` runs in a second:

1. **Null-tenant floor.** A tenant with no customer-authored OpenPipeline configuration produces **no composite at all**. It must never produce a passing grade.
2. **Monotonicity against investment.** A tenant that adopted more, and therefore has more defects to find, must never be outranked by one that adopted less. If it is, a pillar is still absence-scored.
3. **Monotonicity against remediation.** Fixing a real defect must move the score **up**, and re-scoring the pre-fix evidence must reproduce the pre-fix score exactly.
4. **Gate boundary.** A tenant at the floor and one just below it must not differ by more than a grade band's worth of narrative whiplash; if they do, the floor is in the wrong place.
