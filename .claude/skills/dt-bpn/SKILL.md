---
name: dt-bpn
description: >-
  Reference the Dynatrace Best Practice Notebooks (BPN) — 32 series, ~307 notebooks — from the
  public GitHub repo. Routes a question to the right series and notebook, fetches only what's
  needed, and cites it with a followable public URL.
  Trigger: "what do the Best Practice Notebooks say about X", "BPN", "best practice notebook",
  "per BPN", "check the notebooks for", "cite BPN", "which BPN series covers X", plus any
  request for Dynatrace best-practice/reference guidance where BPN is the intended source
  (K8S deployment, IAM policy syntax, OpenPipeline, migrations from Splunk/New Relic/Sumo, SLO,
  alerting, FinOps, RUM, synthetic, dashboards).
  Do NOT use when working inside the BPN Generator repo — that repo authors and maintains this
  content and uses local sources instead. Do NOT use for official Dynatrace product documentation
  (docs.dynatrace.com is authoritative and outranks BPN), for writing DQL from scratch
  (dt-dql-essentials), or for querying a live tenant (dt-obs-* skills).
license: Apache-2.0
---

# Best Practice Notebooks (BPN)

The BPN is a **content-only** corpus of Dynatrace best-practice guidance: 32 series, ~307 notebooks, ~725k words. No build system, no code.

**Always reference the public repo. Never a local clone path.** Clone paths are machine-specific, go stale, and can't be followed by anyone reading your output.

Canonical entry point:
<https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/blob/main/AGENTS.md>


## Route — do not crawl

The corpus is far too large to read wholesale. Three hops, reading only what each names:

1. **Series** — match the question to a prefix using the map below. If it's obvious (K8S, IAM, SLO), skip straight to hop 2.
2. **Per-series routing table** — fetch that series' `AGENTS.md`. It maps question types to individual notebooks.
3. **Notebook** — read only the file(s) it names. Each is self-contained (~2–5k words) with a TOC, prerequisites, and fenced `dql`/`yaml`/`bash` blocks you can quote directly.

For broad "where do I start" / adoption-journey questions, go to `-START-HERE-/README.md` instead — it sequences series by scenario (net-new, expand/consolidate, deployment migration) and has a series overlap map.

## Fetching

Base: `https://raw.githubusercontent.com/timstewart-dynatrace/Best-Practice-Notebooks/main/`

Directory names contain spaces — encode as `%20`. Notebook filenames contain literal brackets and a leading dash; encode as `%5B`/`%5D`, or pass `curl -g` and leave them literal. Both work.

```bash
# hop 2 — series routing table
curl -s "https://raw.githubusercontent.com/timstewart-dynatrace/Best-Practice-Notebooks/main/K8S%20-%20Kubernetes%20Monitoring/AGENTS.md"

# hop 3 — a notebook
curl -s "https://raw.githubusercontent.com/timstewart-dynatrace/Best-Practice-Notebooks/main/K8S%20-%20Kubernetes%20Monitoring/markdown/-%5BK8S%5D-09-troubleshooting.md"
```

WebFetch works on the `blob/` form too, and is fine when you want the rendered page.

## Formats — read only markdown

Every series has the same layout:

| Path | Purpose | Agents |
|---|---|---|
| `markdown/` | Canonical text of every notebook | **Read this** |
| `AGENTS.md` | Per-series routing table | **Read this** |
| `README.md` | Human overview + import instructions | Fallback index |
| `notebooks/` | Dynatrace notebook JSON for tenant import | Only when the user asks to import |
| `pdfs/`, `markdown/images/` | Print/visual duplicates | Ignore |

Subdirectory casing varies — ALERT, APPSEC, and SLO use `NOTEBOOKS/` and `PDFs/`. `markdown/` is lowercase in every series.

## Series map

Literal directory names (quote them in shell — they contain spaces).

**Foundations & Adoption**

| Prefix | Directory | Scope |
|---|---|---|
| ONBRD | `ONBRD - Dynatrace Onboarding` | Step-by-step onboarding for new users |
| ADOPT | `ADOPT - Observability Adoption & Maturity` | Maturity model, health assessment, success metrics, enablement |
| IAM | `IAM - IAM Administration` | Enterprise identity and access management |
| ORGNZ | `ORGNZ - Organize Data: Buckets, Segments, Security` | Grail buckets, segments, security context |
| FAQ | `FAQ - Frequently Asked Questions` | Cross-series Q&A |
| FINOPS | `FINOPS - Cost Management & FinOps` | Understanding, forecasting, optimizing DPS consumption |

**Data Sources & Instrumentation**

| Prefix | Directory | Scope |
|---|---|---|
| K8S | `K8S - Kubernetes Monitoring` | Operator/DynaKube, GitOps, cluster/workload monitoring, K8s DQL, troubleshooting |
| CLOUD | `CLOUD - Cloud Provider Integrations` | AWS, Azure, GCP integrations |
| MOBL | `MOBL - Mobile Monitoring` | Mobile RUM: iOS, Android, cross-platform |
| WEBRUM | `WEBRUM - Web Real User Monitoring` | Web RUM, session replay, client-side performance |
| SYNTH | `SYNTH - Synthetic Monitoring` | Synthetic monitors: HTTP, browser, network |
| DBMON | `DBMON - Database Monitoring` | SQL, NoSQL, cache, messaging platform monitoring |
| OTEL | `OTEL - OpenTelemetry Integration` | OTLP ingest, collectors, OneAgent coexistence |

**Data Processing & Analytics**

| Prefix | Directory | Scope |
|---|---|---|
| OPLOGS | `OPLOGS - OpenPipeline Logs` | Log ingest, parsing, routing with OpenPipeline |
| OPIPE | `OPIPE - OpenPipeline Beyond Logs` | OpenPipeline for spans, metrics, business/security events |
| SPANS | `SPANS - Distributed Tracing and Spans` | Working with traces and spans |
| BIZEV | `BIZEV - Business Events & Funnel Analysis` | Business events, funnels |
| DASH | `DASH - Dashboard Design & Building` | Dashboard design for stakeholder audiences |

**Automation & Workflows**

| Prefix | Directory | Scope |
|---|---|---|
| AUTOM | `AUTOM - Dynatrace Automation` | Configuration and operations automation |
| WFLOW | `WFLOW - Workflows and Alert Notifications` | Workflows, notification routing |
| AIOPS | `AIOPS - Dynatrace Intelligence` | Causal, predictive, generative AI capabilities |
| ALERT | `ALERT - Alerting Strategy and Design` | End-to-end alerting design; orchestrates AIOPS + SLO + WFLOW |
| SLO | `SLO - Service Level Objectives` | SLIs, error budgets, burn-rate alerting, SLOs as code |

**Security**

| Prefix | Directory | Scope |
|---|---|---|
| APPSEC | `APPSEC — Application Security` | RVA, Runtime Application Protection, posture management (em dash in directory name) |

**Migrations**

| Prefix | Directory | Scope |
|---|---|---|
| M2S | `M2S - Managed to SaaS Migration` | Dynatrace Managed → SaaS |
| S2S | `S2S - SaaS to SaaS Migration` | Between Dynatrace SaaS environments |
| S2D | `S2D - Splunk to Dynatrace Migration` | Splunk → Dynatrace |
| SL2DT | `SL2DT - Sumo Logic to Dynatrace` | Sumo Logic → Dynatrace |
| NR2DT | `NR2DT - New Relic to Dynatrace Migration Steps` | New Relic → Dynatrace: process, discovery → cutover |
| NRLC | `NRLC - New Relic to Dynatrace Migration Deep Dives` | NR2DT companion: query translation, dashboards, alerting, validation |
| OPMIG | `OPMIG - OpenPipeline Migration` | Classic log processing → OpenPipeline |
| MZ2POL | `MZ2POL - Management Zone to Policy Migration` | Management Zones → policy-based access control |

Disambiguating the overlapping clusters:

- **OpenPipeline** — logs → OPLOGS; other signal types → OPIPE; migrating from classic pipelines → OPMIG.
- **New Relic** — "how do we migrate" (process) → NR2DT; "how do I translate this NRQL/dashboard/alert" (reference) → NRLC.
- **Alerting** — strategy/design → ALERT; anomaly detectors and AI → AIOPS; notification plumbing → WFLOW; reliability targets → SLO.

## Rules

- **Read-only.** Never edit, "fix", or reformat BPN content. Found an error? Report it to the user as a suggestion for the upstream author — corrections belong in the Generator repo, not here.
- **Cite by series and number** (e.g. "per K8S-09 Troubleshooting") so the user can open the full document or import the matching notebook JSON. When a link is wanted, use the public `blob/` URL — never a local path.
- **docs.dynatrace.com outranks BPN.** When an official doc page covers the same ground, prefer it and cite BPN as secondary corroboration.
- **Not officially supported.** Content is AI-generated from community-submitted and public sources. For version-sensitive claims (operator versions, GA dates, pricing), advise verifying against official Dynatrace documentation.
- **Surface currency when it matters.** Each notebook header carries Created / Last Updated dates.
- **Preserve query idiom when quoting.** Entity queries prefer `smartscapeNodes` over legacy `fetch dt.entity.*`; where both appear, the fetch form is the deprecated alternative.
