# `/dt-eval-rollup` — Executive Rollup

**What it answers:** *Across everything Dynatrace has already delivered for this tenant, where does it stand?*

A thin, standalone skill that collects **zero new evidence**. It reads the `headline` block each
sibling `/dt-eval-*` skill's own `run.json` already carries — synthesized by `runlog.py finalize`
when that skill's build step passes `--skill`/`--confidence` — and assembles whichever of the
six have already been run **and delivered** for a tenant into one short, side-by-side dashboard.

Built **after the fact**, not by forcing the other skills to run together: an engagement that has
only delivered a Configuration Review so far gets a two-row rollup (this skill, plus an explicit
"not yet assessed" line for the other five); run the missing skills later and re-build the rollup
to pick them up.

> **Hard rule — never a blended score.** The six siblings grade on incommensurable scales
> (Overall Configuration Score vs. Alerting Effectiveness vs. Migration Completeness % vs. Overall
> Effective Score vs. OpenPipeline Health vs. mz2seg's deliberately ungraded coverage %). This skill
> never averages or composites across them — it is a dashboard of separate headlines, always.

---

## What it reads

| Sibling skill | Headline label | Scale |
|---|---|---|
| `/dt-eval-tenant` | Overall Configuration Score | 0–100, A–D |
| `/dt-eval-prob` | Alerting Effectiveness Score | 0–100, A–D |
| `/dt-eval-gen3` | Migration Completeness | 0–100%, A–D |
| `/dt-eval-consumption` | Overall Effective Score (OES) | 0–100, A–D |
| `/dt-eval-openpipeline` | OpenPipeline Health Score | 0–100, A–D (**no score at all** below the adoption floor — the row says so rather than reading 0) |
| `/dt-eval-mz2seg` | Segments Migration Coverage | 0–100% zones covered, **no A–D grade by design** |

Each key is matched against the skill's own report-filename stem, and resolves to
`dt-eval-<key>/runs/…` for the run state — so renaming either makes that skill silently vanish from
the dashboard with no error anywhere.

A skill only contributes a row if it has a **delivered** `.docx` for this tenant (a real file in
the output tree — never an in-progress or undelivered run). Anything missing gets a named
"not yet assessed" line instead of silent omission.

## v1 scope

Headline only: value, grade (or the stated reason a skill has none), confidence, as-of date, and
a pointer back to the full report. No parsed "top actions" per skill — those live in full in each
skill's own report.

**This is the one deliverable in the family whose shape changes with the grades option** (owner rule,
2026-08-25). The internal edition always shows each review's value and grade. The customer-facing
edition shows each review's **status band** — the same ✅/💡/⚠️ vocabulary as the summary bar — plus
its confidence, as-of date and where to read it in full, and no numbers, unless the run passed
`--grades`. A sibling with no band of its own (mz2seg) says so, exactly as it does when graded.

## Output

`<tenantId>-executive-rollup-<date>(vN).docx` at
`<output-root>/<customer-name>/current/` (internal variant
`[INTERNAL ONLY]-<tenantId>-executive-rollup-<date>(vN).docx`, same folder),
same convention as every other deliverable in this repo.

## Related

- [SKILL.md](SKILL.md) — the runbook.
- [build_rollup.py](build_rollup.py) — the builder.
- [.dt-eval-common/runlog.py](../.dt-eval-common/runlog.py) — `_synthesize_headline`, the
  cross-skill `headline` contract this skill depends on.
- [.dt-eval-common/report-audiences.md](../.dt-eval-common/report-audiences.md) — § *Grades are an
  option*, the policy behind the status-band edition above.
