# `/dt-eval-mz2seg` — Management Zones → Segments Migration Plan

**What it answers:** *Exactly how does this tenant get from management zones to segments — zone by zone, consumer by consumer, in what order?*

A standalone skill producing an **execution-grade migration plan**. Where the Gen3 Migration Progress report grades the scoping domain with a status, this deliverable is the worklist a team executes: every zone dispositioned, every blocked consumer listed, every missing segment specified, every step sequenced and cited.

The framing matters in both directions: a tenant with **zero management zones is already done** — that reads as "Complete — maintain," never as an empty result. And a tenant with hundreds of zones usually is **not** facing hundreds of migrations — reducing zones to their scoping *dimensions* typically collapses the estate to a handful of real gaps.

---

## What is measured

Ten analysis stages over (mostly) already-collected read-only probes:

| Stage | Question | Source |
|---|---|---|
| **Dimension map** | What does the zone estate *really* discriminate on? Zones are reduced to condition families — host-group pins, name patterns, tag keys, k8s/cloud metadata — with agent/system-noise exclusion regexes flagged as hygiene, not scoping intent | Zone definitions (cached) |
| **Tag provenance** | For every tag dimension the zones depend on: is that tag **source-propagated** (a primary Grail tag, segment-ready today), **context-imported** (platform metadata — segment on the native field, never the rendered string), or **classic and not propagated** (the source tag must be established first)? A token present on a fraction of a percent of the fleet is not propagation | Auto-tag rules + classic entity tags + one new propagation census |
| **Auto-tag rule disposition** | Every classic auto-tagging rule on the tenant, dispositioned from its own **body** rather than its name — most produce no key any zone filters on, and are invisible to a zone-by-zone plan while still having live consumers. Names the **dependency cascade** (rules that read other tags, in the order they can be re-sourced, and any cycle with no valid order), the mechanics **segments do not reproduce** (relationship propagation, computed values), and the rules that are **retired rather than migrated** | Auto-tag rule bodies + a tag-consumer census across zones, alerting profiles, metric events, maintenance windows and segments |
| **Segment classification** | Which existing segments are the end state (native-dimension), which are transitional (bridge segments re-rendering legacy tag strings), which are rot-prone snapshots (static pinned lists)? | Segment definitions (cached) |
| **Coverage map** | Which dimensions are covered, bridged, or genuinely uncovered? Each uncovered dimension gets a concrete proposed segment spec | Stages 1 × 2 |
| **Population census** | Which zones actually contain entities — versus definitions that merely say they should? | One new live entity-table read (cost-trivial) |
| **Query-activity census** | Is anyone actually *querying* this zone? The platform keeps its own per-zone query counter, so "nobody uses this" is a measurement rather than an inference — and it catches consumers the configuration side structurally cannot see, such as a classic dashboard filter or an integration passing a zone as a parameter | One new counter read, over a stated window |
| **Consumer census** | What breaks if a zone disappears? MZ-bound alerting profiles, problem notifications, metric-event scopes, auto-tag feeds, IAM bindings — each with its platform-native cutover target | Alerting/notification/tagging/IAM probes (cached) |
| **Job classification** | Which of a zone's three possible jobs is it doing — restricting who may **read** (→ IAM policy + security-context boundary), scoping what a user **sees** (→ segment), or deciding who gets **paged** (→ problem-triggered workflow)? Per-group bindings are usually unreadable, so a second, independent read of the platform's own access model establishes whether classic role bindings exist *at all*. It never resolves which zone a binding scopes — so the access job is reported **measured-but-unresolved, never assumed filter-only**, and it never releases a retirement: replacing an access-bearing zone with a segment alone is a security regression | IAM groups (cached) + IAM readiness snapshot + consumers + population |
| **Zone effectiveness** | Which zones actually earn a place in the target model? Verdicts: dead · populated-but-unreferenced (**measured**, not inferred — no configured consumers *and* no query activity in the stated window) · hygiene-only · value-of-a-shared-dimension (the family collapses to ONE segment with a variable) · effective. The headline becomes **N zones → M worth keeping → K segments**, with a sprawl warning past eight | Stages 1+4+4b+5 combined |
| **Conversion blockers** | Which zones cannot convert one-to-one, and why? Four documented platform constraints (segments cannot express exclusions; includes are `=`/`in()` only; only security context and the two cost keys reach service metrics; entity includes alone do not filter the problem feed) plus the two alerting dead ends — detected per zone, designed around rather than discovered mid-cutover | Zone definitions + segment/workflow limits |

Every zone then lands in exactly one disposition: **Retire now** (empty, no consumers) · **Retire after cutover** (covered, consumers to rehome) · **Build then retire** (populated, dimension uncovered) · **Investigate** (conflicting signals — named, never silently dropped, including zones whose bound alerting profiles can never fire because the zone matches nothing). **No retirement is final while a zone's access job is unmeasured.** Four docs-verified conversion blockers (exclusions, substring matching, the derived-data key gap, problem-view includes) and the two alerting dead ends (duration filters have no successor; four destinations have no native connector) are detected per zone and sequenced in the plan.

The tag-provenance stage is what orders the remediation: segments and IAM policies key on **primary Grail tags**, so a dimension whose tag exists only on classic entities needs the source tag established *before* a segment can carry it. Classic auto-tag rules are never the target of new work — they retire with the generation that created them.

**The anti-vanity rule built in:** on real estates the consumer cutover — not the segment authoring — is the bulk of the work. Field-validated on a de-identified reference estate: roughly 300 zones reduced to a handful of dimensions, most already covered by existing segments, while the real workload was the several hundred management-zone-bound alerting profiles and their notification chains. A plan that counts zones and skips consumers is not a plan.

---

## How results are summarized

- **Headline numbers, deliberately not a grade** (so the family's grades option, off by default on customer-facing editions since 2026-08-25, changes nothing here — there was never a letter to withhold)**:** **Dimensional coverage %** (share of the estate's scoping intent already covered by segments, population-weighted) and **Retirable now** (zones with no population and no consumers). A plan's headline is the size of the remaining work.
- **Consumers to rehome** — the honest bulk-of-work number, by consumer class, worst-first.
- Scope gaps (e.g. classic-dashboard filter usage, per-group IAM bindings that no available access can resolve to a zone) are appendix footnotes with the access that would include them — never scored, never silently dropped.

---

## What you get

1. **`<tenantId>-mz2seg-migration-plan-<date>(vN).docx`** under `<output-root>/<customer-name>/current/` — cover with the two headline numbers · executive summary · zone effectiveness (the *not-1:1* headline, `N zones → M worth keeping → K segments`) · which job is each zone doing · target architecture & enablement · the dimension map · conversion blockers · segment build specs · consumer cutover plan · zone disposition worklist · sequenced Now/Next/Later runbook · verification queries · appendix.
2. **`<tenantId>-mz2seg-disposition-<date>(vN).xlsx`** (default on) — the full per-zone worklist as a working sheet, because a several-hundred-row worklist is operated from a sheet, not prose.

**The plan is an enablement document, not just a worklist.** A management zone did four jobs at once; the report opens its guidance with the four-layer target architecture that splits them apart, drawn with this tenant's own posture filled in:

1. **Metadata at source** — primary Grail tags and OpenPipeline enrichment (the foundation everything else keys on)
2. **Storage — Grail buckets** — retention differentiation, coarse access isolation, and query-scan pruning; a capability zones never had, assessed from the tenant's bucket posture and recommended for design alongside the segment rollout when the estate runs default-only (buckets bind at ingest — late design means re-ingest or wait)
3. **Access — IAM policies** on security context and bucket permissions (with the explicit statement that **segments are not an access boundary** — a segment hides data from view; only a policy withholds it from query)
4. **View — Segments** — the dynamic filtering layer users actually see

**Alerting profiles and notifications migrate by delivery target, never 1:1.** The engine groups every classic notification by its normalized destination (recipient set, webhook endpoint, integration) — on a reference estate, ~900 notifications collapsed to ~400 targets and hundreds of webhook copies pointed at a single ITSM endpoint, i.e. one parameterized problem-workflow. The plan inventories profile → zone → severity → destination offline, designs one workflow per target, ports the hidden semantics (severity thresholds, closed-problem notification, maintenance-window expectations), and parallel-runs before any classic notification is disabled. Additional consideration areas ship in the same section: MZ-scoped metric events and maintenance windows (both silently stop working when their zone retires), dashboard zone filters, IAM group bindings, and cost-allocation/chargeback continuity.

**Every section ends in a runbook, not a verdict** — WHY (including the cost of inaction: zones rot as the estate changes, dual-running doubles every scoping change, Grail data stays invisible to MZ-based access) + HOW (numbered, dependency-ordered, naming this tenant's own findings) + validate-and-decommission, grounded in docs.dynatrace.com pages verified during the run, with Best Practice Notebook series (MZ2POL, ORGNZ, IAM, WFLOW) as further reading.

**Sequencing is dependency-ordered:** enrichment prerequisites → build segments → validate population parity → rehome consumers (paging-risk items last) → switch access to IAM policies on security context → retire zones. Retirement is always last and always behind a parity check.

---

## Quick start

```bash
/dt-eval-mz2seg
```

The skill prompts for tenant ID, customer name, dtctl context (pre-authenticated), output location, audience (External default), and whether to ship the disposition worksheet (default yes). If a sibling `/dt-eval-*` skill ran today, its probe cache is reused — only the four live reads (population, tag propagation, zone query activity, IAM readiness) are newly collected.

Scope note: platform (`apps.dynatrace.com`) tenants via dtctl, 100% read-only. All retire lists are advisory worklists the customer applies — the skill never modifies a tenant.

---

## Documentation

- [SKILL.md](SKILL.md) — the full runbook: inputs, phases, disposition rules, hard rules
- [mz2seg-migration-plan-spec.md](../dt-eval-tenant/mz2seg-migration-plan-spec.md) — the design note: method, disposition model, remediation bar
- [probes-grail.md](../dt-eval-tenant/probes-grail.md) — the four live reads: B37 population census, B38 tag propagation, B42 zone query activity, B47 IAM readiness ([probes.md](../dt-eval-tenant/probes.md) is the catalog router)
- [verification-queries.md](../dt-eval-tenant/verification-queries.md) — the client-runnable twins V38 / V39 / V43 / V48
- [field-notes.md](../dt-eval-tenant/field-notes.md) — verified field names and gotchas (the `managementZones` array/`expand` trap lives here)
- Shared engine: [docx_style.py](../.dt-eval-common/docx_style.py) · [runlog.py](../.dt-eval-common/runlog.py) · [report-audiences.md](../.dt-eval-common/report-audiences.md)
- [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) — reproduce every read without an agent

## Troubleshooting

**"dtctl: context not found"** — ensure `dtctl auth login --context <name> --environment <url>` is active and resolves to the target tenant.

**"Zones show as empty that I know are populated"** — the population census must `expand` the `managementZones` array; the shipped B37 query does. If reproducing manually, an un-expanded grouping silently groups by membership *combinations*.

**"The IAM group read failed"** — expect it to. The groups API cannot enumerate: it demands a name fragment or a uuid and returns 400 without one, and the read scope is rarely granted anyway. The IAM readiness snapshot is the primary access signal, not the fallback — it still establishes whether classic role bindings exist. What neither read resolves is *which zone* a binding scopes, so per-zone bindings stay a verify-live footnote and **every retire disposition stays blocked on that check**. The plan ships either way, stating what the missing access would add.

**"Can I run this together with the Gen3 report?"** — yes, as separate invocations sharing the same-day probe cache; the two documents cross-reference rather than duplicate.

---

**Status:** In development · **Part of:** the `/dt-eval-*` skill family (monorepo, shared scoring engine and probes)
