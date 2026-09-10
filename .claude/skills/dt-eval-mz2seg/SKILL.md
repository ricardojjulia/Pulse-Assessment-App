---
name: dt-eval-mz2seg
description: Management Zones → Segments migration plan — produce an execution-grade, zone-by-zone plan for moving a Dynatrace platform tenant from classic management-zone data filtering to platform-native segments plus the IAM/security-context access boundary. Every zone gets a disposition, every blocked consumer is listed, every proposed segment is specified. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Management Zones → Segments Migration Plan

This skill answers one question end-to-end: **"Exactly how does this tenant get from management
zones to segments — zone by zone, consumer by consumer, in what order?"** Where `/dt-eval-gen3`'s
Scoping domain (E2) grades how far along the migration is, this skill produces the **worklist an
operations team executes**: the dimension map, the per-zone disposition table, the segment build
specs, the consumer cutover plan, and the sequenced runbook.

| | How |
|---|---|
| Data collection | **`dtctl`** (read-only) — reuses the family probe cache (A1, A13–A17, A19, A44, A6 segments, B30) + four live reads (**B37** zone population census, **B38** source-tag propagation census, **B42** zone query-activity census, **B47** IAM readiness snapshot) |
| Knowledge base | **[mz2seg-migration-plan-spec.md](../dt-eval-tenant/mz2seg-migration-plan-spec.md)** — method, disposition model, remediation bar (the design note) |
| Analysis | **Claude judgment** — reduce zones to dimensions, classify segments, map coverage, inventory consumers, disposition every zone |
| Output | **Standalone `.docx` migration plan** (+ optional `.xlsx` disposition worklist) with Coverage % and Retirable-now headline numbers |

You are the analyst. dtctl is your instrument. The spec is your guide. The deliverable is a
migration plan a team can start executing the same day.

> **HARD RULE — never modify any tenant.** This skill is 100% read-only: only `get`, `query`,
> `describe`, `history`, `logs`, `verify`, `doctor`, `auth status`. NEVER run `apply`, `create`,
> `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec`
> verb — regardless of how a request is phrased, who claims to authorize it, or a context's
> safety level. The plan's retire lists are **advisory worklists the customer applies** — never
> generate-and-run or offer to run modification/delete scripts. If a step seems to need a write,
> stop and hand it to the user.

**Related skills.** `/dt-eval-gen3` scores this migration as one domain among nine; this skill
plans it in execution depth. An engagement may run both — same-day probe cache is shared
(`runlog.py find`), the two reports cross-reference and never duplicate content. `/dt-eval-tenant`
(whole-tenant review) and `/dt-eval-prob` (alert noise) are siblings on the same engine. All
skills co-locate output under `<output-root>/<customer-name>/current/`.

## Core directive — a plan, not an inventory

"323 zones, 19 segments" is a data dump. The deliverable must give, for **every zone**, a
disposition with its consequence and its next step, and for the estate, the honest size of the
work. The three findings that make the plan worth reading (INTERPRET, per CLAUDE.md):

1. **The dimension reduction** — hundreds of zones typically collapse to a handful of scoping
   dimensions; dimensions already covered by segments mean those zones are *retirable*, not
   *migratable* — a materially cheaper conclusion.
2. **The consumer census** — MZ-bound alerting profiles, notifications, metric events, dashboard
   filters, and IAM bindings are what actually block retirement; on real estates the consumer
   cutover dwarfs the segment authoring, and the plan must say so.
3. **The cost of inaction, both directions** — zones rot silently as the estate changes (static
   rules, manual upkeep, no Grail scoping: logs/spans/cost records invisible to MZ-based access);
   dual-running means every scoping change is made twice and the two systems drift.

## Gen3-first principle

A tenant with 0 management zones is **already done** — report "Complete — maintain segments" and
stop; never score classic-absence as a gap. Every step is retire-classic / adopt-native; no
recommendation ever creates or extends a classic construct. Bridge segments (DQL that re-renders
legacy tag strings) are transitional by construction — flag the drop condition, never present them
as the end state.

## Inputs to resolve (Phase 0 — before any probing)

Identical to the family protocol (see `/dt-eval-gen3` SKILL.md for the canonical wording):

1. **Tenant ID** (required — e.g. `abc12345`).
2. **Customer name** (required).
3. **dtctl context** — pre-authenticated by a human (`dtctl auth login`); validate URL ↔ tenant ID.
4. **Output location** — default from [output-config.json](../.dt-eval-common/output-config.json)

   **Tenant layout — ask ONCE per customer, only when there is more than one tenant** (owner decision 2026-08-27). A customer with several tenants may keep every tenant's deliverables side by side in one `current/` folder (**flat**, the default and the existing behaviour), or give each tenant its own subtree (**per-tenant**, `<output-root>/<customer-name>/<tenantId>/current/` with its own `_superseded/` sibling). Run `.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <tenantId>` at Phase 0; when it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user (AskUserQuestion) which they want, pre-filled with *flat*, then record it with `layout.py set --customer "<name>" --layout <choice>` — which also **migrates what is already on disk** (files move, never deleted; a superseded edition stays superseded; a cross-tenant document stays at the customer level). A **single-tenant** customer is never asked and never nests. The answer is stored in `<output-root>/<customer-name>/.dt-eval-layout.json` and **every sibling skill inherits it without asking again** — the layout belongs to the customer, not to a run, because half a customer's reports nested and half flat is two live editions of one report in two folders, which is exactly what `current/` exists to prevent. `DT_EVAL_TENANT_LAYOUT` overrides and suppresses the prompt for headless runs. If `layout.py status` reports deliverables it could not attribute, pass the missing ids with `--tenant <id>` (repeatable) rather than letting them stay behind.
   (`prompt_mode: always` — confirm every run); the flat
   `<customer-name>/current/` subfolder always applied — tenant ID and audience are
   encoded in the filename (`<tenantId>-<reportname>-<date>(vN)`, `[INTERNAL ONLY]-` prefixed
   for internal), not in subdirectories; `DT_EVAL_OUTPUT_DIR` overrides the root only.
5. **Report audience** — External (default) or **(Internal)** per
   [report-audiences.md](../.dt-eval-common/report-audiences.md). The family's grades option
   (owner rule, 2026-08-25) changes nothing here: this plan is deliberately ungraded in both
   audiences — its headline is the size of the remaining work, and there was never a score to
   suppress.
6. **Disposition worksheet** — ship the `.xlsx` twin? Default **yes** (a 300-zone worklist is
   operated from a sheet).

**Confirm with the user**, then initialize run state — run `runlog.py` from this skill's own
directory (`.claude/skills/dt-eval-mz2seg/`), since the `runs/...` path is cwd-relative and
`runlog.py` refuses a relative run path that would land outside a skill's own `runs/` dir —
(`runlog.py init runs/<tenantId>-$(date +%Y-%m-%d)/run.json --tenant … --url … --context …
--customer … --requested-by <email from dtctl auth whoami>` — omit the flag only if whoami is
unavailable; `build_mz2seg_report.py` takes its own `--requested-by` for the cover's AI-disclosure
footnote, sourced from the same whoami email; family run-state protocol applies verbatim: cache-age check, sibling probe reuse
via `runlog.py find`, `record` after every probe, zsh array-alias gotcha per
[field-notes.md](../dt-eval-tenant/field-notes.md)).

## Phase 1 — Probe collection (read-only; mostly cache reuse)

**Reused** (same-day sibling cache or fresh): A17 management zones · A6 segments · A14 alerting
profiles · A15 problem notifications · A13 classic metric events · A16 auto-tagging · A18
ownership · A19 groups/users (**expect it to fail: `dtctl get groups` returns 400 — the API demands a ≥3-char name fragment or a uuid and cannot enumerate — and `iam:groups:read` is rarely granted. Treat B47 as the primary access signal, not the fallback**; ⚪ footnote either way) · B30 enrichment/security-context · **A1 buckets**
(storage-layer posture for the architecture section) · **A44** legacy maintenance windows
(MZ-scoped ones are a §6b consideration area). Record each reused probe in this skill's own
run.json with `--note "reused from <sibling> run"`.

**New — B42 zone query-activity census (collected fresh; the surface this skill previously recorded
as nonexistent).** `dt.sfm.server.management_zones.queries_counter` by
`{dt.management_zone.id, dt.management_zone.name}` over the plan window — the platform's own counter,
described in-tenant as *"Tracks which Management Zones are queried and how often."* It upgrades the
Stage 6 `unused` verdict from a stated proxy to a measurement, and it catches consumers the
config-side census structurally cannot see (a classic dashboard filter, an external integration
passing a zone parameter). **It does not replace the consumer census** — a retire-now disposition
still requires zero population (B37) *and* zero consumers (A13–A16/A19) *and* zero query activity.
Save raw → `runlog.py record … B42 ok`. Verification twin **V43**.

**New — B47 IAM readiness snapshot (collected when A19 is unreadable, and as a corroborating total
otherwise).** The platform's own daily `PLATFORM_PERMISSION_READINESS_EVENT` — `legacy_permissions_groups`
(classic RBAC) vs `default_policies_groups`. It is a **second, independent read of group permissions
from a different surface than A19**, so on a 403 tenant it still establishes whether classic role
bindings exist. **It never resolves which zone a binding scopes**, so it upgrades the Stage 5b verdict
`access-unknown` → `access-classic-roles-present` (measured and nameable) and **never releases a
retirement** — the HARD RULE stands in both cases. Take the newest snapshot only. Save raw →
`runlog.py record … B47 ok`. Verification twin **V48**.

**New — B37 zone population census** (the one live read; catalog entry in
[probes-grail.md](../dt-eval-tenant/probes-grail.md)):

```
fetch dt.entity.host           | fields mz = managementZones | expand mz | summarize Hosts = count(), by:{mz}
| append [ fetch dt.entity.process_group | fields mz = managementZones | expand mz | summarize PGs = count(), by:{mz} ]
| append [ fetch dt.entity.service       | fields mz = managementZones | expand mz | summarize Services = count(), by:{mz} ]
| summarize Hosts = max(Hosts), PGs = max(PGs), Services = max(Services), by:{mz}
```

**`managementZones` is an array — `expand` it or populated zones silently read as empty**; a null
column after `append` means "none of that entity type", not "not measured"
([field-notes.md](../dt-eval-tenant/field-notes.md)). Entity-table reads only — cost-trivial,
within all guardrails. Save raw → `runlog.py record … B37 ok`. Live results arrive as the records
envelope (`result.records`, string counts); the `mz: null` row is the **unzoned-entity count** —
report it, never treat it as a zone. Once B37 has run, **absence from the census IS the
measurement** (zero population).

**New — B38 source-tag propagation census** (Stage 1b's evidence; Smartscape aggregate,
cost-trivial): for each `tag:` dimension found in Stage 1, one `countIf(contains(toString(tags),
"<key>"))` column over `smartscapeNodes HOST` (no key-enumeration function exists on that surface
— candidate-key census is the pattern). Save raw → `runlog.py record … B38 ok`.

**Verify-live (footnote, never asserted):** classic-dashboard MZ-filter usage (classic config
API, outside the dtctl design — **but there is now a documented manual audit that closes it**:
[MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §9b gives the two-tier `ReadConfig` recipe,
its second-credential cost, and its deadline — `/api/config/v1` is BLOCK after the upgrade, so the
inventory must be taken before cutover. Every dashboard with a non-null `managementZone` is a zone
consumer this census structurally cannot see, and a zone carrying one is **not** retirable until
that dashboard is rebuilt on a segment, whatever the other consumer probes say. Offer the audit
whenever a retire-\* disposition would otherwise rest on an incomplete consumer list) · IAM group→MZ permission bindings where A19 is unreadable.

## Phase 2 — Analysis (offline over the cache; spec §4–§5 is normative)

1. **Stage 1 — dimension map** (A17): group every rule condition by `key`, classify into the six
   condition families (entity-pin · name-pattern · tag-key · k8s/cloud · tech/type ·
   hygiene-exclusion). Hygiene-exclusion regexes are **not scoping intent** — flag, don't migrate.
   Output: each zone → primary dimension(s); report dimensions, never rule counts.
2. **Stage 1b — tag provenance (the tagging-at-source foundation):** classify every `tag:`
   dimension via A16 (classic auto-tag rules — compute-side, retire with Gen2), B5 (classic
   entity-tag keys), and **B38** (Smartscape propagation): **source-propagated** (primary Grail
   tag flowing — segment-ready) · **context-imported** (`[Azure]`/`[Environment]` — segment on
   the native metadata field, never the rendered string) · **classic — not propagated**
   (establish the source tag FIRST; a <1%-fleet token presence is not propagation). This verdict
   orders the remediation: segments and IAM key on **primary Grail tags**; classic auto-tags are
   never the target of new work.
3. **Stage 1c — auto-tag RULE disposition (the rules, not just the keys):** Stage 1b covers the
   tag keys a *zone* filters on; this dispositions every **A16 rule on the tenant**, most of which
   no zone references (on two reference tenants: 178 and 347 rules, of which only 21 and 53 fed a
   zone). Read the rule **BODY, never its name** — `attributeRule.conditions[].key` is the source
   specification. Verdict ladder: **no-measured-consumer** (retire, not migrate) ·
   **consumer-unclassified** · **blocked-on-tag** · **native-field** (segment directly, retire the
   rule, no source work) · **re-source** · **already-sourced** · **verify-live**.
   Three mechanics have **no segment equivalent** and are flagged regardless of verdict:
   `pgToHost`/`pgToService`/`hostToPG` **propagation** (a segment does not traverse the
   relationship — migrating as-written silently shrinks scope), **`valueFormat` computed values**
   (a segment cannot compute; the value must exist at source first), and **entity-pinned**
   conditions. Rules that read *other* tags form a **dependency cascade**: the stage emits
   topological **resolution layers** (the order the re-sourcing can be done in) and names any
   **dependency cycle**, which has no valid order until a human picks the source of truth.
   **A retire verdict is two-gated** (2026-08-27): no structured filter reference *and* no textual
   mention across every probe loaded. The first cut used one gate and called 111 rules retirable
   on one tenant; a sample of five found four of them live in maintenance windows, metric events
   and zones through reference forms the extractor did not yet read. The structured forms are
   `tagFilter` (profiles) · `entityTags` (maintenance windows, and workflow trigger filters, where
   it is a **map keyed by tag key**, not a list) · `{key:"*_TAGS", tag:…}` (zones, auto-tag rules) ·
   `{type:"TAG", value:…}` (metric events) · `entitySelector tag(…)`. Problem
   notifications are deliberately **not** a consumer surface — they reference tags only through
   their alerting profile, and their `displayName` routinely contains a tag key as prose.
   **Every surface gets BOTH a structured and a literal-key pass** (2026-08-27, found on the first
   fresh collection after the stage shipped): **segments name their tag key inside a DQL string**
   as a `Key:Value` literal or a parse pattern (`parse toString(tags), "ld('AppID:'…)"`), never as
   `tag(…)` — the selector regex found zero on both reference tenants, so segments had been listed
   as a read surface while contributing nothing. There is no syntax to match, but the key set IS
   known, so the literal pass is a lookup rather than a parse. Keys under three characters are
   excluded — a two-character key matches everything and is not evidence.
   The literal pass reads **DQL-bearing fields only** (`query`, `dql`, `value`, `expression`),
   falling back to the whole object where a schema has none — scanning whole documents counted a
   dashboard tile *titled* `KPMC`, and a markdown heading `KPMC:`, as consumers of the tag `KPMC`.
   Every genuine reference on both reference tenants sits inside a query, so the restriction costs
   nothing.
   **Surface capability is MEASURED, never declared.** A surface yielding no reference for any key
   is reported **`inconclusive`**, not read: either it genuinely holds none or the extractor cannot
   read it, and nothing available distinguishes those. The plan states inconclusive surfaces
   **beside the uncollected ones** — a payload that reads as "checked, clean" is the more dangerous
   of the two.
   **Dashboards need the PER-DOCUMENT read.** `dtctl get dashboards` returns document metadata;
   **`dtctl get dashboard <id>` returns `content.tiles[].query`**. Fetch each id — 0.1 MB of
   metadata becomes 8.0 and 14.5 MB of content carrying 25 and 629 `tag(` references and 9 and 155
   management-zone references, and **40 rules across the two tenants leave the retire list**, every
   one of them queried by a live dashboard. Save as `A8-dashboards-content.json`; the probe pattern
   prefers it and falls back to the listing.
   **Classic dashboards are the one surface no platform token reaches** — separate store,
   `dt.entity.dashboard` is not an entity type — and they are heavily used (154 and 430 distinct
   ones opened in 30 days; 2,094 and 34,516 opens; one opened 14,138 times, another by 52 people —
   size it with the classic-dashboard usage read before deciding). Run the opt-in ReadConfig audit
   (`.dt-eval-common/collect_classic_evidence.py`, `--dashboard-ids @<in-use ids>`); drop
   `classic-evidence.json` in the run directory and the census picks it up, reading it **directly,
   not via `load_probe`** (it is not a dtctl envelope). Until then the surface reads **not
   checked**, never "no classic dashboard uses this tag". **It has a deadline** — `/api/config/v1`
   is BLOCK after the upgrade, so the inventory has to be taken before cutover.
4. **Stage 2 — segment classification** (A6): native-dimension · bridge (parses/renders legacy tag
   strings — transitional, with drop condition) · static-pinned (hard-coded lists — flag as
   rot-prone, need a dynamic source).
5. **Stage 3 — coverage map**: dimension → covered / bridged / uncovered. Uncovered ⇒ a concrete
   proposed segment spec (name, native field, variable DQL sourced from `metrics`, validation
   query).
6. **Stage 4 — population join** (B37): definitions say *should*, populations say *does*.
7. **Stage 5 — consumer census** (A13/A14/A15/A16/A19/B30): per zone, every consumer and its
   Gen3-first cutover target (profiles → davis-problem workflows; notifications → workflow
   delivery; metric-event scopes → dimension filters; auto-tags feeding conditions → source
   tags/OpenPipeline; MZ permissions → IAM policies on `dt.security_context`).
8. **Stage 5b — job classification (security vs filter vs alerting; MZ2POL-05 §1):** a zone does
   up to three jobs, each migrating to a different target — restrict who may READ → **IAM policy +
   boundary on `dt.security_context`** · scope what a user SEES → **segment** · decide who gets
   PAGED → **problem-triggered workflow**. Bindings come from A19 groups; **when A19 is unreadable
   the access job is `access-unknown` — or `access-classic-roles-present` when B47 confirms classic
   role bindings exist, which is measured but still scope-unresolved and still blocks retirement —
   never defaulted to filter-only** — replacing an
   access-bearing zone with a segment alone is a security regression (a segment changes what is
   shown, never what is permitted). B30's `dt.security_context` entity coverage is corroborating
   context for the target surface, never a substitute for the IAM read.
9. **Stage 6 — zone effectiveness & consolidation (the not-1:1 stage; MZ2POL-05 §2):** verdict per
   zone — `dead` (zero population) · `unused` (populated, no consumers, **and no query
   activity in the B42 window** — MEASURED since 2026-07-31 via
   `dt.sfm.server.management_zones.queries_counter`; the old usage-proxy caveat is retired. Report
   it as *"no query activity in the last N days"* with the window named — a silent 7-day window on
   a quarterly-review zone is not an unused zone) · `hygiene-only` ·
   `value-of-dimension` (same dimension signature as another zone → the family is ONE segment
   with a variable) · `effective` · `no-dimension`. Headline: **N zones → M worth keeping → K
   segments** (one per dimension; typical target three to eight — past the sprawl gate of 8 the
   design is converting values, not dimensions).
10. **Disposition** every zone: **Retire now** (empty ∧ no consumers) · **Retire after cutover**
   (covered ∧ consumers) · **Build then retire** (populated ∧ uncovered) · **Investigate**
   (conflicting signals — including **dead alert routing**: profiles bound to zones that match
   nothing). Rollups: **Dimensional coverage %** (report BOTH zone-count and population bases —
   their divergence is a finding) · **Retirable now** · **consumers to rehome**. **HARD RULE: no
   zone may be finally dispositioned retire-\* while its access job is unmeasured** — every
   retire row is "retire once access is verified" until the IAM bindings have been checked.
11. **Stage 7 — conversion blockers & alerting gaps (docs-verified constraints, never
    preferences):** per zone — `exclusion` (a negated tag/structural condition; segments cannot
    express exclusions — restate positively; negated NAME conditions stay hygiene, deliberately
    distinct) · `substring-match` (CONTAINS/ENDS_WITH; segment includes are `=`/`in()` only and
    `entity.name` takes starts-with at most, per the segments limits reference — docs win over
    the BPN's broader wildcard claim). Estate-level — **derived-data gap** (only
    `dt.security_context`/`dt.cost.costcenter`/`dt.cost.product` reach service metrics; a segment
    on any other tag can filter logs/spans correctly and return empty on metrics) ·
    **problem-view zones** (the replacing segment needs an events include on
    `event.kind = "DAVIS_PROBLEM"`). Alerting gaps (upgrade guide, alert notification): **the
    duration filter has no successor** (delay-dependent profiles sequence LAST; a scheduled
    workflow filtering on problem duration approximates it imprecisely) and **OpsGenie /
    VictorOps / xMatters / Trello have no native connector** (→ generic HTTP request).
11. **Architecture inputs** (spec §6b): **delivery consolidation** — group A15 notifications by
    normalized delivery target (recipient set / webhook endpoint); the resulting count is the
    workflow design basis, **never 1:1 profile copies**. **Bucket posture** (A1): default-only
    estates get the bucket-design recommendation alongside the segment rollout.

## Phase 3 — Produce the plan

`.docx` via the shared [docx_style.py](../.dt-eval-common/docx_style.py); structure per spec §6
(cover with the two headline numbers — no A–D grade · executive summary · **zone effectiveness —
the not-1:1 headline (`N zones → M worth keeping → K segments`), immediately after the executive
summary, with the sprawl warning when it fires and the B42 query-activity window named alongside every `unused` verdict** · **which job is each
zone doing (access → policy · filter → segment · alerting → workflow), carrying the
unreadable-IAM hold-retirements warning whenever `access_measured` is false** · **target
architecture & enablement, spec §6b: the four-layer model — metadata at source / buckets / IAM on
security context / segments — drawn with this tenant's posture, plus the explicit "segments are
not an access boundary" statement** · dimension map · **conversion blockers (the four documented
constraints)** · segment build specs **with the derived-data caveat on every tag dimension
outside the three carried keys** · consumer cutover plan **leading with the alerting
consolidation model, the capability-gaps subsection (delay-dependent profiles last; connectorless
destinations → HTTP), and the §6b additional-consideration areas (metric events, maintenance
windows, dashboard filters, IAM bindings, cost allocation, buckets)** · disposition worklist ·
sequenced Now/Next/Later runbook · verification section · appendix). Every section clears the
family remediation bar: WHY + HOW + validate-&-decommission + **docs.dynatrace.com citation
verified live this run** (the References section cites the BPN notebooks by ID **with their
public URLs** — MZ2POL-00/-05/-09, ORGNZ-08/-10 — as further reading; never BPN-only, and never
bare codenames without links). Sequencing is
dependency-ordered: enrichment prerequisites → segments → parity validation → consumer rehoming
(paging-risk items last) → IAM switch → retirement.

**Filenames:** `<tenantId>-mz2seg-migration-plan-<date>(vN).docx` ·
internal variant `[INTERNAL ONLY]-<tenantId>-mz2seg-migration-plan-<date>(vN).docx` ·
optional `<tenantId>-mz2seg-disposition-<date>(vN).xlsx` alongside (`[INTERNAL ONLY]-` prefixed
too when `--audience internal`).

Run the **pre-delivery scan** (family hard rules: no internal machinery, no probe IDs in external
copy, ⚪ items appendix-only, no cross-tenant references, redaction hygiene).

## Phase 4 — Finalize

`runlog.py finalize run.json --skill mz2seg --report <docx-path> --confidence <High|Medium|Low> --headline-value <dimensional-coverage-pct> --no-grade-reason "deliberately not a grade — coverage % and retirable-now count, see README.md"` (plus the xlsx path in a `--note`); record output location and timestamp for future comparison runs. **`--skill mz2seg` is mandatory, same as every sibling skill** — this run previously omitted it, which meant `results.mz2seg` was never populated and this skill's runs/ directory was missing from `runlog.py`'s cross-skill discovery list (fixed alongside this). **`--headline-value` carries the Dimensional coverage % that is this skill's real headline** — there is no `--overall`/`--ec-oes`/`--migration-pct` slot for it, and this skill deliberately has no A–D grade (README.md), so `--headline-grade` stays unset and `--no-grade-reason` states why rather than leaving it silently blank. This is what lets the `dt-eval-rollup` skill show mz2seg alongside its four graded siblings without inventing a fake grade for it.

## Hard rules & non-negotiables

1. **Read-only only** — never any write/exec verb, never `dtctl ctx token`.
2. **Advisory worklist** — retire lists are the customer's to execute after validation; never
   offer to run them.
3. **Every zone gets a disposition and every disposition a next step** — an unclassified zone or
   a bare count is unfinished work.
4. **Consumer cutover before retirement** in every sequence — a zone with live consumers is
   blocked, and the plan must show the unblock path.
5. **Gen3-first** — no classic construct is ever recommended; 0 zones = done, never empty.
6. **Standalone & exclusive per invocation**; sibling cache shared, content cross-referenced.
7. **Citations bind both audiences** — docs verified live; BPN further reading only.
8. **De-identified figures in every committed artifact** — real tenant IDs/customers appear only
   in gitignored `runs/` and the delivered report.

## Shared components (monorepo)

Probe catalog ([probes.md](../dt-eval-tenant/probes.md) router; B37 in
[probes-grail.md](../dt-eval-tenant/probes-grail.md)) · design note
([mz2seg-migration-plan-spec.md](../dt-eval-tenant/mz2seg-migration-plan-spec.md)) ·
verification twins **V38** (B37 population), **V39** (B38 propagation), **V43** (B42 query
activity), **V48** (B47 IAM readiness) —
[verification-queries.md](../dt-eval-tenant/verification-queries.md) ·
shared engine ([docx_style.py](../.dt-eval-common/docx_style.py),
[runlog.py](../.dt-eval-common/runlog.py),
[report-audiences.md](../.dt-eval-common/report-audiences.md),
[output-config.json](../.dt-eval-common/output-config.json)) ·
[field-notes.md](../dt-eval-tenant/field-notes.md) (read before improvising DQL) plus this skill's exclusive [field-notes-mz2seg.md](../dt-eval-tenant/field-notes-mz2seg.md) (zone-dimension/consumer-cutover mechanics) ·
[MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) (agent-free mirror; repo-root file, absent
from installed copies). Keep-in-sync rule applies to the whole family.
