# OpenPipeline Review — deliverable structure

One probe collection (Phases 1–4) feeds both deliverables. Build only the selected ones; default is both. Deliverables land in `<output-root>/<customer-name>/current/`, named `<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` (or `[INTERNAL ONLY]-<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` for an internal edition) — the `(vN)` marker is always present, starting at `v1`.

> **🔴 The report's `reportname` is `OpenPipeline`, and only the report may be a `.docx`.** `dt-eval-rollup` locates this skill's deliveries by globbing `<root>/<customer>/current/*OpenPipeline*.docx`. A renamed stem silently drops this skill's column from the dashboard; a **second** `.docx` in the same folder whose name contains `OpenPipeline` is counted as another delivery of the same skill on that date. The consolidation worklist is therefore markdown or CSV — never Word — and this is a structural constraint, not a style preference.

---

## 1. Word OpenPipeline report — `<tenantId>-OpenPipeline-<date>(vN).docx`

Client-ready, via the shared `../.dt-eval-common/docx_style.py` (same house style as the Tenant Eval, so figures and look reconcile across reports). Built from `run.json` + `findings.json`. **Assemble `findings.json`'s `meta` with `assemble_findings.py`, never hand-type it** — it computes the composite via [scoring.py](scoring.py) and names its own keys via [findings_schema.py](findings_schema.py), which is also the canonical schema every consumer validates against. An unrecognized or missing meta key fails the build rather than rendering a blank cell. This skill's qualitative analysis (per-family disposition, the confirmations from Phase 4) is the analyst's judgment and is passed in as separate JSON, not computed.

Structure:

1. **Cover** (`cover_page`) — "Dynatrace OpenPipeline Configuration Review", customer, tenant URL, date, the **OpenPipeline Health Score** + grade (`render_gauge_png`), and the **scale stat line** — *customer-authored pipelines · routing entries · signal-type scopes configured* — so page one states the size of the estate the grade is computed over. A grade with no scale behind it invites the reader to over-read a small number. Carries the AI-disclosure footnote with `requested_by=` from `dtctl auth whoami`.
   **Gated run (below the adoption floor):** the cover instead carries **"OpenPipeline Adoption (configuration-only)"** with no score and no grade, plus the notice — *"This tenant has not yet built enough OpenPipeline configuration for a health verdict. The findings below describe the current state and the path to adoption."* A gated report is a materially different artifact and the reader must be able to tell from page one. **Never render a gated run as a score of 0** — that would rank a tenant that has not started below every tenant that has.

   **Gated run (inventory not assessable):** a different notice, and since 2026-08-26 one of *two* depending on `meta.diagnosis` — because the two causes call for opposite actions. A **tooling gap** (the definitions sit on a surface dtctl has no verb for) must say the configuration could not be *retrieved*, state plainly that this is **not** an access limitation and that no permission change is needed, and name the **export** from the OpenPipeline app as the fix. An **access gap** (`routing_unreadable` — the routing tables themselves would not read) keeps the access wording, because there it is true. With no diagnosis recorded the notice asserts neither cause. **Never let the not-assessable gate render the below-floor sentence** — telling a customer whose pipelines carry billions of records that they "have not yet built enough" inverts the finding. `report_helpers.gated_notice()` owns all four sentences; `test_report_helpers.py` pins them.
2. **Executive summary** (~1 page, prose) — the thesis sentence (e.g. "Records are routed correctly and end-to-end, but the pipeline estate has grown one-per-source: a third of its pipelines are duplicates of four distinct processing shapes"), the 3–5 biggest drivers tied to operational impact, and the one-paragraph "what to do first."
3. **How to read this** — ✅/💡/⚠️ legend. ⚪ items are excluded from the body and listed in the appendix with the access that would close each.
4. **The routing and pipeline picture** — the estate at a glance before any finding: routing entries and their order, catch-all presence, pipelines by scope, the **ownership split** (customer-authored vs. extension-default — stated plainly, because it is the denominator every later number rests on), and per-pipeline processor counts against the **public** limits figure. Lead with the **three-pillar breakdown** (routing integrity · native adoption breadth · structural hygiene, each with weight and grade), then a `rag_summary` bar and a `pillar_bar_chart` worst-first. **Throughput belongs here as context and nowhere else** — never presented as an adoption measure.
5. **Findings — summary table first, then bulleted deep-dives.** **(a)** Lead with a `scorecard_table` (`#` · finding · measured · status ✅/💡/⚠️ · recommended action). **(b)** Then one H3 per finding, worst-first, written as **bullet lists, not prose** — *Found / what's measured*, *evidence*, *if-left-unaddressed*, *sequencing* as `List Bullet` items via `lead_bullets(doc, label, items)`; reserve short prose only for a one-line *Recommendation*. Dense paragraphs are the failure mode to avoid.
   Each finding carries the full contract — `docx_style.finding_section(..., means=, consequence=, action=[steps], reproduction={query, note, sample})`:
   - **means** — what it says about *this* tenant, from cross-correlating probes. Not a restated definition.
   - **consequence** — both directions, and the cost of inaction explicitly: records silently dropped at a missing catch-all; a masking rule that never runs because its pipeline is orphaned; two numbers for one signal drifting apart until an incident turns on which is right.
   - **action** — concrete and sequenced, with the canonical survivor named and the routing entries to repoint listed. "Consolidate your pipelines" is not an action.
   - **reproduction** — **every counted claim ships with the client-runnable query that produced it, or a sample of five of the things being counted — ideally both**, placed directly under the number where the reader meets it, and printed **only** there. `finding_section` refuses a counted finding with nothing attached (`UnreproducibleCountError`), and the pre-delivery scan fails it (`structure-unreproducible-count`). Where a count genuinely has no query and nothing to sample, `reproduction={"note": …}` states *why* — a stated gap passes, silence never does.
   **Reproduction queries are plain DQL** — no `dtctl` wrapper. The client pastes them into a Notebook; a CLI invocation they cannot run is not a reproduction.
   **Confirmation-pending findings are marked as such.** Governance drift and near-duplicate families that the Phase-4 confirmation did not settle appear as 💡 with the open question named verbatim — never as ⚠️, and never counted in the score.
6. **The consolidation plan** — the sequenced Now/Next/Later table: delete confirmed orphans (zero-risk) → merge exact-duplicate families → repair dangling and shadowed routing entries → generalize confirmed near-duplicate families → resolve governance-drift questions with the owner. Each row carries its `[counted]` / `[volume-weighted]` / `[derived]` tag. **Never publish a bare percentage.**
7. **Verifying and re-measuring** — **the check lives with the finding it supports, not in a list at the end.** Each deep-dive in §5 already carries its client-runnable DQL directly under what was found, and that is the only place it is printed. This closing section carries only what has no single finding to sit under: where to change each thing in the UI (Settings → Process and analyze → OpenPipeline), the GUI-only states, and the standing instruments. **Never repeat a query a finding already shows** — printing it twice gives the reader no signal about which is authoritative.
8. **Appendix** — method (client-safe), ⚪ footnotes (each with the scope or share that would include it), and references (docs.dynatrace.com OpenPipeline pages, including the public limits page cited in §4). **Internal editions only:** the internal soft/hard limit tiers, if used for prioritization, appear here and never in an external edition.

**Hygiene:** no run paths, probe IDs, evidence filenames, raw API error strings, context names, or cross-tenant references. No scope-decision language ("out of scope") — say "not assessed in this review" plus the access that would include it. Pre-delivery scan every docx before handing over.

---

## 2. Consolidation worklist — `<tenantId>-OpenPipeline-consolidation-<date>(vN).md`

The lightweight, execution-ready cut — no prose. This is the artifact a platform engineer works from.

**Header line (required, verbatim shape).** Every field is copied from `run.json` — `meta.customer`, `meta.tenant`, the collection date. `dt-eval-prob` learned this the hard way: with no template to copy, the header was retyped each run, and two change lists shipped naming a different customer than the one they were about. **Do not retype it from session memory**, and run the hygiene scanner over this file with `--customer` passed explicitly rather than inferred.

```
**Customer:** <meta.customer>  |  **Environment:** <meta.tenant>  |  **Scope:** <data-type scopes assessed>  |  **Generated:** <YYYY-MM-DD>
```

Then one ranked table, **grouped by scope** — a family never spans two data-type scopes, and a worklist that mixes them invites a merge that cannot work:

```
| # | Scope | family_id | member_pipelineIds | canonical_pipelineId | member_record_share | governance_drift | disposition | routingEntries_to_repoint |
|---|-------|-----------|--------------------|----------------------|---------------------|------------------|-------------|---------------------------|
| 1 | logs  | orphan-03 | pipe-7c2           | —                    | 0%                  | n                | delete-orphan | — |
| 2 | logs  | exact-01  | pipe-1a4, pipe-9d8 | pipe-1a4             | 71% / 29%           | n                | merge | route-12, route-19 |
| 3 | logs  | near-02   | pipe-3f1, pipe-8b6 | pipe-3f1             | 88% / 12%           | y (securityContext) | keep-separate: ABAC scoping deliberate (confirmed with owner) | — |
```

**Column rules:**
- `canonical_pipelineId` is the **highest-volume** member — repointing low-volume entries onto an established pipeline is lower-risk than the reverse. `—` for a delete-orphan row.
- `governance_drift` is `y` + the drifting field, or `n`. A `y` row is **never** `merge` unless the confirmation recorded the drift as accidental; the disposition then states that it was confirmed.
- `disposition` is one of `merge` · `keep-separate:<reason>` · `delete-orphan` · `repoint`. A `keep-separate` reason is mandatory and names *why*, so the next review does not re-raise a settled question.
- `routingEntries_to_repoint` lists the routing-entry `objectId`s whose `pipelineId` changes to the canonical.

Ordered so the zero-risk, high-certainty rows come first — confirmed orphans and exact duplicates in one sitting — then the entries that need a routing edit, then the families still waiting on an owner decision.

**The worklist is advisory.** It names what to change; it never ships as a script, and this skill never offers to run one. Merging pipelines is destructive and irreversible from this side of the boundary.

---

## `findings.json` — the shared intermediate

Both deliverables read one `findings.json`. Its `meta` block is built and validated by [findings_schema.py](findings_schema.py):

- **Full mode** requires `score`, `grade`, `grade_label`, `routing_integrity`, `n_authored`, `window`.
- **Gated mode** requires `gated`, `reason`, `no_grade_reason`, `headline_label`, `adoption_floor`, `window` — and must carry **no** score, grade, or scored pillar.
- Findings-side detail (`capacity_pressure`, `governance_drift_families`, `near_duplicate_families`, `extension_default_pipelines`, `confirmations`, `consolidation_worklist`, `orphan_pipelines`, `duplicate_collection_paths`) is optional, recognized, and deliberately **outside the arithmetic**.

`no_grade_reason` travels from here to `runlog.py finalize --no-grade-reason` verbatim, which is what lets the rollup render a gated tenant as "not applicable yet" rather than a blank or a zero.
