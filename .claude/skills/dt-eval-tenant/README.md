# `/dt-eval-tenant` — Technical Configuration Review

**What it answers:** *Is this Dynatrace tenant configured to deliver the value it is paying for — and where is it silently losing that value?*

Root skill of the `/dt-eval-*` family. It reads a platform tenant end-to-end through read-only `dtctl` probes (configuration **and** live telemetry), cross-correlates the two, and writes a client-ready Word report with an overall score, per-pillar grades, and a sequenced action plan.

Effective Consumption, Gen3 Migration Progress, Problem Noise, OpenPipeline design and the Management Zones → Segments plan are **separate standalone skills** — [`/dt-eval-consumption`](../dt-eval-consumption/README.md), [`/dt-eval-gen3`](../dt-eval-gen3/README.md), [`/dt-eval-prob`](../dt-eval-prob/README.md), [`/dt-eval-openpipeline`](../dt-eval-openpipeline/README.md), [`/dt-eval-mz2seg`](../dt-eval-mz2seg/README.md). They reuse this skill's same-day probe cache but never appear as a section inside this report. `/dt-eval-openpipeline` **owns the OpenPipeline depth this review points at** (A21/A22/A23/A29/A38/A46/A54/B45/B50, D2/D6) and supersedes those fragments.

---

## What is measured

Two batteries, run in one pass. Every probe is read-only; nothing is written to the tenant.

### §A — Configuration inventory (A1–A54, `dtctl get`)

The rule for this section is **evaluate, don't enumerate**: a count is not a finding. Each probe is read for *content* — are the rules duplicated, dormant, generic, watching dead inputs, or left at platform default?

| Theme | What is read | What it tells you |
|---|---|---|
| **Data routing & retention** | Buckets (lifetime records, retention tiers), OpenPipeline routing entries and pipelines per scope, classic log-storage rules, classic→OpenPipeline translation | Whether logs land where the design says, whether routing is native end-to-end (the trailing catch-all matcher decides this), whether two processing systems run in parallel |
| **Detection & alerting** | Gen3 Davis detectors, classic metric-event detectors, the Davis analyzer catalog, maintenance windows (legacy + Gen3), frequent-issue detection | The static-vs-adaptive split, clone families and threshold drift, whether the AI analyzers you pay for are wired into any detector, standing suppression risk |
| **Automation & delivery** | Workflows with full trigger objects, recent executions, EdgeConnect, plus the mandatory configured-vs-executed cross-check | Polling anti-patterns vs event-driven automation — and deployed, event-triggered workflows with **zero** executions, which is either an alert-delivery outage or config the customer believes is live |
| **Scoping, tagging & ownership** | Segments (each one's populating DQL is executed to test whether it returns rows), management zones read *by dimension*, auto-tagging rules, ownership teams, IAM groups | Effective vs dead scoping constructs; how many logical dimensions the estate really discriminates on |
| **Fleet & deployment** | OneAgent/ActiveGate update policy, default monitoring mode for new hosts, network zones, OneAgent feature flags (selective) | Why coverage looks the way it does — an explicit `INFRASTRUCTURE` default is the steady state the configuration produces, not a backlog |
| **Reliability & quality gates** | SLOs and per-SLO config (targets, evaluation window, burn-rate wiring), SLO templates, failure detection, service detection, span capturing | Whether reliability targets exist and are tuned to service criticality, and whether "failed request" is defined by the service or by platform default |
| **Cloud, extensions & apps** | AWS/Azure/GCP connections, installed extensions vs the Hub catalog, per-extension monitoring configs, apps, dashboards, notebooks, functions, lookups, CoPilot skills | Agent-only cloud coverage, extension shelfware (installed, zero configs), untapped integrations, adoption breadth |
| **Privacy & compliance posture** | Masking across all three enforcement layers — capture, ingest, display/RUM — plus IP-address masking and Session Replay presets | Shipped guards left switched off; the control posture, never a content scan for PII |

### §B — Grail telemetry probes (B1–B51, `dtctl query` / DQL)

| Plane | What is measured |
|---|---|
| **Data plane** | One-pass log health (routing share, security-context coverage, Kubernetes enrichment, parsing, volume), per-bucket recency vs lifetime records, log-source coverage vs host inventory |
| **Estate & coverage** | Monitoring-mode split, discovered-but-unmonitored candidates, stale/inactive entities, topology depth (services, process groups), OneAgent fleet version spread |
| **Application observability** | Span health (failure rate by service, OpenTelemetry vs OneAgent split, health-check ingest waste), database technology mix and slow tier, OTel collector data loss |
| **Kubernetes** | Workload right-sizing (requested vs used CPU/memory), reliability (OOM kills, restarts, throttling), node and PVC headroom |
| **Value plane** | RUM experience *quality ratios* (error, crash, replay coverage, bounce — never raw session count), Core Web Vitals at p75 against Google bands, synthetic availability, SLO SLIs and the SLO-to-service coverage gap |
| **Intelligence & security** | Vulnerability **reachability triage** (the intersection of internet-exposed ∧ exploit-available ∧ vulnerable-function-in-use — not a raw CVE count), compliance fail rate by framework, Runtime Application Protection presence, Davis signal-to-problem compression |
| **Governance** | Entity-side enrichment ratio for ABAC and FinOps readiness, record-side governance fields, cost-allocation actually landing in billing, maintenance-window suppression measured rather than inferred |
| **Platform fleet** | ActiveGate fleet topology, network-zone design, data-loss and saturation signals, version drift across the fleet |

### Deep-dive recipes (run by default — these change reports)

Smartscape census and agent layer · OpenPipeline stage matrix (routed vs orphan pipelines) · detection enabled-split joined to what actually fires · **detector rule deep-analysis** (exact duplicates, clone families with threshold drift, out-of-the-box overlap, dead metric inputs verified key-by-key) · the alerting delivery chain.

**Cost guardrails are non-negotiable.** Unscoped log and span reads are short single-pass aggregates sized down adaptively on large estates; entity, problem, event, and metric reads are cheap and use full windows. Anything extrapolated from a short sample is labeled *derived* in the report.

---

## How results are scored

- **Per check:** ✅ Healthy = 100 · 💡 Opportunity = 50 · ⚠️ Needs attention = 0 · ⚪ Not assessable = **excluded from the denominator**. A permission gap never reads as a configuration gap and is never scored 0.
- **Pillar** = weighted mean of its assessable checks; **overall** = weighted mean of assessable pillars. Computed by the shared [`scoring_engine.py`](../.dt-eval-common/scoring_engine.py) — never hand-rolled.
- **Grade bands:** A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50.
- **Confidence flag** per pillar: High (denominators ≥ 100) · Medium (30–100, or one to two ⚪ inputs) · Low (< 30, or majority ⚪). A Low flag is stated wherever that score appears.
- **Outlier guard:** per-actor counts are fenced at `median + 3×IQR` before any distribution measure; fenced actors are named in de-identified form and rejoin the automation story.
- **Gen3-first:** the *absence* of a classic construct is never scored as a gap. Outcome capability is scored on its platform-native mechanism — alert delivery on workflows, scoping on segments, tagging on source tags, access on security context and IAM policies. No recommendation ever tells a customer to create a classic construct.
> **Grades are an option, and off by default on anything customer-facing** (owner rule, 2026-08-25). The score below is computed exactly as described on every run, and the Dynatrace-facing internal edition always prints it — but the customer edition carries no score, grade badge, gauge or Score/Grade column unless that run asked for one (`--grades`). It keeps the findings, the ✅/💡/⚠️ statuses, the confidence flags and the sequenced remediation; pillar tables read *Pillar | Status*. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.


---

## What you get

Deliverables are chosen at the start of every run (pick one or more — there is no default):

| Deliverable | File | Contains |
|---|---|---|
| **Detailed (customer facing)** | `<tenantId>-technical-configuration-review-<date>(vN).docx` | Full scorecard, pillar breakdown, numbered deep-dive findings, action plan, verify-it-yourself queries. Scores and grades only when the run asked for them (`--grades`) — never the scoring internals |
| **Summary (customer facing)** | `[INTERNAL ONLY]-<tenantId>-executive-summary-<date>(vN).docx` | ~4 pages, qualitative only — no scores, grades, or gauge. Strengths first, then opportunities framed as capability one step away, then Now/Next/Later first steps. Carries the verbatim not-for-distribution notice |
| **INTERNAL REPORT** | `[INTERNAL ONLY]-<tenantId>-technical-configuration-review-<date>(vN).docx` | Same math, diagnostic voice: scoring-derivation table, confidence flags, talk-track and expansion hooks, consumption-depth table, and the full roster of not-assessed inputs with the verbatim ask to close each |

All land outside the repo at `<output-root>/<customer-name>/current/` — one flat folder per customer; the tenant ID leads the filename and an internal edition gets the `[INTERNAL ONLY]-` prefix instead of a separate subfolder. The `(vN)` marker is always present and increments, so a rebuild never overwrites a delivered file. The skill confirms the location on every run.

### Structure of the detailed report

Cover (overall score and gauge on a graded edition; the deliverable's name and confidence otherwise) → executive summary → how to read this report → **scorecard** (pillar bar chart worst-first, status mix bar, one row per area) → **deep-dive findings** worst-first → underused capabilities → priority action plan (30/60/90) → **verify these findings yourself** → appendix (method, not-assessed footnotes, references, disclaimer).

---

## What to expect from the results

**Every finding is an interpretation, not a number.** The house shape is: *what we measured* → *what it means* (a conclusion drawn by cross-correlating probes) → *the effect of acting and of not acting*, with the cost of inaction stated explicitly → *evidence* with its method and window → *concrete, sequenced remediation steps*. A finding that stops at a measurement and a definition is treated as unfinished.

The findings that carry a review are usually the **cross-reads**, not any single probe:

- Billions of lifetime records in a bucket with nothing in the last 24 hours ⇒ routing regressed, which no static check catches.
- High alert volume beside an all-static detector set ⇒ the volume is the configuration, not the estate.
- Deployed problem-triggered workflows with zero executions while problems flow ⇒ alerts are not reaching anyone.
- Strong topology depth confined to a Full-Stack minority ⇒ the dependency cascade below every layer above it.
- Records enriched but entities not ⇒ anything built on segments or source tags is blind.

**Reading the grade** — on an edition that carries one. A ≥ 85 means the estate is shaped to its needs and the work is maintenance. B ≥ 70 means one or two areas need focused work. C ≥ 50 means a real remediation backlog with compounding cost. D < 50 means foundations must be addressed before anything built on them can be trusted. Always read the grade next to its confidence flag — a Low-confidence C is a scope problem, not a verdict.

**What the report will not tell you.** Items the review credentials could not read are excluded from every score and appear only as appendix footnotes, each naming the exact access that would include them next time. API-token inventory is out of scope (token hygiene is assessed from policy settings). ActiveGate auto-update *status* has no query surface and is stated as not assessed — version currency itself is graded on drift within the fleet. Nothing is compared against other tenants, ever; there are no peer benchmarks and no dollar figures attached to customer numbers.

**Re-running.** Run state persists per tenant and date, so an interrupted run resumes at no re-collection cost and a later run can be diffed against it. A comparison section enters a deliverable only from the second **delivered** review onward, and only after you confirm it.

---

## Inputs (Phase 0)

1. **Tenant ID** — e.g. `abc12345` from `https://abc12345.apps.dynatrace.com`
2. **Customer name** — e.g. `Acme Corp`
3. **dtctl context** — a pre-authenticated context that resolves to that tenant
4. **Output location** — confirmed every run; press through to accept the default
5. **Deliverables checklist** — INTERNAL REPORT / Summary / Detailed (one or more, no default)

```bash
/dt-eval-tenant context=prod customer="Acme Corp"
```

---

## Documentation

- [SKILL.md](SKILL.md) — the full runbook: phases, run-state protocol, narrative rules, pre-delivery scan
- [probes.md](probes.md) — probe-catalog router → [probes-config.md](probes-config.md) §A · [probes-grail.md](probes-grail.md) §B · [probes-deepdives.md](probes-deepdives.md) deep-dives D1–D6 · [probes-consumption.md](probes-consumption.md) §D · [probes-gen3.md](probes-gen3.md) §E
- [verification-queries.md](verification-queries.md) — client-runnable DQL twins plus the GUI validate/remediate map
- [field-notes.md](field-notes.md) — verified field names, error semantics, CLI gotchas; read before improvising DQL
- [security-sensitive-data-policy.md](security-sensitive-data-policy.md) — mandatory redaction rules for probes that touch secrets or addresses
- [bpn-library.md](bpn-library.md) · [rate-card.md](rate-card.md) · [standards.example.json](standards.example.json)
- Shared engine: [scoring_engine.py](../.dt-eval-common/scoring_engine.py) · [docx_style.py](../.dt-eval-common/docx_style.py) · [runlog.py](../.dt-eval-common/runlog.py) · [verify_docx.py](../.dt-eval-common/verify_docx.py) · [report-audiences.md](../.dt-eval-common/report-audiences.md)
- [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) — reproduce every query and evaluation rule with bash + dtctl + jq, no agent required

## Troubleshooting

**"Run state expired / not found"** — the run directory for this tenant and date is missing or older than 24 hours; reuse is offered, or pass `--fresh` to re-collect.

**"A probe came back not-assessable"** — the review credentials lack that read scope. Check `dtctl auth status --context <ctx>`; the appendix names the grant that closes it.

**"The score dropped but nothing changed in the tenant"** — check the method note first: a probe that moved from inferred to measured, or a pillar composition change, legitimately moves scores. `runlog.py compare` shows per-probe deltas.

**"The report mentions an internal document"** — that is a pre-delivery scan failure. Remove the citation, or select the INTERNAL REPORT deliverable if a Dynatrace-facing document was intended.
