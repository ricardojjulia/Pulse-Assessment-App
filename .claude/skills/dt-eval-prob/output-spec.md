# Problem Noise — deliverable structure

One probe collection (Phases 1–4) feeds all three. Build only the selected ones; default is all three. Deliverables land in `<output-root>/<customer-name>/current/`, named `<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` (or `[INTERNAL ONLY]-<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` for an internal edition) — the `(vN)` version marker is always present, starting at `v1`.

---

## 1. Filled tuning sheet — `<tenantId>-noise-tuning-<date>.xlsx`

Built by `build_tuning_sheet.py` from `run.json` + `noise-ruleset.json` + `findings.json` (this run's per-rule analysis). **Assemble `findings.json` with `assemble_findings.py`, never hand-type it** — it computes the composite via `noise_scoring.py` and names its own meta keys via `noise_findings_schema.py`, which is also the canonical schema `build_tuning_sheet.py` validates every `--findings` file against (an unrecognized or missing meta key fails the build rather than rendering a blank cell — field finding, 2026-08-09: a hand-typed meta dict is exactly how "noise_score" vs "detector_tuning" drifted across runs). `assemble_findings.py --rules <path> --change-plan <path>` still takes this run's qualitative analysis (per-rule status/recommendation, non-ruleset actions) as separate JSON files — that judgment call is the analyst's, not something a script computes. Mirrors the Alerting Thresholds workbook layout, then adds the analysis the manual sheet can't:

| Column | Source |
|---|---|
| Area · Alert | ruleset |
| Default | ruleset |
| Suggested Prod · Suggested Lower | ruleset (resolution contract applied) |
| **Actual Prod · Actual Lower** | **auto-filled** — Phase 2 resolved values (not the field_hint) |
| **Status** | ✅ / 💡 / ⚠️ / ⚪ per scoring.md |
| **Recommendation** | the concrete change (e.g. "loosen 50%→75% baseline, add 5-min window") |
| **Est. reduction** | with its `[counted]`/`[replay]`/`[derived]` tag |
| **Priority** | 1..N (noise_risk × measured volume × ease) |
| **Fired (30d)** | the detector's attributed problem count from Phase 1 |

Conditional formatting: ⚠️ rows red, 💡 amber, ✅ green, ⚪ grey. A summary tab carries the Alerting Effectiveness Score with its three pillars (signal quality · native adoption · detector tuning), and the top-10 change list. This is the artifact a customer keeps and re-runs.

---

## 2. Word noise-reduction report — `<tenantId>-noise-reduction-<date>.docx`

Client-ready, via the shared `../.dt-eval-common/docx_style.py` (same house style as the Tenant Eval). Structure:

1. **Cover** (`cover_page`) — "Dynatrace Problem Noise Reduction", customer, tenant URL, date, **Alerting Effectiveness Score** + grade (`render_gauge_png`) and the **burden stat line** (~problems/day · custom share · root-cause rate) so page one acknowledges the lived experience. Carries the AI-disclosure footnote with `requested_by=` from `dtctl auth whoami`. In config-only mode the cover instead carries "Detector Tuning Score (configuration-only)" and the config-only notice (SKILL.md).
2. **Executive summary** (~1 page, prose) — the thesis sentence (e.g. "This estate is run as a threshold pager: half of its 9,076 monthly problems are ported custom rules, and the rest come from a handful of default OOTB detectors"), the 3–5 biggest drivers tied to operational impact (alert fatigue → missed real signals), and the one-paragraph "what to do first."
3. **How to read this** — ✅/💡/⚠️ legend; ⚪ items excluded and listed in the appendix.
4. **Noise baseline** — volume, custom-vs-Davis split, compression, PUI/impact-cardinality, duplicate/maintenance rates, **time-to-detect (P9 median/p90)**, and **the noisy-entity share against Dynatrace's documented 0.1%/day over-alerting threshold (P10)** — report P10 as the headline noise rate (a share, not a raw count) and P5's duplicate/frequent/muted rates as the friction detail beneath it, never one in place of the other; lead with the **three-pillar breakdown of the effectiveness score** (signal quality · native adoption · detector tuning, each with weight and grade), then a `rag_summary` bar and (where areas are scored) a `pillar_bar_chart` worst-first. Label per-area tuning grades as areas within the detector-tuning pillar — never as report-level pillars. **Neither P9 nor P10 feeds the effectiveness score** — same diagnostic-only status as D-rcrel/C-rcrel — they inform the narrative, not the composite.
5. **Findings — summary table first, then bulleted deep-dives** (owner format rule — match the Tenant Eval's scorecard→deep-dive shape). **(a)** Lead with a `scorecard_table` (`#` · driver · measured · status ✅/💡/⚠️ · recommended action) — the drivers at a glance. **(b)** Then one H3 per driver, worst-first, written as **bullet lists, not prose**: the *Found / what's measured*, *evidence*, *if-left-unaddressed*, and *sequencing* are `List Bullet` items (one fact per bullet, via a `lead_bullets(doc, label, items)` helper); reserve short prose only for a one-line *Recommendation*. Each driver still covers *what's firing → which detector/rule produces it (attribution) → cost & over-correction risk → evidence → sequenced change*, across both axes (top OOTB detectors and the custom-rule burden). Dense paragraphs are the failure mode to avoid. **The root-cause driver's evidence bullets must carry the D-rca-buckets split** (expected-empty vs. `should_have_had`) alongside the raw RCA% — a raw percentage alone is exactly the "artificially low" misreading D-rca-buckets exists to correct, so a root-cause finding that states only the percentage is incomplete. **The fragmentation driver pairs D-cardinality (this rule, this title) with D-source-fragmentation (estate-wide, which other source entities look like this)** — the latter is where new candidates come from, not just where an already-named rule gets confirmed.
5b. **The consolidation picture — required whenever `detector_families.py` reports policy clusters.** This is the finding that reframes a large ported fleet, and it is easy to lose among per-detector noise findings, so it gets its own H2 rather than living as one driver among many. It carries, in this order: **(a)** the headline — *N of M detectors (X%) collapse into K distinct alerting policies* — with the four groupings' counts side by side (exact rules title-blind · clone families with threshold drift · policy clusters) so the reader sees why the largest number is the policy one; **(b)** a table of the largest clusters — policy envelope, member count, and **merge verdict**; **(c)** the routing-divergence statement, which is the part most likely to be dropped and the most expensive to get wrong.
   **The framing is maintainability, not duplication.** Every detector in a cluster watches a different metric and is individually legitimate — the cost is that changing one of K policies means editing every copy by hand. Never write it as "delete these."
   **Never recommend merging a cluster whose destination fields diverge.** State the distinct-destination counts explicitly and recommend templatizing the *policy* fields while leaving routing per detector. Where `detector_families.py` returns a merge verdict of `unknown` because the input was redacted, say so and recommend nothing — a merge recommendation built on a redacted destination field is the one mistake in this section that would break a customer's alerting.
   **Capacity framing (probes.md §3 item 14) — required whenever the declared maximum was read, whichever way it reads.** State the fleet size against `maxObjects` **as read live from the schema on this tenant**, never a remembered documentation figure: the two have already disagreed by 4.5x on a live engagement, which is the difference between "over an unenforced cap" and "at exactly 100% of the ceiling, the next creation fails". The structural fix is consolidation, not a limit increase. Say it when it is healthy too — a fleet at 27% of its ceiling changes *why* the consolidation work is worth doing (maintainability, not headroom), and a reader who is not told assumes the worst. Keep any internal soft/hard tier reasoning to the internal edition.
5c. **The delivery-destination picture — required whenever detectors carry a routing property** (probes.md §3 items 12 and 15). Three things the rest of the report cannot show, in this order:
   **(a) Where alerts actually go.** The `dt_alert_target` census, with each value mapped to the endpoint the consuming workflow sends it to. This is invisible to the notification-integration reads — property-driven routing never touches that layer — so if this section is omitted, nothing else in the deliverable covers it.
   **(b) The non-production share, as a question rather than a verdict.** State the count and share targeting a non-production destination, then ask whether it is intended. **Never assert that it is wrong**: the identical setting is correct on a lower environment and a finding on a production one, and the report cannot resolve that from configuration. Live 2026-08-10: 48.9% of a production fleet resolved to a UAT destination — the single most consequential finding of that engagement, and it reads as a defect only once the environment is known.
   **(c) Whether two mechanisms deliver to one destination.** Where an enabled native integration targets an endpoint the workflow already targets, say so — both fire, the receiving system gets two events, and every ticket-side alert-volume measure becomes untrustworthy until ownership is settled. Read each integration's target rather than its name; where the two disagree, report the disagreement rather than picking one.
5d. **Silent-source coverage — required whenever the fleet was read** (probes.md §3 item 13). State the share of detectors that do not alert when their input stops arriving, counting unset with disabled but reporting the two apart. Frame it by *intent*, not as a blanket defect: silence is correct for a performance threshold and backwards for a security or audit condition. Pair it with the ingest-rejection read — rejected datapoints on a key the fleet queries make this a live condition rather than a theoretical one, and that pairing is the finding rather than either number alone.
6. **The change plan** — the sequenced Now/Next/Later table (delete-dupes & disable-in-lower → loosen high-volume thresholds → generalize families → enable-for-coverage), each row with its estimated reduction tag and environment.
7. **Re-measuring after each change** — **the check lives with the driver it supports, not in a list at the end** (owner rule, 2026-08-03). Each driver deep-dive in §5 already carries its client-runnable DQL (the Phase 1 probes, re-scoped) directly under what was found, which is where the reader meets the number and where it is useful during the readout — and it is the only place that query is printed. This closing section carries only what has no single driver to sit under: where to change each setting in the UI (Settings → Anomaly detection → …), the directional-estimate caveat, and the standing instruments (Dynatrace Tenant Review dashboards, the `dt-alerting` best practices). **Never repeat a query a driver already shows** — printing it twice gives the reader no signal about which is authoritative.
8. **Appendix** — method (client-safe), ⚪ footnotes (each with the scope that would include it), references (docs.dynatrace.com anomaly-detection pages + BPN ALERT series), and the standing disclaimer that reduction figures are directional and should be re-measured after each change.

Hygiene: no run paths, probe IDs, raw error strings, or cross-tenant references. Pre-delivery scan every docx before handing over.

---

## 3. Prioritized change list — `<tenantId>-noise-changes-<date>.md`

The lightweight, ticket-ready cut — no prose.

**Header line (required, verbatim shape).** Every field is copied from `run.json` — `meta.customer`, `meta.tenant`, the window the problem probes actually covered, and `meta.completed`. This line was unspecified until 2026-08-03, which is precisely why it drifted: with no template to copy, it was retyped each run, and two change lists shipped naming a different customer than the one they were about. Do not retype it from session memory.

```
**Customer:** <meta.customer>  |  **Environment:** <meta.tenant>  |  **Window:** 30 days  |  **Generated:** <YYYY-MM-DD>
```

Then a single ranked table:

```
| # | Area | Detector | Env | Current | → Recommended | Change | Est. reduction | Fired 30d |
|---|------|----------|-----|---------|---------------|--------|----------------|-----------|
| 1 | Custom | "a single high-volume custom log detector" | prod | fires 2,099/mo | retire/generalize | delete+replace | [counted] 2,099 | 2,099 |
| 2 | K8s Workload | pods-stuck-pending | lower | Enabled | Disabled | disable | [counted] full lower share | 1,515 |
| 3 | Services | response-time | prod | 50% baseline | 75% baseline, 5-min | loosen | [derived] ~half of 1,069 | 1,069 |
...
```

Grouped so an SRE can knock out the zero-risk high-yield rows (deletes, disable-in-lower) in one sitting, then schedule the threshold loosening. Each row links back to the tuning sheet for the full context.

---

## 4. Per-detector audit workbook — `[INTERNAL ONLY]-<tenantId>-detector-audit-<date>(vN).xlsx`

Built by `build_detector_audit.py` from the same `C-davis-detectors.json` §3 already collects — no
extra tenant read. The tuning sheet (1) covers the ~62 **built-in** rules; this covers the
**custom** fleet, which on a ported estate is where nearly all the volume and every consolidation
decision lives. Before it existed, "which of my 4,500 detectors do I touch, and in what order?" had
no artifact and was rebuilt by hand each engagement.

**Sheet 1 — Detectors.** One row per detector, frozen header, auto-filter on: title · enabled ·
analyzer · query expression · threshold · condition · violating/dealerting samples · window ·
alerts-on-missing-data · merging-allowed · severity · alert target · routing group · asset tag ·
source application · recipients · migration source · **policy-cluster id** · **flags** · objectId.
The cluster id is what makes the sheet sortable into work batches; the flags column is shaded and
carries, per row: `no alert target` · `no severity` · `no assignment metadata` ·
`non-production destination` · `silent on missing data` · `cannot participate in RCA`.

**Sheet 2 — Fleet summary.** The rollups behind the report's numbers so the two cannot drift: fleet
size and capacity against the declared maximum, the four consolidation groupings side by side, the
alert-target census with the non-production share, the missing-data split, the delivery-chain
flags, and provenance.

**Run it on the REDACTED file.** `redact.py` aliases recipients rather than flattening them, so the
routing columns stay analyzable without exposing an address. The workbook carries objectIds and
routing metadata, so it is an internal working artifact and takes the `[INTERNAL ONLY]-` prefix —
share the report with the customer, and this with whoever does the work.
