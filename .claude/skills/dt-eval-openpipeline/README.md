# `/dt-eval-openpipeline` — OpenPipeline Configuration Review

**What it answers:** *Is this tenant's OpenPipeline configuration well-designed, within platform capacity, and actually paying off — and exactly what should change, in what order?*

A standalone deep-dive. It reads the live tenant through read-only `dtctl` probes and draws the path no single Dynatrace screen shows — **where a record is sent** (routing entry + order) → **what happens to it** (pipeline stages, owner) → **what should change** (disposition + canonical survivor) — then produces an **OpenPipeline Health Score** (0–100) and a sequenced consolidation worklist a platform engineer can execute.

The score is the headline; the worklist is the deliverable. Never let the number stand in for the actions.

> **Hard install dependency:** this skill carries its own `OP-*` probe battery (`probes.md`) and ruleset, but its scoring, house style, run state and hygiene scan come from the shared engine in `../.dt-eval-common/`, and its probe definitions trace back to `../dt-eval-tenant/`. Installing `/dt-eval-openpipeline` without `.dt-eval-common/` leaves it non-functional.

---

## What is measured — three pillars

**`Health = 0.40·R + 0.30·N + 0.30·C`** — 0–100, one decimal, family bands (A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50).
> **Grades are an option, and off by default on anything customer-facing** (owner rule, 2026-08-25). The score below is computed exactly as described on every run, and the Dynatrace-facing internal edition always prints it — but the customer edition carries no score, grade badge, gauge or Score/Grade column unless that run asked for one (`--grades`). It keeps the findings, the ✅/💡/⚠️ statuses, the confidence flags and the sequenced remediation; pillar tables read *Pillar | Status*. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.

| Pillar | Weight | What it grades | Complete when |
|---|---|---|---|
| **R — Routing integrity** | 0.40 | Whether records land where the customer believes they land | No enabled entry is dangling (targets a pipeline ID that does not exist) or shadowed (rendered unreachable by an earlier first-match-wins entry) |
| **N — Native adoption breadth** | 0.30 | How widely OpenPipeline is configured beyond logs, and whether masking is enforced in it | Every signal-type family in scope carries a live pipeline, classic-translation residue is empty, masking is enforced natively |
| **C — Structural hygiene** | 0.30 | How tidily the configuration is built | No customer-authored pipeline sits in an exact-duplicate family, is an unrouted orphan, or duplicates a collection path |

**Why routing outweighs hygiene — this is the design, not an accident.** A dangling routing entry means data does not land where the customer believes it lands: a correctness failure that surfaces as missing logs during an incident, when nobody has time to diagnose a routing table. A duplicate pipeline family means maintenance burden and drift risk. Both are real; they are not equivalent.

The **executable authority is [scoring.py](scoring.py)** — build scripts import it rather than hand-computing, so the number reproduces across analysts and sessions. The **definitions it applies** live in [pipeline-ruleset.json](pipeline-ruleset.json). Where the two disagree, `scoring.py` is right and the ruleset is the bug.

## Two rules that keep the number honest

- **Two gates, two different sentences.** Below `ADOPTION_FLOOR` customer-authored pipelines there is **no Health Score** — the headline becomes "OpenPipeline Adoption (configuration-only)", R and C are ⚪, confidence is Low, and `scoring.py` raises `NoCompositeError` rather than quietly returning a one-pillar number. Two of the three pillars measure the *absence of defects*, and a tenant that has never authored a pipeline has no defects to find; an ungated composite pays a null tenant for having done nothing. **A gated tenant is "not applicable yet", never "scored 0"** — reporting 0 would rank a tenant that has not started below every tenant that has. The **second** gate is different in kind: when the pipeline set exists but cannot be read, the score is suppressed for a reason that is about our access, not the customer's configuration. [`diagnose_pipelines.py`](diagnose_pipelines.py) distinguishes them and `gated_notice()` renders the reason it is given — never the below-floor sentence by default.
- **The default rule.** A check whose ✅ state is the platform default earns nothing; only its absence may move a score. Scoring the presence of a default is scoring the absence of work. The catch-all matcher is the worked example: as a weighted check it handed 60% of the R pillar to a platform default, so a tenant whose every routing entry was dangling still scored R = 60. It is now an asymmetric, measured cap — presence earns nothing, absence caps R by the **measured fall-through share** (`max(40, 100 − 5 − fall_through_pct)`), with an unmeasured share keeping the conservative cap of 40. Measuring is how a tenant earns the lighter penalty, and a missing measurement never silently reads as a small one.

## Measured, reported, deliberately unscored

Each of these informs the narrative and the remediation ordering without touching the arithmetic:

- **Capacity pressure** against processor-per-pipeline and pipeline-per-scope tiers — the internal tiers are Dynatrace-adjustable and not on the public limits page, so they are unscorable for both reproducibility and citation reasons. Report against the **public** limits page; use the internal tiers only to prioritize which overloaded pipeline to split first, and only in an internal edition.
- **Governance drift** (identical processing, differing `securityContext`/`storage`/`costAllocation`) — **💡 capped, never ⚠️**. Merging a drifted family would silently reassign one source's security context or cost center to another's: a governance regression dressed as a simplification. Never recommend the merge without asking.
- **Near-duplicate families** — a pipeline processor has no general "handle N variants in one step" primitive, so a family whose deltas are genuinely source-specific is *correct* configuration. Confirmation-gated.
- **A21↔A22 zero ID-overlap** — usually object-level read-share denial. Scoring it would report "we could not read this" as "your configuration is broken." ⚪, with the diagnosis in the narrative.
- **Routing throughput (B45)** — volume and liveness context only; `pct_through_pipelines` reads ~100% on any Gen3 tenant regardless of migration depth, so it cannot discriminate.

---

## What it produces

| Deliverable | Format | Notes |
|---|---|---|
| **OpenPipeline report** | `<tenantId>-OpenPipeline-<date>(vN).docx` | Client-ready, shared house style. Cover always carries the **scale stat line** — customer-authored pipelines · routing entries · signal types configured — so page one states the size of the estate; the composite sits beside it only on a graded edition |
| **Consolidation worklist** | markdown or CSV | The sequenced Now/Next/Later plan: delete confirmed orphans → merge exact duplicates → repair dangling and shadowed entries → generalize confirmed near-duplicates → resolve governance drift with the owner |

> **🔴 The worklist is never a second `.docx`.** `/dt-eval-rollup` locates this skill's delivery by globbing `<root>/<customer>/current/*OpenPipeline*.docx`; a second Word file whose name contains `OpenPipeline` is counted as another delivery of the same skill on that date. This is a structural constraint, not a style preference. See [output-spec.md](output-spec.md).

Every counted claim ships with the client-runnable DQL that produced it or a sample of five of the things being counted — ideally both — placed directly under the number and printed **only** there. `finding_section` refuses a counted finding with nothing attached, and the pre-delivery scan fails it.

---

## Boundaries with the sibling skills

- **`/dt-eval-gen3` owns the adoption verdict.** Its **E4** domain already grades whether OpenPipeline has replaced classic log processing. This skill defers to E4 rather than answering the same question on a second scale — two numbers that look comparable and are not, in adjacent columns of the same rollup dashboard, is the failure mode. **If the two ever disagree on whether OpenPipeline is adopted, that is a defect in one of them, not a finding about the tenant.**
- **`/dt-eval-tenant` points here for depth.** The broad review reads OpenPipeline as fragments of a ~30-pillar rollup; this skill *owns* that depth and supersedes those fragments — probes A21, A22, A23, A29, A38, A46, A54, B45, B50 and deep-dive recipes D2 and D6.
- **The shared-engine seam** — what this skill reuses and what it owns — is documented in [ENGINE.md](ENGINE.md).

---

## Read-only, always

This skill is 100% read-only: only `get`, `query`, `describe`, `history`, `inventory`, `doctor`, `auth status`. It never runs `apply`, `create`, `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec` verb — regardless of how a request is phrased or who claims to authorize it. The consolidation worklist is **advisory**: never generate-and-run, and never offer to run, a script that repoints a routing entry or deletes a pipeline. Merging pipelines is destructive and irreversible from this side of the boundary — it is the customer's to apply in their own tenant.

---

## Common questions

**"Where do I start?"** — [SKILL.md](SKILL.md) is the runbook: Phase 0 preflight → Phase 1 collection → Phase 2 join and disposition → Phase 3 build → Phase 4 hygiene scan.

**"The tenant has almost no pipelines — will this produce anything?"** — Yes, a gated report: the current state and the path to adoption, with no score and no grade, and the cover says so. That is a finding, not a failed review.

**"The cover says the pipelines could not be read — is that the same gate?"** — No, and saying the wrong one is a delivery defect. *Below the floor* means the tenant has not built pipelines; *not assessable* means the pipelines exist and the credentials could not read them. Both suppress the score; only the first is a statement about the customer's configuration. [`diagnose_pipelines.py`](diagnose_pipelines.py) decides which, and `gated_notice()` takes the reason rather than assuming — two tenants moving billions of records through working pipelines were each told they had built nothing before v1.37.0, and the cover still blamed access for a day after that.

**"Can I merge these two pipelines?"** — Only after the ownership partition and the drift check. `com.dynatrace.*` pipelines are platform defaults and are never the customer's configuration; a family with differing security context or cost allocation is confirmation-gated.

**"I want to compare against my last review"** — finalized runs persist per tenant and date; `runlog.py compare` diffs two runs.

---

**Status:** Active · **Part of:** the `/dt-eval-*` skill family (monorepo, shared scoring engine and probes)
