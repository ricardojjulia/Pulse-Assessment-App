# Probe catalog — §E Gen3 Migration Progress recipe (E1–E13)

Part of the dt-eval probe catalog — [probes.md](probes.md) is the router: the shared preamble (dtctl version floor, `--context` on every command, save-raw + `runlog.py record` rules) lives there and applies to every probe here. Cross-references to other sections point into sibling files: §A = [probes-config.md](probes-config.md) · §B = [probes-grail.md](probes-grail.md) · deep-dives D1–D6 = [probes-deepdives.md](probes-deepdives.md) · §C = [probes.md](probes.md) · §D = [probes-consumption.md](probes-consumption.md) · §E = [probes-gen3.md](probes-gen3.md) (this file). The keep-in-sync rule (CLAUDE.md) applies to this whole family.

## §E — Gen3 Migration Progress (scoring recipe over §A/§B — no new raw collection)

The evaluation battery for the standalone **Gen3 Migration Progress** deliverable ([gen3-migration-progress-spec.md](gen3-migration-progress-spec.md)). For the **config-construct domains E1–E7 it collects no new probes** — every classic-residue and native-target signal is already gathered in §A/§B, and §E is the recipe that reads that evidence, assigns each migration **domain** a status, and rolls the domains into a **Migration Completeness %**. The three 2026-07-28 additions **do** collect: **E8** reads **B33** (extension entity model — the answer to "are entities Gen3-native?"), the **E5 correction** reads **B34** (real-user, non-Dynatrace Grail dashboard usage — never native object count), and **E9** reads **B35** (Gen3 SLO enumeration, verify-live). The **2026-07-31 upgrade-readiness additions** also collect: **E10** reads **B43**+**B44** (classic API callers and classic-entity documents — the new Integration surface domain), **E4** keeps its config-side grading (the B45 re-basing attempted on 2026-07-31 was withdrawn the same day — see B45's correction), and **E5/E7** are re-based on **B46** (classic-app opens by distinct real user, replacing the classic-dashboard verify-live footnote). Two further 2026-07-31 domains collect as well: **E11** reads **B47** (the platform's daily IAM readiness snapshot — classic RBAC roles vs default policies) and **E12** reads **A52**+**A53** (service-/failure-detection rules flagged for rework, and Enhanced Endpoints for SDv1). All of these reproduce reads from the platform's own ready-made **Check your upgrade readiness** dashboard, which makes them customer-reproducible and citable — see [classic-to-native-map.md](classic-to-native-map.md). The **2026-08-05 addition, E13**, is free on the status side like E1–E7 — its classic-residue (**A13**) and native-target (**A2**/A43) signals are already in §A — and collects only one new read, **B49**, for the footprint *weight* (actual custom-detector firing volume by `dt.settings.schema_id`, never `event.provider`), not for the status itself. Run §E **only** when the Gen3 Migration Progress deliverable is selected (SKILL.md input #4); otherwise skip it (and B33–B35, B43–B47, A52–A53, B49) entirely. **Gen3-first still governs:** progress is measured *toward the native target* — a fully-native tenant (0 MZs, 0 classic notifications, workflow delivery, typed extension nodes, Gen3 SLOs) is **100 % Complete**, never "empty"; never score classic-absence as a gap, and every remediation is retire-classic / adopt-native, never "create a classic construct."

Status per domain: **✅ Complete** (native in place, classic retired) · **💡 In progress** (dual-running — both present) · **⚠️ Not started** (classic only / native absent) · **⚪ Not assessable** (excluded from the denominator, never scored 0).

| # | Domain | Classic-residue signal (existing probe) | Native-target signal (existing probe) | Complete rule |
|---|--------|------------------------------------------|----------------------------------------|---------------|
| E1 | Alerting & problem delivery | A15 `problem.notifications`, A14 `alerting.profile` (MZ-bound share via D4); CUSTOM_ALERT share of the problem stream (EC11/EC16) = ported-threshold residue | A4 davis-problem workflows (BOTH `isDeployed=true` AND `trigger.eventTrigger.isActive=true` + D4 delivery chain) | davis-problem workflows deliver ∧ 0 classic profiles/notifications |
| E2 | Scoping / access boundaries | A17 `management-zones` — **by dimension, not count** (see the E2 recipe below) | A6 segments (effective/total) + B30 `dt.security_context` % | segments cover every zone dimension ∧ 0 MZs |
| E3 | Tagging & ownership | A16 `tags.auto-tagging` rules, A18 `ownership.teams` | B5 record-side + B30 entity-side source-tag enrichment ratio | source-tag enrichment live ∧ 0 classic auto-tag rules |
| E4 | Log processing | A29 `classic-pipelines-translation` (substantive = classic config still *present*, counted as **enabled/total per group** — `processing`, `metricExtraction`, `davis`, `storage` — not total) | A21 routing **incl. the catch-all check** + A22 pipelines **incl. groups**; **B45 for ingest scale/liveness only** | OP routing configured ∧ classic-translation empty. **B45's `pct_through_pipelines` is NOT an adoption measure — corrected 2026-07-31**: it reads ~100% on any platform tenant because the default pipeline counts (live: 100.0% and 99.8% on tenants with one routing entry and 2–3 pipelines), and the metric carries **no pipeline dimension** (every candidate returns one null bucket). Grade on the config side; use B45 for volume context. **A trailing enabled `matcher: true` means nothing falls through to classic** — with one present, classic config is residue to retire, not a parallel processing path |
| E5 | Dashboarding & analysis | **B46 classic-app / classic-dashboard opens by distinct real user** (measured, 2026-07-31 — replaces the former `popularity`/`lastViewed` verify-live footnote) | **B34 real-user (non-Dynatrace) Grail dashboard usage** — NOT A8/A9 object counts | real users actively run Grail dashboards ∧ classic opens near-zero (**graded on usage on BOTH sides, never presence** — B34 vs B46 in the same currency: opens by distinct real users) |
| E6 | Automation | *(native-only — no classic residue)* | A4/A5 workflows present ∧ executing (EC2/EC14 footprint) | workflows present ∧ executing (dormant = 💡) |
| E7 | Apps / UX | **B46 classic-app opens by distinct real user**, each row carrying its named successor from [classic-to-native-map.md](classic-to-native-map.md) Table 1 | A10 apps adoption + B34-style real-user opens | meaningful native app adoption ∧ classic opens near-zero. **Classic apps whose successor is `— none yet` (7 at transcription) are ⚪** — appendix footnote, never a gap (Gen3-first: never score the absence of a construct Dynatrace has not yet replaced) |
| E8 | **Extension entity model** | **B33** extension-sourced nodes with populated `id_classic` + metrics-only extensions (0 nodes) | **B33** typed nodes (`id_classic` null), volume-weighted | every extension's active-volume-weighted footprint on typed nodes ∧ 0 classic-backed |
| E9 | **SLO model** | A37 `builtin:monitoring.slo` (classic, exact) | A3 `dtctl get slos` (platform-native, exact) + **B35** Gen3 DQL-SLI verification | Gen3 SLOs evaluating ∧ 0 classic SLOs |
| E10 | **Integration surface** (NEW 2026-07-31) | **B43** classic API/settings calls by caller, classified BLOCK/HIDE/VISIBLE against [classic-to-native-map.md](classic-to-native-map.md) Table 2 + **B44** customer-authored documents running classic-entity DQL | callers whose traffic is entirely on surviving (`VISIBLE`) endpoints; documents whose DQL carries no classic-entity construct | **0 callers with BLOCK-share traffic ∧ 0 customer-authored documents flagged** |
| E11 | **Access model** (NEW 2026-07-31) | **B47** groups still bound to classic RBAC roles (`legacy_permissions_groups`) | **B47** groups on default policies (`default_policies_groups`) + B30 `dt.security_context` coverage as the boundary the policies key on | 0 groups on classic RBAC roles ∧ policy-based groups in place |
| E12 | **Service detection & rule settings** (NEW 2026-07-31) | **A52** enabled service-/failure-detection rules flagged for rework (management-zone, service-tag, or non-`primary_tags.` PG-tag scopes) + **A53** Enhanced Endpoints for SDv1 | the same rules re-scoped onto **primary tags** from process groups | 0 flagged enabled rules across the assessed families |
| E13 | **Custom anomaly-detector framework** (NEW 2026-08-05) | **A13** `builtin:anomaly-detection.metric-events`, enabled count | **A2**/A43 `builtin:davis.anomaly-detectors`, enabled count | 0 enabled A13 detectors ∧ native detectors active (where custom detection is used at all) |

**E11 grades the ONE domain where being wrong is a security regression, not a cosmetic gap.**
Classic RBAC roles are being replaced by policies; a group left on classic roles keeps working until
it does not. Two rules: the readiness event is a **daily snapshot**, so take the newest one only
(aggregating a week multiplies the estate); and **B47 can unblock `/dt-eval-mz2seg`** — that plan
blocks every retire-\* disposition while the access job is unmeasured, and B47 is a second,
independent read of group permissions when A19 is unreadable. It establishes *that* classic role
bindings exist, never *which zones they scope*, so it moves `access-unknown` →
`access-classic-roles-present` and never promotes a zone to retire-now. See B47.

**E12 is graded as a dependency, not a tidy-up.** Service-detection configuration decides what a
service *is*, and Davis correlates over that topology — so flagged rules move the ground under every
service-level finding in the Config Review and every detector in `/dt-eval-prob`. The rework rule and
its cited HOW (drop management-zone / service-tag / non-`primary_tags.` PG-tag scopes; reproduce via
**primary tags** in the Process-group tag field) are Dynatrace's own — see the **A52 recipe** in
[probes-config.md](probes-config.md), which also records the **⚪ partial coverage**: Request
Attributes and Request Naming have no settings schema and no `dtctl` verb, so two of Dynatrace's four
rule families are not assessed and must be footnoted with the surface that would include them. Never
imply the estate was fully assessed. A tenant returning **0 objects** from the failure-detection
schemas has no global rules — ✅ for that family, not ⚪.

**E10 is the domain that answers the question customers actually ask — "what of *mine* stops working
on upgrade day?"** Every other domain measures a construct's migration state; E10 measures the
*dependencies on it*. A tenant can be ✅ on E2 (zero management zones) while an external CMDB
integration still calls `/api/v2/settings/managementZones` nightly — the construct is gone, the
caller breaks anyway. **⚠️ Not started** = named callers hitting BLOCK endpoints, or customer-authored
documents flagged `CLASSIC_ENTITY_MIGRATION_ADVISED`; **💡 In progress** = some callers migrated,
a residue remains; **✅ Complete** = all observed classic traffic lands on `VISIBLE` rows and no
authored document carries a classic-entity construct.

**Two mandatory calibrations — without them this domain fabricates findings (both learned live 2026-07-31):**

1. **Exclude Dynatrace's own first-party apps.** Raw classic-passthrough volume is dominated by
   `dynatrace.appshell`/`clouds`/`infraops`/`synthetic`/`kubernetes`/`extensions.manager` and a large
   null-`dt.app.id` bucket. That is **Dynatrace's** migration debt, not the customer's. B43/B44 carry
   the authoring-surface filters; use them.
2. **Never report the raw `CLASSIC_ENTITY_MIGRATION_ADVISED` share.** On a reference tenant it read
   ~83% of all successful executions while the customer-owned portion was a small fraction (~92% of
   flagged executions had no attributable document). The reportable number is **how many
   customer-authored documents need rewriting, named** — a worklist, never a percentage.

**E10's deliverable artifact is a list, not a score** — per caller: the endpoints it touches, their
BLOCK/HIDE/VISIBLE verdicts, and what replaces them. Feed the B44 document list to the **`dt-migration`**
skill, which rewrites classic-entity DQL to Smartscape/dimension filters.

**E13 is distinct from E1 (alerting delivery) and E12 (service detection) — it is about how the
detection rule itself is authored, a layer upstream of both.** E1 measures whether a raised problem
gets *routed* (workflows vs. classic notifications); E12 measures what counts as a *service*; E13
measures whether the rule that *detects the anomaly in the first place* runs on the classic 2nd-gen
metric-events engine or 3rd-gen Davis. Status is free — A13 and A2/A43 are already collected and
already Gen3-first-flagged (probes-config.md) — so this domain adds no new collection for its
✅/💡/⚠️ read, only for its adoption-weight (B49). **Use `dt.settings.schema_id`, never
`event.provider`, to tell classic from Gen3** — `event.provider` names the emitting component, not
the config generation that produced the event, and cannot make this distinction at all.

**Rollup — Migration Completeness %** = **adoption-weighted** mean of *assessable* domains (Complete 100 · In progress 50 · Not started 0; ⚪ excluded from the denominator, never scored 0). Each domain's weight is its **share of the tenant's total active-usage footprint**, not a fixed constant — migration debt in a domain the tenant actually leans on moves the grade; a barely-touched domain barely counts (CLAUDE.md rule 6 at the scoring layer). Footprint proxy per domain: Alerting = problems delivered (D4/EC11/EC16) · Scoping = entities+records scoped (E2 population) · Tagging = records enriched (B5/B30) · Log = **records actually routed (B45)**, A21 as fallback · Dashboarding = real-user Grail dashboard opens (B34) **vs classic opens (B46)** · Automation = workflow executions (A5/EC2) · Apps = real-user app opens (B34-style) · **Extension entity model = extension metric volume (B33, the P1–P4 tiers)** · **SLO = SLOs evaluated/consumed (B25/B35)** · **Integration surface = observed classic-API call volume from customer-authored callers (B43) + flagged authored documents (B44)** · **Access model = groups carrying permissions (B47: classic + policy group totals)** · **Service detection = services actually detected (D1/B7 service census — the topology the rules produce)** · **Custom anomaly-detector framework = event/problem-stream share by schema_id (B49), enabled-count share as fallback**. Intra-domain, E8 rolls up per-extension migration weighted by each extension's metric volume (a not-started P1 hurts far more than a not-started P4). **Fallback** where a proxy is unavailable/zero: the prior fixed weights (Alerting .20 · Scoping .15 · Tagging .15 · Log .15 · Automation .15 · Dashboarding .10 · Apps .10, with Extensions, SLO, Integration surface, Access model, Service detection and the anomaly-detector framework added pro-rata) — say which basis was used in the method note. Weights are **exposed and adjustable**; status rules are unchanged. Grade bands **A ≥ 85 / B ≥ 70 / C ≥ 50 / D < 50** (repo standard). **💡 dual-running domains carry the headline callout** — name the specific classic + native pair coexisting and the double-config / double-cost of leaving both.

**Remediation is mandatory and cited for every domain (spec §8).** Each domain's Path forward is a self-contained **WHY + HOW** runbook tied to the tenant's own counts, grounded in a docs.dynatrace.com page **verified live this run** (the authority) plus the BPN series by code (further reading) — never BPN-only, never a bare pointer. ✅ Complete rows read *"Complete — maintain, no action"* so no item is left without a path. Per-domain remediation-source map (docs topic · BPN code, resolved via [bpn-library.md](bpn-library.md); the run WebFetches and verifies the exact docs URL before citing):

- **E1** → Migrate alerting profiles → workflows; notification workflows · **WFLOW, MZ2POL** (if MZ-scoped), ALERT-01/03/04
- **E2** → Segments; IAM policies / ABAC · **MZ2POL, ORGNZ, IAM**
- **E3** → Tagging (source tags); OpenPipeline enrichment · **FAQ-02, ORGNZ**
- **E4** → OpenPipeline; Classic→OpenPipeline migration · **OPMIG, OPLOGS, OPIPE**
- **E5** → Migrate dashboards / Dashboards app · **DASH, ADOPT-03**
- **E6** → Workflows; AutomationEngine (+ config-as-code) · **AUTOM, WFLOW**
- **E7** → Dynatrace Apps / Hub · **ADOPT, DASH**
- **E8** → Extensions 2.0 / Gen3 extensions; re-save monitoring configs to drop the classic `CUSTOM_DEVICE` backing; network-topology/entity extraction · **ADOPT** (no dedicated extensions series — Hub extension pages + docs.dynatrace.com authoritative)
- **E12** → **Re-scope the flagged rules onto primary tags**: remove management-zone / service-tag / non-`primary_tags.` PG-tag scopes from service-detection, failure-detection, request-attribute and request-naming configurations; reproduce the behavior with primary tags in the Process-group tag field (Dynatrace's own stated rework). Enhanced Endpoints for SDv1 is a separate capability decision, not a rule rewrite · **ADOPT**
- **E11** → **Migrate roles to policies**: move each group off classic RBAC roles onto default policies, and bind the boundary on `dt.security_context` rather than management zones · **IAM, MZ2POL, ORGNZ**
- **E10** → **Retire the classic API/settings dependency**: per caller, the BLOCK endpoints it touches and their successors ([classic-to-native-map.md](classic-to-native-map.md) Table 2); per document, the classic-entity DQL rewrite (the **`dt-migration`** skill does the rewrite) · **ADOPT, AUTOM** (integration re-platforming), **MZ2POL** where the calls are zone/tag settings
- **E9** → **Upgrade Classic SLOs** (metric-expression → DQL SLI; entity-selector → DQL; Upgrading-Metrics table); Service-Level Objectives app · **SLO 01–05**
- **E13** → **Anomaly Detection app → Custom alert → Improve metric events with DQL → select → Transform** — converts the classic metric event directly into a Davis DQL detector and auto-disables the original; a one-click retire-classic/adopt-native step, not a re-architecture · **ALERT-02** (detection decision framework, static vs Davis), **AIOPS** (Davis anomaly detection) — not E1's ALERT-01/03/04, which is routing/notifications, a different topic
- **Overall sequencing** → **ADOPT 01/02/05/06** (roadmap ordering), FAQ-12 (cost-of-inaction framing)

### E2 recipe — comparing management zones against segments (do this, not a count diff)

A zone-count-vs-segment-count comparison is not evidence; it cannot distinguish *"segments have
replaced these"* from *"two systems are genuinely running in parallel"*, and those carry opposite
remediations. Establish the comparison in three steps.

**1. Reduce the zones to dimensions (offline, from A17's saved JSON — no tenant access needed).**
Group `value.rules[].attributeRule.conditions[].tag` by the prefix before `:`. That prefix set *is*
the zone estate's real shape. Report *dimensions*, never zone or rule counts. **Two calibration
rules (2026-07-29, a ~320-zone estate):** (a) **a tag with no `:` separator is a bare tag key —
count it as its own dimension, never collapse it into an empty-string bucket** (live, 59% of ~1,900
conditions carried no separator; the naive prefix grouping folded them all into one `''` key);
(b) **a wide-dimension outcome is a legitimate result, not a failed analysis** — reference estates
collapse to a handful of dimensions, but a live estate resolved to 91 distinct dimensions, and the
**dimension count (not the zone count) is what sizes the migration effort**: a 91-dimension estate
is genuinely large work, and reporting it as such is the finding.

**2. Ask what each segment is defined to return (A6 `variables.value`).** Segments divide into two
kinds and the distinction drives the remediation:
- **Native-dimension segments** filter a real field (`dt.host_group.id`, `k8s.namespace.name`,
  `aws.account.id`, `primary_tags.*`) — the end state.
- **Bridge segments** read a native field and rebuild the legacy tag string, e.g.
  `fieldsAdd tag = concat("App:", primary_tags.application)`. These exist to keep classic-tag
  consumers working *during* cutover and are transitional by construction — flag them as such and
  recommend dropping the `concat` once nothing consumes the rendered tag.

**3. Map dimension → covering segment. The gap list is the finding.** A zone dimension with no
segment is the only real work; a dimension already covered means those zones are retirable.
Live-verified on a reference tenant: three existing segments covered ~93% of the zone estate's
dimensional intent, leaving exactly one uncovered dimension (~7 zones) — a materially different
(and cheaper) conclusion than "120 zones to migrate."

**Then, and only then, measure population.** Definitions say what *should* match; only entity counts
say what *does*:

```
fetch dt.entity.host           | fields mz = managementZones | expand mz | summarize Hosts = count(), by:{mz}
| append [ fetch dt.entity.process_group | fields mz = managementZones | expand mz | summarize PGs = count(), by:{mz} ]
| append [ fetch dt.entity.service       | fields mz = managementZones | expand mz | summarize Services = count(), by:{mz} ]
| summarize Hosts = max(Hosts), PGs = max(PGs), Services = max(Services), by:{mz}
```

**`managementZones` is an array — `expand` it or the grouping is wrong**, silently: without `expand`
you group by the whole membership *combination*, so an entity in three zones yields one row for the
triple rather than one row per zone, and populated zones read as empty. A null column after `append`
means "none of that entity type", not "not measured".

Each zone then lands in one of three buckets, with different remediations: **empty + segment
covers it** → retire, no migration work; **populated + no segment** → the genuine gap, build the
segment; **populated + segment covers it** → true duplication, confirm the counts agree, then retire.

For the segment side, source primary tags from `metrics` rather than the entity tables — that is
where they resolve reliably, and it is what the tenant's own segment definitions do.

### E6 recipe — Automation domain (workflows present AND executing)

Adoption ≠ vanity metric. **Count executions, not workflow objects** (verified live 2026-07-28). The goal is to measure whether automation engine is used. Config population (A4 workflows) is the denominator; runtime execution count (A5 + EC2) is the numerator.

**Steps:**
1. **Get the workflow id set from config** (`A4 dtctl get workflows` → `workflow.id`).
2. **Join to executions** from `A5 dtctl get workflow-executions` → for each workflow id, count `state == SUCCESS` and `state == ERROR` (terminal states). Alternative: query the events table (`EC2 fetch dt.system.events | filter event.kind=="WORKFLOW_EVENT" … | summarize count(), by:{dt.automation_engine.workflow.id}`) — that surface shows only workflows that actually ran. **A5's raw output carries PII (see probes-config.md A5 / security-sensitive-data-policy.md)** — pipe it through [`redact.py`](../.dt-eval-common/redact.py) before writing to `runs/`, same as A2/A43.
3. **Classify per workflow:** "executing (ran ≥1 time in 30d)" vs "dormant (configured, 0 runs)". A dormant workflow = 💡 (in progress), not ⚠️.

Example result: 11 workflows configured, 8 executing = 💡 In progress. All dormant = ⚠️ Not started. All executing = ✅ Complete (+ config-as-code share for automation maturity, but adoption itself is the binary).

### E7 recipe — Apps / UX domain (vendor classification required)

Adoption ≠ app count. **Filter by vendor** to score meaningful adoption (verified live 2026-07-28: large estate had 126 installed apps, 125 dynatrace-first-party, 0 custom-built — a count alone gives the wrong verdict).

**Steps:**
1. **Get the app inventory** (`A10 dtctl get apps` → `id`).
2. **Filter:** `id.startswith("dynatrace.")` = Dynatrace built-in / first-party. Anything else = custom-built or third-party.
3. **Grade on custom/third-party adoption, not raw count.** A tenant with 2 Dynatrace apps + 15 custom = ✅ Complete. A tenant with 50 Dynatrace apps + 0 custom = ⚠️ Not started (vanilla, no self-service app ecosystem).

Example result: 126 installed (125 dynatrace, 0 custom-built) = ⚠️ Not started. Any custom-built presence = 💡 In progress. Both vendor classes represented meaningfully = ✅ Complete.

### E5 recipe — Dashboarding graded on real-user usage, NOT object count (the correction)

**Do not run `dtctl get dashboards | length` and call a high number "Gen3 adoption."** That is the vanity trap that made a report claim Gen3 leverage on a tenant whose people only opened classic dashboards. Grade on **B34**:

1. Run **B34** (real-user, non-Dynatrace interactive Grail engagement) and **drop every `isDynatraceStaff == true` row first** — Dynatrace CSM/support/consulting logins are not customer adoption.
2. Over the remaining real users: distinct real users + the sustained subset (`activeDays >= 10`) = actual Gen3-UX engagement. **Native dashboards present (A8) but near-zero real-user Grail engagement ⇒ ⚠️/💡, never ✅** — the users are on classic (classic dashboards run off-Grail and leave no query trace).
3. Confirm with the classic-dashboard **usage** residue (`popularity`/`lastViewed`, classic config API — verify-live) and **name the Dynatrace-staff share** ("N of M apparently-active users were Dynatrace logins" — why a naive count over-reported).

### E8 recipe — Extension entity model (per-extension, volume-weighted)

**Are entities Gen3-native?** Run **B33** and classify each extension by its `migrationStatus`:

1. **Tally the health line:** `3rd Gen — fully migrated` (✅) vs mid-migration (💡: `Configs not updated` / `Partial — …`) vs `Migration not started` (⚠️). For every mid-migration extension, compute **% migrated = `smartscapeNodes / (smartscapeNodes + classicEntities) × 100`**.
2. **Domain status = volume-weighted, not a row count:** weight each extension's migration state by its `metricCount` (the P1–P4 tier *is* the adoption weight). Nearly all volume on typed nodes (`id_classic` null) = ✅; meaningful classic-backed volume = 💡; high-volume extensions with 0 nodes = ⚠️.
3. **Headline callout (owner's ask):** list every **P1/P2 extension still `Migration not started`** — highest operational risk (biggest footprint, binary not even updated).
4. **Anomalies:** `No data — investigate` rows and Smartscape-only + `metricCount` = 0 (OneAgent/WMI-driven — priority understated), flagged separately, never counted as migrations.

Example shape: 30 extensions — 18 fully migrated, 7 mid-migration (avg 64% configs re-saved), 5 not started of which **2 are P1** → 💡 In progress, with the 2 P1 not-started extensions as the headline risk.

### E9 recipe — SLO model (classic count exact, Gen3 count exact + verify-live)

**Did SLOs get upgraded?** Classic = metric+entity-selector SLI; Gen3 = single-DQL SLI. A3 and A37 are **disjoint populations, not a drill-down of each other** (probes-config.md A3/A37; live 2026-07-29: A3 = 0 while A37 held 278 tuned classic SLOs on the same tenant) — read both, never substitute one for the other.

1. **Classic count (exact):** A37 `builtin:monitoring.slo`.
2. **Platform-native count (exact):** A3 `dtctl get slos` — this is the Gen3 surface, not a second classic read.
3. **Gen3 confirmation (verify-live):** **B35** — resolve the reachable surface (`dtctl get documents` type-filtered · SLO Service Public API · `dt.slo*`-metric tell) to corroborate A3's count where the enumeration surface is otherwise undocumented. If none is reachable, grade on classic residue + confirmed Gen3 presence and **say the native count is verify-live** — never fabricate one.
4. **Status:** classic ∧ 0 Gen3 = ⚠️ · both = 💡 dual-running (name the double-maintenance cost) · only Gen3 = ✅.
5. **Weight by adoption:** SLOs actually evaluated/consumed (burn-rate-wired, B25). 0 SLOs ⇒ ~0 footprint ⇒ E9 does not drag the grade. Path forward = the docs "Upgrade Classic SLOs" runbook.

### E13 recipe — Custom anomaly-detector framework (status free, weight is not)

**Is custom detection authored on the classic engine or Gen3 Davis?** Classic = `builtin:anomaly-detection.metric-events`; Gen3 = `builtin:davis.anomaly-detectors`.

1. **Status (no new collection):** A13 enabled count (classic) vs A2/A43 enabled count (Gen3). 0 enabled A13 ∧ native detectors active = ✅ · both active = 💡 dual-running · A13 active ∧ 0 native = ⚠️. A tenant with 0 custom detectors of either kind is not a special case — it just carries ~0 footprint in step 3, the same as a 0-SLO tenant on E9.
2. **Do not weight by enabled-count alone.** A disabled clone family and a firing one count identically by enabled-count — the same distortion B34 corrected for dashboard object counts.
3. **Weight by adoption (B49):** the schema's share of the 30-day `dt.davis.events` stream (`legacy_share_pct`). Fall back to the enabled-count share from step 1 if B49 is unavailable — the domain's status is unaffected either way, only the precision of its weight.
4. **Path forward:** Anomaly Detection app → Custom alert → *Improve metric events with DQL* → select → Transform. This converts the classic config directly into a Davis DQL detector and auto-disables the original — a one-click retire-classic/adopt-native step, not a re-architecture, which typically pulls this domain earlier in the Now/Next/Later sequencing than domains needing a rebuild.
