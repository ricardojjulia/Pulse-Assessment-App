# `/dt-eval-prob` — Problem & Alert Noise Evaluation

**What it answers:** *Why is this tenant noisy, and exactly what should we change to fix it?*

It reads the live problem stream (what is firing now), reads the actual anomaly-detection settings (why it is firing), maps each noisy detector to a maintained threshold ruleset (what it should be set to), and produces a **specific, quantified change plan** — plus a client-ready report and a tuning workbook.

The deliverable is the sequenced change plan. The score is a health headline, and it is never allowed to stand in for the actions.

---

## What is measured

Every probe is read-only. Problem, event, entity, and settings reads are cheap and use full windows; spans and unscoped logs are the only guarded tables.

### Reach check (before anything else)

The problem, event, entity, and log tables are each tested for accessibility, so anything unreadable is declared up front rather than discovered mid-run. A single failure never re-shapes the deliverable — only a literal, repeated authorization denial, cross-checked against a sibling table, puts the run into config-only mode.

### The noise baseline (30 days, with a 24-hour corroborator)

| Measure | What it tells you |
|---|---|
| **Volume and modernity split** | Total problems, and the share that are custom alerts rather than Davis-native categories. A high custom share means the firehose is ported static rules, and tuning built-in thresholds alone will not fix it |
| **Signal-to-problem compression** | Raw signals collapsed per surfaced problem. Low compression beside high volume means the team is being paged on raw events, not correlated problems |
| **Problem Usefulness Index (PUI)** | Weighted from three rates — does the problem carry a root cause, does it span more than one entity, is it actionable (not muted, duplicate, or flagged frequent) |
| **RCA participation, per detector** | Whether each detector's alerts are even *eligible* for root-cause analysis. An alert that cannot be merged is never correlated with anything, so it arrives as a single-entity problem with no root cause — by construction, not by tuning. Two mechanisms cause it: an explicit opt-out in the detector's own event template, or the alert type it emits, which excludes the event with no per-detector flag at all. This is the mechanism behind a low root-cause rate. The configuration-side read survives a run that cannot reach the problem stream, but it establishes a **lower bound only** — it can prove a detector is excluded, never that one participates |
| **Noise and friction rates** | Duplicate rate, frequent-event rate, muted count, and the share raised under maintenance |
| **The tuning worklist** | Top problem titles by count, split two ways: built-in detector titles map to a ruleset row, custom titles go to the detector deep-analysis |
| **Maintenance suppression** | Whether configured windows are suppressing real alerts unseen — or scoping nothing at all |
| **Source attribution** | The whole stream bucketed by driver, so the report can say "four drivers each own about a fifth" (buckets overlap by design and are never summed or presented as a partition of the stream) |
| **Time-to-detect (MTTD)** | Median and p90 minutes from event onset to problem-open. Read next to PUI, not instead of it — fast detection on a low-usefulness stream is not progress, and tuning for one can regress the other |
| **Noisy-entity share** | The share of source-entity-days exceeding Dynatrace's own [documented over-alerting threshold](https://docs.dynatrace.com/docs/dynatrace-intelligence/use-cases/avoid-overalerting) (no more than 0.1% of observed time in an alerting state) — a rate, not a raw count that just scales with estate size, so it is the more defensible headline noise number |

### The actual detector settings

The live built-in anomaly-detection configuration is read per area — hosts, disks, services, databases, web applications, and the five Kubernetes scopes — at environment scope **and** without scope, so per-entity overrides are counted too. Two distinctions the report depends on:

- **A readable schema returning zero objects is "platform defaults in force"** — a scoreable state, not a denial.
- **Presence is proved by entities, not by config.** An area is marked not-applicable only when the entities are genuinely absent; a missing cloud connector has been mistaken for "no Kubernetes here" on an estate running hundreds of workloads.

Per-entity overrides that disable detection are flagged as blind spots — with a carve-out for the built-in placeholder services, where disabling is standard housekeeping, not a defect.

### Custom-detector deep-analysis (the other half of the noise)

The custom detector library is analyzed, never enumerated:

- **Enabled split** — dormant rules are prune candidates, not active noise
- **Analyzer split** — an all-static-threshold library with the adaptive, seasonal, forecast, and novelty analyzers wired into nothing is the sharpest form of "bought the AI, turned it off"
- **Exact duplicates** — same query, threshold, and condition under different names; deletable at zero coverage cost
- **Clone families with configuration drift** — identical query text at *differing* thresholds. The drift is the finding, and it catches families that both duplicate-detection and title-normalization miss
- **Threshold plausibility** — a threshold above 100 on a percentage metric can never fire; a zero threshold with an "above" condition fires permanently
- **Out-of-the-box overlap** — custom rules re-implementing CPU, memory, disk, restart, or availability detection the platform already does natively
- **Semantic intent classification** — each enabled detector is classified by what it is really watching, so the plan can name which native detector replaces which group of rules
- **Top offenders** — the rules joined to the problems they actually produced, with the durable object handle for the customer to action

### Attribution drill-downs and adjacent checks

Drill-downs turn a noisy title into a cause: is *pods pending* real or all short-lived cronjob churn; is a service driver spread across many services or one bad one; is a custom alert flapping (one-minute median duration, none open now) or a sustained outage; and is the rule **structurally** noisy because it groups on an ephemeral identity rather than a durable one — in which case raising the threshold will not help at all, and the fix is re-scoping. A companion, estate-wide scan finds fragmentation candidates before you know which rule to blame: any source entity firing more than one non-informational event on the same day, trended day over day so a falling count corroborates that a tuning change worked.

A raw root-cause percentage reads artificially low even on a healthy estate — some empty-RCA problems are legitimately empty (a single-entity direct failure, an infrastructure-impact problem, no affected entity at all). The empty-RCA slice is split into expected-empty vs. a residual that genuinely should have had a root cause and didn't, so the report states which share of "no root cause" is the real finding.

Adjacent checks decide how the noise should be *read*: maintenance windows, the delivery chain (do problems reach anyone?), host monitoring mode, service-detection shape, the analyzer catalog, frequent-issue detection, the older metric-events framework (config-side, corroborated by a stream-side check for whether it is truly dormant or still emitting), and health-check span noise. There is also a direct measurement of what the detector library **costs to run** — every detector evaluation is a logged query execution, so the same consolidation that cuts noise also cuts query load.

---

## How results are scored

The headline is the **Alerting Effectiveness Score** — `0.40·S + 0.30·N + 0.30·T`, 0–100, on the family bands (A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50).
> **Grades are an option, and off by default on anything customer-facing** (owner rule, 2026-08-25). The score below is computed exactly as described on every run, and the Dynatrace-facing internal edition always prints it — but the customer edition carries no score, grade badge, gauge or Score/Grade column unless that run asked for one (`--grades`). It keeps the findings, the ✅/💡/⚠️ statuses, the confidence flags and the sequenced remediation; pillar tables read *Pillar | Status*. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.


| Pillar | Weight | What it grades |
|---|---|---|
| **S — Signal quality** | 0.40 | Whether the problems the team actually receives arrive with context they can act on (the PUI over the full 30-day stream) |
| **N — Native-detection adoption** | 0.30 | How much of the stream comes from the correlation engine rather than custom static rules that bypass it |
| **T — Detector tuning** | 0.30 | Whether the built-in detectors are configured to recommendation |

**Why the outcome pillars outweigh tuning:** a tenant that has bypassed the correlation engine for half its stream is not using the product well, however its built-in knobs are set. A tuning-only headline once read "Strong" on an estate living through daily alert storms — and the report read as denying the customer's experience. The composite makes the headline match what the team feels, while the tuning sub-score preserves the (true, important) point that the engine underneath may be sound.

Three naming rules follow, and they are hard: the word *Overall* never attaches to the tuning sub-score; the cover carries the composite **plus a burden stat line** (problems per day · custom-rule share · root-cause rate); and a high tuning sub-score on a noisy tenant is stated as a finding — *"the engine underneath is sound; the burden comes from outside it"* — never as an all-clear.

**Per rule:** ✅ at recommendation = 100 · 💡 at default or generic = 50 · ⚠️ actively noisy = 0 · ⚪ not readable = excluded from the denominator · not applicable (technology absent) = excluded, and described as such rather than as a permission gap. Areas roll up weighted by noise risk, and area weights follow measured problem volume so the areas actually generating noise dominate.

**Confidence** is High, Medium, or Low based on how much of the stream attributes to known detectors — computed from distinct problem titles as a share of the total, never by summing the overlapping attribution buckets.

Formulas live in [noise_scoring.py](noise_scoring.py); build scripts call it rather than hand-computing, so the number is reproducible across analysts.

---

## What you get

Four deliverables from one probe collection (default: all four), written to `<output-root>/<customer-name>/current/` with an always-present, incrementing `(vN)` marker so a rebuild never overwrites a delivered file. The tenant ID always leads the filename:

1. **Word noise-reduction report** — `<tenantId>-noise-reduction-<date>(vN).docx`
   Cover with the burden stat line — and the effectiveness score only on a graded edition — → executive summary (the thesis sentence and the biggest drivers) → the noise baseline → **a summary table of drivers, then one bulleted deep-dive per driver, worst-first** → the sequenced change plan → verify-it-yourself queries and where to change each setting in the UI → appendix.
2. **Tuning workbook** — `<tenantId>-noise-tuning-<date>(vN).xlsx`
   One row per ruleset rule: area, alert, default, suggested prod and lower values, the **actual** resolved values from this tenant, status, the concrete recommendation, estimated reduction with its method tag, priority, and how often it fired in 30 days. Conditionally formatted, with a summary tab. This is the artifact a customer keeps and re-runs.
3. **Prioritized change list** — `<tenantId>-noise-changes-<date>(vN).md`
   A ranked, ticket-ready table with no prose, grouped so an SRE can knock out the zero-risk high-yield rows in one sitting and schedule the rest.
4. **Per-detector audit workbook (internal only)** — `[INTERNAL ONLY]-<tenantId>-detector-audit-<date>(vN).xlsx`
   One row per detector across the CUSTOM fleet. The complement to the tuning workbook, not an alternative: (2) covers the ~62 built-in rules, this covers the custom fleet where a ported estate keeps its volume and every consolidation decision.

---

## What to expect from the results

**Every finding draws the chain no single screen draws:** *what is firing now* → *which detector or rule produces it* → *what to change, and what that is expected to do*. A finding that stops at a count is unfinished.

**Reduction estimates are labeled, always** — never a bare percentage:

- **[counted]** — structural and exact: deleting duplicate rules, or disabling a detector in lower environments, removes a known fired share.
- **[replay]** — the problem records carried the breaching magnitude, and a stated number of them would not fire under the proposed rule.
- **[derived]** — a proportional estimate, with the assumption stated inline.

**The plan is sequenced by yield and risk:** delete exact duplicates and disable in lower environments first (high yield, zero risk), then loosen the high-volume built-in thresholds, then generalize clone families, then enable-for-coverage items last — those add intentional alerts. Where loosening trades noise for a slower catch on a real incident, the report says so.

**Typical shape of what comes back.** On an estate run as a threshold pager, expect: a large custom-alert share; a handful of titles owning most of the volume; near-zero multi-entity impact on the custom block (ported per-entity thresholds cannot correlate, by construction); one or two structurally noisy rules scoped to ephemeral identities; and clone families where the fix is generalization rather than tuning. The single strongest correlation in the report is usually usefulness split by category — it converts *"you have a lot of alerts"* into *"most of your alerts cannot, by construction, tell you anything."*

**Config-only mode.** If the problem stream genuinely cannot be read, all three deliverables still build — but they are a materially different artifact and say so **on the cover**: no reduction figures at all, equal area weighting, findings ordered by configuration risk and certainty rather than volume, confidence fixed at Low, and no composite score (a tuning-only number is never presented as effectiveness). The change plan states plainly that the highest-risk row could be the largest single noise source, and that this ranking does not size the impact.

**What the score is not.** It is a health headline for the alerting outcome, not a target to optimize. Two tenants with the same composite can need entirely different work — read the three pillars, not the number alone.

---

## Inputs (Phase 0)

1. **Tenant ID** (e.g. `abc12345`) and **customer name** (e.g. `Acme Corp`)
2. **dtctl context** — pre-authenticated, validated against the tenant ID
3. **Environment split (prod vs lower)** — the ruleset carries separate recommendations per environment, so the skill must know which entities are which. It asks, or infers from naming and confirms with you, or runs single-environment and says so in the report. It never guesses silently
4. **Time window** — 30 days by default for the baseline; the 24-hour split is a cheap corroborator. The window is stated on every figure
5. **Output location** and **report audience** (External by default)
6. **Deliverables** — all three unless you narrow it

```bash
/dt-eval-prob context=prod customer="Acme Corp"
```

Runs standalone, or alongside a Configuration Review — the two share several problem-stream reads, so a same-day cache is reused rather than re-queried.

---

## Documentation

- [SKILL.md](SKILL.md) — the full runbook: phases, the reach-verification gate, config-only mode, the attribution joins, hygiene
- [probes.md](probes.md) — the noise battery: reach check, baseline, detector settings, custom-detector deep-analysis, drill-downs, adjacent checks (the tenant skill's [probes.md](../dt-eval-tenant/probes.md) is a different battery)
- [scoring.md](scoring.md) — the Alerting Effectiveness composite, per-rule statuses, confidence, and reduction-labeling discipline
- [noise_scoring.py](noise_scoring.py) — the executable formula authority
- [noise-ruleset.json](noise-ruleset.json) — the maintained threshold library, per detector type and environment (regenerate with [build_ruleset.py](build_ruleset.py))
- [output-spec.md](output-spec.md) — the structure of all three deliverables
- [ENGINE.md](ENGINE.md) — the shared-engine seam
- Shared engine: [docx_style.py](../.dt-eval-common/docx_style.py) · [runlog.py](../.dt-eval-common/runlog.py) · [report-audiences.md](../.dt-eval-common/report-audiences.md)

## Troubleshooting

**"No problems found in the window"** — the tenant is genuinely quiet, or problem retention is short. Widen the window, or accept the tuning sub-score as "already well-tuned" with the volume pillars computed over whatever stream exists. Do not manufacture findings.

**"A detector is not in the ruleset"** — a custom or proprietary detector. It goes to the custom-detector deep-analysis instead of a ruleset row; if it needs a generic baseline, say so and mark it for manual review.

**"How confident is the recommendation?"** — read the confidence flag beside the score. It reflects how much of the problem stream attributes to specific detectors; configuration-only evidence is always Low.

**"The tuning sheet has blank recommendations"** — the detector is outside the maintained ruleset or lacks problem history. It is marked for manual review, never silently filled.

**"The score looks good but the customer is drowning"** — check the pillars. A high tuning sub-score beside low signal quality and low native adoption is exactly the pattern the composite exists to surface: the engine is sound, the burden comes from outside it.
