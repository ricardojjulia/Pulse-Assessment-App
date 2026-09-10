# `/dt-eval-consumption` — Effective Consumption Review

**What it answers:** *Is this tenant actually working the platform it pays for — or is the data shelfware?*

A standalone skill that measures **behavior, not inventory**. It reads 30 days of what people and machines actually did in the tenant — config changes, workflow executions, Davis problems, query executions, entity metadata — and rolls four pillars into a single **Overall Effective Score (OES)** with an A–D grade, per-pillar confidence flags, and a sequenced remediation path.

Never combined with the Configuration Review in one invocation. An engagement that needs both documents runs [`/dt-eval-tenant`](../dt-eval-tenant/README.md) and this skill in sequence, sharing the same-day probe cache.

> **Hard install dependency:** this skill ships no probe catalog of its own — its probe definitions, field notes, and KPI derivations live in `../dt-eval-tenant/` (`probes-consumption.md`, `field-notes.md`, `effective-consumption.md`) and the shared engine in `../.dt-eval-common/`. Installing `/dt-eval-consumption` without `/dt-eval-tenant` and `.dt-eval-common/` leaves it non-functional.

---

## The model — four pillars → one score

| Pillar | Weight | Carried by | Target shape |
|---|---|---|---|
| **Signals** | 0.35 | **PUI** — Problem Usefulness Index (root cause present, impact spans more than one entity, actionable) · **SMX** — Signal Modernity, `1 − custom-alert share` | Are the problems the team receives worth acting on, and do they come from the correlation engine or from ported static rules? |
| **Automation** | 0.35 | **WFR** — workflow follow-through rate · **WOS** — ownership × success · **FPR** — event-driven share of runs · **CCS-Q** — declarative config-as-code, distinguished from integration churn | Does automation finish, is it owned, is it event-driven rather than polling, and is configuration managed declaratively? |
| **Foundation** | 0.20 | **Foundation baseline** — application/organization/environment tag-key family coverage across hosts *and* services *and* process groups, host-group coverage, segment effectiveness | Is there metadata for ABAC boundaries, chargeback, and ownership routing to key on? |
| **Engagement** | 0.10 | **QEI** — of the humans who query at all, the share doing so on **≥ 10 distinct days in 30**, after machine actors and Dynatrace-staff logins are fenced out | Sustained active use, weighed against estate size |

**Reported but never scored** (context, not maturity): AI-tier presence and health, query economics (scanned bytes, on-demand share, consumption source mix), and the expected-users baseline — an estimate, always labeled as one.

---

## What is measured (EC1–EC17)

All reads are behavioral and cheap — the `dt.system.*` and `dt.davis.*` tables — over a rolling 30-day window.

| Read | Feeds | What it measures |
|---|---|---|
| EC1 | Config ownership | Concentration of human config changes across actors, after unattributed and system actors are fenced out (their dominance is its own governance finding) |
| EC2 | WFR, WOS | Workflow executions: terminal runs, completed vs triggered |
| EC3 | PUI + noise penalty | Davis problems deduplicated: root-cause / multi-entity / actionable rates, plus duplicate, frequent, and muted shares |
| EC4 | QEI | Human query executions and their distinct-day distribution |
| EC5 | Foundation refinement | Entity tag and host-group coverage skeleton (gated on a customer standards file) |
| EC6 | OES | The rollup itself |
| EC7 | WOS, delivery | Workflow **config ↔ events stitch** — ownership, problem-triggered lanes, dormant workflows, and workflows that executed but no longer exist in config |
| EC8 | Config-as-code (raw) | Token-driven share of *all* config changes — collection-only, never credited before decomposition |
| EC9 | Expected-users baseline | Cheap entity census vs actual query users |
| EC10 | CCS-Q | Declarative config-as-code (schema-broad, batched) vs integration churn (one or two schemas hammered daily) |
| EC11 | SMX | Custom-alert share of problems, per-category durations, routing-intent coverage |
| EC12 | AI consumption | Analyzer executions and their warning share; Davis CoPilot invocations |
| EC13 | Query economics | Scanned bytes split **by initiator** — platform-internal detector evaluation looks like runaway user cost until it is split out |
| EC14 | FPR | Event-driven vs scheduled vs manual share of runs; automation footprint vs estate scale |
| EC15 | QEI fence | Machine-actor audit of top query actors — pollers running under human identities |
| EC16 | SMX corroboration | Problem-title concentration and naming convention — the fingerprint of an imported rule library |
| EC17 | Foundation baseline | Tag-key families, host groups, and **segment effectiveness** — each segment's populating query is executed; defined ≠ effective |

Plus a small cross-correlation subset reused from the shared battery: workflow trigger classification, log-ingest health, estate coverage and monitoring-mode split, and topology depth — the context that makes a low score explainable.

---

## How results are scored

- **Pillar composition** is the mean of its KPIs; the OES is the weighted mean of the pillars, computed by the shared [`scoring_engine.py`](../.dt-eval-common/scoring_engine.py).
- **Noise penalty** is a multiplier, not a pillar: `OES = raw × (1 − penalty)`, where the penalty is the sum of duplicate, frequent, and workflow-rollback rates, capped at 0.5.
- **Foundation gate:** a scored Foundation below 0.5 caps the OES at **70** — strong signals never paper over a weak foundation.
- **Grade bands:** A ≥ 85 *Excellent* · B ≥ 70 *Strong* · C ≥ 50 *Building* · D < 50 *Foundational*.
- **Not-assessable inputs reweight, never score 0.** Anything the credentials or definitions can't reach drops out of the denominator and is listed in the appendix with the ask that would close it.
- **Confidence flag** per pillar (High / Medium / Low by denominator size and ⚪ share); the report-level flag is the lowest pillar's.
- **Guards applied before any distribution KPI:** the `median + 3×IQR` volume fence only *nominates* a candidate — an actor is excluded only if it also matches the machine signature. A high-volume actor with high context diversity is a power user, retained and credited. Dynatrace-staff logins are excluded from engagement everywhere and reported as a share.
- **Gen3-first:** Foundation is graded on source tags, host groups, and segments. Management zones are never counted, and a tenant with none of them scores *high*, not low.
> **Grades are an option, and off by default on anything customer-facing** (owner rule, 2026-08-25). The score below is computed exactly as described on every run, and the Dynatrace-facing internal edition always prints it — but the customer edition carries no score, grade badge, gauge or Score/Grade column unless that run asked for one (`--grades`). It keeps the findings, the ✅/💡/⚠️ statuses, the confidence flags and the sequenced remediation; pillar tables read *Pillar | Status*. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.


---

## What you get

- **`.docx` report** — "Dynatrace Effective Consumption Review", written to `<output-root>/<customer-name>/current/` as `<tenantId>-effective-consumption-<date>(vN).docx` (internal audience: `[INTERNAL ONLY]-<tenantId>-effective-consumption-<date>(vN).docx`). The `(vN)` marker always increments, so a rebuild never overwrites a delivered file.
  - OES cover grade with gauge and per-pillar scores on a graded edition (internal always, external with `--grades`); confidence flags on every edition
  - Cross-correlated findings — measured → what it means → cost of inaction → sequenced steps
  - Client-runnable verification DQL for every finding, plus where to check it in the UI
  - Appendix roster of every not-assessed input with the exact ask to close it
- **Optional companion notebook** — an importable Dynatrace notebook carrying the headline KPI tiles, so the customer can re-measure themselves between reviews.

**Audience variants change voice and sections, never the math.** External reports carry no derivation, no weights and no probe IDs — and, since 2026-08-25, no OES value or grade either unless the run passed `--grades`. Internal reports add the OES derivation table, the noise-penalty line, Foundation-gate status, talk-track and expansion hooks, and the consumption-depth table. Neither audience ever gets peer benchmarks or dollar figures attached to customer numbers.

---

## What to expect from the results

**The payoff is the cross-read, not the KPI list.** Each of these is a real finding shape this skill exists to produce:

- A high workflow success rate beside dozens of scheduled workflows ⇒ reliable *polling*, not automation of the estate. Automation is never graded on reliability alone.
- A healthy-looking config-as-code share that decomposes to near-zero declarative quality ⇒ integration churn wearing a config-as-code costume — a click-ops estate with busy machinery.
- A low problem-usefulness score driven by near-zero multi-entity impact ⇒ shallow topology or per-entity static thresholds, not "bad problems". The signal-modernity term tells you which.
- Large ingest beside few *sustained* users ⇒ shelfware, measured honestly — never masked by dashboard counts, table diversity, or scanned bytes, all of which trivially max out.
- Workflows executing that no longer exist in configuration ⇒ automation ran that nobody can now inspect or re-run.

**Reading the score.** A ≥ 85: the platform is being worked; the report is largely reinforcement. B ≥ 70: solid, with one pillar carrying the drag. C ≥ 50: capability is bought and partly staged but not operationalized. D < 50: the foundation or the signal stream must be addressed before anything else pays back. A capped-at-70 OES always means the Foundation gate fired — read that pillar first.

**Honesty properties.** Zero KPIs carry a verification flag: an unverified zero (a field that may simply not be populated on this tenant) is treated as not-measured, never averaged in as 0 — the difference between the two has moved a pillar by half a band. Every figure derived from a short sample is labeled *derived*. Actor identities never leave the run directory; fenced actors appear in the report only in de-identified role or tool form.

**What it will not tell you.** Ticket-quality and per-entity consumption measures stay gated until the corresponding customer input exists. Pattern-compliance scoring against a tag standard requires a `standards.<tenantId>.json` — without it those inputs stay not-assessed rather than guessed. Nothing is ever compared against another tenant.

---

## Quick start

```bash
/dt-eval-consumption
```

The skill prompts for:

1. **Tenant ID** (e.g. `abc12345`) and **customer name** (e.g. `Acme Corp`)
2. **dtctl context** — pre-authenticated, validated against the tenant ID
3. **Output location** — confirmed every run; press through for the default
4. **Report audience** — External (default) or Internal — and whether to also write the companion notebook

Optionally, a `standards.<tenantId>.json` (template: [standards.example.json](../dt-eval-tenant/standards.example.json)) closes the definition-gated KPIs and selects the OES weight profile.

---

## Documentation

- [SKILL.md](SKILL.md) — the full runbook: inputs, phases, scoring calls, hard rules, pre-delivery scan
- [effective-consumption.md](../dt-eval-tenant/effective-consumption.md) — the model's source of truth: per-KPI DQL, formulas, targets, validation history
- [probes-consumption.md](../dt-eval-tenant/probes-consumption.md) — the §D battery definitions ([probes.md](../dt-eval-tenant/probes.md) is the catalog router)
- [verification-queries.md](../dt-eval-tenant/verification-queries.md) — the client-runnable twin battery
- [field-notes.md](../dt-eval-tenant/field-notes.md) — verified field names and error semantics; read before improvising DQL
- [security-sensitive-data-policy.md](../dt-eval-tenant/security-sensitive-data-policy.md) — mandatory redaction of actor identifiers before anything is written to the run directory
- Shared engine: [scoring_engine.py](../.dt-eval-common/scoring_engine.py) · [docx_style.py](../.dt-eval-common/docx_style.py) · [runlog.py](../.dt-eval-common/runlog.py) · [report-audiences.md](../.dt-eval-common/report-audiences.md)
- [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §7 — reproduce every KPI and the OES rollup without an agent

## Troubleshooting

**"dtctl: context not found"** — ensure `dtctl auth login --context <name> --environment <url>` is active and the context resolves to the target tenant.

**"Permission denied on query executions or Davis problems"** — the context lacks that read scope; the dependent KPIs become not-assessable and the appendix names the grant needed.

**"Foundation came back not-assessable"** — the entity tables were denied, so the gate is inactive and its weight reweights away. Since the baseline measure was introduced this should be rare.

**"The OES moved but nothing changed in the tenant"** — check the method note: pillar composition upgrades legitimately move scores. `runlog.py compare` shows per-probe deltas.

**"One actor dominates every distribution"** — that is the fence's job. It is nominated by volume and excluded only if the machine signature matches; if it is a service identity it joins the automation story instead.

---

**Status:** Active · **Part of:** the `/dt-eval-*` skill family (monorepo, shared scoring engine and probes)
