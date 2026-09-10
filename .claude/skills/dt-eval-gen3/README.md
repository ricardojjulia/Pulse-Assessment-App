# `/dt-eval-gen3` — Gen3 Migration Progress Review

**What it answers:** *How far has this platform tenant moved from classic (Gen2-era) constructs to platform-native ones, and what is the specific next step for each remaining gap?*

A standalone skill. It reads the live tenant through read-only `dtctl` probes, maps every classic construct to its platform-native equivalent, grades progress **toward the native target**, and produces a **Migration Completeness score** (0–100%) with a cited, tenant-specific remediation runbook for every domain.

The framing matters: a fully native tenant is **100% Complete, never "empty."** The absence of a classic construct is never a gap, and no recommendation ever tells a customer to create one.

> **Hard install dependency:** this skill ships no probe catalog of its own — its probe definitions, recipes, and field notes live in `../dt-eval-tenant/` (`probes-gen3.md`, the §A/§B catalog files, `field-notes.md`, `gen3-migration-progress-spec.md`) and the shared engine in `../.dt-eval-common/`. Installing `/dt-eval-gen3` without `/dt-eval-tenant` and `.dt-eval-common/` leaves it non-functional.

---

## What is measured — thirteen migration domains

Each domain pairs a **classic-residue signal** against a **native-target signal**, and is graded on the outcome rather than on object counts.

| Domain | Classic residue | Native target | Complete when |
|---|---|---|---|
| **Alerting & problem delivery** | Classic problem notifications, alerting profiles (and their management-zone-bound share), the custom-alert share of the problem stream | Problem-triggered workflows that are both deployed **and** actively triggering, plus the delivery chain | Workflows deliver and no classic profiles or notifications remain |
| **Scoping & access** | Management zones, read **by dimension** — the tag-key families a zone really discriminates on, never a zone or rule count | Segments (each one's populating query executed to prove it returns rows) plus security-context coverage | Segments cover every zone dimension and no zones remain |
| **Tagging & ownership** | Classic auto-tagging rules, ownership-team objects | Source-tag enrichment measured on both records and entities | Source-tag enrichment is live and no classic auto-tag rules remain |
| **Log processing** | Classic pipeline translation, counted enabled-vs-total per processing group | OpenPipeline routing (including the trailing catch-all check) and pipelines, read with their groups | Native routing is live and classic translation is empty |
| **Dashboarding & analysis** | Classic dashboard *usage* | **Real-user Grail engagement** — actual human, non-Dynatrace-staff interactive queries | Real users actively run native dashboards and classic usage is near zero |
| **Automation** | *(native-only domain)* | Workflows present **and executing** — execution count, not object count | Workflows present and executing (dormant = in progress) |
| **Apps / UX** | *(native-only domain)* | App adoption classified by vendor — first-party vs custom-built | Meaningful custom or third-party adoption, not a shelf of built-ins |
| **Extension entity model** | Extension-sourced nodes still backed by a classic device entity; metrics-only extensions | Typed Gen3 Smartscape nodes, weighted by each extension's metric volume | Effectively all active volume sits on typed nodes |
| **SLO model** | Classic metric-expression SLOs (exact count) | Gen3 DQL-based SLOs | Gen3 SLOs evaluating and no classic SLOs remain |
| **Integration surface** | Classic API/settings calls by caller, classified against what breaks on upgrade day; customer-authored documents running classic-entity DQL | Callers whose traffic lands only on surviving endpoints; documents rewritten to Smartscape/dimension filters | No caller depends on a retiring endpoint and no authored document is flagged — a named break list, not a score |
| **Access model** | Groups still bound to classic RBAC roles | Groups on default policies, boundary keyed on security context rather than management zones | No groups remain on classic RBAC roles |
| **Service detection & rule settings** | Enabled service-/failure-detection rules scoped by management zone, service tag, or a non-primary-tag process-group tag | The same rules re-scoped onto primary tags from process groups | No flagged enabled rule remains across the assessed rule families |
| **Custom anomaly-detector framework** | Classic metric-event detectors (`builtin:anomaly-detection.metric-events`), enabled count | Gen3 Davis custom detectors (`builtin:davis.anomaly-detectors`), enabled count, weighted by actual firing volume | No enabled classic detector remains and native detection is active (where custom detection is used at all) |

**Two anti-vanity rules are built in and are the point of the design:**

- **Dashboarding is graded on usage, never presence.** Native dashboards run on Grail and leave a query trace; classic dashboards do not. So *low real-user Grail engagement is itself evidence the users are still on classic*, however many native dashboards exist. Dynatrace-staff logins are excluded from every engagement number and reported separately — they are consulting activity, not customer adoption.
- **Adoption weighting.** Completeness is weighted by each domain's share of the tenant's actual usage footprint — problems delivered, records enriched, ingest routed, real dashboard opens, workflow executions, extension metric volume, SLOs evaluated. Migration debt in a domain the tenant leans on moves the grade; a barely-touched domain barely counts. An SLO-light tenant is not dragged down by the SLO domain.

Most of the evidence is reused from the shared configuration and telemetry battery — seven of these thirteen domains (alerting, scoping, tagging, log processing, dashboarding's classic side, automation, apps) collect nothing new at all. The rest each add one targeted read collected only for this report: the extension entity-model audit, the real-user engagement read, the Gen3 SLO enumeration, the classic API/settings-caller and authored-document census, the daily IAM readiness snapshot, and the custom-anomaly-detector schema-generation share (weight only — that domain's status is free too).

---

## How results are scored

- **Per domain:** ✅ Complete (native in place, classic retired) · 💡 In progress (dual-running) · ⚠️ Not started (classic only) · ⚪ Not assessable.
- **Migration Completeness %** = adoption-weighted mean of *assessable* domains (Complete 100 · In progress 50 · Not started 0). ⚪ domains are excluded from the denominator and never scored 0. Where a footprint proxy is unavailable, fixed fallback weights apply and the method note says which basis was used.
- **Grade bands:** A ≥ 85% (all domains have a clear path) · B ≥ 70% (one or two need focused work) · C ≥ 50% (a clear remediation backlog) · D < 50% (comprehensive re-architecture).
> **Grades are an option, and off by default on anything customer-facing** (owner rule, 2026-08-25). The score below is computed exactly as described on every run, and the Dynatrace-facing internal edition always prints it — but the customer edition carries no score, grade badge, gauge or Score/Grade column unless that run asked for one (`--grades`). It keeps the findings, the ✅/💡/⚠️ statuses, the confidence flags and the sequenced remediation; pillar tables read *Pillar | Status*. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.

- **Weights are exposed and adjustable**; the status rules are not.
- **Dual-running domains carry the headline callout** — the specific classic + native pair coexisting, and the double-configuration and double-cost of leaving both in place.

---

## What you get

A single `.docx` — `<tenantId>-gen3-migration-progress-<date>(vN).docx` under `<output-root>/<customer-name>/current/` (internal audience: `[INTERNAL ONLY]-<tenantId>-gen3-migration-progress-<date>(vN).docx`). One invocation produces this report and nothing else.

Structure:

1. **Cover** — Migration Completeness %, prominently. The percentage is a **progress** headline — distance to a target the tenant can reach and be finished with — so it stays on every cover; the A–D letter beside it and the grade-band dial appear only on a graded edition (internal always, external with `--grades`)
2. **Executive summary** — the domain breakdown (how many complete / in progress / not started), the single biggest remediation area, and the first domain to tackle
3. **Domain by domain** — status badge, current state (counts and example names), target state with an authoritative docs link, a **sequenced remediation path**, and an effort/risk note
4. **Appendix** — not-assessable footnotes, a glossary of native constructs with links, and run metadata

---

## What to expect from the results

**Every domain ends in a runbook, not a verdict.** The house shape is *what is classic* → *what replaces it* → *how to move it*, with steps tied to this tenant's own counts and grounded in a docs.dynatrace.com page verified during the run. Best Practice Notebook series are cited as further reading, never as the authority. A domain already complete reads *"Complete — maintain, no action"*, so no line is left without a path.

**The findings that change the conversation** are usually reductions in scope, not additions to it:

- Reducing management zones to their **dimensions** typically collapses a large migration into a handful of real gaps — a dimension already covered by a segment means those zones are simply retirable, which is a materially cheaper conclusion than "migrate every zone."
- A trailing catch-all routing entry means nothing falls through to classic processing — the domain is far nearer complete than object counts suggest.
- Extensions whose binary is updated but whose monitoring configs were never re-saved sit one level below the config layer; the highest-volume ones still not started are the headline operational risk.
- A high native dashboard count beside near-zero real-user Grail engagement is not adoption — it is the vanity trap this report exists to correct.

**Reading the score.** The percentage measures distance to the native target, weighted by what the tenant actually uses. A dual-running estate lands in the middle band by construction — that is accurate, not harsh, and the cost being described is the cost of maintaining two systems. Domains with no native equivalent yet are marked not-assessable and footnoted; they are never scored as gaps and never resolved with "stay classic."

**Honesty properties.** Classic SLO counts are exact; the native SLO count is resolved live and, where no enumeration surface is reachable, the report says so rather than fabricating a number. The extension audit reports how many of the installed extensions it could actually measure — the unmeasured remainder is stated as not assessed, never as proven migrated. Nothing is compared against another tenant.

---

## Quick start

```bash
/dt-eval-gen3
```

The skill prompts for:

1. **Tenant ID** (e.g. `abc12345`) and **customer name** (e.g. `Acme Corp`)
2. **dtctl context** — pre-authenticated, validated against the tenant ID
3. **Output location** — confirmed every run; press through for the default
4. **Report audience** — External (default) or Internal

Scope note: this measures construct-level adoption on a **platform** (`apps.dynatrace.com`) tenant. Still-classic environments are not reachable this way and are out of scope.

---

## Documentation

- [SKILL.md](SKILL.md) — the full runbook: inputs, phases, scoring, hard rules
- [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md) — the design note: domain matrix, scoring rubric, remediation runbooks
- [probes-gen3.md](../dt-eval-tenant/probes-gen3.md) — the §E scoring recipe and the per-domain recipes ([probes.md](../dt-eval-tenant/probes.md) is the catalog router; §A and §B carry the underlying reads)
- [verification-queries.md](../dt-eval-tenant/verification-queries.md) — client-runnable DQL twins for the migration reads
- [field-notes.md](../dt-eval-tenant/field-notes.md) — verified field names and error semantics; read before improvising DQL
- Shared engine: [scoring_engine.py](../.dt-eval-common/scoring_engine.py) · [docx_style.py](../.dt-eval-common/docx_style.py) · [runlog.py](../.dt-eval-common/runlog.py) · [report-audiences.md](../.dt-eval-common/report-audiences.md)
- [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §8 — reproduce the reads and scoring without an agent

## Troubleshooting

**"dtctl: context not found"** — ensure `dtctl auth login --context <name> --environment <url>` is active and the context resolves to the target tenant.

**"Output path does not exist"** — the skill creates it; verify write permission on the parent directory.

**"Some probes failed"** — check the run directory's raw outputs and error files. Cost guardrails may have triggered; re-run with a narrower window.

**"A domain came back not assessable"** — either the credentials could not read it, or no native equivalent exists yet. Either way it is excluded from the denominator and footnoted with what would include it next time.

**"I want to compare against my last review"** — finalized runs persist per tenant and date; `runlog.py compare` diffs two runs.

---

**Status:** Active · **Part of:** the `/dt-eval-*` skill family (monorepo, shared scoring engine and probes)
