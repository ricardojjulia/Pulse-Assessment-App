# Best Practice Notebook library — the reference layer

The **Dynatrace Best Practice Notebook series** is the explanation layer for this skill's recommendations. **Authority order: measured evidence → docs.dynatrace.com → this library.** The official docs are the authoritative source for every recommendation; the notebook series supplies framing (habit → gap → handicap), worked DQL, migration context, and sequencing — and is what the report's *Further reading* section links.

**Public series (link this in every report):**
`https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/blob/main/README.md`

**Optional local copy for analysis-time reading:** clone the series next to your project so Claude can read notebooks during analysis:

```bash
git clone https://github.com/timstewart-dynatrace/Best-Practice-Notebooks ../Best-Practice-Notebooks
BPN=../Best-Practice-Notebooks
```

## Reading notebooks at analysis time (when a local copy exists)

The series repo carries its own `AGENTS.md` navigation contract — follow it, and re-read it if these notes and the repo disagree. In short: **don't crawl the corpus**, and read `markdown/`, never the JSON.

Layout: series are top-level directories named `<CODE> - <Title>` (e.g. `FAQ - Frequently Asked Questions`), each holding `AGENTS.md` (routing table), `markdown/` (**canonical text — read this**), `README.md` (human overview, fallback), plus `notebooks/` (Dynatrace JSON, import only) and `pdfs/` (ignore). Three series (ALERT, APPSEC, SLO) uppercase those last two as `NOTEBOOKS/`/`PDFs/`.

```bash
cat "$BPN/AGENTS.md"                                       # root routing: question -> series
series=$(ls -d "$BPN/"<CODE>*)                             # dirs are "<CODE> - <Title>"
cat "$series/AGENTS.md"                                    # series routing: topic -> notebook
ls "$series/markdown/"                                     # entries, named -[CODE]-NN-slug.md
grep -rl "dt.security_context" "$BPN" --include="*.md"     # which notebooks cover a topic
grep -oh 'https://docs\.dynatrace\.com[^)"]*' "<path>.md" | sort -u   # doc URLs a notebook cites
```

Route root `AGENTS.md` → series `AGENTS.md` → the specific notebook(s) it names (~2–5k words each); for broad adoption/maturity questions start at `$BPN/-START-HERE-/` (`99-index.md` is the index). Notebooks contain verified DQL and curated doc links — prefer their probe variants over improvising, and use the extracted docs.dynatrace.com URLs as the starting set to verify (WebFetch) before citing a recommendation. The content is AI-generated from community and public sources and is not officially supported by Dynatrace, so treat it as reference and verify version-sensitive claims against the docs; sections marked *Derived* are engagement synthesis, not official docs — keep that label when you reuse them. Each notebook carries Created/Last Updated dates; surface them when currency matters. The repo is read-only — never edit it. If no local copy exists, cite the series link plus the relevant series code (e.g. *FAQ-12*, *ALERT-02*) — the reader can browse on GitHub.

## Finding area → series to consult

| Finding area (scorecard row) | Consult first | Also |
|---|---|---|
| Log routing, buckets, retention tiers | **ORGNZ** (buckets, security_context, segments), **OPLOGS** (processing, parsing, buckets) | OPMIG (Classic→OpenPipeline runbook) |
| DPL parsing, PII masking, log-to-metric extraction | **FAQ-15** (how DPL works — canonical pattern-language reference), **OPLOGS** (parsing/processing) | OPMIG (masking patterns, fixed 2026-07-20 — re-verify any earlier-quoted masking DPL) |
| ABAC / `dt.security_context` / access boundaries | **ORGNZ**, **IAM** | MZ2POL (if legacy MZs still carry scoping) |
| Detection quality, static vs Davis, alert noise | **ALERT-02** (detection decision framework), **AIOPS** (Davis, anomaly detection) | FAQ-06 (trusting Davis) |
| Alert routing, workflows, notifications | **WFLOW** (triggers, routing, governance), **ALERT-01/03/04** | AUTOM (workflows-as-code) |
| Host monitoring mode / coverage gaps | **FAQ-12** (cost of coverage gaps — the framing model), **ADOPT-06** (staged enablement) | FAQ-03 (OneAgent vs OTel), ONBRD |
| Tagging discipline | **FAQ-02** (tagging sources/standards/strategy) | ORGNZ |
| Host-group naming | **FAQ-01** (host-group naming strategy) | |
| Fleet currency — OneAgent / ActiveGate | **FAQ-04** (OneAgent updates), **FAQ-05** (ActiveGate updates) | FAQ-10 (AG sizing/scaling) |
| SLOs / reliability targets | **SLO 01–05** (fundamentals → SLIs → error budgets → alerting → as-code) | |
| RUM / digital experience | **WEBRUM**, **MOBL** (mobile) | |
| Synthetic | **SYNTH** | |
| Application Security | **APPSEC 01–10** (RVA, RAP, posture, K8s security, IAM) | |
| Cost, consumption, DPS mix | **FINOPS 01–03** (units/querying → forecasting → optimization) | FAQ-09 (metrics instead of log queries) |
| Kubernetes monitoring & enrichment | **K8S** | OTEL |
| OpenPipeline maturity (beyond logs) | **OPIPE** (spans/metrics/bizevents/security pipelines) | OPLOGS, OPMIG |
| Business analytics / bizevents | **BIZEV** | |
| Dashboards / reporting surface | **DASH** | ADOPT-03 (success metrics) |
| Tracing depth / spans | **SPANS** | OTEL |
| Database monitoring | **DBMON** | |
| Cloud integrations (AWS/Azure/GCP) | **CLOUD** | |
| Config-as-code / governance | **AUTOM** (Monaco, Terraform, GitOps) | |
| Overall maturity & roadmap sequencing | **ADOPT 01/02/05/06** (maturity model, health assessment, roadmap, staged enablement) | `-START-HERE-/` reading orders (`99-index.md`) |
| Migration-shaped habits (customer came from another tool) | **NR2DT/NRLC** (New Relic), **S2D** (Splunk), **SL2DT** (Sumo — 11 notebooks incl. SL2DT-10 Telegraf-metric migration), **M2S/S2S** (deployment moves) | FAQ-12 for the habit framing |
| Management-zone-heavy estates (MZ→policy migration) | **MZ2POL** (series live as of 2026-07-21 — no longer a forward reference) | IAM, ORGNZ |
| **The `/dt-eval-mz2seg` Migration Plan** (this family's own MZ→segments deliverable) | **MZ2POL-00** (SDK MZ analysis tool — compare with `analyze_mz2seg.py`), **MZ2POL-05** (segments implementation: the 8 scenarios, one-segment-per-dimension, the 4 blockers), **MZ2POL-09** (alerting/notification migration) | **ORGNZ-08** (segment limits/operators), **ORGNZ-10** (segment mechanics; §12 Davis-problem include). Two BPN-vs-docs divergences recorded in field-notes (entity.name wildcards; host-group derived-data propagation) — docs win |

## Citation rules

1. **Docs are the authority; notebooks are the reference.** Every recommended action is backed by a docs.dynatrace.com page you verified this run (title + URL in the report). Series entries are cited alongside as explanation/further reading — e.g. *"adopt one naming convention (Dynatrace docs: Host groups; further reading: FAQ-01)"* — never as the sole basis for a recommendation.
2. **Only cite what you opened.** A doc page may appear as an authoritative source only if you actually fetched it during the engagement. Series codes may be cited by mapping (the public link lets the reader browse).
3. **Cite in-line where the guidance lands:** in the scorecard's Recommended-action cells and each deep-dive's action/method note.
4. **Appendix — References:** two-part: (a) *Authoritative sources* — the docs.dynatrace.com pages per finding; (b) *Further reading* — introduced with the public series link: *"Further reading — Dynatrace Best Practice Notebook series, available at https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/blob/main/README.md"*, followed by the specific series entries per finding.
4a. **Every notebook mention carries a followable URL — scanner-enforced since 2026-08-11** (`further-reading-without-url`, customer-facing profiles; `internal` exempt, since an internal reader can resolve a series code from the skill itself). Rule 4 was prose-only for its whole life and 85 of 299 delivered customer-facing documents named the notebooks with no link — the reader was told a source exists and given no way to reach it, which is worse than no citation at all. Cite the **specific series** rather than the repo root wherever one applies: `https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/blob/main/<Series%20Directory>/README.md`. **Percent-encode spaces (`%20`) and any brackets (`%5B`/`%5D`) — on `blob/` a literal bracket 404s**, and this is the form that lands in someone else's hands, so an encoding slip fails for the reader rather than for you.
5. **Conflict handling:** docs beat notebooks — if they disagree (thresholds moved, feature renamed, capability GA'd), follow the docs and note the discrepancy. Live measurements beat both for statements about the tenant's current state.
6. **Internal material stays internal.** If you hold customer-specific engagement notebooks or prior internal measurements locally, use their substance as prior knowledge only — never cite them as named documents in a client-facing report, and never reference other tenants' evaluations (see SKILL.md client-facing hygiene).

## Upstream currency snapshot (checked 2026-07-21)

- **MZ2POL is now a real series** (added 2026-07-21 with content updates to WFLOW, AIOPS, ALERT,
  IAM, ORGNZ, ONBRD, START-HERE) — cite it directly for MZ-bound alerting-profile / scoping
  migration findings instead of "MZ2POL (planned)".
- **SL2DT is 11 notebooks**; SL2DT-10 covers migrating Telegraf-collected metrics — pull it for
  Sumo-heritage tenants whose metric feeds came through Telegraf.
- **OPMIG masking patterns were fixed 2026-07-20** (previous patterns could fail to redact PII) —
  if a report ever quoted OPMIG masking DPL before that date, re-verify before reuse; DPL questions
  now route to **FAQ-15 (How Does DPL Work?)**.
- **Query idiom:** the BPN now prefers `smartscapeNodes` over `fetch dt.entity.*` and marks the
  fetch form the deprecated alternative. This skill's §B probes remain on the live-verified
  `fetch dt.entity.*` surfaces (measurements beat reference idiom, and several attributes/types
  have no Smartscape twin yet — see B3/D1 notes) — but when quoting BPN DQL in a report, keep the
  notebook's smartscapeNodes idiom, and expect future probe upgrades to trend that way.
