---
name: dt-eval-rollup
description: Executive Rollup — a side-by-side dashboard of the headline score/grade/confidence from whichever of the sibling /dt-eval-* skills (tenant, prob, gen3, consumption, mz2seg) have already been run and DELIVERED for a tenant. Assembles after the fact from existing, completed engagements — never forces the other skills to run together, never blends their scores into one number. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Executive Rollup

This skill answers one question: **"Across everything Dynatrace has already delivered for this
tenant, where does it stand?"** It collects **zero new evidence** — it reads the `headline` block
each sibling skill's own `run.json` already carries (written by `runlog.py finalize` when that
skill's build step passes `--skill`/`--confidence` — see `.dt-eval-common/runlog.py`'s
`_synthesize_headline`) and assembles them into one short dashboard document.

| | How |
|---|---|
| Data collection | **None.** No `dtctl`, no DQL, no new probes — this skill only reads other skills' already-recorded results. |
| Discovery | `runlog.py`-adjacent glob over the output tree (`build_rollup.py`'s `_skill_delivered_dates`) — a skill is included only if it has a **delivered** `.docx` for this tenant, never an in-progress or undelivered run. |
| Output | **Standalone `.docx` Executive Rollup** — one row per assessed sibling skill (headline label, value, grade, confidence, as-of date), an explicit "not yet assessed" line for every skill with nothing delivered, and a pointer back to each full report. |

**Hard rule — this is a dashboard of separate headlines, never a blended score.** The five
siblings' scores are incommensurable (Overall Configuration Score vs. Alerting Effectiveness vs.
Migration Completeness % vs. Overall Effective Score vs. mz2seg's deliberately ungraded coverage
%). Combining them into one number would invent a precision this repo's own rules forbid
(CLAUDE.md: never let a number stand in for the actions; `report-audiences.md`: no blended
figures, no peer benchmarks). Never compute an average, weighted or otherwise, across rows.

**v1 scope, deliberate:** headline only. No parsed "top actions" per skill — those live in full
in each skill's own report; extracting them back out of docx prose is out of scope here. Point the
reader at the full report for findings, evidence, and remediation.

## Phase 0 — Inputs

1. **Customer name** and **tenantId** — same identifiers used by every sibling skill's output path.
2. **Tenant URL** (optional, cosmetic — cover page only).
3. **Which skills to include** (optional; default all five: `tenant,prob,gen3,consumption,mz2seg`).
4. **Audience** — External, Internal, or both (default: both, matching every other deliverable in
   this repo — `report-audiences.md` applies to this skill exactly as it does to its siblings).
   **Grades are an option and off by default on the External edition (owner rule, 2026-08-25),
   and this deliverable feels that hardest** — its whole content is other reviews' headlines. The
   default customer table therefore reads **Review | Headline | Status | Confidence | As of**, each
   review's status coming from its own grade band; Value and Grade appear only when the run passes
   `--grades`. Ungraded it still answers what the dashboard is for: which reviews were delivered,
   where each stands, how confident each is, and where to read it in full. The Internal edition
   always carries the values and grades. Say this at Phase 0 if the ask was "a one-page score
   dashboard for the customer" — that ask is the `--grades` case.
5. **Output root** — resolved exactly like every sibling skill: `DT_EVAL_OUTPUT_DIR` env override,
   else `.dt-eval-common/output-config.json`'s `default_output_root`. The **tenant layout** is
   likewise inherited, never chosen here: a rollup assembles what siblings already delivered, so the
   customer's layout was settled when the first of them ran. It reads
   `<output-root>/<customer>/.dt-eval-layout.json` through `resolve_delivery_dir()` and files itself
   beside the reviews it summarizes — flat, or under `<customer>/<tenantId>/current/`. If a
   multi-tenant customer has no layout recorded yet, that is a sibling skill's Phase 0 question, not
   the rollup's.

## Phase 1 — Discover what's actually delivered

Run `build_rollup.py`, which for each requested skill:

1. Globs the output tree for that skill's known report-filename stem (`technical-configuration-
   review`, `noise-reduction`, `gen3-migration-progress`, `effective-consumption`,
   `mz2seg-migration-plan`) under **every `current/` folder at any depth** — `<customer>/current/`
   for a flat customer, `<customer>/<tenantId>/current/` for a per-tenant one — matched against
   filenames that start with this tenant's ID (or `[INTERNAL ONLY]-<tenantId>-`). The glob is
   recursive for exactly this reason: a one-level scan saw only the flat half of the tree, and a
   delivered sibling under a tenant folder read as never delivered — the one thing this skill exists
   to read.
2. **External audience only counts an external (no `[INTERNAL ONLY]-` prefix) delivery.** Internal
   audience also accepts an internal-only delivery — the same "an internal edition still proves the
   tenant was assessed" reasoning `runlog.find_delivered_reports` already applies, scoped so an
   External Rollup never cites a report marked not for customer distribution.
3. Takes the most recent delivered date, locates that skill's `runs/<tenantId>-<date>/run.json`,
   and reads its `headline` block.
4. **Any skill that can't contribute a row says so explicitly** — no delivered report, a delivered
   report whose run state is missing, or a run that predates the headline contract each produce a
   named line in the appendix rather than a silent omission (the same no-silent-caps discipline
   this repo applies to every counted claim).

```
.venv/bin/python build_rollup.py "<customer>" <tenantId> --tenant-url <url> \
  --skills tenant,prob,gen3,consumption,mz2seg --audience both
```

## Phase 2 — Verify & deliver

Same discipline as every sibling deliverable:

1. **Reopen and verify:** python-docx, assert paragraph/table counts are non-zero.
2. **Pre-delivery scan:** `.venv/bin/python ../.dt-eval-common/verify_docx.py <file> --profile rollup`
   for the external edition, `--profile internal` for the internal edition — this rollup carries no
   scoring derivation of its own (there is no method note naming pillars to carve an exemption
   for), so `rollup` is the strictest external profile in the family.
3. **Report to the user:** the full resolved output path(s), which skills were assessed vs. not yet
   assessed, and the headline row for each assessed skill.

## Phase 3 — Finalize (optional; this skill has no headline of its own)

```
runlog.py init runs/<tenantId>-<date>/run.json --tenant <id> --url <url> --context <ctx> --customer <name>
runlog.py record run.json ROLLUP-SOURCES ok --summary '{"skills_assessed": [...], "skills_not_assessed": [...]}'
runlog.py finalize run.json --report <docx-path> --audience external|internal
```

No `--skill` flag here — the rollup doesn't have its own place in `_HEADLINE_VOCAB` (it isn't a
graded review; it's an assembly of the others'), so this `finalize` call intentionally writes no
`headline` block of its own.

## Hard rules & non-negotiables

1. **Read-only, always.** This skill makes no `dtctl`/DQL calls at all — it only reads files
   already on disk (other skills' `run.json`, the output tree's delivered `.docx` list).
2. **Never blend the five scores.** No average, no weighted composite, no single "portfolio
   grade." Five rows, five scales, side by side.
3. **Never include an undelivered run.** A skill with an in-progress or never-finalized run
   contributes nothing — same as if it had never been run.
4. **Cross-tenant ban applies unchanged.** This is still one customer's document; nothing here
   introduces peer comparison, rankings, or benchmarks across tenants.
5. **No silent caps.** Every requested skill either appears as an assessed row or an explicit
   "not yet assessed" line — never just absent.

## Related files

- [build_rollup.py](build_rollup.py) — the executable authority; reads `_output_root()`/
  `_skill_delivered_dates()` conventions from `.dt-eval-common/runlog.py` and reuses
  `.dt-eval-common/report_builder.py`'s `next_version_number`/`supersede_previous` for output
  path/versioning, and `.dt-eval-common/docx_style.py` for the document itself.
- [.dt-eval-common/runlog.py](../.dt-eval-common/runlog.py) — `_synthesize_headline`, the
  cross-skill `headline` contract every sibling skill's `finalize` call writes into.
- [README.md](README.md) — short overview.
