---
name: dt-eval-m2s
description: Managed → SaaS migration scope assessment — measure a Dynatrace Managed estate from its configuration exports and produce a defensible, estate-specific scope for the move. Separates customer-built configuration from platform defaults by baseline subtraction, sizes the workstreams nobody planned for (hard-coded entity references, process-group-bound settings, classic extensions), and names what can be retired instead of migrated. Offline — reads export zips, never a live tenant. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Managed → SaaS Migration Scope Assessment

This skill answers one question end-to-end: **"What is actually in this Managed estate, how much
of it is real, and what does moving it genuinely cost?"** It is the only skill in the family that
runs **before** a tenant exists — its subject is a Managed cluster on its way to SaaS, not a
platform tenant under review.

| | How |
|---|---|
| Data collection | **Configuration export `.zip` files** — offline, no tenant, no `dtctl`, no DQL |
| Knowledge base | **[m2s-scope-assessment-spec.md](../dt-eval-tenant/m2s-scope-assessment-spec.md)** (method, traps, finding catalog) and **[m2s-source-errata.md](../dt-eval-tenant/m2s-source-errata.md)** (source precedence, the five verified-wrong claims) |
| Analysis | **`analyze_export.py`** — baseline subtraction, entity-reference census, disabled/retire candidates — plus Claude judgment to interpret it |
| Output | **Standalone `.docx` scope assessment**, ungraded, plus an optional per-environment `.csv` inventory |

You are the analyst. The exports are your instrument. The deliverable is a scope a delivery lead
can staff and a customer can challenge line by line.

> **HARD RULE — this skill never contacts a tenant.** It has no `dtctl` step, no probes and no
> queries. It reads files. There is nothing to make read-only because nothing is read from a live
> system, and no step of this runbook may add one.

> **HARD RULE — exports are customer data.** They contain the customer's full configuration
> surface, including notification integrations that can carry credentials in cleartext. Keep them
> **outside the repo** or under a gitignored `runs/` path, never in a tracked directory, and never
> share the export directory or its extracted contents with anyone. Deliver only the `.docx`/`.csv`.

**Related skills.** `/dt-eval-gen3` is the natural *next* engagement — it measures Gen2 → Gen3
progress once the tenant is live, which is exactly the work this assessment sizes and the plan
template omits ([m2s-source-errata.md](../dt-eval-tenant/m2s-source-errata.md) E3/E4).
`/dt-eval-mz2seg` plans the largest single piece of that conversion in execution depth. This
skill hands off to both and duplicates neither: it **sizes** the conversion, it does not plan it.

## Core directive — a scope, not an inventory

"7,938 configuration objects across nine environments" is a data dump, and worse, it is a
misleading one — roughly 980 objects per environment are platform defaults that ship with every
tenant. The deliverable must give the honest size of the work and the shape of it. The findings
that make it worth reading (INTERPRET, per CLAUDE.md):

1. **What is actually customer-built.** Baseline subtraction turns the raw count into the number
   that matters, and it routinely collapses by 70–80%.
2. **Where it is.** Estates are radically unequal. When one environment holds three quarters of
   the hand-built configuration, the engagement is a one-environment migration with a tail of
   shells — a materially cheaper and differently staffed conclusion than "nine environments".
3. **The workstreams nobody listed.** Hard-coded entity references, process-group-bound settings
   and identity/SAML are the three that are reliably absent from the customer's own brief and
   from the official plan template.
4. **What to retire instead of migrating.** Already-disabled objects, dashboards that are cloned,
   personal or default-named, and classic extensions enabled nowhere-configured are scope
   *reduction*. Every one removed is migration effort that never has to be estimated.
5. **The cost of not acting, both directions.** Migrating configuration debt means paying to move
   it and then paying again to live with it; the entity-reference workstream discovered on
   cutover weekend is the one that turns a migration into an outage.

## The precondition — three environments, or the method is invalid

Baseline subtraction takes the **minimum count per configuration type across all environments**
as the platform-default floor. With one or two exports the floor is indistinguishable from an
environment's own content, and the resulting "customer-built" figure is really just the
difference between two estates — a plausible-looking number that means nothing.

**A set too small to baseline itself can borrow a measured floor.** `--floor-from <dir>` measures
the floor from a reference set of exports and applies it to the analyzed set — the case this exists
for is a single production export assessed alongside its non-production siblings. The floor is a
property of the platform build, so the borrowing is legitimate **only within one cluster and one
product version**; the analyzer records both on each side and warns when they differ. The reference
set is itself gated at three environments, so the import cannot launder an invalid floor into a
valid-looking result. **State the basis in the deliverable** — a floor measured somewhere other than
the environment being reported is a claim the reader is entitled to challenge.

`analyze_export.py` **refuses** below three environments rather than warning. `--allow-small-estate`
runs the arithmetic for inspection and marks the result `baseline_valid: false`; a result so
marked must not reach a deliverable. With one or two environments, fall back to per-type
inspection and say in the report that the estate could not be baselined and why.

## Phase 0 — Preflight. BLOCKING: resolve these BEFORE any analysis

The family protocol, with input 3 replaced — there is no tenant to authenticate to. **Do not run
`analyze_export.py` until every input below is resolved.** Measuring first and asking afterwards
produces a scope the user never agreed to, and on this skill that is not a cosmetic error: the
export set IS the scope, so an unconfirmed input silently changes what the deliverable is about.

**Step 1: Resolve customer name and estate identifier**

If not provided in the initial request, prompt the user (AskUserQuestion):

- "What is the customer name / organization?" (e.g. `Acme Corp`) — required.
- "Which Managed cluster is this?" — the **estate identifier**, the first 8 characters of
  `clusterUuid` from any export's `exportMetadata.json`. Read it from the exports rather than
  asking, and confirm it back. It occupies the tenant-ID position in the output filename so the
  family's versioning and superseding work unchanged. **Exports spanning more than one cluster is
  itself a finding** — say so, and ask which is primary.

Store both for filenames, the cover page, the output directory, and run-state tracking.

**Step 2: Confirm the export set — EXACTLY what the user supplied**

> **HARD RULE — the user names the exports; you never widen the set.** Use precisely the files
> the user attached or named. **Do not substitute the containing directory, do not add siblings
> you find next to them, and do not "helpfully" analyze the whole folder** — the export set is the
> scope of the engagement, and expanding it fabricates a scope decision that belongs to the user.
> If the supplied files sit in a directory holding more exports, that is worth ONE sentence
> pointing it out and asking — never a reason to proceed on the larger set.

Confirm with the user:
- the exact list of export files, read back to them by name;
- that their location is **outside this repo** (they are customer data — see the hard rule above);
- **whether the set is complete for the estate.** If it is not, say plainly what that costs:
  below three environments the baseline is invalid (see the precondition below), and a partial
  set understates every estate-wide total in the report.

**Step 3: Confirm the output location** — default from
[output-config.json](../.dt-eval-common/output-config.json), whose shipped `prompt_mode` is
**`always`**: confirm the location on **every** run, pre-filled with the default, and let the user
redirect it. The flat `<customer-name>/current/` subfolder is always applied, with the estate
identifier and audience encoded in the filename
(`<clusterId>-managed-to-saas-scope-assessment-<date>(vN).docx`, `[INTERNAL ONLY]-` prefixed for
internal). `DT_EVAL_OUTPUT_DIR` overrides the root only. Session scope: a root already confirmed
by a sibling skill this session for the same engagement is inherited without re-prompting.

**Cluster layout — ask ONCE per customer, only when there is more than one cluster** (owner decision
2026-08-27). The estate identifier occupies the tenant-ID position, so this skill uses the same
machinery as its siblings: a customer with several Managed clusters may keep every cluster's
assessments side by side in one `current/` folder (**flat**, the default), or give each cluster its
own subtree (`<output-root>/<customer-name>/<clusterId>/current/`). Run
`.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <clusterId>`; when
it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user, then record it with `layout.py set`,
which also migrates what is already on disk. A single-cluster customer is never asked. The answer is
shared with every sibling skill through `<output-root>/<customer-name>/.dt-eval-layout.json` — one
customer, one layout, whether its deliverables came from a Managed estate or a live tenant.

**Step 4: Confirm the report audience** — External (default) or **(Internal)** per
[report-audiences.md](../.dt-eval-common/report-audiences.md). Ask; do not assume.

**Step 5: Confirm scope exclusions** — environments to mark out of scope (`--scope-exclude`),
typically sandbox or test estates the customer does not intend to move. **Confirm the substring
with the user; never infer it from a name alone** (CLAUDE.md rule 5a — a name is not evidence).
An environment called `*-TEST` may be a production dependency, and a shell environment may be a
DR target that is supposed to look empty. Present the environment list from the exports and let
the user mark them.

**Step 6: Check for prior deliverables** — glob `<output-root>/<customer-name>/current/` for
`<clusterId>-*` (both audiences) and any `_superseded/` sibling. **If a prior assessment exists,
ASK before building** (AskUserQuestion): compare against it, or treat this as a fresh report? A
comparison may appear in the deliverable only if the prior report was actually delivered
(CLAUDE.md hard rule 4).

## This deliverable is ungraded, and it is not in the rollup

**Ungraded in both audiences.** There is no score to suppress: the headline is the size of the
remaining work, not a rank. Follow `/dt-eval-mz2seg` — no score, no grade letter, no gauge, no
Score/Grade column, in either edition. The headline figures that DO belong on the cover are the
**in-scope customer-built object count** and the **concentration share**, both stated as plain
measured numbers in prose.

**It does not participate in `/dt-eval-rollup`.** The rollup assembles reviews delivered *for a
tenant*; this assesses a Managed cluster before one exists, so it writes no `headline` block and
`runlog.py finalize` is called **without `--skill`** (which is exactly the documented behavior
for a caller with no cross-skill headline vocabulary). Adding it to the rollup would put a
pre-migration scope beside post-migration tenant scores and invite a comparison that means
nothing.

## Phase 1 — measure

```bash
.venv/bin/python .claude/skills/dt-eval-m2s/analyze_export.py <export-dir> \
    --scope-exclude <substring> \
    --json runs/<clusterId>-<date>/analysis.json \
    --csv  runs/<clusterId>-<date>/inventory.csv
```

Read the JSON, not the console text — the console report is for the operator, the JSON is the
authored report's source. Before interpreting anything, check three keys:

- `duplicate_export_groups` — **non-empty means stop.** Byte-identical zips are the same export
  renamed, and every per-environment figure is fiction until they are re-exported. Say so to the
  user and do not proceed on the assumption it is minor.
- `baseline_valid` — false means the customer-built figures cannot be used.
- `not_in_exports` — the standing list of what an export never contains.

## Phase 2 — interpret

Work the finding catalog in
[m2s-scope-assessment-spec.md](../dt-eval-tenant/m2s-scope-assessment-spec.md) §3. For each
finding, before it is counted as a defect, **rule it in before you rule on it** (CLAUDE.md
directive 5): a low object count can be a deliberately small estate; a shell environment can be
a DR target that is supposed to look empty; a "duplicate" dashboard family can be deliberate
per-team separation. State what you excluded and why, with `verified_by`, using
`finding_section(..., excluded=[{item, reason, verified_by}])`.

**Every counted claim carries its reproduction** (CLAUDE.md directive 4). For this skill the
reproduction is not a DQL query — there is no tenant to run one against. It is the **command that
produced the number plus a sample of five**, e.g.:

```python
reproduction={
    "note": "Produced by analyze_export.py over the nine configuration exports supplied "
            "on <date>; re-runnable against the same files.",
    "sample": [...],   # five of the things counted — capped at five
}
```

`finding_section` raises `UnreproducibleCountError` on a counted finding with neither, so this
holds whether the report is scaffolded or hand-authored.

**Check every derived total against its ceiling** (CLAUDE.md directive 6): customer-built objects
can never exceed raw objects; per-type built counts can never exceed that type's raw count in
that environment; the concentration share can never exceed 100%. The analyzer's arithmetic makes
these true by construction — assert them anyway if you compute anything further by hand.

## Phase 3 — author the report

**Hand-authored via `docx_style`**, the same pattern `/dt-eval-gen3` uses — there is no builder
script for this skill, which is precisely why `finding_section` is the guard rather than a
scaffold. Section list, voice and the ungraded cover are specified in
[m2s-scope-assessment-spec.md](../dt-eval-tenant/m2s-scope-assessment-spec.md) §4.

Host units, DEM units, DDU and entity counts are **⚪ not-assessable** whenever the customer has
not supplied them from the Managed cluster console or tenant API — appendix footnote only, never
a body page, and **never substituted with a default** (CLAUDE.md hard rule 3). "Configuration
exports carry no host data" is a sentence that belongs in the method note, stated plainly.

## Phase 4 — scan and file

```bash
.venv/bin/python .claude/skills/.dt-eval-common/verify_docx.py <file> \
    --profile detailed --customer "<Customer>"
```

The scan binds this deliverable exactly as it binds every other, including `us-english`,
`gen2-expansion` and the distribution marking. Cite `docs.dynatrace.com` for every
version-sensitive claim **this run** — see
[m2s-source-errata.md](../dt-eval-tenant/m2s-source-errata.md) §3 for the list that goes stale,
and §2 for the claims in official material that are already wrong.

Then `runlog.py finalize <run.json> --report <path>` (no `--skill`, no headline — see above).

## What this skill must never do

- **Never contact a tenant.** No `dtctl`, no DQL, no API call. If a figure needs a live read, it
  is not in scope for this deliverable — hand it to `/dt-eval-gen3` after cutover.
- **Never recommend creating a classic construct** (Gen3-first, CLAUDE.md). Classic extensions,
  management zones and alerting profiles found in an export are migration or retirement
  decisions; the target is always the native mechanism.
- **Never substitute a default for missing host or licensing data.** Not-assessable is a stated
  gap, not a gap to fill.
- **Never present a number from a duplicated export set.** See Phase 1.
- **Never widen the export set the user gave you.** Not to the containing directory, not to
  siblings found next to it. The export set is the scope; choosing it is the user's decision,
  and expanding it silently changes what the report is about. Ask instead — see Phase 0 Step 2.
- **Never run the analysis before Phase 0 is resolved.** Output location, audience and scope
  exclusions are inputs to the deliverable, not afterthoughts.
- **Never cite the BPN as authority.** Further reading only, and only with a followable public
  URL — [m2s-source-errata.md](../dt-eval-tenant/m2s-source-errata.md) §1.
