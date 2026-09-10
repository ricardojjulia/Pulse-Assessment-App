# Effective Consumption — KPI query catalog

A validated DQL implementation of the *Effective Consumption* model (Signals / Automation /
Foundation / Engagement + Overall Effective Score). This is the analytics companion to the
configuration review: the config probes (§A/§B in [probes-config.md](probes-config.md) / [probes-grail.md](probes-grail.md)) measure *what is set up*;
these KPIs measure *whether the platform is actually being consumed effectively* — automation that
executes, self-service that is distributed, problems that are useful, and data that is queried.

**Provenance.** Every query below was run read-only against a live reference tenant
(30-day windows) on 2026-07-10; the calculation-upgrade queries (CCS, outlier fence, EUB)
were validated against the same tenant on 2026-07-14. The reference values in each *Validated* line
are that tenant's actual numbers — they anchor the query shape, not a target. The seed query
(self-service score) is the customer-supplied original; the rest were built to match its pattern and
validated the same way.

## Computability legend

Not every KPI in the source notebook is fully derivable from Grail. Each is tagged:

| Tag | Meaning |
|---|---|
| ✅ **Computable** | Fully derivable from Grail system/Davis/entity tables via DQL alone. |
| 🟡 **Partial** | The core is computable; one input needs an external system or a config cross-check (e.g. ticketing, entity coverage). The query computes what it can and the missing input is stated. |
| 🔧 **Definition-gated** | Computable *once the customer defines the standard* (required tag keys, id/env/owner regex). The notebook itself flags these "D1 needed". Ships with a parameterised skeleton. |

Partial and definition-gated KPIs follow the skill's ⚪ rule: **excluded from the OES denominator,
never scored as 0.**

## KPI → source → status → validated value

| # | KPI | Source table(s) | Status | Validated (reference, 30d) |
|---|---|---|---|---|
| 6+7 | Self-Service Score (SSU⊕COC blend, seed query) | `dt.system.query_executions`, `dt.system.events` | ✅ | 66/100 |
| 7 | COC — Config Ownership Concentration (HHI) | `dt.system.events` AUDIT | ✅ | 0.287 (evenness 0.79) |
| 6 | SSU — Self-Service Utilization | `dt.system.events` AUDIT + IAM | 🟡 | 0.55 (needs admin list to split non-admin) |
| 4 | WFR — Workflow Follow-Through Rate | `dt.system.events` WORKFLOW | ✅ | 33.9% |
| 5 | WOS — Workflow Ownership & Success | `dt.system.events` WORKFLOW + `get workflows` | ✅ | 0.30 composite; true ownership 0.244 (22/90) |
| 2 | PUI — Problem Usefulness Index | `dt.davis.problems` | ✅ | 0.47 |
| 1 | SQI — Signal Quality Index | `dt.davis.problems` + WORKFLOW + `get workflows` | 🟡 | workflow leg 0% (dead problem→wf lane); ticket leg needs ITSM |
| 3 | SQ-BLP — Signal Quality / Billing-Linked Presence | `dt.davis.problems` + `dt.entity.*` | 🟡 | actionability leg computable; coverage needs entity census |
| 8 | QEI — Query/Active Engagement Index (from CQR) | `dt.system.query_executions` | ✅ | sustained-engagement rate; reference 0.53 (10/19); NOT bucket diversity |
| — | CCS — Config-as-Code Share | `dt.system.events` AUDIT | ✅ | 0.008 (2/253 token-driven, 1 token actor) — click-ops signature |
| — | CCS-Q — Config-as-Code **Quality** (decomposed) | `dt.system.events` AUDIT | ✅ | a large-estate tenant: **0.0** where raw CCS said ~0.84 — the raw share was integration churn |
| — | FPR — Automation Footprint Rate | `dt.system.events` WORKFLOW + `get workflows` | ✅ | the large estate: 0% event-driven of a few thousand runs; 9 workflows / a large host estate |
| — | SMX — Signal Modernity | `dt.davis.problems` | ✅ | the large estate: 0.29 (71% of ~30k problems = CUSTOM_ALERT) |
| — | AIC — AI/Intelligence Consumption | `dt.system.events` ANALYZER + GENAI | ✅ | the large estate: ~14k analyzer runs/30d (36% with warnings); ~1.3k CoPilot invocations |
| — | QEC — Query Economics | `dt.system.query_executions` | ✅ | the large estate: multi-petabyte scanned/30d (PB-scale), ~100% on-demand, 25× ingest (context KPI) |
| — | EUB — Expected-Users Baseline | `dt.entity.*` + `dt.system.query_executions` | 🟡 | ~26 expected vs 20 actual ≈ 77% (✅ band); persona-count estimate |
| 12 | Noise / Friction penalties | `dt.davis.problems` + WORKFLOW | 🟡 | dup 0.2%, 40% under maintenance; reopen/ticket/TSG N/A |
| 9 | SCI — Standards Consistency Index | `dt.entity.*` | 🔧 | mechanics ok (tags 100%, host-group 50%) |
| 10 | FCS — Foundational Configuration Score | `dt.entity.*` + config | 🔧 | see Gen3-first caveat |
| 11 | MCS — Metadata Consistency Score | `dt.entity.*` | 🔧 | needs id/env/owner patterns |
| — | OES — Overall Effective Score | rollup | ✅* | 54/100 (Foundation excluded, reweighted) |

---

## 1. Self-Service Score — the seed query (✅)

*Blends SSU participation with COC evenness, then applies a scale gate against a 20%-of-eligible
target. This is KPIs 6 and 7 fused into one operational score — the customer-supplied original,
validated unchanged.*

```
fetch dt.system.query_executions, from:now()-30d
| summarize totalEligibleUsers = countDistinct(user.id)
| append [
    fetch dt.system.events
    | filter event.kind == "AUDIT_EVENT" and isNull(authentication.token)   // exclude API-token/automation actors
    | filter isNotNull(details.dt.settings.object_summary)                  // settings changes only
    | filterOut in(user.id, {"UNKNOWN", "system"})
    | summarize changes = count(), by:{user.id}
    | summarize totalChanges = sum(changes),
                participatingUsers = countDistinct(user.id),
                hhi = sum(changes*changes) / (sum(changes) * sum(changes))
  ]
| summarize totalEligibleUsers = max(toDouble(totalEligibleUsers)),
            totalChanges = max(toDouble(totalChanges)),
            participatingUsers = max(toDouble(participatingUsers)),
            hhi = max(toDouble(hhi))
| fieldsAdd hhi_Normalized = (hhi - 1/participatingUsers) / (1 - 1/participatingUsers)
| fieldsAdd participationRate = participatingUsers/totalEligibleUsers
| fieldsAdd participationRateCapped = if(participationRate > 1, 1, else: participationRate)
| fieldsAdd evenness = 1 - hhi_Normalized
| fieldsAdd selfServiceScore = round((0.3*participationRateCapped + 0.7*evenness)*100),
            targetUsers = totalEligibleUsers*.2,
            dailyChanges = round(totalChanges)/30
| fieldsAdd scaleScore = if(participatingUsers > targetUsers, 1, else: participatingUsers/targetUsers)
| fieldsAdd selfServiceTargetScore = round(selfServiceScore * scaleScore)
```

**Validated (reference):** 29 eligible users, 10 participants, HHI 0.287, evenness 0.79, participation 0.34,
`selfServiceScore` **66**, `scaleScore` 1.0, `selfServiceTargetScore` **66**.

**Validity notes / refinements**
- `isNull(authentication.token)` is the load-bearing filter — it removes token/automation-driven
  changes so the score reflects *human* self-service. Terraform/Monaco changes carry a token and are
  correctly excluded. To measure automation coverage separately, invert the filter.
- `hhi_Normalized` divides by `(1 - 1/participatingUsers)`; with a single participant this is 0/0 →
  null. Guard for tiny estates: `if(participatingUsers <= 1, 1, else: <expr>)`.
- **Denominator refinement.** `countDistinct(user.id)` over *all* query executions counts internal
  service actors that run under a user identity (anomaly detectors, etc.). For a cleaner "eligible
  humans" pool add `| filter isNull(client.internal_service_context)` to the first fetch — on the
  reference tenant this moves eligible users 29 → 20 and lifts participation to 0.55.

---

## 2. COC — Config Ownership Concentration (✅)

*Herfindahl index over config changes per user. Low = distributed ownership (good). The notebook's
`OwnershipIndex = 1 − COC` is the positive input to OES. Extend the same pattern to actors on Davis
anomaly detectors and workflows.*

```
fetch dt.system.events, from:now()-30d
| filter event.kind == "AUDIT_EVENT" and isNull(authentication.token)
| filter isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN", "system"})
| summarize changes = count(), by:{user.id}
| summarize COC = sum(changes*changes)/(sum(changes)*sum(changes)),
            participants = countDistinct(user.id),
            totalChanges = sum(changes)
| fieldsAdd OwnershipIndex = 1 - COC
```

**Validated (reference):** COC **0.287**, OwnershipIndex **0.713**, 10 participants, 237 changes.
Target: COC ≤ 0.4.

**The `filterOut in(user.id, {"UNKNOWN","system"})` fence is load-bearing — the token filter alone
does NOT isolate humans** (neither actor carries a token; live 2026-07-28: 66% of token-less changes
were `UNKNOWN` — the unfenced HHI was badly skewed, the fenced read showed a healthy 15-actor spread).
And when `UNKNOWN` *dominates* config changes, report that as its own governance finding
(unattributed configuration change) — fencing it out of the math never means dropping it from the story.

**Outlier guard (apply before COC/SSU/QEI — validated 2026-07-14).** A single automation actor
running under a user identity (terraform-runner, monaco service account) can produce more audit
events than every human combined, making the human distribution invisible and HHI meaningless. Before
computing any actor-distribution KPI, fence outliers at **`median + 3×IQR`** over the per-actor
counts:

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNull(authentication.token) and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize changes=count(), by:{user.id}
| summarize users=count(), p25=percentile(changes,25), p50=percentile(changes,50), p75=percentile(changes,75), maxChanges=max(changes)
| fieldsAdd outlierFence = p50 + 3*(p75 - p25)
```

**The volume fence NOMINATES candidates — it never decides alone (correction, 2026-07-28).** An
actor above `median + 3×IQR` is excluded only when it **also** matches a machine signature: for
query KPIs the EC15 test (1–3 distinct `client.client_context`, tool-named context, and/or
near-uniform inter-query timing); for audit KPIs the config-as-code signature (token identity, 1–2
schemas hammered daily). **A high-volume actor with high context diversity is a power user — retain
and credit them; they are the adoption the KPI exists to measure.** Applied as volume-only, the
fence removed a reference tenant's four heaviest users — all named humans on 10–19 distinct days
with 289–3,137 distinct contexts each — and dropped QEI from 0.179 to 0.115: the adoption metric
lowered *because* the estate has power users, an inversion of its purpose. Actors that pass both
tests are **named in a side-note, excluded from the human-engagement math** (COC/SSU/self-service),
and **counted toward the automation story** (CCS below) — they are usually misclassified
config-as-code, not a self-service participant. Recompute the KPI on the fenced list (pull the
per-actor rows from the EC1 raw file; the fence itself is one cheap query).

**Validated (reference):** 11 users, median 7.8, IQR 41.4 → fence ≈ 132; max actor 85 → **no outliers
fenced** — COC stands as computed. (The rule matters on estates where it *does* trip; report "no
outliers fenced" as method color, don't invent one.) The same fence applies to any hotspot list
(top config types touched, top buckets queried, top users by change count).

---

## 2b. CCS — Config-as-Code Share (✅) — the automation-side complement to COC

*COC/SSU measure the **human** half of config change (token actors deliberately excluded). CCS
measures the other half: what share of all config changes is **token-driven** (Terraform / Monaco /
API) — the config-as-code signature. Nirvana is a tenant under source control: **CCS ≥ 0.7** with
humans making declarative-drift changes on top. Low CCS + high human change volume = a click-ops
estate where every change is manual, unreviewed, and unreproducible.*

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize total=count(), tokenDriven=countIf(isNotNull(authentication.token)),
            tokenActors=countDistinct(if(isNotNull(authentication.token), user.id)),
            humanActors=countDistinct(if(isNull(authentication.token), user.id))
| fieldsAdd CCS = round(toDouble(tokenDriven)/toDouble(total), decimals:3)
```

**Validated (reference, 2026-07-14):** 253 changes, 2 token-driven, 1 token actor, 11 human actors →
**CCS 0.008** — a click-ops estate (target ≥ 0.7). This is a real ⚠️ finding: no config-as-code
means no review trail, no reproducibility, and config drift that only surfaces in the next incident.

**Report the THREE-WAY actor split — named human / token-driven / unresolved — never a binary
human-vs-token one (2026-07-29).** The `filterOut in(user.id, {"UNKNOWN","system"})` fence above is
load-bearing: run without it, every unresolved actor lands in the "human" bucket (live: a "2,034
human changes" read was 605 named humans + 1,429 `UNKNOWN`/`system` changes — taken at face value it
supports "all configuration changes are made by named humans", false for two thirds of them). Record
all three counts in the probe summary, and **cross-assert against EC1: EC8's named-human count
exceeding EC1's fenced human count is a probe error to fail loudly on, not a discrepancy to
average away.**

**Service-actor breadth (secondary read):** distinct token actors ≥ 5 = ✅ healthy automation
diversity, 2–4 = 💡, 0–1 = ⚠️ (no config-as-code practice). Actors fenced by the outlier guard above
join this count.

**Feeds the Automation pillar** alongside WFR/WOS (see the OES section — the pillar composition
change is flagged there). `countDistinct(if(cond, field))` counts non-null branches only —
validated; no else-branch needed.

---

## 2c. CCS-Q — Config-as-Code **Quality** (✅) — always decompose before crediting CCS

*Raw CCS is quality-blind: any token-driven change counts, so one integration hammering one
settings type reads as a config-as-code practice. **Owner correction (2026-07-14, large estate):**
raw CCS ~0.84 decomposed into 4,213 OneAgent-update writes (one token, 4 days) + ~4,900
maintenance-window writes (~80/day, two tokens) + OS-service tweaks — **zero declarative-config
actors**. The estate was a maintenance-window factory, not a CaC practice, and the report
mislabeled it "automation excellence". Never report raw CCS without this decomposition.*

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNotNull(authentication.token) and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize n=count(), days=countDistinct(toString(bin(timestamp,1d))), by:{user.id, schema=details.dt.settings.schema_id}
| sort n desc | limit 15
```

**Classification per token actor (judgment, from the schema×actor×cadence shape):**
- **Declarative CaC signature:** breadth ≥ ~5 distinct schemas per actor, batchy cadence
  (bursts on change days, quiet between), settings families that map to app/team monitoring
  (detectors, dashboards, SLOs, notifications). These count toward CCS-Q.
- **Integration churn signature:** 1–2 schemas hammered daily/continuously (maintenance
  windows, agent-update state, os-services) — an external system writing operational state
  through the settings API. Counts toward *automation volume*, **never** toward CaC.

`CCS-Q = declarative token-driven changes / all config changes`. The large estate: **0.0**; a genuine
Terraform/Monaco estate scores what raw CCS suggests. **CCS-Q replaces raw CCS in the
Automation pillar** (composition upgrade 2026-07-14b, flagged in the method note like its
predecessors); raw CCS stays as the collection query (EC8) feeding the decomposition (EC10).
A high-volume maintenance-window writer is additionally its own hygiene finding — cross-check
against the noise KPI's `underMaint` share (windows written daily while 0% of problems fire
under maintenance = windows that may scope nothing).

---

## 4b. FPR — Automation Footprint Rate (✅) — reliability of what runs ≠ automation maturity

*WFR is scale-blind: it grades whatever executed. Nine scheduled platform-tending jobs at 98.9%
on a large (10k+-host) estate is a rounding error scored as excellence (the large-estate miss). FPR asks
what share of automation is driven by what the platform observes.*

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
| dedup {dt.automation_engine.workflow_execution.id}, sort:{timestamp desc}
| summarize runs=count(), eventDriven=countIf(dt.automation_engine.workflow_execution.trigger.type=="Event"),
            scheduled=countIf(dt.automation_engine.workflow_execution.trigger.type=="Schedule"),
            manual=countIf(dt.automation_engine.workflow_execution.trigger.type=="Manual")
| fieldsAdd FPR = round(toDouble(eventDriven)/toDouble(runs), decimals:3)
```

**FPR = event-driven share of terminal runs** (problem-attached runs, via the EC7 id-set stitch,
are the strongest subset). Report next to *scale context*: executing workflows vs services/hosts
(a judgment line, not a ratio with a magic target). The large estate: **FPR 0.0** — 100% Schedule/Manual;
automation tends the platform, not the estate. Targets: ≥ 0.3 of runs event/problem-driven = ✅;
0 with a large problem stream = ⚠️ regardless of WFR.

**A zero must carry its verification, or it cannot be averaged (rule, 2026-07-29).** FPR 0.0 halves
the Automation pillar, and the skill's own ⚪ rule says a *non-measurement* is excluded, never
scored 0 — so `run.json` must record which one this was: EC2/EC14's summary carries
`trigger_type_populated: true|false` (true = the by-trigger grouping returned real, non-null trigger
classes — a verified zero that stands; false = the fields were null and the fallback below applies).
**Never average FPR as 0 unless `trigger_type_populated` is true**; the same applies to CCS-Q
(record `token_actor_check: true` when the token/schema decomposition actually ran). On the pillar
this decides, live, between Automation ≈ 40 (verified zeros) and ≈ 80 (⚪-excluded) — a future
reader of `run.json` must be able to tell which was measured. **This zero also triggers the A4b
configured-vs-executed hard gate** (probes-config.md A4b): event-driven = 0 while deployed event-triggered
workflows exist is a delivery-failure finding, not just a maturity score.

**Fallback when the runtime trigger fields are null (validated live 2026-07-28).** On some tenants
`…workflow_execution.trigger.type` (and the execution id — see the §4 dedup guard) is unpopulated on
every `WORKFLOW_EXECUTION` event; the query above then returns one null-keyed group and FPR cannot be
computed as written. Attribute the **task-level** events by workflow title instead, and join the
titles to the A4/EC7 config trigger classification:

```
fetch dt.system.events, from:now()-30d
| filter event.kind == "WORKFLOW_EVENT" and in(event.type, {"TASK_EXECUTION", "ACTION_EXECUTION"})
| summarize n = count(), by:{dt.automation_engine.workflow.title}
| sort n desc
```

(The task-level `event.type` has been observed as `ACTION_EXECUTION` on one tenant (2026-07-10) and
`TASK_EXECUTION` on another (2026-07-28) — filter for either.) Each title's task volume inherits the
trigger class of its configured workflow (live: one event-driven alert-routing workflow at ~38k tasks
vs ~450 tasks across seven scheduled workflows → **FPR 98.9% by task volume**). **State the basis** —
this weights by task volume, not run count; a chatty workflow weighs more. Side benefit: the title
list surfaces **executed-but-no-longer-configured workflows** (titles absent from `get workflows` —
deleted or renamed inside the window; live: 8 executing titles vs 7 configured). That is the EC7
stitch's inverse direction — a governance signal the config surface cannot see (automation ran that
nobody can now inspect or re-run); report it alongside configured-but-never-executed. **The forward
direction is not just governance — it is the delivery-failure detector** (2026-07-29): a workflow
configured `isDeployed` + event-triggered (A4) with zero executions here is a live alert-delivery
outage or unretired config; probes-config.md A4b makes that comparison a mandatory hard gate whenever both
surfaces were read.

---

## 3. SSU — Self-Service Utilization (🟡 — needs admin list)

*Share of configurators who are non-admins. The configurator/participation half is computable; the
"non-admin" split requires the IAM admin roster (`dtctl get groups`/`get users` → members of
admin/owner groups). Without it, SSU degrades gracefully to participation rate (configurators /
eligible users), which is what the seed query already uses.*

```
// participation form (no admin list) — this is what OES uses by default
fetch dt.system.query_executions, from:now()-30d
| filter isNull(client.internal_service_context)
| summarize eligibleUsers = countDistinct(user.id)
| append [
    fetch dt.system.events
    | filter event.kind == "AUDIT_EVENT" and isNull(authentication.token) and isNotNull(details.dt.settings.object_summary)
    | filterOut in(user.id, {"UNKNOWN","system"})
    | summarize configurators = countDistinct(user.id)
  ]
| summarize eligibleUsers = max(eligibleUsers), configurators = max(configurators)
| fieldsAdd SSU = toDouble(configurators)/toDouble(eligibleUsers)
```

**Validated (reference):** eligibleUsers 20, configurators 11, **SSU 0.55** (target ≥ 0.5).
**To reach the true definition:** supply an `adminUserIds` list (from IAM) and compute
`nonAdminConfigurators / totalConfigurators`.

---

## 4. WFR — Workflow Follow-Through Rate (✅)

*Reliability of automation end-to-end. Uses only terminal (`state.is_final`) execution events,
deduped by execution id so multi-state transitions don't double-count.*

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
| dedup {dt.automation_engine.workflow_execution.id}, sort:{timestamp desc}
| summarize triggered=count(), completed=countIf(dt.automation_engine.state=="SUCCESS")
| fieldsAdd WFR = round(100.0*toDouble(completed)/toDouble(triggered), decimals:1)
```

**Validated (reference):** hundreds of thousands of terminal runs, ~34% succeeded → **WFR 33.9%** (target ≥ 85%). A low
value here is a real finding — this tenant has heavy scheduled- and event-triggered failure volume.

**Dedup guard (universal, learned live 2026-07-28): a dedup that drops more than ~90% of rows means
the KEY is wrong or unpopulated on this tenant — not that the data collapses.** The execution-id
field is not populated on every tenant's workflow events: one live estate returned ~17.5k
`WORKFLOW_EXECUTION` events that a `dedup {<execution id>}` collapsed to **one row** — WFR would
have been computed from n=1 and reported as a confident percentage. Before trusting any dedup,
compare `countDistinct(<key>)` against `count()`; if the key is unpopulated, switch to the
**count-by-final-state fallback (validated same day)** — no dedup at all, state does the work:

```
fetch dt.system.events, from:now()-30d
| filter event.kind == "WORKFLOW_EVENT" and event.type == "WORKFLOW_EXECUTION"
| summarize n = count(), by:{dt.automation_engine.state, dt.automation_engine.state.is_final}
```

`WFR = SUCCESS / (SUCCESS + ERROR)` over the `is_final==true` rows (live: ~8.8k final runs —
8,727 `SUCCESS` · 39 `ERROR` → **WFR 99.6%**; `RUNNING` is non-final and stays out of the
denominator). The two methods agree when the id key is populated; the fallback is also the cheaper
first read on an unfamiliar tenant.

**Problem-attached WFR (config cross-reference, validated).** The runtime `trigger.type` values are
`Schedule` / `Event` / `Manual` — there is no distinct "Davis problem" runtime trigger, so
problem-attachment can't be isolated from events alone. Get the id set from config —
`dtctl get workflows -o json`, classify `.trigger.eventTrigger.triggerConfiguration.type ==
"davis-problem"` — then filter events to `in(dt.automation_engine.workflow.id, {<ids>})`.

**On the reference tenant this produced the sharpest finding of the whole pillar:** 5 workflows are configured with a
davis-problem trigger, but **not one has a single execution in 30 days** — their ids do not appear in
the workflow-event stream at all, against **~30k problems**. The config explains why: 4 of the 5
are `isActive:false` (one isn't even deployed), and the lone active one still never fired. This is a
**"defined ≠ delivering"** break that *neither surface shows alone* — config says one is active;
events show nothing — only the stitch reveals the dead alerting→automation chain. Always run this
cross-check and name the offending workflows.

---

## 5. WOS — Workflow Ownership & Success (✅, ownership approximated)

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
| dedup {dt.automation_engine.workflow_execution.id}, sort:{timestamp desc}
| summarize triggered=count(), completed=countIf(dt.automation_engine.state=="SUCCESS"),
    workflows=countDistinct(dt.automation_engine.workflow.id),
    actors=countDistinct(dt.automation_engine.workflow_execution.actor)
| fieldsAdd WOS_Success = toDouble(completed)/toDouble(triggered)
| fieldsAdd WOS_Ownership = if(toDouble(actors)/toDouble(workflows)>1.0, 1.0, else: toDouble(actors)/toDouble(workflows))
| fieldsAdd WOS_Composite = round(sqrt(WOS_Ownership*WOS_Success), decimals:3)
```

**Validated (reference):** 42 workflows, 11 distinct actors, success 0.34 → ownership 0.26,
**WOS_Composite 0.30**.

**The executable authority for this composite is `scoring_engine.wos_composite(ownership, success)`**
(the geometric mean `sqrt(ownership × success)`, matching the DQL above) — build scripts call it,
never re-derive the formula from prose. This is codified because "Ownership × Success composite"
alone admitted two defensible readings (product vs arithmetic mean) whose difference moved the
Automation pillar across a meaningful part of a grade band on a live run.

**Config cross-reference — true ownership (validated).** `workflow_execution.actor` is the *runner*,
not the configured owner, and events only see workflows that *ran*. The authoritative ownership comes
from the config: `dtctl get workflows -o json` carries `owner` / `ownerType` per workflow. On the reference tenant:
**22 distinct owners / 90 configured workflows = 0.244** true ownership index (vs the runtime-actor
proxy 0.26) — and the config population (90) is more than double what actually executed (42), so ~48
workflows are configured but dormant. Owner concentration is also visible here (top owner holds
35/90) — compute an owner HHI the same way as COC for a config-side concentration read. **Use config
ownership as the WOS_Ownership input; keep the runtime actor only as a fallback when config is
unreadable.**

---

## 6. PUI — Problem Usefulness Index (✅)

*Weighted: root cause present (0.4), impact spans >1 entity (0.3), actionable (0.3). Problems are
deduped by `display_id` (the table carries one record per status transition).*

```
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| fieldsAdd rc = if(isNotNull(root_cause_entity_id) or isNotNull(root_cause.smartscape_entity.id), 1.0, else: 0.0)
| fieldsAdd im = if(arraySize(affected_entity_ids) > 1 or arraySize(smartscape.affected_entity.ids) > 1, 1.0, else: 0.0)
| fieldsAdd ac = if(dt.davis.mute.status=="NOT_MUTED" and dt.davis.is_duplicate==false and dt.davis.is_frequent_event==false, 1.0, else: 0.0)
| summarize problems=count(), rootCauseRate=avg(rc), impactMultiRate=avg(im), actionableRate=avg(ac)
| fieldsAdd PUI = round((0.4*rootCauseRate + 0.3*impactMultiRate + 0.3*actionableRate), decimals:3)
```

**Check the classic field and its 3rd-gen Davis equivalent together** (field-team, verified live 2026-08-05) — `root_cause_entity_id`/`affected_entity_ids` are classic and deprecating; a tenant migrated to 3rd-gen Davis populates only `root_cause.smartscape_entity.id`/`smartscape.affected_entity.ids` instead, and the classic-only read silently returns 0% with no error. Full writeup: [dt-eval-prob/probes.md](../dt-eval-prob/probes.md) P4.

**Validated (reference):** ~30k problems, root-cause 43%, impact-multi 0.7%, actionable 99.8% →
**PUI 0.47** (target ≥ 0.7). The near-zero impact-multi rate (almost every problem hits exactly one
entity) is itself a finding — it usually means topology/Smartscape linkage is shallow or detectors
are per-entity static thresholds rather than Davis correlation.

**Actionability proxy.** The notebook defines actionability as "has ticket or workflow"; without
ticketing that leg is proxied by not-muted / not-duplicate / not-frequent (i.e. a problem worth
acting on). Refine with `labels.alerting_profile` (a non-Default profile ⇒ routing was configured).

---

## 6b. SMX — Signal Modernity (✅) — what kind of problems fill the stream

*PUI says whether problems are useful; SMX says why they aren't. A problem stream dominated by
`CUSTOM_ALERT` (ported static/threshold alerts) structurally cannot deliver Davis root cause —
the low-PUI diagnosis lives here, alongside the monitoring-mode split (B3).*

```
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| fieldsAdd dur_min = (toLong(event.end) - toLong(event.start))/60000000000.0
| summarize problems=count(), med_dur_min=median(dur_min), p90_dur_min=percentile(dur_min,90),
            nonDefaultProfile=countIf(isNotNull(labels.alerting_profile) and labels.alerting_profile!="Default"),
            by:{event.category}
| sort problems desc
```

`SMX = 1 − CUSTOM_ALERT share`. A large-estate tenant: **0.29** (~70% = CUSTOM_ALERT, tens of thousands of problems) — the
migration anti-pattern measured from the problem stream itself, corroborating a static-detector
config read without needing one. The same query yields two bonus reads: **per-category duration**
(the large estate: AVAILABILITY p90 ≈ 11.5 h — long-lived availability problems) and **routing-intent
coverage** (`labels.alerting_profile` non-Default share; the large estate: 100% — intent fully configured).
Cross-check routing intent against *delivery*: profiles all set + 0 classic notification configs
(`dtctl get notifications`) + 0 problem-triggered workflow runs = **routing intent orphaned** —
and say explicitly that an external system polling the problem API would be invisible to every
in-tenant surface. **SMX joins the Signals pillar**: `Signals = mean(PUI, SMX)` (composition
upgrade 2026-07-14b, flagged in the method note).

**Title-pattern corroboration (EC16 — owner request 2026-07-14).** Group the deduped problems by
`event.name` and read repetition, convention, and offenders:

```
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| summarize n=count(), by:{title=event.name}
| sort n desc | limit 20
```

Few distinct titles for many problems = the same rules breaching over and over — the platform run
as a threshold pager, "basically another monitoring tool". Severity-in-title prefixes
(`APP|MAJOR|`, `INFRA|MINOR|`) = an imported rule library; their problem share should ≈ the
CUSTOM_ALERT share — the match is the proof (the large estate: 712 prefixed titles = 70.6% of problems vs
CUSTOM_ALERT 70.9%; 1,813 titles / ~30k problems ≈ 18 each; top 10 titles = 47%, one Lambda
error rule alone = 20%). The top-count titles are the tuning worklist — name them in the report.

---

## 6c. AIC — AI/Intelligence Consumption (✅) — is the AI tier being used, and is it healthy

*Two surfaces nothing else in the model reads: `ANALYZER_EXECUTION_EVENT` (the Gen3 Davis
analyzers actually executing — the runtime twin of the A43/A45 config reads) and `GENAI_EVENT`
(Davis CoPilot invocations — organic AI adoption).*

```
fetch dt.system.events, from:now()-30d
| filter event.kind=="ANALYZER_EXECUTION_EVENT"
| summarize n=count(), warn=countIf(dt.analyzer.result_status=="SUCCESSFUL_WITH_WARNINGS"),
            failed=countIf(dt.analyzer.result_status=="FAILED"), by:{name=dt.analyzer.name}
| sort n desc

fetch dt.system.events, from:now()-30d
| filter event.kind=="GENAI_EVENT"
| summarize invocations=count(), activeDays=countDistinct(toString(bin(timestamp,1d)))
```

Read as: analyzers executing = the AI tier is *on* (✅ presence); a large
`SUCCESSFUL_WITH_WARNINGS` share = it runs degraded (💡 — typically sparse/short-history inputs;
a large-estate tenant: 36% overall, 48% on AutoAdaptive) — `result_status` is three-valued, **warnings are
not failures**, don't report them as errors. CoPilot invocations (the large estate: ~1.3k over 21 active
days) are adoption color for the Engagement narrative — cultivate, don't score into OES yet.
GenAI events carry no populated `user.id` (anonymized) — count volume and days, never "users".

**Zero `ANALYZER_EXECUTION_EVENT` rows is NOT evidence the AI tier is idle.** Verified live
2026-07-28: a tenant running 100+ enabled detectors continuously returned **no** analyzer-execution
events at all — whether because the `StaticThreshold` analyzer doesn't emit them or the surface is
gated, the absence is about the *event stream*, not the analyzers. Before writing anything like
"the AI tier is unused", cross-check detector evaluation in the query ledger:

```
fetch dt.system.query_executions, from:now()-30d
| filter contains(toString(client.client_context), "anomaly-detectors")
| summarize queries = count(), gb = round(sum(scanned_bytes)/1073741824.0, decimals:1)
```

Millions of detector-context queries (see §9c — on that tenant they were ~97% of ALL query
executions) prove the analyzers run constantly. Zero on **both** surfaces = genuinely idle; zero on
the event surface alone = the analyzer-*health* read (warnings share) is ⚪ for this tenant, while
AI-tier *presence* is established from the query ledger.

---

## 7. SQI — Signal Quality Index (🟡 — workflow leg only)

*`(ValidAlerts / TotalProblems)` where ValidAlerts = accepted tickets + completed problem-triggered
workflow runs (no rollback). The **ticket** term needs an external ITSM feed (or a bizevent/log
stream carrying ticket-creation events); the **workflow** term is computable via the problem-attached
WFR set from KPI 4. Report the workflow leg and mark the ticket leg "requires ITSM integration".*

```
// workflow leg: problems that led to a completed, problem-triggered workflow run
// (requires the davis-problem workflow-id set from `dtctl get workflows`)
fetch dt.davis.problems, from:now()-30d | dedup {display_id} | summarize totalProblems = count()
| append [
    fetch dt.system.events, from:now()-30d
    | filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
    | filter in(dt.automation_engine.workflow.id, { /* davis-problem workflow ids */ })
    | dedup {dt.automation_engine.workflow_execution.id}
    | summarize completedProblemRuns = countIf(dt.automation_engine.state=="SUCCESS")
  ]
| summarize totalProblems = max(totalProblems), completedProblemRuns = max(completedProblemRuns)
| fieldsAdd SQI_workflow_leg = round(100.0*toDouble(completedProblemRuns)/toDouble(totalProblems), decimals:1)
```

**Validated (reference):** with the 5 davis-problem workflow ids injected, `completedProblemRuns` = **0**
against ~30k problems → **SQI workflow leg 0.0%**. Consistent with the problem-attached-WFR finding
(KPI 4): the problem→workflow lane is configured but dead, so *zero* problems are being resolved
through automation.

**Status:** the workflow leg is fully computable via the config-id cross-reference; the **ticket** term
remains out of scope without ITSM. Report the workflow leg (it's a real, strong signal here) and mark
the ticket leg as the remaining ⚪ input — SQI is not fully scored until an ITSM feed is available.

---

## 8. SQ-BLP — Signal Quality / Billing-Linked Presence (🟡 — coverage leg)

*`CoverageRatio × ActionabilityRate`. Actionability = KPI 6's `actionableRate` (computable). Coverage
= consuming entities / total entities — approximate from the entity census: e.g. hosts in Full-Stack
mode vs all hosts, or services emitting data vs all services. It needs an entity-type census, so it's
partial.*

```
// coverage leg example: fraction of hosts actually monitored (mode != infrastructure-only proxy)
fetch dt.entity.host
| fieldsAdd consuming = if(monitoringMode == "FULL_STACK", 1.0, else: 0.0)
| summarize CoverageRatio = avg(consuming)
// multiply by actionableRate from KPI 6 to get SQ-BLP
```

**Status:** coverage is a modelling choice (which entity types count as "consuming"); document the
definition per engagement. Marked partial; excluded from OES until the coverage definition is fixed.

---

## 9. QEI — Query/Active Engagement Index (✅; DPS ratio is 🟡)

*The notebook offers CQR = DPS/Queries (lower better) → QEI = 1 − min(CQR/CQR_max, 1). A single "DPS"
number isn't exposed. **Do NOT proxy QEI with bucket/table diversity** — an earlier version did, and
it is actively misleading: diversity trivially maxes out (any estate where someone touches ~15
buckets scores 1.0) while completely missing whether people **sustainably** use the data at the scale
it is produced. On a large estate that produced the classic false positive — high data volume, a
handful of real users, "engagement" scored 1.0 (see field-notes).*

**QEI measures sustained active engagement**: of the humans who query at all, what share do so
regularly (on ≥10 distinct days in the window). It answers "is the data actually worked, or is it
shelfware?" rather than "did anyone touch many datasets."

```
fetch dt.system.query_executions, from:now()-30d
| filter isNull(client.internal_service_context) and query_pool != "AUTOMATION"   // human interactive queries
| filterOut in(user.id, {"UNKNOWN","system"})
| filterOut endsWith(lower(coalesce(user.email,"")), "@dynatrace.com")            // exclude Dynatrace staff (see below)
| summarize activeDays = countDistinct(toString(bin(timestamp, 1d))), queries = count(), by:{user.id}
| summarize activeUsers = count(),
            sustainedUsers = countIf(activeDays >= 10),
            oneOrTwoDayUsers = countIf(activeDays <= 2),
            medianActiveDays = median(activeDays),
            totalQueries = sum(queries)
| fieldsAdd QEI = round(toDouble(sustainedUsers)/toDouble(activeUsers), decimals:3)
```

**Exclude Dynatrace-internal humans, not just machine actors (owner correction 2026-07-28).** The
`internal_service_context` / `AUTOMATION` fences remove pollers and automation but **not** Dynatrace
employees (CSM / support / consulting) who log into the tenant and query — their activity is not
*customer* adoption, and counting it over-reports engagement (the same defect that made a Gen3 report
over-claim leverage). The `@dynatrace.com` `user.email` filter above removes them everywhere QEI is
computed (and B34 for Gen3 usage); it is a heuristic — extend the list for partner/MSP domains. Report
the excluded share as its own line ("N of M apparently-active users were Dynatrace logins"). Note
`countDistinctIf` does not exist — split in one pass with `countDistinct(if(cond, user.id))`.

**Validated (reference):** 19 active users, 10 sustained (≥10 days) → **QEI 0.53**. **Validated (large
estate):** ~450 active users but only ~50 sustained and 60% one-or-two-day → **QEI 0.11** — thin,
concentrated engagement the old diversity metric had scored 1.0.

**Read alongside scale.** QEI as a rate captures "even the active users are one-off." Also weigh it
against estate size — ~50 sustained users for a large host estate is a second, qualitative signal of
shelfware (host/org headcount isn't in Grail, so state this as context, not a computed term). **Do
not** use scanned-bytes-vs-ingest as the engagement signal: repeated/broad scans inflate it (one
large estate scanned 25× its ingest while only ~50 people were sustained users).

**Optional CQR ratio (🟡).** For a true consumption-to-query ratio, divide ingest by human queries:
`timeseries ingest=sum(dt.billing.logs.ingest.usage_by_product), from:now()-30d` (reference: ~hundreds of GB/30d)
÷ human queries. Label the result *derived* and single-capability (logs only).

**Machine-actor fence for QEI (2026-07-14, large estate).** `isNull(client.internal_service_context)`
does NOT exclude external tools polling under a user identity — an external SLO platform ran tens of
thousands of queries over ~2 weeks through one user and landed in the *sustained* numerator. Audit the top QEI
actors before reporting:

```
fetch dt.system.query_executions, from:now()-30d
| filter isNull(client.internal_service_context) and query_pool != "AUTOMATION"
| summarize q=count(), days=countDistinct(toString(bin(timestamp,1d))), contexts=countDistinct(client.client_context), by:{user.id}
| sort q desc | limit 10
```

**Machine signature:** high volume + tiny `contexts` count + a tool-named `client.client_context`
(each interactive app card produces a distinct context, so humans show tens-to-hundreds; pollers
show 1–3). Fence matches out of active/sustained, name them in the method note, and count them as
integration consumption. Human power users (hundreds of contexts) stay — **volume alone NEVER
fences a QEI actor; the signature test decides** (§1 candidate-selector rule). In the 3–10-context
grey zone, examine the context *names* (tool-named vs app cards) and inter-query timing regularity
before fencing; when still ambiguous, retain the actor and note the ambiguity — a mis-fenced human
lowers the adoption score precisely because the estate has engaged users (a recorded live fence of
an actor with 6 distinct app contexts over 10 active days was a human, misclassified against the
fence's own 1–3 signature).

---

## 9c. QEC — Query Economics (✅, context KPI — never an OES input)

*QEI counts people; QEC weighs what their querying costs. `scanned_bytes.on_demand` separates
scans not covered by included query capacity — the consumption-spend side of engagement.*

```
fetch dt.system.query_executions, from:now()-30d
| filter isNull(client.internal_service_context)
| summarize queries=count(), scanned_pb=round(sum(scanned_bytes)/1e15, decimals:2),
            ondemand_share=round(sum(scanned_bytes.on_demand)*1.0/sum(scanned_bytes), decimals:3),
            by:{src=client.client_context}
| sort queries desc | limit 12
```

Read as: total scanned vs 30-day ingest gives the scan-to-ingest ratio (a large-estate tenant: **multi-petabyte
scanned (PB-scale) ≈ 25× the monthly ingest, ~100% on-demand**) — high ratio + low sustained-user count =
few people re-scanning broadly (dashboards on wide timeframes, unbounded queries), a cost finding
the engagement rate alone hides. `client.client_context` also yields the **consumption source
mix** (inventory/app cards vs notebooks vs workflow-DQL vs API): many users on passive card reads
with few DQL authors = GUI-consumer estate — engagement depth color beyond day-counts. QEC is
**context for Engagement, never an OES input** (it's a cost shape, not a maturity score).

**Never publish a raw scanned-bytes total — split by initiator first.** The query above already
fences platform-internal executions; if you compute an *unfenced* total for the full picture, split
it (`isNotNull(client.internal_service_context)` / `query_pool` / `client.client_context`) before
any figure leaves your notes: live 2026-07-28, a 30-day unfenced total of ~5.3 PB across ~53M
executions read as runaway user query cost until the split showed ~99% was platform-internal
detector evaluation — which is the **running cost of the ported detector library**, a finding that
cross-correlates with D5/the noise report, not with user behavior. Same number, opposite story.

**The detector query-cost join — name what the internal share actually is (validated live
2026-07-28; the strongest single bridge between this review and the noise report):**

```
fetch dt.system.query_executions, from:now()-30d
| filter contains(toString(client.client_context), "anomaly-detectors")
| summarize queries = count(), gb = round(sum(scanned_bytes)/1073741824.0, decimals:1)
```

Live, on a tenant with ~110 static custom detectors: detector evaluation was **~97% of all query
executions and ~47% of all scanned bytes** (≈12.7k GB of a ≈27k GB 30-day total). That converts the
qualitative "too many hand-written detectors" finding into a measured consumption fact — the
detector library isn't just noisy, it is the majority of the tenant's query workload — and gives the
`/dt-eval-prob` consolidation plan (§4 drill-downs) a sized cost lever. Generalizes:
`client.client_context` carries the originating surface for *every* execution, so the same join
sizes dashboards, notebooks, apps, workflow-DQL, and external pollers individually.

---

## 9b. EUB — Expected-Users Baseline (🟡 — persona-count estimate)

*QEI says what share of active users is sustained; EUB answers the prior question — **is the active
population itself the right size for this estate?** The estate's shape implies an expected persona
population; compare it to the actual distinct query users. It is an **estimate** — say so in the
report — but it turns "20 active users" from a bare count into a judgment.*

**Baseline persona-count assumptions** (override in `standards.<tenantId>.json` → `personaCounts`;
these defaults are deliberately rough):

| Estate signal | Persona | Assumed count |
|---|---|---|
| per `dt.entity.service` | Developers | 0.3 (≈3 services per dev) |
| per `dt.entity.host_group` | SRE / Ops | 1 |
| per web/mobile application entity | App Owners | 1 |
| per SLO defined (A3) | SRE | 0.5 |
| per cloud connector (A28) | Cloud Admins | 2 |
| flat, if AppSec billing ≠ 0 | Security | 2 |

```
// estate shape (cheap entity counts) — actual users comes from the QEI query's denominator
fetch dt.entity.service | summarize n=count() | fieldsAdd entityType="service"
| append [fetch dt.entity.host_group | summarize n=count() | fieldsAdd entityType="host_group"]
| append [fetch dt.entity.application | summarize n=count() | fieldsAdd entityType="web_application"]
| append [fetch dt.entity.mobile_application | summarize n=count() | fieldsAdd entityType="mobile_application"]
| fields entityType, n
```

**Bands:** actual/expected < 30% = ⚠️ *platform closed to its consumers* (few admins pulling all
levers); 30–70% = 💡 *opportunity to open access*; 70–130% = ✅ *platform open, personas on it*;
> 130% = baseline under-estimates this org (contractors, ML-ops) — note as color, don't over-credit.

**Validated (reference, 2026-07-14):** 77 services (→ ~23 devs) + 2 host groups (→ 2 SRE) + 1 web app
(→ 1 owner) ≈ **26 expected** vs **20 actual** active query users ≈ 77% → ✅ band. (SLO/cloud/security
terms not included in this validation — add them when the A3/A28/B14 counts are in the run.)

**Status: 🟡 estimate.** EUB is **context for QEI, not an OES input** — it rests on assumptions, and
the OES stays clean of assumed terms. When the customer supplies real platform-team headcount (a
standards-file input), the comparison firms up and can be reported without the estimate caveat.

---

## 10. Noise / Friction penalties (🟡)

```
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| summarize problems=count(),
    duplicates=countIf(dt.davis.is_duplicate==true),
    frequent=countIf(dt.davis.is_frequent_event==true),
    muted=countIf(dt.davis.mute.status!="NOT_MUTED"),
    underMaint=countIf(maintenance.is_under_maintenance==true)
| fieldsAdd duplicateRate=round(100.0*toDouble(duplicates)/toDouble(problems),decimals:2)
| fieldsAdd frequentRate=round(100.0*toDouble(frequent)/toDouble(problems),decimals:2)
| fieldsAdd maintenanceRate=round(100.0*toDouble(underMaint)/toDouble(problems),decimals:1)
// workflow rollback proxy: ERROR share of terminal runs (see KPI 4)
```

**Validated (reference):** duplicate 0.2%, frequent 0%, muted 0%, **40% of problems fired under a
maintenance window** (a strong noise/coverage-window signal). **NoisePenalty** for OES uses
`duplicateRate + frequentRate` (rollback added from workflow ERROR share).

**Not derivable:** `ReopenRate` — the status-transition values are `CLOSED`/`UPDATED`/`REFRESHED`,
no `REOPEN`; `TicketPerProblem` and `NumberOfTSG` need ITSM/runbook systems. Marked N/A.

---

## 11–13. Foundation KPIs — SCI / FCS / MCS (🔧 definition-gated) + Gen3-first caveat

The mechanics are proven (`tags`, `hostGroupName`, `monitoringMode` are direct fields on
`dt.entity.host`; reference: 10 hosts, 100% tagged, 50% host-grouped). What's missing is the **customer's
definition of "required"** — which tag keys, which id/env/owner patterns. Ship these parameterised.

```
// SCI skeleton — mean coverage of required dimensions (parameterise the required set)
fetch dt.entity.host
| fieldsAdd hasTags = if(arraySize(tags) > 0, 1.0, else: 0.0)
| fieldsAdd hasHostGroup = if(isNotNull(hostGroupName), 1.0, else: 0.0)
| summarize tagCov=avg(hasTags), hgCov=avg(hasHostGroup)
| fieldsAdd SCI = (tagCov + hgCov)/2.0   // add MgmtZone/CMDB dimensions once defined

// MCS skeleton — shared-field presence + pattern compliance (supply the regex)
fetch dt.entity.host
| expand tags | parse tags, "LD:key ':' LD:val"
| fieldsAdd envMatch = if(matchesPhrase(val, "prod") or matchesPhrase(val,"dev") or matchesPhrase(val,"qa"), 1.0, else: 0.0)
| summarize ...   // per required pattern
```

### 11a. Foundation baseline — scoreable WITHOUT the standards file (EC17, owner request 2026-07-14)

Full SCI/MCS pattern compliance stays definition-gated, but the **baseline-minimum standard** does
not: every estate should identify *application*, *organization/division/LOB*, and *environment*
(or equivalents), have host groups actually defined, and have segments that work against those
dimensions. Three cheap reads:

```
// 1. tag-KEY inventory — look for the app/org/env key FAMILIES (names vary per estate)
//    Run for EACH of dt.entity.host, dt.entity.service, dt.entity.process_group — see scope rule below
fetch dt.entity.host
| expand tags | parse tags, "LD:key ':' LD:val"
| summarize hosts = countDistinct(id), by:{key}
| sort hosts desc | limit 30

// 2. host-group coverage (KPI-11 skeleton) + name sample for an encoding convention (B6)
// 3. segment inventory: dtctl get segments -o json → run each `variables` DQL, count rows (A6)
```

**Scope rule — coverage spans host + service + process_group, NEVER host-only (correction,
2026-07-28).** ABAC scoping, chargeback, and ownership routing key on the full entity set, and
tagging that stops exactly at the host boundary is a common, load-bearing failure shape that
host-only scoring averages away. Compute the baseline-key coverage ratio across all three entity
types (the same uniform read B30 uses — `fieldsAdd t = toString(tags)` + `contains()` per type,
`append` + `sum()` to roll up), and **record the per-entity-type breakdown in the probe summary**
so the boundary is visible. When the host-side and below-host readings diverge materially, the
deliverable reports **both** readings and names the boundary as the finding. Live case (reference
tenant): hosts ~79% cost-center-tagged, services and process groups **0%** — host-only Foundation
read 0.81 while the full-scope read was 0.59, moving the OES a full grade band; the host-only
number was arithmetically right and diagnostically wrong.

**Two methods, one canonical (verified live 2026-07-28 — they disagree by 40%).** The `expand tags`
read above counts **tag instances** (an entity carrying two spellings of a key family counts twice);
the `fieldsAdd t = toString(tags) | countIf(contains(t, "<key>"))` form counts **entities**. Live,
on the same 57 hosts: 52/57 by expand vs the true **37/57** by entity count. Every coverage *ratio*
in `Foundation_baseline` (and anything compared against B30, which the report cites) MUST use the
`toString(tags)` entity-count form — that is the canonical method. Keep `expand tags | parse` for
key-family **inventory** only (discovering *which* keys exist and their spelling variants), never
for a coverage denominator.

`Foundation_baseline = mean(baseline-key coverage, host-group coverage, segment-effectiveness
share)` — baseline-key coverage measured across host + service + process_group per the scope rule
above — **this joins the OES as the Foundation pillar** (composition upgrade 2026-07-14c; the
0.20 weight returns to the denominator; flag in the method note). Validated (large estate):
`HGApp`/`HGDiv`/`HGEnv` on ~84.5% of hosts across a large (10k+-host) estate (derived from a `<app>.<env>.<division>`
host-group naming convention), host-group coverage 84.3%, 16 of 17 segments effective (tested:
Environment → 6 values, Application → 1,459, host-group → 3,308) → **0.87 — a real strength the
blanket ⚪ had hidden**. Name the residual findings: uncovered share, parallel conventions for one
concept (`HG*` vs `[Environment]primary_tags.*` vs `[VMware]*`), case-duplicate host groups,
placeholder segments. When the customer later supplies the real standards file, SCI/MCS refine
this baseline — they don't replace it.

> ### ⚠️ Gen3-first caveat (skill hard rule) — read before scoring Foundation
> The source notebook's FCS rewards **management zones** and **classic tags mapped**. The dt-eval-tenant
> skill's Gen3-first rule (see SKILL.md, Phase 4) says **never score the absence of a Gen2/classic
> construct as a gap.** Management zones, classic auto-tags, and alerting profiles are *inventory*:
> their presence signals migration debt, their absence is clean. So when folding Foundation into this
> tenant review:
> - **Reframe FCS to platform-native foundations:** host groups, **segments**, **buckets**, and
>   **source tags** (deployment/K8s/cloud tags + pipeline enrichment) — *not* MZ count or classic-tag
>   mapping.
> - A tenant with 0 MZs but segments + source tags scores **high** on foundation, not low.
> - SCI/MCS pattern compliance is measured on **Grail governance fields / source tags**, the surfaces
>   Gen3 features actually read (B5 in probes-grail.md), not on classic entity tags that don't propagate.

---

## OES — Overall Effective Score (✅, one-query rollup)

The capstone. Combines the computable pillars, excludes partial/definition-gated inputs from the
denominator (⚪ rule) and reweights, applies the noise penalty. **Validated end-to-end on the reference tenant → OES 48.**
See [effective-consumption-notebook.json](effective-consumption-notebook.json) for the importable,
sectioned version; the single-query rollup lives there too.

### Weighting — a documented ambiguity in the source

The source notebook states two different weight sets:

| | Signals | Automation | Foundation | Engagement |
|---|---|---|---|---|
| Prose ("Weights sum = 1.0") | 0.35 | 0.20 | 0.10 | 0.35 |
| Code block (`RawScore_0_1`) | 0.35 | 0.35 | 0.20 | 0.10 |

These conflict on Automation/Foundation/Engagement. **This catalog defaults to the code-block
weights** (they appear in the executable formula) and exposes them as notebook variables so the
customer can switch. The prose weighting arguably better matches the notebook's own narrative (which
elevates *Engagement*/query trends); flag the choice when presenting.

Two more items the source under-specifies and this catalog makes explicit:
- **NoisePenalty** — applied as `OES = RawScore × (1 − NoisePenalty)`, with
  `NoisePenalty = min(noisePenaltyCap, duplicateRate + frequentRate + workflowRollbackRate)` — each
  term a *proportion* (0.02 = 2%), cap default **0.5** (override via `targets.noisePenaltyCap` in the
  standards file).
- **Foundation gate** — mentioned but never defined. Implemented as: if `Foundation_idx` is available
  and `< 0.5`, cap OES at 70 (a broken foundation caps the ceiling). When Foundation is excluded
  (definition-gated), the gate is inactive and the denominator drops the 0.20 weight.
- **Automation pillar composition (upgraded 2026-07-14)** — CCS joins the pillar:
  `Automation = mean(WFR, WOS_Composite, CCS)`. The source model never measured the config-as-code
  half of automation; a tenant whose workflows succeed but whose every config change is click-ops is
  not automation-mature. This is a deliberate composition change from the source — flag it in the
  method note like the weight-profile choice, and expose it as a variable (`targets.includeCCS`,
  default true).
- **Scale-and-quality composition (upgraded 2026-07-14b, owner correction)** — the prior
  composition still over-credited a tenant whose 9 scheduled tending jobs ran reliably and whose
  token-driven changes were integration churn ("automation excellence" on an estate that wasn't).
  Current composition: **`Automation = mean(WFR, WOS_Composite, FPR, CCS-Q)`** — raw CCS is
  replaced by decomposed CCS-Q (§2c) and the footprint rate FPR (§4b) joins, so reliability can no
  longer carry the pillar alone. **`Signals = mean(PUI, SMX)`** — the modernity term (§6b) makes
  the CUSTOM_ALERT-dominance diagnosis part of the score, not just narrative. QEI applies the
  machine-actor fence (§9) before counting sustained users. AIC (§6c) and QEC (§9c) are reported
  context, not OES inputs. Flag every one of these in the method note when comparing against a
  pre-upgrade score.
- **Foundation baseline joins the OES (upgraded 2026-07-14c, owner request)** — the
  baseline-minimum metadata standard (§11a: app/org/env key families, host-group coverage, segment
  effectiveness) is computable without the customer standards file, so Foundation is no longer
  blanket-⚪: score `Foundation = Foundation_baseline`, return the 0.20 weight to the denominator,
  and footnote that SCI/MCS pattern compliance still awaits the customer's own standard. Only when
  even the baseline is unreadable (entity tables denied) does Foundation revert to ⚪/reweighting.

### Normalization

Each KPI is mapped to [0,1] as a raw signal (not divided by target — targets inform the grade bands,
not the score): rates stay as-is; percentages ÷ 100; HHI → `OwnershipIndex = 1 − HHI`. Grade bands
mirror the rest of the skill: **A ≥ 85, B ≥ 70, C ≥ 50, D < 50.** The reference tenant's OES 48 = **D** (Foundation
excluded). **Verbal labels:** A *Excellent* · B *Strong* · C *Building* · D *Foundational* (external);
internal-audience reports add the lifecycle read per [report-audiences.md](../.dt-eval-common/report-audiences.md).

### Confidence flags (per pillar, carried beside every score)

Every pillar score is reported with a confidence flag so a thin denominator can't masquerade as a
firm grade:

- **High** — all major inputs computable, denominators (users / problems / executions) ≥ 100.
- **Medium** — one or two ⚪ inputs excluded, or denominators 30–100.
- **Low** — denominators < 30, or a majority of the pillar's inputs ⚪. Score it, but the report must
  say so; internal-audience reports treat a Low-confidence bad score as a *scope-more* ask, not a
  finding.

Report-level confidence = the lowest pillar flag. (reference: Engagement runs on 19–20 users → Medium-Low;
Problems runs on 35k → High. The composite OES inherits the caveat.)

### Rollup shape

`append` one row per pillar, `summarize max()` to collapse, then derive. Full query in the notebook
JSON and reproduced in [probes-consumption.md](probes-consumption.md) (§D). Validated reference row:

```
SSU 0.55 · COC 0.287 · WFR 0.34 · WOS 0.30 · PUI 0.47 · QEI 0.53 (10/19 sustained) · NoisePenalty 0.002
Signals 0.47 · Automation 0.48 · Engagement 0.53  →  OES 48 (Foundation ⚪)
```

**Upgraded composition, recomputed (2026-07-14):** with CCS 0.008 in the pillar,
`Automation = mean(0.34, 0.30, 0.008) = 0.22` → **OES 37 (D)**. The 11-point drop against the same
tenant is the upgrade working as intended: the original score credited automation that succeeds when
it runs while ignoring that *nothing about how the tenant is configured is automated*. Present the
composition choice in the method note whenever comparing against a pre-upgrade score.

---

## Trend variants — direction, not just level

Every KPI above is a 30-day *level*. The source model's own language is directional ("trending up",
"declining QoQ"), and a level alone can't tell a chronic problem from a fresh regression. Add a
weekly `bin(timestamp, 7d)` grouping to any KPI to get its trajectory — the `bin`+`summarize` form
yields the metric line directly (charts as a line in a notebook; the array-based `makeTimeseries` is
fine too but needs per-element division for ratios).

```
// WFR weekly trend
fetch dt.system.events, from:now()-30d
| filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
| dedup {dt.automation_engine.workflow_execution.id}, sort:{timestamp desc}
| fieldsAdd ok = if(dt.automation_engine.state=="SUCCESS",1.0,else:0.0)
| summarize triggered=count(), completed=sum(ok), by:{week=bin(timestamp,7d)}
| fieldsAdd WFR_pct = round(100.0*completed/toDouble(triggered),decimals:1)
| sort week asc
```

**Validated (reference):** WFR held **32–37% every week** across the window — *chronic*, not a regression.
That single fact rewrites the recommendation: not "find what broke last week" but "this automation
was never wired to succeed." PUI was likewise stable at ~0.47. This is the payoff of trending.

**Trend classification (report the trajectory next to the level, in these terms):**

- **Chronic** — the KPI misses its target every week of the window (the reference tenant's WFR above). This is the
  baseline, not an incident: the recommendation is *activate*, never *restore*, and "what changed?"
  is the wrong question.
- **Regression** — a drop of ≥ 15 points (on the 0–100 scale, or the proportional equivalent) inside
  the window. Fresh and urgent: ask what changed, check `history` on the touched configs.
- **Improving** — a rise of ≥ 15 points inside the window. Credit it explicitly ("momentum is on
  your side") — a report that only names decay teaches readers to ignore it.

**Low-sample caveat (partially addresses the confidence-flag gap).** Ratio KPIs on small
denominators are noisy at weekly granularity — the reference tenant's weekly COC swings 0.31→0.5 purely because
partial first/last weeks have 2–3 participants (HHI is unstable on tiny n). **Trend only the KPIs
whose weekly volume is adequate, and always carry the per-bucket count** (`participants`, `problems`,
`triggered`) next to the ratio so a spike from thin data is visible. Don't narrate a weekly move on a
handful of events.

## Standards input — closing the definition-gated KPIs (SSU / SCI / FCS / MCS)

The four gated KPIs are all blocked on the same missing thing: the customer's *definition of "good"*.
Supply it once per tenant in **[standards.example.json](standards.example.json)** → copy to
`standards.<tenantId>.json`, fill in with the customer. An unfilled file leaves these KPIs ⚪
(excluded from OES) — the tool never guesses a standard.

**SCI mechanism (validated).** The standards file lists `requiredTagKeys`; two cheap probes measure
coverage; the analysis layer computes `SCI = mean over the required set of (hosts carrying key /
total hosts)`, filling **0 for a required key with no coverage** (the trap: a missing key produces no
row, so averaging present-only rows overstates SCI).

```
fetch dt.entity.host
| summarize totalHosts = count()
| append [
    fetch dt.entity.host
    | expand tags | parse tags, "LD:key ':' LD:val"
    | filter in(key, {"Team","dt.owner","environment"})   // <- requiredTagKeys.host from standards file
    | summarize hostsWithKey = countDistinct(id), by:{key}
  ]
```

**Validated (reference)** with required `{Team, dt.owner, environment}`: Team 10/10, dt.owner 10/10,
**environment 0/10 (no row)** → `SCI = (1.0 + 1.0 + 0.0)/3 = 0.67`. Averaging only the present keys
would wrongly report 1.0 — the zero-fill is load-bearing.

- **SSU non-admin split**: with `adminUserIds` (or members of `adminGroups`) supplied, SSU becomes the
  true `nonAdminConfigurators / allConfigurators`; empty → falls back to participation-rate SSU.
- **MCS**: `metadataPatterns` regexes give `PatternCompliance = values matching / values present`;
  combine with shared-field presence per the KPI 11 skeleton.
- **FCS / normalization / weights**: `targets` overrides the hard-coded constants (QEI's 15-bucket
  diversity target, the 20% self-service scale gate, the noise cap, the CCS ≥ 0.7 token-share target,
  the outlier-fence multiplier, `includeCCS`) so the score is tenant-size-aware;
  `oesWeights.profile` resolves the code-vs-prose weight conflict explicitly per engagement.
- **EUB**: `personaCounts` overrides the baseline persona-count assumptions (§9b) with the customer's
  own ratios — or a flat `expectedUsers` headcount, which removes the estimate caveat entirely.

**Gen3-first still governs the standard:** list source tags / host groups / segments as the required
surfaces — never management-zone membership or classic-tag mapping.

## How this feeds the executive review

- **Report type is asked upfront, every run (Phase 0 input #5, SKILL.md):** *Configuration Review*
  (§D never runs), *Effective Consumption* (§D runs alone, plus a small A4/B1/B3/B7 cross-correlation
  set — no Configuration Review is produced this run). Effective Consumption is **always standalone** — never combined with the Configuration Review. Each report runs independently. Effective Consumption's standalone document is a
  "Dynatrace Effective Consumption Review" `.docx` with the OES as its own cover grade, scoped entirely
  to consumption — and that mode asks a follow-up: whether to also write the importable companion
  notebook. Choose Effective Consumption when the config/best-practices audience and the adoption/value
  audience differ, or the engagement itself is scoped to adoption/value alone. An engagement that needs
  both documents runs the skill twice against the same tenant (the second invocation resumes the first's
  `run.json` at no re-collection cost).
- **Scorecard treatment:** the review is scored from the ✅ KPIs, with partial/
  definition-gated KPIs in the appendix footnotes (the scope/definition needed to include them next
  time) — identical treatment to ⚪ telemetry gaps.
- **Gen3-first governs Foundation** — reframe FCS/SCI/MCS to platform-native surfaces; never
  recommend creating classic constructs.
- **Cross-correlation is the payoff:** WFR 34% *next to* 42 workflows that mostly fail on schedule,
  PUI 0.47 *because* impact-multi is ~0 (shallow topology or per-entity static thresholds), high QEI
  *validating* that the ingested data is actually trusted — and CCS 0.008 *next to* a healthy WFR
  would mean the automation that exists works but nobody automates the platform itself. These causal
  links are the narrative.
- **Audience (the `(Internal)` deliverable variants, Phase 0 input #5 Deliverables) shapes the voice, never the math** — see
  [report-audiences.md](../.dt-eval-common/report-audiences.md). Internal-audience runs additionally surface the OES
  derivation table, per-pillar confidence flags, talk-track & expansion hooks, the ⚪ input roster
  with verbatim asks, and the **rate-card consumption depth** table graded on the nirvana-hit levels
  in [rate-card.md](rate-card.md) (⚪ when `dt.billing.*` isn't readable).
- Client-facing hygiene unchanged for external runs: state *what* was measured and the window; keep
  probe ids, table names, and internal weighting-decision notes out of the deliverable.
