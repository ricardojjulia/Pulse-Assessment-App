# Shared-engine seam — what this skill uses, owns, and should hand back

Unlike `/dt-eval-prob`, whose ENGINE.md was written *before* the shared engine existed and reads as a plan for extraction, this skill was built **on the extracted engine from day one**. So this file records two things: which side of the seam each piece sits on, and — the more useful half — **what building this skill surfaced as a candidate for promotion into the engine**, because a pattern appearing in two skills independently is the signal that it was never domain-specific.

## The seam

| Layer | What it is | Shared engine? | Where it lives now |
|---|---|---|---|
| **Run-state** | init/record/status/finalize/compare/find/delivered | **Engine** | `../.dt-eval-common/runlog.py` (single copy) |
| **Docx house style** | cover, scorecard, findings, gauge, charts, `finding_section`'s contract | **Engine** | `../.dt-eval-common/docx_style.py` (single copy) |
| **Scoring primitives** | ✅/💡/⚠️/⚪ → 100/50/0/excluded, ⚪ reweighting, A/B/C/D bands, confidence | **Engine** | `../.dt-eval-common/scoring_engine.py` — `score_checks()` is called directly, never re-derived |
| **Output-path authority** | `current/` layout, `(vN)` versioning, supersede, `[INTERNAL ONLY]-` prefix | **Engine** | `../.dt-eval-common/report_builder.py` + `output-config.json` |
| **Pre-delivery hygiene** | banned-content scan, profile registry | **Engine** | `../.dt-eval-common/verify_docx.py` (`--profile detailed`, reused; no bespoke profile) |
| **Redaction** | sensitive-field masking before evidence hits `runs/` | **Engine** | `../.dt-eval-common/redact.py` |
| **Preflight & auth** | `dtctl ctx/doctor/auth`, scope mapping, read-only guard | **Engine** | prose in `SKILL.md` Phase 0 — still not code, same gap prob recorded |
| **Hygiene rules** | client-safe language, no cross-tenant, Gen3-first | **Engine** | shared convention, restated in `SKILL.md` |
| **Pipeline ruleset** | catch-all, ownership partition, duplicate definitions, collector→native map | **Skill-specific** | `pipeline-ruleset.json` (hand-authored; no transcriber) |
| **OpenPipeline probes** | §1 routing/pipelines · §2 ownership · §3 consolidation · §4 residue · §5 volume | **Skill-specific** | `probes.md` (lifted from `/dt-eval-tenant`, not re-derived) |
| **OpenPipeline scoring** | Health composite (routing integrity + adoption breadth + structural hygiene), the adoption gate | **Skill-specific** | `scoring.md` + `scoring.py` |
| **Findings meta schema** | canonical `findings.json` `meta` shape, alias/rejection tables | **Skill-specific today** | `findings_schema.py` — **but see promotion candidate 2** |
| **Report structure** | section layout, worklist columns | **Skill-specific** | `output-spec.md` |

Rule of thumb, unchanged from prob's: **anything identical across skills is engine; anything encoding the OpenPipeline domain is skill-specific.**

## Engine touchpoints this skill requires (spec O1–O6)

This skill cannot finalize, roll up, or scan correctly until six registration points land in shared files. They are listed here as well as in the spec because ENGINE.md is where a maintainer looks when a sibling skill breaks:

| # | File | Change |
|---|---|---|
| O1 | `runlog.py` | `finalize --skill` choices gains `"openpipeline"` — without it, argparse rejects the call |
| O2 | `runlog.py` | `_HEADLINE_VOCAB["openpipeline"]` — without it, finalize writes **no `headline` block at all** and the rollup has nothing to read |
| O3 | `runlog.py` | the sibling-skill tuple in `_candidate_run_roots()`, **both copies** — without it, `runlog.py find` never surfaces this skill's cache to a sibling, or a sibling's to it |
| O4 | `build_rollup.py` | `SKILLS["openpipeline"]` with `filename_match: "OpenPipeline"` — the directory must be named exactly `dt-eval-openpipeline` or `_find_run_json` silently fails |
| O5 | `report-audiences.md` | scanner-profile row + the deliverable-count sentence |
| O6 | `verify_docx.py` | **DONE (2026-08-10).** `PROFILES` needed nothing (`detailed` is reused). `_PROBE_ID` gained an `OP-` named whitelist — the spec had assumed no change was needed. See below. |

**O6 was the one registration point the spec got wrong, and it is worth understanding why.** The spec recommended reusing the tenant-skill IDs (`A21`, `B50`, `D6`) verbatim as this skill's own, which would have needed no regex change. The build instead gave every probe a local `OP-*` alias (`OP-routing ≡ A21`) because a runbook reads better when the identifier says what it does — `A21` tells an analyst nothing at 4pm. That trade left a real gap: an `OP-*` identifier leaking into customer-facing prose was not caught by the hygiene scan, which is precisely the leak class `RUN_STATE` exists to ban.

**Closed by adding `OP-` as a named whitelist**, mirroring the `D-`/`C-` entries — named alternatives, never a generic `OP-\w+`, because a wildcard is what turns a probe-ID pattern into an EC2 incident.

**Validated before promotion, per the discipline this alternation is held to.** Run against the full delivered corpus — **527 documents across 9 customers, all five firing contexts** — the `OP-` alternative produced **zero** false positives. It also produced zero for the bare named ID anywhere in prose and zero for an unrestricted case-sensitive `OP-<word>`. The only six matches in the entire corpus require case-*in*sensitivity: lowercase `op-` inside evidence filenames (`03-op-logs_routing.json`) in one internal-only document, which the existing `(?-i:…)` wrappers already exclude and which is a separate hygiene issue in that document rather than a pattern problem. Three regression tests ship with the pattern (leak caught, legitimate prose clean, internal profile still exempt).

Note the precedent cuts both ways: `/dt-eval-prob`'s own local IDs (`P1`, `P3`, `P7`) remain **deliberately excluded** from `_PROBE_ID`, because bare `P\d` collides with ITSM "P1/P2" severity prose. That gap is accepted and documented there; this one is now closed.

**O3 is a defect, not just a registration.** The tuple is duplicated across two call sites and is not a shared constant, so it has to be edited in lockstep and will drift again the next time a skill is added. Promote it to one module-level constant while adding the entry.

## Promotion candidates — patterns this build found on the wrong side of the seam

Ordered by confidence. The bar is the rule of three: two independent instances make it a candidate, three make it a defect.

**1. The composite-refusal pattern — two instances, promote.**
`noise_scoring.effectiveness()` raises when both volume pillars are absent (config-only mode). `scoring.openpipeline_health()` raises when the population is below the adoption floor. Same shape: *a composite that must refuse rather than silently return a weaker number*, carrying the strings the caller needs for `--no-grade-reason`. Both hand-rolled. An engine helper — `refuse_composite(reason, no_grade_reason, headline_label)` plus the exception type — would make the third skill's version correct by construction instead of by imitation. The rollup already has the `no_grade_reason` field to receive it.

**2. The findings-meta schema — two instances, promote the mechanism, not the vocabulary.**
`noise_findings_schema.py` and `findings_schema.py` are the same machine with different key lists: REQUIRED-per-mode, OPTIONAL, LEGACY_ALIASES, `normalize_meta()` that raises on unknown keys, `assemble_meta()` that self-checks before writing. The *keys* are domain-specific and must stay skill-side; the *machinery* is not. Promote a `findings_schema_base` the skills parameterize.
**Take the `REJECTED_KEYS` table with it.** This skill added it because an alias is only safe when a rename is cosmetic: `consolidation_opportunity` → `structural_hygiene` also inverted the direction of goodness, so a silent alias would have carried the number across unchanged and handed a badly-built tenant an excellent pillar. Any skill can rename a pillar and invert it; none of them should have to rediscover that an alias table is the wrong tool for it.

**3. The platform-default rule — a scoring principle, currently only prose.**
*A check whose ✅ state is the platform default earns nothing; only its absence may move a score.* This skill learned it from the catch-all matcher (present by default on any Gen3 tenant, so weighting it handed 60% of a pillar away for free). It is not an OpenPipeline rule — it applies anywhere a skill scores a construct the platform ships enabled, which is most of them under Gen3-first. It belongs in `scoring_engine.py`'s shared-rubric comment block alongside the ⚪-exclusion rule, and ideally as an `asymmetric_cap()` helper so the mechanism is as available as the principle.

**4. Confirmation-gated defects — two instances, watch for a third.**
`/dt-eval-prob` refuses to score a `threshold 0` + `ABOVE` idiom as a defect without classifying the series first (scoring it blind would have marked 59 + 8 correctly-written detectors defective). This skill refuses to score governance drift or near-duplicate families without an owner confirmation, for the identical reason: *possibly-correct configuration must not be penalized on inference alone.* Both encode it as prose plus a severity cap. If a third skill needs it, the concept deserves a first-class representation — a finding state between 💡 and "scored" that the report renders as an open question and the arithmetic ignores.

**5. Prose-vs-code drift guards — mechanism worth sharing, low urgency.**
Every skill restates its formula in `scoring.md` and again in `SKILL.md`. This skill's tests parse those documents and compare the stated weights to `WEIGHTS`, and check the stated constants against the module. That is the WOS defect class caught cheaply. A shared `assert_doc_matches_constants(doc, mapping)` helper would let siblings adopt it in a line. Not urgent — but note that no sibling currently has this guard, so their prose has never been checked.

## What must NOT be promoted

- **`pipeline-ruleset.json`.** The threshold/definition opinion is this skill's instrument, exactly as `noise-ruleset.json` is prob's.
- **The adoption floor's *value*.** The refusal mechanism is engine (candidate 1); `ADOPTION_FLOOR = 5` is a domain judgment about pipeline estates and means nothing to another skill.
- **The internal capacity tiers.** Adjustable, not publicly citable, internal-audience only. They are deliberately outside the arithmetic and must not acquire an engine-level home that makes them look scorable.

## Cross-skill precedence — the seam that is not code

`/dt-eval-gen3`'s **E4** domain already scores OpenPipeline adoption. This skill's NativeAdoptionBreadth pillar reads the same probes. The seam between them is **documented, not enforced**: E4 is the authority for the adoption verdict; this skill carries structural depth. Nothing in the engine prevents the two from disagreeing, and if they ever do, that is a defect in one of them rather than a finding about the tenant. A future engine could enforce it — a shared domain formula both skills call — and that would be the right fix. Until then it lives in `SKILL.md`, `scoring.md`, and O9's hand-off documentation, in all three directions.
