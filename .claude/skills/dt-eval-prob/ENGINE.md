# Shared-engine seam — notes for the future refactor

Problem Noise is built **stand-alone today** but deliberately partitioned so the reusable
parts can later be lifted into a shared "engine" that every Dynatrace assessment skill
(Tenant Eval / Config Review, Effective Consumption, Gen3 Migration, Problem Noise, …)
sits on. This file records which side of the seam each piece is on, so the extraction is a
lift, not a rewrite.

## The seam

| Layer | What it is | Shared engine? | Where it lives now |
|---|---|---|---|
| **Run-state** | init/record/status/finalize/compare | **Engine** | `../.dt-eval-common/runlog.py` (shared, single copy) |
| **Docx house style** | cover, scorecard, findings, gauge, charts | **Engine** | `../.dt-eval-common/docx_style.py` (shared, single copy) |
| **Preflight & auth** | `dtctl ctx/doctor/auth`, scope mapping, read-only guard | **Engine** | described in `SKILL.md` Phase 0 (prose, not yet code) |
| **Scoring primitives** | ✅/💡/⚠️/⚪ → 100/50/0/excluded, A/B/C/D bands, confidence flags | **Engine** | described in `scoring.md` (shared convention) |
| **Hygiene rules** | client-safe redaction, no cross-tenant, Gen3-first | **Engine** | described in `SKILL.md` (shared convention) |
| **Noise ruleset** | the Alerting Thresholds workbook, schema-mapped | **Skill-specific** | `noise-ruleset.json` + `build_ruleset.py` |
| **Noise probes** | §1 baseline / §2 settings / §3 custom-detector | **Skill-specific** | `probes.md` |
| **Noise scoring** | Alerting Effectiveness composite (signal quality + native adoption + detector tuning) + reduction tags | **Skill-specific** | `scoring.md` + `noise_scoring.py` |
| **Tuning sheet** | the annotated .xlsx deliverable | **Skill-specific** | `build_tuning_sheet.py` |
| **Report structure** | noise-report section layout | **Skill-specific** | `output-spec.md` |

Rule of thumb: **anything that would be identical across skills is engine; anything that
encodes the noise domain is skill-specific.**

## What the extraction looks like when we do it

1. ✅ **Done (2026-07-28)** — the shared engine lives at `.claude/skills/.dt-eval-common/`
   (`runlog.py`, `docx_style.py`, `scoring_engine.py`, `report_builder.py`, `build_reports.py`).
   `preflight.py` (Phase 0 codified) remains future work.
2. ✅ **Done (2026-07-28)** — the vendored `lib/docx_style.py` and `lib/runlog.py` copies are
   deleted; this skill uses the single shared copy in `../.dt-eval-common/` directly
   (per-run build scripts `sys.path.insert(0, "../.dt-eval-common")`).
3. Each skill keeps only its domain assets (ruleset, probes, output builders, SKILL.md).
4. The Tenant Eval's EC and Gen3 *flavors* can then also become thin skills on the same
   engine — the symmetry goal discussed at design time. Revisit Gen3's placement then.

## First shared module identified: the anomaly-detection config lens (decided 2026-07-27)

The Part II gap-analysis is **configuration-review work** — it reads `builtin:anomaly-detection.*`
at environment + entity scope, counts per-entity overrides, and compares each detector's live
value to a recommended value. That is the Tenant Eval's territory too (its alerting pillar). The
owner's call: **keep Problem Noise standalone for now, but mark this config lens as the first
concrete shared-engine module.** When the engine is extracted, this becomes:

- **`config_lens/anomaly_detection.py`** (engine): read all `builtin:anomaly-detection.*` schemas
  (env + entity scope), count overrides per area, and expose a normalized per-detector current-value
  map. Pure read + normalize; no scoring, no ruleset opinion.
- **Consumers:** the Tenant Eval renders it as its **alerting-pillar deep-dive** (scored); Problem
  Noise renders it as **Part II** (current-vs-`noise-ruleset.json` gap + Status). Same reads, two
  surfaces, no divergence.

What stays skill-specific (NOT engine): `noise-ruleset.json` (the threshold opinion) and the
problem-stream tie-in (Part I). Those are Problem Noise's own instrument.

Leak that surfaced (evidence the sharing is real): `footer_disclaimer` hard-coded the label
"Executive Configuration Review". **Fixed 2026-07-27** — it now takes a `label=` param (default
unchanged for the eval); Problem Noise build scripts pass `label="Dynatrace Problem Noise"`. Any new
consumer must pass its own label. (The combined guide predates the fix and still shows the default
label until regenerated.)
