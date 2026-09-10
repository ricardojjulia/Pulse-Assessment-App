# Management Zones → Segments Migration Plan — design note (PROPOSED)

> **STATUS: PROPOSED (2026-07-29).** Design note for the fifth `/dt-eval-*` deliverable and skill,
> **`/dt-eval-mz2seg`**. It follows the family pattern set by
> [gen3-migration-progress-spec.md](gen3-migration-progress-spec.md): this file is the living design
> reference (rationale, method, the remediation bar); the runbook is
> `../dt-eval-mz2seg/SKILL.md`; the evidence recipe extends the §E family (probes-gen3.md E2 is the
> scoring parent); the client twin is `verification-queries.md` V38; the agent-free mirror is a
> `MANUAL-EXTRACTION.md` section. Illustrative tenant figures in this doc are **rounded magnitudes
> from a de-identified reference estate** — never a real tenant ID or customer name.

## 1. Summary

A **standalone, execution-grade migration plan** that takes a tenant from management-zone-based
data filtering to platform-native **segments** (plus the IAM/`dt.security_context` boundary MZs
cannot provide for Grail). Where the Gen3 Migration Progress report's E2 domain answers *"how far
along is scoping?"* with a status and a grade, this deliverable answers *"exactly what do we do,
zone by zone, consumer by consumer, in what order?"* — a plan an operations team can execute.

It is almost entirely a **recipe over already-collected probes** (A17 zones, A6 segments,
A13–A16 consumers, A15 notifications, A19 IAM groups, B30 security-context coverage) plus **one
new live Grail read** (B37 — the zone population census). The net-new work is the disposition
model, the consumer-cutover inventory, the segment build-spec generator, and the report.

**Why a separate skill, not a mode of `/dt-eval-gen3`:** the audiences differ. Gen3 Migration
Progress is a *scorecard* for leadership (how far, what next, one grade). This is a *worklist* for
the team doing the migration (every zone named and dispositioned, every blocked consumer listed,
every proposed segment specified). Keeping them separate preserves the family's
one-deliverable-per-skill shape and lets an engagement run either or both (shared probe cache,
cross-references, never duplicated content).

## 2. Scope & interpretation

- **Construct scope:** classic management zones (`builtin:management-zones`) → native **segments**
  for data filtering, **plus** the access-boundary half: MZ-based permissions →
  **IAM policies keyed on `dt.security_context`** (set via source tags / OpenPipeline enrichment).
  A plan that only converts filters and ignores access is half a migration — both halves are in
  scope, and the plan says explicitly which zones carry an access-control role (verify-live where
  group→MZ bindings are not probe-readable).
- **Platform tenants only** (`apps.dynatrace.com` via dtctl) — same reach as the rest of the family.
- **Advisory worklist, never executed.** 100% read-only; every step in the plan is the customer's
  to apply. Deletion lists are *retire-after-validation* worklists, never scripts to run.
- **Gen3-first governs** (CLAUDE.md): a tenant with 0 MZs is **already done** — the plan says
  "Complete — maintain segments, no action", never scores the absence of zones as anything but
  finished. No remediation ever creates or extends a classic construct.

## 3. Deliverable behavior

- **Standalone & exclusive per invocation** (family rule): one invocation produces this plan and
  nothing else. Engagements wanting siblings run each skill in sequence over the shared same-day
  probe cache.
- **Filename:** `<tenantId>-mz2seg-migration-plan-<date>(vN).docx` (internal variant:
  `[INTERNAL ONLY]-<tenantId>-mz2seg-migration-plan-<date>(vN).docx`), written to the standard
  output tree `<output-root>/<customer-name>/current/`
  (root per [output-config.json](../.dt-eval-common/output-config.json); prompted every run).
- **Optional machine-readable twin:** `<tenantId>-mz2seg-disposition-<date>(vN).xlsx` — the
  per-zone disposition table as a working sheet (same pattern as `/dt-eval-prob`'s tuning sheet),
  because a 300-zone worklist is operated from a sheet, not prose. Default: ship it.
- **Headline metric — Coverage & Readiness, not a grade.** The cover carries two numbers:
  **Dimensional coverage %** (share of the zone estate's dimensional intent already covered by
  existing segments) and **Retirable now** (N of M zones with a covering segment *and* no blocking
  consumer). An A–D grade is deliberately absent — a plan's headline is the size of the remaining
  work, not a score. (Flippable default; the internal variant may add the E2 status for
  continuity with a gen3 report from the same engagement.)

## 4. Method — five stages

### Stage 1 — Reduce zones to dimensions (offline, from A17)

The E2 recipe's tag-prefix reduction is necessary but not sufficient: live estates key zones on
much more than tags. **Generalize to condition families.** Group every
`value.rules[].attributeRule.conditions[]` by its `key`, then classify each zone's condition set
into the families below. Field-validated on a de-identified reference estate (~320 zones): the
dominant keys were `HOST_GROUP_ID` (~340 conditions), `HOST_GROUP_NAME` (~200),
`PROCESS_GROUP_NAME` (~200), then the tag families (`HOST_TAGS` / `PROCESS_GROUP_TAGS` /
`SERVICE_TAGS`, ~360 combined) — a **tag-only reduction would have missed the majority of the
estate's real shape.**

| Condition family | Example keys | Native segment dimension it maps to |
|---|---|---|
| **Entity-pin** | `HOST_GROUP_ID` (entityId) | `dt.host_group.id` — the cleanest 1:1 |
| **Name-pattern** | `HOST_GROUP_NAME`, `HOST_NAME`, `SERVICE_NAME`, `*_DETECTED_NAME` | the same name field in Grail/Smartscape; often a host-group or naming-convention proxy — resolve to the underlying dimension, don't port the regex blindly |
| **Tag-key** | `HOST_TAGS`, `PROCESS_GROUP_TAGS`, `SERVICE_TAGS`, `WEB_APPLICATION_TAGS` | `primary_tags.*` / source-tag key (the `Key:value` prefix is the dimension) |
| **K8s / cloud metadata** | `KUBERNETES_CLUSTER_NAME`, cloud keys | `k8s.cluster.name`, `k8s.namespace.name`, `aws.account.id`, `azure.*`, `gcp.*` |
| **Tech / type** | `SERVICE_TYPE`, `SERVICE_TECHNOLOGY`, `HOST_OS_TYPE` | rarely a scoping intent by itself — usually a *refinement* inside another dimension |
| **Hygiene-exclusion** | `NOT_REGEX_MATCHES` noise lists (agent/system processes) | **not a scoping dimension at all** — process-noise hygiene that belongs in monitoring settings, not in the segment; flag separately so it is not "migrated" |

Output: the **dimension map** — each zone → its primary dimension(s) + refinements + hygiene
residue. Report *dimensions and families*, never raw zone/rule counts (a 300-zone estate routinely
reduces to a handful of dimensions).

### Stage 1b — Tag provenance: the tagging-at-source foundation (offline A16/B5 + live **B38**)

**The plan's long-term foundation is tagging at source.** Segments, IAM policies, and dashboards
key on **primary Grail tags** — tags set at the source (host tags/`DT_TAGS`, K8s labels, cloud
tags, OpenPipeline enrichment) that flow into Grail and Smartscape. Classic auto-tag rules (A16)
compute tags that exist **only on classic entities and retire with them** — a segment cannot key
on one, which is why bridge segments end up parsing tag strings. So every `tag:` dimension from
Stage 1 gets a provenance verdict, because it decides the remediation's *order*:

- **source-propagated** — the key shows materially on Smartscape nodes (B38): segment-ready now.
- **context-imported** (`[Azure]…`, `[Environment]…`) — cloud/env metadata: segment on the native
  metadata field, never the rendered tag string.
- **classic auto-tag / classic-manual — not propagated** — establish the source tag FIRST, then
  author the segment. A token presence (< 1% of the fleet) is not propagation.

**B38 — source-tag propagation census** (live; Smartscape reads, cost-trivial): no key-enumeration
function exists on the `smartscapeNodes` surface (`recordKeys`/`fieldsNames` both absent —
verified live), so B38 is a **candidate-key census**: one aggregate query `countIf(contains(
toString(tags), "<key>"))` per Stage-1 tag dimension. Field-validated decisive on a reference
estate: the mega-zones' management tags were ~93%-fleet propagated (segment-ready immediately),
while the estate's dominant app-ID tag — 80+ zones and every bridge segment depend on it — showed
on **six** hosts out of tens of thousands: the single biggest tagging-at-source work item, and
invisible to any object-count analysis.

### Stage 2 — Classify the existing segments (offline, from A6)

Three kinds, extending E2's two (the third emerged from field data):

- **Native-dimension segments** — `variables.value` filters a real field
  (`dt.host_group.id`, `k8s.namespace.name`, `aws.account.id`, `azure.subscription`,
  `gcp.project.id`) — the end state.
- **Bridge segments** — DQL that *parses the legacy tag string back out of* entity tags (e.g.
  `parse toString(tags), "…'AppID:'…"`) or `concat`s a tag rendering. Transitional by
  construction: they keep classic-tag consumers working during cutover. Flag each with what it
  bridges and the drop condition (once nothing consumes the rendered value, delete the parse).
- **Static-pinned segments** — hard-coded `data record(...)` value lists or no variables at all
  (fixed app-ID lists). These are snapshots that rot silently as the estate changes — call out
  that they need a dynamic source (source tag or metadata field) before they can be an end state.

### Stage 3 — Coverage map: dimension → covering segment (offline)

Cross Stage 1 × Stage 2. Each dimension lands as **covered** (a native-dimension segment returns
it), **bridged** (only a bridge/static segment covers it — works today, not an end state), or
**uncovered** (the genuine build list). The gap list — with a concrete proposed segment spec per
gap (name, the native field to filter, the DQL variable source, sourced from `metrics` where
primary tags resolve reliably) — is the plan's build section.

### Stage 4 — Population census (the one live read — **B37**)

Definitions say what *should* match; only entity counts say what *does*. The E2 population query
(`fetch dt.entity.{host,process_group,service} | expand managementZones | summarize by zone` —
**`managementZones` is an array; `expand` it or populated zones read as empty**, see
field-notes.md) becomes a first-class probe: **B37 — MZ population census**, cheap
(three entity-table reads, no log/span scan), cached in the run directory like every probe, with
verification twin **V38** and a MANUAL-EXTRACTION mirror. Zones referenced by no entity *and* no
consumer go straight to the retire list.

### Stage 5 — Consumer cutover inventory (offline, from A13/A14/A15/A16/A19 + B30)

The blocker census — **who breaks if a zone disappears.** Field-validated shape (same reference
estate): ~700 of ~900 alerting profiles were MZ-bound, referencing ~100 distinct zones, with ~900
classic problem-notifications routed through them — i.e. **the consumer cutover, not the segment
authoring, is the bulk of the migration.** Inventory, per zone:

| Consumer | Source | Cutover target (Gen3-first) |
|---|---|---|
| Alerting profiles (`managementZone` filter) | A14 | davis-problem **workflows** filtered by segment / entity criteria (E1 chain — cross-links the gen3 report) |
| Problem notifications (profile-routed) | A15 | workflow delivery steps (email/Slack/SNOW/webhook) |
| Metric events with MZ scope | A13 | detector scope on dimension filters, not MZ |
| Auto-tag rules feeding MZ conditions | A16 | source tags / OpenPipeline enrichment (E3) |
| IAM groups bound to MZ permissions | A19 (+ verify-live for bindings) | IAM policies on `dt.security_context` (B30 tells how much of Grail already carries it) |
| Dashboards/notebook MZ filters | verify-live (classic config API) | segment variables |

Every zone's disposition carries its consumer count; a zone is **blocked** until its consumers are
rehomed, and the plan sequences consumer moves *before* zone retirement.

### Stage 5b — Job classification: security vs filter vs alerting (offline, A19 + Stage 4/5)

A zone does up to three jobs, each migrating to a different target (MZ2POL-05 §1): restrict who
may **read** → IAM policy + boundary on `dt.security_context` · scope what a user **sees** →
segment · decide who gets **paged** → problem-triggered workflow. The heuristic: *if removing the
zone would let someone see data they are not allowed to see, it is doing the access job.*
Bindings come from A19 group permissions. **When A19 is unreadable the access job is
`access-unknown` for every zone — never defaulted to filter-only** (returning `None`, not an
empty set, is deliberate in `zone_access_bindings`): replacing an access-bearing zone with a
segment alone is a security regression, because a segment changes what is shown, never what is
permitted. B30's security-context entity coverage is corroborating context for the target
surface (0% = zones are currently the *only* access mechanism), never a substitute for the read.

**B47 refinement (2026-07-31):** where A19 is unreadable, the platform's daily IAM-readiness
snapshot (`PLATFORM_PERMISSION_READINESS_EVENT`) is a second, independent read of group permissions
from a different surface. It proves whether classic RBAC role bindings exist **without** resolving
which zone each binding scopes, so the verdict becomes `access-classic-roles-present` rather than
`access-unknown` — measured and nameable in the report, and **still blocking every retire-\*
disposition**. The HARD RULE is unchanged: no zone is finally dispositioned retire-\* until its
bindings are read directly. Where A19 *is* readable it wins on specificity and B47 corroborates the
total.

### Stage 6 — Zone effectiveness & consolidation (offline; the not-1:1 stage)

The stage that stops the plan being a 1:1 port (MZ2POL-05 §2: one segment per **dimension**, not
per value; typical target three to eight). Verdict per zone: `dead` (zero population once B37
ran) · `unused` (populated, no consumers, **and no query activity in the B42 window** — MEASURED
since 2026-07-31; the former "no probe surface, never phrase as measured usage" caveat is
**retired**, superseded by `dt.sfm.server.management_zones.queries_counter`. Two limits survive
and must be stated with the number: absence from the B42 census is *"no queries observed in the
last N days"*, never *"unused"* in the abstract, and self-monitoring retention is short — a zone
driving a quarterly review will read silent on a 7-day window) · `hygiene-only` · `value-of-dimension`
(same dimension signature as another zone — the family is ONE segment with a variable, never
len(family) migrations) · `effective` · `no-dimension`. Estate rollup: **N zones → M worth
keeping → K proposed segments** (one per distinct dimension of zones worth keeping) plus a
**sprawl warning** past 8 proposed segments — past that the design is converting values.

### Stage 7 — Conversion blockers & alerting gaps (docs-verified constraints)

Detected per zone and rolled up estate-wide; every constraint is documented, not heuristic:
`exclusion` (negated tag/structural condition — segments cannot express exclusions; negated NAME
conditions remain hygiene, a deliberate distinction) · `substring-match` (CONTAINS/ENDS_WITH —
segment includes are `=`/`in()` only; `entity.name` is documented starts-with at most: docs win
over the BPN's broader wildcard claim, recorded in field-notes) · **derived-data gap** (only
`dt.security_context`/`dt.cost.costcenter`/`dt.cost.product` carry to service metrics — segments
on other tags filter logs/spans and can return empty on metrics) · **problem-view zones** (the
replacing segment needs an events include on `event.kind = "DAVIS_PROBLEM"`). Alerting gaps from
the upgrade guide (alert notification): the **duration filter has no successor** — sequence
delay-dependent profiles LAST and agree replacement behavior with on-call teams (a scheduled
workflow filtering on problem duration approximates it with imprecise timing); **OpsGenie /
VictorOps / xMatters / Trello** have no native connector and migrate to generic HTTP requests.

## 5. Disposition model — every zone lands in exactly one bucket

| Disposition | Rule | Plan action |
|---|---|---|
| **Retire now** | no population (B37) ∧ no consumers (Stage 5) | delete after the standard parallel-run check — zero migration work |
| **Retire after cutover** | covered dimension (Stage 3) ∧ consumers present | rehome the listed consumers, confirm parity, then retire |
| **Build then retire** | populated ∧ uncovered dimension | author the proposed segment (spec provided), validate population parity, rehome consumers, retire |
| **Investigate** | population/coverage signals conflict (e.g. covered but counts disagree, hygiene-exclusion-only zones) | named follow-up, never silently dropped |

Plan-level rollups: **Dimensional coverage %** (covered ∕ all dimensions, population-weighted),
**Retirable now** (bucket 1 count), **blocked-by-consumer count** (buckets 2–3 total consumers to
rehome — the honest size of the work), and the Stage-6 headline **N zones → M worth keeping → K
segments**. Every number's method is stated; ⚪-style scope gaps (e.g. dashboard-filter usage
without classic-API access) go to appendix footnotes, body legend stays ✅/💡/⚠️ (CLAUDE.md rule
3). **HARD RULE: while the access job is unmeasured (Stage 5b), no retire-\* disposition is
final** — the plan states every retire row as "retire once access is verified".

## 6. Report structure

1. **Cover** — "Management Zones → Segments Migration Plan", customer, tenant URL, date,
   the two headline numbers (§3); AI-disclosure footnote.
2. **Executive summary** — prose verdict: the estate's real shape in dimensions, how much is
   already covered, the honest bulk of the work (usually consumers, not segments), what to do
   first. INTERPRET discipline: conclusion + cost of inaction (zones rot as the estate changes;
   dual-running means every scoping change is made twice; Grail data stays invisible to MZ-based
   access) + sequenced next step.
2b. **Zone effectiveness** (immediately after the executive summary — the headline story):
   `N zones → M worth keeping → K segments`, the verdict table, value-family collapse, the
   sprawl warning when it fires, and the B42 query-activity window stated in the method note (the former usage-proxy caveat, retired 2026-07-31).
2c. **Which job is each zone doing** — the three jobs and their targets, with the
   unreadable-IAM hold-retirements callout whenever the access job is unmeasured, and the B30
   security-context corroboration line.
3. **How to read** — legend, the three segment kinds, the four dispositions.
3b. **Conversion blockers** — the four documented constraints with where each bites on this
   tenant and the design-around; build specs carry the derived-data caveat per affected
   dimension; the consumer cutover plan carries the capability-gaps subsection.
4. **Target architecture & enablement** (§6b) — the four-layer target state, drawn with this
   tenant's own posture filled in: which layers exist, which are missing, which the migration
   builds.
5. **The dimension map** — the estate reduced to dimensions (the "300 zones are really 6
   dimensions" moment), with the coverage state of each.
6. **Segment build specs** — one per uncovered dimension: proposed name, native field, variable
   DQL, validation query.
7. **Consumer cutover plan** — per consumer class (§4 Stage 5 table), worst-first by count, each
   with its Gen3-first target and cited procedure. **Alerting leads with the consolidation model
   (§6b) — delivery targets, never 1:1 profile copies.**
8. **Zone disposition worklist** — the per-zone table (summary in-document; full table in the
   `.xlsx` twin when shipped).
9. **Sequenced runbook** — Now/Next/Later, dependency-ordered: source-tag/enrichment prerequisites
   → build segments → validate population parity → rehome consumers (profiles→workflows last,
   they carry paging risk) → IAM policy switch → retire zones. Each step cites docs
   (verified live this run) + BPN further reading.
10. **Verify these findings yourself** — V38/V39 + the client-runnable stage queries + GUI map rows.
11. **Appendix** — method (client-safe), footnotes (verify-live and not-assessed items with the
    access that would include them), references (docs opened this run · BPN codes), disclaimer.

## 6b. Architectural guidance & enablement — the target state (mandatory section)

The plan is an enablement document, not just a worklist: the customer's team must leave it
understanding *what replaces the management zone*, because **a management zone did four jobs at
once and the platform-native answer splits them into four purpose-built layers**. The report
draws this picture with the tenant's own posture filled in (which layers exist, which are
missing, which the migration builds):

| Layer | Mechanism | What it replaces from the MZ | Evidence in this plan |
|---|---|---|---|
| **Foundation — metadata at source** | Primary Grail tags (host tags/`DT_TAGS`, K8s labels, cloud tags) + OpenPipeline enrichment (`dt.security_context`, cost allocation) | The auto-tag rules and naming conventions the zone rules pattern-matched on | Stage 1b provenance (B38) |
| **Storage — Grail buckets** | Custom buckets per data domain: retention differentiation, bucket-level IAM (coarse isolation), and query-scan pruning (a bucket filter cuts what a query *reads*; a segment only cuts what a user *sees*) | Nothing — MZs never controlled storage; this is a **capability gained**, assessed from A1 | Bucket-posture read: an effectively default-only estate is flagged, with bucket design recommended alongside the segment rollout. Buckets bind at **ingest** (OpenPipeline routing) — they are not retroactive, so the design belongs early in the sequence |
| **Access — IAM policies** | Record-level: policies conditioned on `dt.security_context` · coarse: bucket read permissions · entity-level: policy conditions | MZ-based permissions on user groups | B30 coverage % + A19/verify-live bindings |
| **View / UX — Segments** | Dynamic entity+Grail filtering, shareable, variable-driven | The zone dropdown in dashboards, notebooks, apps | Stages 2–3 (classification, coverage, build specs) |

**Segments are not an access boundary** — the report must say this explicitly (a common and
dangerous assumption): a segment hides data from *view*, an IAM policy withholds it from
*query*. Access work lands in the IAM layer or it doesn't exist.

### Alerting profiles & notifications — the consolidation model (mandatory subsection)

The largest consumer class migrates by **delivery target, never 1:1**. The engine computes the
consolidation basis offline (A15 grouped by normalized recipient set / webhook endpoint /
integration): field-validated on a reference estate, ~900 classic notifications collapsed to
~400 distinct delivery targets — and **every one of ~265 webhook notifications pointed at a
single ITSM endpoint**, i.e. one parameterized workflow replaces hundreds of per-MZ copies.
Porting profiles 1:1 would faithfully reproduce the sprawl the migration exists to retire.

Guidance shape (each step cited docs-first, WFLOW/ALERT BPN further reading):
1. **Inventory offline** — profile → zone → severity rules → notifications → delivery target
   (all from A14/A15 joins; ships in the `.xlsx`).
2. **Design one workflow per delivery target** (team/channel/endpoint), with the davis-problem
   trigger filtered by the *new* dimensions (segment intent: tags/security context/entity
   criteria), parameterized by problem metadata — not one workflow per zone.
3. **Port the semantics that hide in profile config**: severity thresholds and delay windows →
   trigger conditions; `notifyClosedProblems` → close-event handling; maintenance-window
   suppression expectations → workflow-level checks.
4. **Parallel-run** each workflow against its live profile (same problems, compare deliveries
   over an agreed window), then disable the classic notification, and retire the profile
   **when its zone retires** — dead-routed profiles (bound to empty zones, found by B37∧Stage 5)
   can be retired immediately.

### Additional consideration areas (each present in the report when the tenant has them)

- **MZ-scoped metric events** (A13) — re-scope detectors to dimension filters before their zone
  retires; a detector scoped to a retired zone silently stops matching.
- **MZ-scoped maintenance windows** (A44 legacy surface) — recreate as Gen3 maintenance on
  filter criteria; a window scoped to a retired zone silently stops suppressing.
- **Dashboard / notebook zone filters** (verify-live, classic config API) — repoint to segment
  variables; classic dashboards bypass Grail entirely, so this lands with the E5 dashboards
  migration (cross-reference the Gen3 report when the engagement ran it).
- **IAM group → MZ permission bindings** (A19; verify-live where unreadable) — the access-layer
  cutover above; sequence the policy switch before zone retirement or those groups silently gain
  or lose visibility.
- **Cost allocation & showback** — zones were often the de-facto chargeback dimension; move it
  to source tags / `dt.cost_center` enrichment so cost queries survive the retirement.
- **Buckets** (A1) — when posture is default-only, a bucket design (per domain/retention class)
  belongs in the same enablement conversation: it is the only layer that reduces query scan cost,
  and it binds at ingest, so late design = re-ingest-or-wait.

**Remediation bar:** identical to the family standard
([gen3-migration-progress-spec.md](gen3-migration-progress-spec.md) §8) — every section is
WHY + HOW + validate-&-decommission + cited (docs.dynatrace.com verified live; BPN **MZ2POL**,
**ORGNZ**, **IAM**, **WFLOW** as further reading), mapped onto
`finding_section(means=, consequence=, action=[…])`. A disposition without a next step is
unfinished.

## 7. Probes

| Read | Probe | Status |
|---|---|---|
| Zone definitions | A17 | existing |
| Segment definitions | A6 | existing |
| Alerting profiles / notifications / metric events / auto-tags | A14 / A15 / A13 / A16 | existing |
| IAM groups | A19 (often 403 → ⚪ footnote) | existing |
| `dt.security_context` coverage | B30 | existing |
| Grail bucket posture (§6b storage layer) | A1 | existing |
| MZ-scoped maintenance windows (§6b) | A44 legacy surface | existing |
| **Zone population census** | **B37** (new — the E2 population DQL as a cached probe; entity tables only, cost-guardrail-trivial) | **new** |
| **Source-tag propagation census** | **B38** (new — candidate-key `contains(toString(tags))` aggregates over `smartscapeNodes HOST`; Stage 1b's provenance evidence) | **new** |
| Dashboard MZ-filter usage | classic config API — **verify-live footnote**, never asserted | out of dtctl scope |

Same-day sibling cache reuse via `runlog.py find` (family protocol); only B37 is net-new
collection when a sibling ran today. Keep-in-sync footprint: probes-grail.md (B37) ·
probes-gen3.md (E2 cross-reference to this plan) · verification-queries.md (V38 + GUI row) ·
field-notes.md (condition-family findings) · MANUAL-EXTRACTION.md (new section) — plus this spec.

## 8. Build footprint (artifacts to touch)

**PR A — spec + skill scaffold:** this file · `../dt-eval-mz2seg/SKILL.md` · `../dt-eval-mz2seg/README.md`
· repo README/AGENTS/CLAUDE skill lists · CHANGELOG.
**PR B — evidence layer:** probes-grail.md (B37) · verification-queries.md (V38) · field-notes.md ·
MANUAL-EXTRACTION.md · .gitignore already covers `.claude/skills/*/runs/`.
**PR C — analysis + report wiring:** disposition builder (analysis script in the skill dir) ·
docx sections over the shared `docx_style.py` helpers · optional xlsx twin · report-audiences.md
internal-variant notes.

## 9. Locked decisions & flippable defaults

**Locked:** standalone & exclusive per invocation · advisory worklist, 100% read-only ·
consumer-cutover inventory is first-class (a zone list alone is not a plan) ·
**tagging-at-source is the foundation** — every tag-dimension remediation is ordered
source-tag-first, segments/IAM key on primary Grail tags, and classic auto-tags are never the
target of new work (they retire with Gen2; bridge parses are transitional with a stated drop
condition) · Gen3-first · remediation bar per §6 · de-identified figures in every committed
artifact.

**Defaults (easy to flip during red-line):**
- Headline = Coverage % + Retirable-now (no A–D grade on the cover).
- Ship the `.xlsx` disposition twin.
- Hygiene-exclusion regex conditions are excluded from dimensional intent (flagged, not migrated).
- IAM group→MZ permission bindings are verify-live (not probe-asserted) until a read surface is
  confirmed.
