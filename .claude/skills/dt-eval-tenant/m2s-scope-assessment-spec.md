# Managed → SaaS scope assessment — method, traps, finding catalog

The design note behind **`/dt-eval-m2s`**. The runbook is
[dt-eval-m2s/SKILL.md](../dt-eval-m2s/SKILL.md); the source precedence and the verified-wrong
claims in official material are in [m2s-source-errata.md](m2s-source-errata.md).

Derived from a nine-environment Managed → SaaS engagement (Aug 2026). Every figure quoted is
from that reference estate, de-identified and rounded.

---

## 1. The input

One `.zip` per environment, produced by the SaaS Upgrade Assistant in Monaco format:

```
<env>_configurationExport-<ts>.zip
└── exportFile.tar.gz
    ├── exportMetadata.json          env name, uuid, cluster uuid, product version
    └── export/project_<env-uuid>/
        └── <config-type>/
            ├── config.yaml          Monaco declarations — REAL object names live here
            └── <id>.json            payload; names templated as {{.name}}
```

**What an export does not contain:** host units, DEM units, DDU consumption, entity counts,
licensing. There is no way to derive them from the files, and no default that may stand in for
them. They are ⚪ not-assessable unless the customer supplies them from the Managed cluster
console or the tenant API.

---

## 2. The core technique — baseline subtraction

A raw object count is meaningless. Roughly **980 objects per environment are platform defaults**
that ship with every tenant, so counting them makes a near-empty environment look substantial and
makes the estate look uniform when it is not.

For each configuration type, take the **minimum count across all environments**. That is the
default floor. Everything above the floor was built by a human.

On the reference estate this turned **7,938 raw objects into 2,046 customer-built**, and showed
that **one environment held 74%** of them. That single number reframed the engagement: a
one-environment migration with a tail of shells, not a nine-environment program.

> **≥3 environments, enforced.** With one or two the floor is indistinguishable from that
> environment's own content, and the derived figure is just the difference between two estates —
> a plausible number that means nothing. `analyze_export.py` raises `SmallEstateError` rather
> than warning, because this failure is silent and flattering. `--allow-small-estate` marks the
> result `baseline_valid: false`, and a result so marked must not reach a deliverable.

**Importing a floor.** A single environment cannot establish a floor from itself — `min(x) = x`, so
every customer-built figure is identically zero by construction. `--floor-from` measures the floor
from a reference set and applies it, which is what makes a production-only assessment possible
alongside its non-production siblings. Two conditions: the reference set must itself clear the
three-environment gate, and it must share the **cluster and product version** with the analyzed set
(the analyzer records both and warns on a mismatch). Verify the borrowed floor is not being set by
the environment under assessment — where the target is the largest environment it never is, and
that is worth checking and stating rather than assuming.

**Ceiling checks** (CLAUDE.md directive 6), true by construction in the analyzer and worth
asserting on anything computed further by hand: customer-built ≤ raw; per-type built ≤ that
type's raw count in that environment; concentration share ≤ 100%.

---

## 3. Finding catalog

Each row is a finding the method reliably surfaces. **None of the reference estate's findings
were in the customer's own brief** — which is the point of measuring rather than interviewing.

| Signal | What it means | Reference figure |
|---|---|---|
| **Customer-built vs raw objects** | The honest size of the migration. Routinely a 70–80% collapse from the raw count | 7,938 → 2,046 |
| **Concentration** | Where the work actually is. Reframes staffing and sequencing | one environment held 74% |
| **Hard-coded entity references** (`id_TYPE_XXXX`) | Every one breaks if entity IDs change at the move. Sizes a remediation workstream that is usually in nobody's plan — **and is conditional**, see E5 below. **Verify any type reported as unrecognized before naming it** (trap 8) | 234 references |
| **Process-group-bound settings** (`builtinhost.process-groups.monitoring-state`) | These do **not** migrate automatically. Direct, unavoidable manual effort | 42 settings |
| **Management zones / alerting profiles** | Each zone becomes a Segment *and* an IAM policy; each profile becomes a Workflow. This is the Gen2 → Gen3 conversion scope the official plan template has no tasks for (errata E4) | — |
| **Disabled objects** | Configuration already switched off that would migrate anyway. Scope reduction, not migration | 346 objects |
| **Dashboard retirement candidates** | Default-named, `-cloned`, `-OLD`, or personal names. Cleanup *as* scope reduction. Counted **per object** — see trap 9 — with `most_repeated` naming the worst offenders | ~45% of dashboards, reproduced on a second estate at 44% |
| **Classic (Extensions 1.0) extensions** | EF1 support ended 30 Sept 2025. Enabled-but-configured-nowhere is a retire decision, never a migration item | one extension enabled in all nine environments, configured in none |
| **Identity / SAML** | Reliably an unlisted workstream sitting on the critical path. Not measurable from an export — surfaced by asking, and flagged as not-assessable if unanswered | — |

**E5 governs the entity-reference finding.** Entity IDs change **only if agents are
reinstalled**; `oneagentctl --set-server` preserves host identity and the entity IDs with it. The
finding is therefore "234 references that break *under a reinstall-based cutover*" — stating it
unconditionally is the error the errata register exists to prevent, and it materially overstates
the work.

### Ruling it in before ruling on it

Before any of the above is counted as a defect (CLAUDE.md directive 5):

- **A shell environment may be a DR target** and is supposed to look empty.
- **A low object count may be a deliberate scope**, not a gap.
- **A duplicate-looking dashboard family may be deliberate per-team separation.**
- **A name is not evidence.** An environment called `test-*` is not out of scope until the
  customer says it is; confirm the `--scope-exclude` substring rather than inferring it.

Record every exclusion with `finding_section(..., excluded=[{item, reason, verified_by}])`.
`verified_by` is mandatory (`UnverifiedExclusionError`) because "excluded 4 DR environments" is a
claim about intent, and intent is exactly what a naming convention does not prove.

### Reproduction, without a tenant

There is no DQL query to print — the measurement is offline. The reproduction block is the
**command that produced the number plus a sample of five**:

```python
reproduction={
    "note": "Produced by analyze_export.py over the nine configuration exports supplied "
            "on <date>; re-runnable against the same files.",
    "sample": [...],   # five of the things counted, capped at five
}
```

---

## 4. The traps

Each of these produced a wrong number before it was caught, and each has a regression test in
`dt-eval-m2s/test_analyze_export.py`.

1. **Identical exports.** Re-downloaded and renamed rather than re-run — six byte-identical files
   were once presented as six environments. SHA-256 the zips first; a non-empty
   `duplicate_export_groups` means **stop**, not "note it in passing".
2. **`glob` skips dot-directories.** It returns zero matches silently rather than erroring. Use
   `os.walk`/`os.listdir`.
3. **Entity IDs are double-counted.** Each reference appears in *both* `config.yaml` and the
   `.json`. Raw matching inflated one environment from 28 to 135. Dedup on `(type, id)`.
4. **`builtinoneagent.features` swamps the disabled count.** ~2,000 disabled feature flags per
   environment are platform defaults, not customer decisions. Excluding them took a headline from
   2,320 to 346 — an order-of-magnitude error in the direction that makes a finding look more
   impressive, which is the direction that gets a report believed.
5. **Dashboard names are templated.** The `.json` says `{{.name}}`; the real name is in
   `config.yaml`, and a naive regex over that YAML also picks up nested keys. Parse it.
6. **Exports carry no host data.** Say so explicitly rather than substituting a default.

A ninth, and the most instructive because the whole test suite passed over it: **count OBJECTS,
not distinct names.** The dashboard-retirement figure deduplicated its numerator while the
denominator stayed per-object — a units mismatch that **understated the finding 2.6x** on the
first real estate (22 of 133 reported where the truth was 59 of 133) because one environment held
19 dashboards named `Home` and 14 named `Config`, and they collapsed to two. Every fixture in the
test suite had used DISTINCT names, so nothing caught it; the regression test now uses repeated
ones. Two lessons: a deduplicated numerator over a raw denominator is always wrong, and **a
sample may be deduplicated while a count may not** — five distinct examples inform a reader, five
identical ones do not.

The repetition is itself a finding worth reporting: a name carried by nineteen dashboards means
nobody renamed them, which is a concrete, auditable claim about estate hygiene. `most_repeated`
carries it.

An eighth, found on first contact with a real export: **Monaco mis-splits some
references, and the entity TYPE is the casualty.** Monaco's own ID extraction can match a
trailing substring of an entity ID and name the placeholder after it — a real export carried
`APPLICATION_MET{{ .extractedIDs.id_HOD_<16-hex> }}`, where the source text was
`APPLICATION_METHOD-<16-hex>`: Monaco matched `HOD-<hex>`, left `APPLICATION_MET` as literal
text, and invented an entity type called `HOD`. Reporting that faithfully is not good enough —
"1 HOD entity reference" is unauditable, it dies at the first "which one?" in the readout, and it
*hides* the real fact, which is an APPLICATION_METHOD reference sitting in mangled dashboard
markdown.

So the **total is unchanged** — the reference is real, only its label is wrong — and the per-type
breakdown is split: recognized types are reported as types, anything else lands in
`entity_refs_unrecognized` for a human to verify before it is named in a deliverable. The known
set only ever **flags, never drops**: Dynatrace adds entity types, and silently discarding a real
one would be the worse failure. An unfamiliar type therefore means one of two things — a Monaco
mis-split, or a genuine type newer than this tool — and the analyst reads the object to find out.

A seventh, added on import: **an export zip is untrusted input.** `tarfile.extractall` without
`filter="data"` will happily write outside the extraction root, and the pre-3.12 fallback in the
original implementation did exactly that. `_safe_extract_tar` validates every member path and
refuses links.

---

## 5. Document structure

Standalone `.docx`, **ungraded in both audiences** (see the runbook — the headline is the size of
the work, not a rank, so there is no score to suppress).

1. **Cover** — customer, estate identifier, date, distribution marking. No score, no grade, no
   gauge. The two headline figures — in-scope customer-built objects, and the concentration share
   — are stated in prose.
2. **Executive summary** — the honest size of the estate, where the work is, and the three
   workstreams that were not in the brief.
3. **Method note** — baseline subtraction in two sentences, the environment count it rests on,
   and the standing statement that exports carry no host, entity or licensing data.
4. **The estate** — per-environment table: customer-built, raw, entity references, dashboards,
   management zones, alerting profiles, process-group-bound settings, disabled, in/out of scope.
5. **Findings** — §3 catalog, one `finding_section` each, every count carrying its reproduction
   and every exclusion its `verified_by`.
6. **Scope reduction** — what to retire instead of migrating, quantified. This section is the
   one most likely to change the commercial shape of the engagement, so it stands on its own
   rather than being folded into the findings.
7. **Not assessed in this review** — appendix. Host/DEM/DDU/entity counts and anything else the
   exports cannot see, each with the access that would include it.
8. **References** — `docs.dynatrace.com` for every version-sensitive claim, verified this run;
   BPN as further reading only, with a followable public URL
   ([m2s-source-errata.md](m2s-source-errata.md) §1).

---

## 6. Related

- [m2s-source-errata.md](m2s-source-errata.md) — source precedence, the five verified-wrong
  claims, and the version-sensitive list to re-verify every run.
- [gen3-migration-progress-spec.md](gen3-migration-progress-spec.md) — the next engagement, once
  the tenant is live. This assessment sizes the Gen2 → Gen3 conversion; that one measures it.
- [mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md) — plans the management zones →
  segments piece in execution depth.
