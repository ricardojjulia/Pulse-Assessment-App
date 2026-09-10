# Gen3 Migration Progress Review — design note (PROPOSED)

> **STATUS: IMPLEMENTED (2026-07-24).** This design note is now wired into the skill and kept as the
> living design reference (rationale, domain rules, the remediation bar). It is referenced by
> **[SKILL.md](SKILL.md)** input #4; the scoring recipe is `probes-gen3.md` (§E), the client twin is
> `verification-queries.md` V33, the agent-free mirror is `MANUAL-EXTRACTION.md` §8, and `runlog.py`
> records it (`--migration-report`). Illustrative tenant figures in this doc (e.g. "14 management
> zones") are **invented for the worked example** — not from any real tenant.
>
> **Domain 13 (§4/§5/§8/§10) shipped 2026-08-05** — drafted, reviewed, and wired into `SKILL.md`,
> `probes-gen3.md` §E (as E13), `verification-queries.md` (V51), `field-notes.md`,
> `MANUAL-EXTRACTION.md` §8, both `README.md`s, and `CHANGELOG.md`. It is now part of the shipped
> report on the same footing as domains 1–12; the section below narrates the review it went through
> before shipping, not a pending decision.

## 1. Summary

A new **standalone** deliverable that grades how far a platform tenant has moved from classic
(Gen2-era) config constructs to platform-native (Gen3) ones, and — for **every item found** —
gives a cited, tenant-specific **WHY + HOW** remediation path grounded in docs.dynatrace.com
(authoritative) and the Best Practice Notebook series (further reading). It reuses the existing
probe battery for its evidence; the net-new work is a scoring rubric, a report structure, a small
classic-inventory probe set, and the remediation runbooks.

## 2. Scope & interpretation

The skill runs via `dtctl` against `apps.dynatrace.com` (platform / Gen3) tenants, so this report
measures **construct-level Gen3 adoption** — how much *classic-era config* remains vs. platform-
native constructs on a platform tenant. It is **not** a whole-environment `live.dynatrace.com →
apps` migration tracker (a still-classic environment is not reachable this way; stated as out of
scope in the appendix). This is exactly the signal the skill's Gen3-first inventory already
collects — classic constructs are gathered as *inventory* (presence = migration debt), outcomes are
scored on the native mechanism.

## 3. Deliverable behavior

- New input-#5 checklist item: **Gen3 Migration Progress** (+ optional **(Internal)** variant).
- **Fully standalone — nothing pairs.** Selecting it produces this report and nothing else; if it
  is ticked alongside any other deliverable, the skill confirms and drops the rest (effectively a
  single-select). Mutually exclusive with **every** other deliverable, not just the configuration
  review.
- **Own headline:** a **Migration Completeness %** (0–100) — the one place that % belongs on a cover,
  because here it *is* the report's headline. It is a **progress** measure, not a score (the tenant
  can reach 100% and be finished), so it is **exempt** from the grades rule and appears on every
  edition. The **A–D letter and the gauge** beside it are grades: internal always, customer only
  when the run passed `--grades` (owner rule 2026-08-25 — grades are never automatically included on
  a customer-facing document).
- **Filename:** `<tenantId>-gen3-migration-progress-<date>(vN).docx` (internal variant:
  `[INTERNAL ONLY]-<tenantId>-gen3-migration-progress-<date>(vN).docx`). Written to the prompted output location (default
  `~/Documents/Dynatrace-Reviews/<customer-name>/current/`, per SKILL.md input #4 — Output location).
- **Evidence:** reuses the existing config/telemetry battery. Because the deliverable is either/or
  at the *document* level only, the probe collection is largely shared — a tenant that had a
  configuration review already holds most of the evidence in `run.json`.

## 4. Domain matrix

Each domain resolves to a status and carries a mandatory Path forward (§8). Statuses reuse the
existing glyph palette: **✅ Complete** (native in place, classic retired) · **💡 In progress**
(dual-running — both present) · **⚠️ Not started** (classic only / native absent) · **⚪ Not
assessable**.

| # | Domain | Native target (reuse existing probes) | Classic residue (probe) | Complete rule |
|---|---|---|---|---|
| 1 | Alerting & problem delivery | davis-problem **workflows** + notification workflows (A4) | alerting profiles + classic problem-notifications count | native delivering ∧ 0 classic |
| 2 | Scoping / access boundaries | **segments** + `dt.security_context` (B30) | management-zone count | segments used ∧ 0 MZs |
| 3 | Tagging & ownership | source tags + pipeline enrichment (B30) | auto-tag rules + ownership-team objects | enrichment live ∧ 0 classic auto-tags |
| 4 | Log processing | **OpenPipeline** routing (A22) | `classic-pipelines-translation` substantive (A29/A46) | OP routing live ∧ classic-translation empty |
| 5 | Dashboarding & analysis | **real-user Grail dashboard/notebook usage** (B34) — *not* native object count | classic-dashboard usage (`popularity`/`lastViewed`, verify-live) | real (non-Dynatrace) users actively run Grail dashboards ∧ classic usage near-zero |
| 6 | Automation | Workflows / AutomationEngine adoption (A4) | *(native-only — no residue)* | present ∧ executing (dormant = 💡) |
| 7 | Apps / UX | AppEngine apps adoption | *(native-only)* | meaningful app adoption |
| 8 | **Extension entity model** | typed Gen3 Smartscape nodes, `id_classic` null (B33) | extension-sourced nodes with populated `id_classic` (config-not-migrated) + extensions with metrics but 0 nodes (binary not updated) | every extension's active-volume-weighted footprint is on typed nodes ∧ 0 classic-backed |
| 9 | **SLO model** | Gen3 DQL SLOs — SLI = single Grail query (B35, verify-live) | classic `builtin:monitoring.slo` (metric+entity-selector SLI, A37/A3) | Gen3 SLOs evaluating ∧ 0 classic SLOs |
| 10 | **Integration surface** | callers whose classic traffic lands only on surviving (`VISIBLE`) endpoints; authored documents free of classic-entity DQL | **B43** classic API/settings calls by caller (BLOCK-share per caller) + **B44** customer-authored documents flagged `CLASSIC_ENTITY_MIGRATION_ADVISED` | 0 callers with BLOCK-share traffic ∧ 0 authored documents flagged |
| 11 | **Access model** | groups on default policies (**B47** `default_policies_groups`), boundary keyed on `dt.security_context` (B30) | groups still bound to classic RBAC roles (**B47** `legacy_permissions_groups`) | 0 groups on classic RBAC roles ∧ policy-based groups in place |
| 12 | **Service detection & rule settings** | service-/failure-detection rules scoped on **primary tags** from process groups | **A52** enabled rules flagged for rework (management-zone / service-tag / non-`primary_tags.` PG-tag scopes) + **A53** Enhanced Endpoints for SDv1 | 0 flagged enabled rules across the assessed families |
| 13 | **Custom anomaly-detector framework** | Gen3 Davis custom detectors, DQL/analyzer-based (**A2**/A43, `builtin:davis.anomaly-detectors`) | classic metric-event detectors (**A13**, `builtin:anomaly-detection.metric-events`) | 0 enabled A13 detectors ∧ native detectors active (where custom detection is used at all) |

**Domain 10 measures the *dependencies* on the constructs, which no other domain sees.** A tenant can
be ✅ on domain 2 (zero management zones) while a nightly CMDB job still calls
`/api/v2/settings/managementZones` — the construct is retired, the caller breaks anyway. Domain 10 is
the answer to *"what of mine stops working on upgrade day?"*, and its deliverable artifact is a
**named break list, not a score**: per caller, the endpoints it touches, their BLOCK/HIDE/VISIBLE
verdicts from [classic-to-native-map.md](classic-to-native-map.md) Table 2, and what replaces them.
**Two calibrations are mandatory** (learned live 2026-07-31): exclude Dynatrace's own first-party
apps from the classic-passthrough volume — that is Dynatrace's debt, not the customer's — and never
report the raw `CLASSIC_ENTITY_MIGRATION_ADVISED` share (it read ~83% of executions on a reference
tenant while the customer-owned portion was a small fraction). See probes-gen3.md §E10.

**Domain 11 is the one domain where being wrong is a security regression, not a cosmetic gap.**
Classic RBAC roles are replaced by policies; a group left on classic roles keeps working right up
until it does not, and the failure mode is people losing or wrongly retaining access. Two rules:
**B47 is a daily snapshot** — take the newest event only, or a week of snapshots multiplies the
estate; and **it can unblock `/dt-eval-mz2seg`**, which holds every retire-\* zone disposition while
the access job is unmeasured. B47 reads group permissions from a *different surface* than A19 (Grail
self-monitoring rather than the IAM API), so on a tenant where A19 403s it still establishes whether
classic role bindings exist. **It is corroboration with a stated limit:** it reports *that* groups
hold classic roles, never *which zones each binding scopes to*. It therefore moves `access-unknown`
→ `access-classic-roles-present` — measured and named, still blocked — and never promotes a zone to
retire-now. Where A19 is readable, A19 wins on specificity.

**Domain 12 is graded as a dependency, not a tidy-up.** Service-detection configuration decides what
a service *is*, and Davis correlates over the resulting topology — so flagged rules move the ground
under every service-level finding in the Configuration Review and every detector in the problem-noise
plan. The rework and its cited HOW are Dynatrace's own (drop management-zone / service-tag /
non-`primary_tags.` process-group-tag scopes; reproduce with **primary tags** in the Process-group tag
field), which makes this a mechanical rewrite with a documented target rather than open-ended risk —
say the target, or "rework your service detection" reads as unbounded work. **⚪ Partial coverage is
mandatory to disclose:** Dynatrace checks four rule families and only two (service detection, failure
detection) have a settings schema reachable by `dtctl`. *Request Attributes* and *Request Naming* sit
on the classic config API with no `dtctl` verb, so they are footnoted with the surface that would
include them and the domain never claims a full-estate assessment. Note both survive the upgrade as
endpoints (`VISIBLE` in Table 2) while their rules still need re-scoping — "endpoint survives" is not
"no work required."

**Domain 13 shipped 2026-08-05**, after review (investigated and drafted 2026-08-05, prompted by
`/dt-eval-prob`'s A9 probe, which reads the same classic-vs-3rd-gen split for noise purposes and
surfaced that no Gen3 domain scores it as a migration construct). It is distinct from domain 1
(delivery/routing) and domain 12 (what counts as a service): domain 13 is about *how the detection
rule itself is authored* — a layer upstream of both. **Both sides are already fully collected with no
new raw probe needed**: `probes-config.md` A13 (`builtin:anomaly-detection.metric-events`, classic
custom metric-event detectors) already carries the Gen3-first framing this domain needs verbatim —
*"A13 presence is migration debt to report, its absence is clean"* — and on the one live tenant that
promoted A13 to a first-class read, it was **54× larger than A2/A43** (1,417 vs 26 detectors), with
over a thousand enabled rules watching one metric key as per-service clones producing a fifth of the
problem stream. A13-only estates are exactly where this domain would be ⚠️ Not started while every
other domain reads clean — the shape a migration-progress report exists to catch. **The one thing
this domain needs that domains E1–E7 didn't** is a footprint proxy with real signal: enabled-count
alone overstates classic residue (a disabled clone family counts as heavily as a firing one), so weight
by the schema's actual share of the 30-day Davis event/problem stream (`dt.settings.schema_id` on
`dt.davis.events`, the same shape as `/dt-eval-prob`'s A9 — live-verified 2026-08-05) — falling back to
enabled-detector-count share if that read is unavailable, the same graceful-degradation pattern E5 and
E10 already use. **The remediation is unusually mechanical for this repo**: the Anomaly Detection app
ships a built-in transpiler (Custom alert → *Improve metric events with DQL* → select → Transform) that
converts a classic metric event directly into a Davis DQL-based detector, auto-disabling the classic
config on success — a one-click retire-classic/adopt-native step per detector rather than a
re-architecture, which changes where this domain sits in Now/Next/Later sequencing relative to the
others. **Confirmed against §5's scoring math**: adoption-weighting handles the "no custom-detector
need at all" case exactly as domain 9 (SLOs) already does — a tenant with 0 detectors of either kind
gets ~0 footprint for this domain and the grade is untouched, so no special-casing of the status rule
itself is required. The fixed-weight fallback table only carries explicit entries through domain 9
("added pro-rata" for 8/9) and is silent on domains 10–12 already; domain 13 would need the same
pro-rata treatment those three already require but don't yet have spelled out — a pre-existing gap in
this section, not one this domain introduces. **Wired in as of 2026-08-05**: `SKILL.md`,
`probes-gen3.md` §E (as E13), `verification-queries.md` (V51), `field-notes.md`,
`MANUAL-EXTRACTION.md` §8, both `README.md`s, and `CHANGELOG.md` all carry it now.

**Domains 1–7 measure *config constructs*; domain 8 measures the *entity model* the constructs
produce.** A classic (Gen2) extension writes `CUSTOM_DEVICE-*` entities; a Gen3 extension writes
typed Smartscape nodes (`EXT_NETWORK_DEVICE`, `F5_LTM_POOL`, …). When a Gen3 extension binary is
installed but its monitoring configurations have not been re-saved, the typed node exists **alongside
a populated `id_classic`** pointing at the legacy `CUSTOM_DEVICE` — the same "installed but not
cut over" shape as a dual-running config domain, one level down in the model. This is the concrete
answer to *"are entities being leveraged in a Gen3 fashion?"* — and it is a **new Grail read** (B33),
not a recipe over existing config probes (§10).

**Domain 5 is graded on *usage by real users*, never native object count — this is a correction.**
A tenant can hold hundreds of platform dashboards while its people still open only classic ones;
counting native objects then reports "leveraging Gen3" when the reverse is true. Classic dashboards
run on the classic metrics API, **not Grail**, so *real-user Grail dashboard engagement being low is
itself the proof that Gen3 dashboards are not being used* — regardless of how many exist. Grade E5
on B34 (real, non-Dynatrace users actively running Grail dashboards/notebooks); the classic-dashboard
`popularity`/`lastViewed` residue is a **verify-live** confirmation (classic-config-API surface,
outside the 100%-dtctl design — footnote it, never assert a count). See CLAUDE.md rule 6
(active engagement, never vanity metrics) and the [field-notes-gen3.md](field-notes-gen3.md) migration entry.

## 5. Status model & scoring rollup

- Per domain: **Complete = 100 · In progress = 50 · Not started = 0**; **⚪ excluded from the
  denominator** (same discipline as the rest of the skill — a scope gap must never read as migration
  debt).
- **Migration Completeness %** = **adoption-weighted** mean of assessable domains. Each domain's
  weight is its **share of the tenant's total active-usage footprint** — not a fixed constant — so
  migration debt in a domain the tenant *actually leans on* moves the grade, and a barely-touched
  domain barely counts (CLAUDE.md rule 6 — active engagement, never vanity metrics — enforced at the
  scoring layer). A tenant with 0 SLOs has ~0 SLO footprint, so a not-started SLO domain does **not**
  drag its grade; a tenant pushing 50k extension datapoints has a large extension footprint, so
  extension debt weighs heavily. The active-usage footprint proxy per domain (each normalized to its
  share of the total, then used as the weight):

  | Domain | Active-usage footprint proxy (sets the weight) |
  |---|---|
  | Alerting & problem delivery | problems delivered in the window (D4 / EC11/EC16) |
  | Scoping / access boundaries | entities + Grail records actually scoped (E2 population read) |
  | Tagging & ownership | records/entities enriched (B5/B30 ratio × volume) |
  | Log processing | **records actually routed (B45)**; A21 targets × ingest as fallback |
  | Dashboarding & analysis | real-user (non-Dynatrace) Grail dashboard/notebook opens (B34), weighed against classic opens (B46) |
  | Automation | workflow executions (A5 / EC2) |
  | Apps / UX | real-user (non-Dynatrace) app opens (B34-style) |
  | Extension entity model | extension metric-datapoint volume (B33 — the P1–P4 tiers) |
  | SLO model | SLOs actually evaluated/consumed (burn-rate-wired; A37/B35) |
  | Integration surface | observed classic-API call volume from customer-authored callers (B43) + authored documents flagged (B44) |
  | Access model | groups carrying permissions (B47 classic + policy totals) |
  | Service detection & rule settings | services actually detected (D1/B7 census — the topology the rules produce) |
  | **Custom anomaly-detector framework** | share of the 30-day Davis event/problem stream by `dt.settings.schema_id` (classic `anomaly-detection.metric-events` vs `davis.anomaly-detectors`); enabled-detector-count share (A2+A43 vs A13) as fallback |

  **Intra-domain, weight by the same principle**: the extension domain (E8) rolls up per-extension
  migration *weighted by each extension's metric volume* (a not-started P1 hurts far more than a
  not-started P4) — the P1–P4 tier *is* the adoption weight. **Fallback**: where a footprint proxy is
  unavailable or zero for the window, fall back to the prior fixed weights (Alerting .20 · Scoping
  .15 · Tagging .15 · Log .15 · Automation .15 · Dashboarding .10 · Apps .10, with Extensions and
  SLO added pro-rata) and say so in the method note. Weights are **exposed and adjustable** either
  way. *Adoption-weighting re-weights every domain by footprint; each domain's **status rule**
  (✅/💡/⚠️ criteria) is unchanged.*

- Grade bands: **A ≥ 85, B ≥ 70, C ≥ 50, D < 50** (same as the rest of the repo).
- **Dual-running is the headline insight.** Every 💡 domain gets a callout naming the specific
  classic + native pair coexisting and the double-config / double-cost of leaving both.
- Confidence flags (High/Medium/Low by assessable-domain count) carry into the internal variant.

## 6. Gen3-first guardrails (non-negotiable — from CLAUDE.md)

Progress is measured **toward native**. A fully-native tenant (0 MZs, 0 classic notifications,
workflow-based delivery) = **100 % / Complete / clean** — say so; never read it as "nothing done."
Never score classic-absence as a gap; **every remediation is a retire-classic / adopt-native step —
never "create a classic construct."**

## 7. Not-assessable (⚪) items — appendix footnotes, each with why

- Classic **API-token inventory** — REST-only, excluded by the 100%-dtctl design.
- **ActiveGate auto-update status** — no query surface. (Fleet *version* currency is no longer ⚪:
  the tenant-review probes grade drift — B13 OneAgent, and since 2026-07-28 B36 ActiveGate via
  `smartscapeNodes ACTIVEGATE` — but currency is a Config Review concern, not a migration domain.)
- **Classic Monaco vs platform config-as-code** distinction — partial; the EC pillar's CCS share
  gets close but does not cleanly separate the two.
- **Whole-environment** classic→platform migration — out of dtctl scope (see §2).
- **Gen3 SLO enumeration (native count) — verify-live, not ⚪ for the domain.** A3 (`dtctl get slos`)
  is the platform-native count and A37 (`builtin:monitoring.slo`) the classic count — **disjoint
  populations, not a drill-down** (live 2026-07-29: A3 = 0 while A37 held 278 tuned classic SLOs on
  the same tenant); both are exact. The new Grail-DQL SLO app has **no documented
  settings-schema, Grail table, or `dtctl` resource** beyond A3 to enumerate against. The run resolves the
  reachable surface live (`dtctl get documents` type-filtered · SLO Service Public API · a
  `dt.slo*`-metric presence tell) and, if none is reachable, grades E9 on classic residue + confirmed
  Gen3 *presence* — **never a fabricated native count** (same discipline as the classic-dashboard
  footnote). E9 itself stays scored; only the precise native *count* is the verify-live part.
- **Classic-dashboard object count** — the classic-config-API surface (`popularity`/`lastViewed`),
  not a `dtctl`/Grail read. E5 no longer needs it: it grades on real-user Grail *usage* (B34), with
  the classic usage signal as a verify-live confirmation. The classic *count* remains a footnote.

## 8. Remediation requirement — WHY + HOW, cited, for every item

**A pointer is not remediation.** Every domain carries a **Path forward** that is a self-contained
mini-runbook tied to the tenant's own findings. No orphan rows: ✅ Complete reads *"Complete —
maintain, no action"* so the "every item" rule holds without inventing work.

### The bar every Path forward must clear
1. **WHY** — the native advantage in concrete terms **+ the cost of not moving** (silent
   degradation, dual-running overhead). Not "segments are better" — *what* they do that the classic
   construct structurally cannot.
2. **HOW** — numbered, dependency-ordered steps that **name the tenant's own findings**, each a
   retire-classic / adopt-native action.
3. **Validate & decommission** — how to parallel-run and confirm equivalence before removing the
   classic construct (safe, not just directional).
4. **Cited** — the docs.dynatrace.com page (**verified live this run** — WebFetch it; the BPN
   notebook's *Sources* footer hands you the exact URLs) is the authority for the procedure; the BPN
   series is cited by code as the worked runbook / further reading. **Never BPN-only.**
5. **Effort / sequence** — rough size and where it sits in Now/Next/Later.

This maps onto the existing `finding_section(means=, consequence=, action=[…])` helper — WHY splits
across `means`/`consequence`, HOW is the `action` step list. It is a **substance bar, not new
plumbing.**

### Per-domain remediation source mapping
The skill artifacts store the **mapping** (domain → doc topic + BPN series); the **run resolves and
verifies the live URL** so citations never go stale. Series codes below are from
[bpn-library.md](bpn-library.md).

| Domain | Authoritative docs (verify-live) | BPN further reading |
|---|---|---|
| Alerting & problem delivery | Migrate alerting profiles → workflows; notification workflows | **WFLOW**, **MZ2POL** (if profiles are MZ-scoped), ALERT-01/03/04 |
| Scoping / access boundaries | Segments; IAM policies / ABAC | **MZ2POL**, **ORGNZ**, **IAM** |
| Tagging & ownership | Tagging (source tags); OpenPipeline enrichment | **FAQ-02**, **ORGNZ** |
| Log processing | OpenPipeline; Classic→OpenPipeline migration | **OPMIG**, **OPLOGS**, OPIPE |
| Dashboarding & analysis | Migrate dashboards / Dashboards app | **DASH**, ADOPT-03 |
| Automation | Workflows; AutomationEngine (+ config-as-code) | **AUTOM**, WFLOW |
| Apps / UX | Dynatrace Apps / Hub | **ADOPT**, DASH |
| Extension entity model | Extensions 2.0 / Gen3 extensions; re-save monitoring configurations to drop the classic `CUSTOM_DEVICE` backing; network-topology/entity extraction | **ADOPT** (roadmap; no dedicated extensions series — Hub extension pages + docs are authoritative) |
| SLO model | **Upgrade Classic SLOs** (metric-expression → DQL SLI; entity-selector → DQL; Upgrading-Metrics table); Service-Level Objectives app | **SLO 01–05** (fundamentals → SLIs → error budgets → alerting → as-code) |
| Integration surface | Per caller: the successor for each BLOCK endpoint ([classic-to-native-map.md](classic-to-native-map.md) Table 2). Per document: the classic-entity DQL rewrite — hand the list to the **`dt-migration`** skill (`fetch dt.entity.*` → `smartscapeNodes`; `entityName()`/`entityAttr()`/`classicEntitySelector()` → direct dimension filters) | **ADOPT**, **AUTOM** (integration re-platforming); **MZ2POL** where the calls are zone/tag settings |
| Access model | **Migrate roles to policies** — move each group off classic RBAC roles onto default policies; bind the boundary on `dt.security_context`, not management zones | **IAM**, **MZ2POL**, **ORGNZ** |
| Service detection & rule settings | Remove management-zone / service-tag / non-`primary_tags.` process-group-tag scopes; reproduce the behavior with **primary tags** in the Process-group tag field (Dynatrace's own stated rework). Enhanced Endpoints for SDv1 is a separate capability decision, not a rule rewrite | **ADOPT** (no dedicated series — docs authoritative) |
| **Custom anomaly-detector framework** | [Upgrade Guide — Metric Alerting](https://docs.dynatrace.com/docs/platform/upgrade/metric-alerting) (the in-product transpiler: Anomaly Detection app → Custom alert → *Improve metric events with DQL* → select → Transform, which auto-disables the classic config on success); [Metric events](https://docs.dynatrace.com/docs/dynatrace-intelligence/anomaly-detection/metric-events) (what the classic construct is); [Davis Anomaly Detection app](https://docs.dynatrace.com/docs/platform/davis-ai/anomaly-detection/anomaly-detection-app) (the native target) | **ALERT-02** (detection decision framework, static vs Davis), **AIOPS** (Davis anomaly detection) — per bpn-library.md's own routing table, not domain 1's ALERT-01/03/04 (that's routing/notifications, a different topic) |
| *Overall sequencing* | — | **ADOPT 01/02/05/06** (roadmap ordering), FAQ-12 (cost-of-inaction framing) |

### Worked example — the standard every item is held to
*(illustrative figures)*

> **Domain: Scoping / access boundaries — ⚠️ Not started** (14 management zones; 0 segments; 0%
> `dt.security_context`)
>
> **Why this matters.** Management zones are static, entity-based, and **do not scope Grail** — so
> every log, span, bizevent, and DPS cost record the estate now writes to Grail is invisible to
> MZ-based scoping. Access boundaries, cost allocation, and dashboard filters have nothing to key on
> over the data that matters most, and the 14 zones need manual rule upkeep as the estate changes.
> Segments are dynamic (DQL/filter-based), apply across Grail *and* entities, self-maintain, and are
> shareable as dashboard/notebook variables. Left as-is: access stays coarse, cost stays
> unattributable, and each new workload silently falls outside the zones until someone hand-edits
> them.
>
> **How to move (Now → Next):**
> 1. **Inventory** the 14 MZs — for each, capture what it scopes and who consumes it (dashboards,
>    permissions, the 9 alerting profiles). *(docs: Management zones; further reading: MZ2POL)*
> 2. **Author an equivalent segment** per scoping intent; validate it returns the same entities
>    **and** now covers the Grail data the MZ never could. *(docs: Segments — verify-live)*
> 3. **Replace MZ-based access** with an **IAM policy keyed on `dt.security_context`** (set via
>    source tags / pipeline enrichment) — the ABAC boundary MZs cannot provide for Grail. *(docs:
>    IAM policies / ABAC; further reading: IAM, ORGNZ)*
> 4. **Repoint consumers:** dashboard & notebook variables → the new segment; the 9 MZ-scoped
>    alerting profiles → davis-problem **workflows** filtered by that segment *(cross-links the
>    Alerting domain)*. *(further reading: MZ2POL, WFLOW)*
> 5. **Parallel-run** (confirm entities + Grail records match), then **decommission** each MZ once
>    nothing references it.
>
> **Effort:** medium; sequence after source-tag enrichment (step 3 depends on it).
> **Further reading:** MZ2POL (Classic-MZ→policy runbook), ORGNZ, IAM.

The same depth applies to every domain (OpenPipeline via the OPMIG runbook, alerting profiles →
workflows via WFLOW, classic dashboards → Dashboards app via DASH, and so on).

## 9. Report structure (standalone; mirrors the Effective Consumption standalone)

1. **Cover** — "Dynatrace Gen3 Migration Progress Review", customer, tenant URL, date, **Migration
   Completeness %** as headline + `render_gauge_png()`; AI-disclosure footnote (`requested_by` from
   `dtctl auth whoami`).
2. **Executive Summary** — plain-prose migration verdict (how far along, biggest remaining moves),
   3–5 headline findings, one-paragraph "what to do first". No field names / DQL / probe IDs.
3. **How to read** — legend ✅ Complete / 💡 In progress (dual-running) / ⚠️ Not started; ⚪ items
   are appendix footnotes only.
4. **Migration scorecard** — lead with `pillar_bar_chart()` over domain completion (worst-first) +
   `rag_summary()`; then `scorecard_table()`: **Domain | Native target | Classic residue measured |
   Status | Path forward (cited next step)**.
5. **Deep-dive per domain** — worst-first, INTERPRET shape via `finding_section(..., means=,
   consequence=, action=[…])`: measured → what it means → dual-running cost / upside → evidence →
   the full WHY+HOW remediation runbook (§8).
6. **Migration sequencing plan** — Now/Next/Later, dependency-ordered (source-tag enrichment before
   ownership routing; segments before retiring MZs; OpenPipeline routing before decommissioning
   classic pipelines), each step carrying its citation.
7. **Verify these findings yourself** — client-runnable DQL/CLI per domain + the GUI validate/
   remediate map + the standing-instruments recommendation. **This section MUST open by naming the
   platform's own ready-made "Check your upgrade readiness" dashboard** (owner decision 2026-07-31)
   — see the citation rules below.

### The upgrade-readiness dashboard — cite it, show the numbers, interpret them (2026-07-31)

Dynatrace ships a ready-made public dashboard, **Check your upgrade readiness**
(`dynatrace.upgrade.readiness.migration-status`, from the `dynatrace.upgrade.readiness` app), which is
already present in the customer's environment. B42–B46 reproduce reads from it. **Reference it in the
report** — it is a Dynatrace product surface in the client's own tenant, so it is a legitimate
neutral-attribution citation (rule 1) and *not* internal machinery (rule 2).

**What the report must do with it — all three, or the reference is decoration:**

1. **Name it and say where it is** — "your environment includes a ready-made *Check your upgrade
   readiness* dashboard; open it from Dashboards." Never a URL containing the tenant ID (rule 5),
   never our internal document ID for it.
2. **Include our measured results alongside it** — the domain's actual numbers from B42–B46, in the
   report's own tables. The dashboard shows the customer a status; the report tells them what it
   *means for them*, which is the whole point of the deliverable (core directive).
3. **Give the interpretation the dashboard does not** — three things it cannot do on its own:
   - **Its colours are per-section, not weighted.** Fifteen sections of mixed 🟢/🟡/🔴 do not tell a
     customer where to start. Our adoption-weighted rollup (§5) does, and the report must say
     explicitly that the ordering comes from *their* usage footprint, not from the dashboard's layout.
   - **Its raw counts overstate customer-owned debt.** The two calibrations in §4 (first-party
     Dynatrace apps excluded; the `CLASSIC_ENTITY_MIGRATION_ADVISED` share never reported raw) are
     exactly the corrections a customer reading the dashboard unaided will get wrong. State the
     corrected numbers and say plainly why the unfiltered figure is higher — this is a place the
     report earns its keep.
   - **It reports state, not consequence.** Every ⚠️/💡 still needs the WHY + HOW runbook (§8) and
     the cost of inaction. A dashboard status is a number and a definition — the thing §8 exists to
     forbid on its own.

**Status-glyph alignment (state it once, in the method note).** The dashboard's 🟢 ready / 🟡 in
progress / 🔴 action required / ⚪ not applicable map 1:1 onto this report's ✅ / 💡 / ⚠️ / ⚪,
including ⚪ meaning *not applicable* and never a gap. Saying so lets the customer move between the
two surfaces without reconciling two vocabularies, and it is a genuine corroboration of the method —
the vendor grades migration the same way this report does.

**Where the two disagree, the tenant's own dashboard wins on facts and this report wins on
weighting** — say which is which rather than papering over a difference the customer can see.
8. **Appendix** — method (client-safe), **Footnotes** (the ⚪ list from §7, each with the access/
   surface that would include it), **References** (two-part: authoritative docs.dynatrace.com pages
   actually opened this run · Further reading — the public series link + per-domain codes), standing
   disclaimer.

Full client-facing hygiene rules and the pre-delivery scan apply. The **(Internal)** variant adds
the scoring-derivation table, per-domain confidence flags, and migration→expansion talk-tracks
(migration is a natural expansion conversation) per [report-audiences.md](../.dt-eval-common/report-audiences.md);
`-internal` filename + internal-distribution cover subtitle.

## 10. Probes — a scoring recipe for E1–E7, plus new Grail reads for E8/E9/E5-usage (2026-07-28) and E10/E4/E5 (2026-07-31)

**Implementation finding:** the classic-construct schema IDs this section proposed as "new, verify-live"
**already exist as confirmed §A probes** — A14 `builtin:alerting.profile`, A15
`builtin:problem.notifications`, A16 `builtin:tags.auto-tagging`, A17 `builtin:management-zones`, A18
`builtin:ownership.teams`, A29 `classic-pipelines-translation` — collected today as "Legacy
inventory." So for **domains E1–E7 §E adds no new raw collection**; it is a **scoring recipe over
§A/§B saved outputs** (shipped in [probes-gen3.md](probes-gen3.md), mirrored in
[MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §8), analogous to the D1–D6 deep-dive recipes.
The three 2026-07-28 additions (E8 extension entity model, E9 SLO model, and the E5 usage correction)
**do** add three cheap, guard-railed Grail reads (B33/B34/B35 — see the scope correction below),
because the entity model and real usage are not captured by any config probe. The table below maps
each domain to the probe it reads.

| Domain | Classic-residue source (existing) | Native-target source (existing) |
|---|---|---|
| E10 Integration surface | **B43** classic API/settings calls by caller (BLOCK-share) | **B44** authored documents free of classic-entity DQL |
| E11 Access model | **B47** `legacy_permissions_groups` (classic RBAC) | **B47** `default_policies_groups` + B30 security-context coverage |
| E12 Service detection | **A52** flagged enabled rules + **A53** Enhanced Endpoints | the same rules re-scoped onto primary tags |
| E1 Alerting | A15 `problem.notifications`, A14 `alerting.profile` (+ D4 chain) | A4 davis-problem workflows |
| E2 Scoping | A17 `management-zones` | A6 segments + B30 `dt.security_context` |
| E3 Tagging | A16 `tags.auto-tagging`, A18 `ownership.teams` | B5 + B30 source-tag enrichment |
| E4 Log processing | A29 `classic-pipelines-translation` | A21/A22 OpenPipeline |
| E5 Dashboarding | classic-dashboard `popularity`/`lastViewed` (**verify-live**, classic config API) | **B34 real-user (non-Dynatrace) Grail dashboard/notebook usage** — *not* A8/A9 counts |
| E6 Automation | *(native-only)* | A4/A5 workflows executing (EC2/EC14) |
| E7 Apps | *(native-only)* | A10 apps + B34-style real-user opens |
| **E8 Extension entity model** | **B33** extension-sourced nodes with populated `id_classic` + metrics-only extensions (0 nodes) | **B33** typed nodes (`id_classic` null), volume-weighted |
| **E9 SLO model** | A37 `builtin:monitoring.slo` (classic) | A3 `dtctl get slos` (platform-native) + **B35** Gen3 DQL-SLI verification (**verify-live**) |
| **E13 — Custom anomaly-detector framework** | **A13** `builtin:anomaly-detection.metric-events`, enabled count | **A2**/A43 `builtin:davis.anomaly-detectors`, enabled count |

**Scope correction (2026-07-28):** the original "§E adds *no* new raw collection" held for the
config-construct domains E1–E7 (a recipe over saved §A/§B outputs). The three additions below **do add
targeted Grail reads**, because the entity model and real usage are not in any config probe: **B33**
(extension `smartscapeNodes`/`id_classic` audit — the answer to "are entities Gen3-native?"), **B34**
(real-user, non-Dynatrace Grail dashboard/app usage — the correction that stops grading dashboards on
object count), and **B35** (Gen3 SLO enumeration, verify-live). All three are cheap (smartscape reads,
a 2h metric window, `dt.system.query_executions`), stay inside the cost guardrails, and are defined
in [probes-config.md](probes-config.md) (§A).

Two honest limitations remain: **E5's classic-dashboard object *count*** has no dtctl/Grail surface
(classic-config-API only) — E5 is now graded on real-user *usage* (B34) instead, with the classic
`popularity`/`lastViewed` signal as a verify-live confirmation; and **E9's Gen3 SLO *count*** has no
documented enumeration surface (verify-live, §7). Each addition still gets its **verification twin**
(V33 in verification-queries.md), a **GUI map row**, a **field-notes** entry, and **MANUAL-EXTRACTION.md**
duplication — same keep-in-sync rule as every probe class.

**E13 splits the same way E5 does: the status is free, the weight is not.** The domain's
✅/💡/⚠️ status needs no new probe at all — A13/A2/A43 already exist and are already flagged Gen3-first
in `probes-config.md`, so E13 is a pure scoring recipe exactly like E1–E7. Only the **adoption-weight**
benefits from a new read, because enabled-detector-count (what A13/A2/A43 give for free) overstates or
understates residue versus actual firing volume the same way raw object counts did for E5 before B34 —
a disabled clone family and a firing one count identically by enabled-count alone. That new read —
**B49** (`dt.settings.schema_id` share of the 30-day Davis event/problem stream; B48 was already taken
by Coverage DEPTH per technology, unrelated) — is optional in the sense E5's B34 was not: where it is
skipped or unavailable, E13 falls back to the enabled-count share already on hand, same
graceful-degradation discipline as the rest of this section, rather than blocking the domain.
Live-verified shape (2026-08-05; `sum()` cannot sit inside `fieldsAdd` in the same pipeline stage as
the `summarize` that produced it — pivot with `countIf()` instead, the same fix A9 in
`dt-eval-prob/probes.md` already uses):
```
fetch dt.davis.events, from:now()-30d
| filter dt.settings.schema_id == "builtin:anomaly-detection.metric-events" or dt.settings.schema_id == "builtin:davis.anomaly-detectors"
| summarize legacy_events = countIf(dt.settings.schema_id == "builtin:anomaly-detection.metric-events"),
    native_events = countIf(dt.settings.schema_id == "builtin:davis.anomaly-detectors")
| fieldsAdd legacy_share_pct = round(100.0 * toDouble(legacy_events) / toDouble(legacy_events + native_events), decimals:1)
```
E13's verification twin is **V51** in verification-queries.md, with a **field-notes** entry and a
**MANUAL-EXTRACTION.md** duplication — same keep-in-sync rule as every probe class, and all shipped
alongside this domain.

## 11. Build footprint (artifacts to touch)

Roughly eight artifacts; data mostly reuse. Suggested as two PRs for tractable review:

**PR A — evidence layer:** [probes-gen3.md](probes-gen3.md) (§E), [field-notes.md](field-notes.md),
[verification-queries.md](verification-queries.md), [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md).

**PR B — report + wiring:** [SKILL.md](SKILL.md) (input-#4 item + exclusivity rule, "Standalone
Gen3 Migration Progress report" structure section, Phase-1/2 scope note, Phase-4 domain rubric +
rollup), [report-audiences.md](../.dt-eval-common/report-audiences.md) (internal-variant additions),
[docx_style.py](../.dt-eval-common/docx_style.py) (reuses cover/gauge/scorecard/`pillar_bar_chart`/`finding_section`;
at most a small domain-status table helper), [README.md](../../../README.md) (step-0 + Output),
[CHANGELOG.md](../../../CHANGELOG.md).

## 12. Locked decisions & flippable defaults

**Locked:** standalone & exclusive with everything · construct-level interpretation (§2) ·
Gen3-first guardrails (§6) · remediation is WHY+HOW+cited for every item (§8).

**Defaults (easy to flip during red-line):**
- Headline metric = **Migration Completeness %** on every edition, **+ A–D** only where grades are
  carried (see §"Own headline").
- Ship **both external and (Internal)** variants.
- Domain **weights** per §5 (exposed + adjustable).
- Domain **set** = the seven in §4 (Config-as-code / Monaco is a ⚪ context note for now, not its own
  scored domain).
