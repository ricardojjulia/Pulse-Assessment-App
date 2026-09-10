# Problem Noise — scoring rubric

The headline is the **Alerting Effectiveness Score** — a weighted composite that grades the alerting *outcome* the customer lives with, not just the positions of the built-in knobs. The score is a health headline, not the deliverable. The sequenced change plan is the deliverable; never let a number stand in for the actions. Bands and mechanics match the Tenant Eval so figures reconcile across reports.

## The headline — Alerting Effectiveness Score

**`Effectiveness = 0.40·S + 0.30·N + 0.30·T`** — 0–100, one decimal, family bands (A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50).

| Pillar | Weight | What it grades | Source |
|---|---|---|---|
| **S — Signal quality** | 0.40 | Whether the problems the team actually receives arrive with context they can act on (root cause, multi-entity impact, actionability) | Phase 1 P4 — PUI over the full 30-day deduped stream |
| **N — Native-detection adoption** | 0.30 | How much of the stream comes from the platform's correlation engine vs. custom static rules that bypass it | Phase 1 P2 — 30-day category mix |
| **T — Detector tuning** | 0.30 | Whether the built-in detectors are configured to recommendation | Phase 2 per-detector rubric below |

**Formulas** — the executable authority is [noise_scoring.py](noise_scoring.py); build scripts call it (or import it) rather than hand-computing, so the number is reproducible across analysts:

- `S = 100 × PUI`, where `PUI = 0.4·rootCauseRate + 0.3·impactMultiRate + 0.3·actionableRate` (P4, 30-day deduped problem stream — the same PUI reported in the baseline, never recomputed with different weights).
- `N = 100 × (1 − custom_share_30d)`, where `custom_share_30d = CUSTOM_ALERT problems ÷ total problems` from the 30-day category mix (P2). Never derive the share from the 24-hour corroborator.
- `T =` the detector-tuning rollup below (unchanged mechanics).

**Why the outcome pillars outweigh tuning (this is the design, not an accident).** A tenant that has bypassed the correlation engine for half its problem stream is not using the product well, no matter how its built-in knobs are set — "settings at recommendation" is a vanity metric when most of what pages the team comes from somewhere else. Field lesson (2026-07-29): a tuning-only headline scored "B — Strong" on a reference tenant whose stream was ~46% context-free migrated static rules. The customer — living through daily alert storms — read the report as denying their experience. The composite makes the headline match what the team feels, while the tuning sub-score preserves the (true, important) point that the engine underneath is sound.

**Naming rules (hard):**

1. The word **"Overall" never attaches to a scoped sub-score.** The tuning number is always presented as "Detector tuning (sub-score)" or equivalent — never as the report's overall grade.
2. **The cover carries the composite plus a burden stat line** — e.g. "~319 problems/day · 45.6% from custom rules · 14% arrive with a root cause" — so page one acknowledges the lived experience instead of appearing to contradict it.
3. **A high tuning sub-score on a noisy tenant is a finding, not an all-clear** — state it as "the engine underneath is sound; the burden comes from outside it," and let the composite carry the pain.

**Diagnostic-only probes (deliberately outside the score).** `C-rcrel` / `D-rcrel` (probes.md §3 item 7, §4) measure per-detector RCA participation — whether a detector's events may merge and be named as a root cause. They **explain** the S pillar's `rootCauseRate`; they do not adjust it. Their asymmetry matters even outside the arithmetic: `C-rcrel` reports a **lower bound** and has no "capable" verdict, so a quiet result is "not established", never an all-clear — do not let it soften a low S pillar in the narrative. PUI keeps the published weights and inputs so the number stays comparable run-over-run and across analysts, and adding a fourth term would silently redefine every prior score. Use them in the narrative and the retire-first ordering, never in the arithmetic.

**Two DRAFT diagnostics carry the same rule once validated:** `D-topology-coverage` (§4 — estate-wide service/host/tracing coverage percentages) explains *why* topology-dependent RCA is thin the same way `D-rcrel` explains why attachment is low — it never adjusts S. `D-rca-quality-sample` (§4 — the owner-reviewed Attached/Correct/Actionable split) is stricter still: it is a manual sample, not a query result, so it can only ever inform the narrative and the retire-first ordering, never the arithmetic — the same non-negotiable as `C-rcrel`'s lower bound. Neither is scored until it has been run live at least once (probes.md marks both DRAFT); until then, do not cite either in a client deliverable.

**Missing pillars:**

- If exactly one volume pillar cannot be computed (partial access), renormalize the remaining weights over the pillars present and state this prominently wherever the score appears.
- **Config-only mode (R1 = ⚪): there is no Alerting Effectiveness Score.** S and N need the problem stream; without it the deliverable's headline is **"Detector Tuning Score (configuration-only)"** — cover notice per SKILL.md, confidence always Low. Never present a tuning-only number as effectiveness. `noise_scoring.py` enforces this: it refuses to emit a composite when both volume pillars are absent.

## Per-detector status (feeds the T pillar)

Each assessable ruleset rule gets a status from the Phase 2 Actual-vs-recommendation comparison:

| Status | Meaning | Score |
|---|---|---|
| ✅ at recommendation | Actual == the ruleset's recommended value for its environment | 100 |
| 💡 at default / generic | Present but at OOB default or a generic value the ruleset would tune | 50 |
| ⚠️ actively noisy | High-noise-risk detector at default **and** firing heavily in Phase 1, OR enabled where the ruleset says disable (esp. lower env) — see precedence note below | 0 |
| ⚪ not readable | Schema returned 403 / permission denied | **excluded from the denominator** — never scored 0 |
| N/A not applicable | Technology absent (e.g., Kubernetes not deployed, no web applications, no databases) | **excluded from the denominator** — status: "does not apply to this tenant" |

**⚠️ precedence clarification (Item 3):**
- **Volume-dependent clause:** *"High-noise-risk detector at default AND firing heavily in Phase 1"* requires measured volume (Phase 1 P1/P2 data). Without volume (R1 problem table is ⚪), this clause cannot be scored and rows fall to 💡.
- **Config-determinable clause:** *"Enabled where the ruleset says disable (esp. lower env)"* stands on its own and requires no volume. This clause can score ⚠️ in config-only mode.
- **Config-only runs:** When Phase 1 volume is unavailable (R1 = ⚪), ⚠️ findings are config-only. State this explicitly in the report: "The scores below are based on configuration only; no volume data is available to corroborate noisy detectors."
- **A threshold-plausibility flag is not automatically ⚠️ — classify the series first (probes.md §3 4c).** `threshold 0` + `ABOVE` on a **count or state** metric is the correct "alert on any occurrence" idiom and scores ✅; it is a defect only on a bounded-percentage series. Scoring the idiom as a defect penalizes correct configuration and inflates the apparent tuning gap (live 2026-07-30: 59 + 8 detectors across two tenants would have been scored ⚠️ for being written correctly). The same applies in reverse to `threshold > 100`, which carries no information on count, duration, byte, or lag series. Every plausibility verdict must also survive the volume falsification in probes.md §3 4e before it reaches the T pillar.

## Detector-tuning rollup (the T pillar)

- **Area score** = weighted mean of that area's assessable rules, weighted by `noise_risk` (high=3, med=2, low=1).
- **T** = weighted mean of assessable areas, weighted by each area's measured problem volume (Phase 1 P2/P6 attribution) so the areas actually generating noise dominate. Fall back to equal area weights if per-area volume can't be attributed, and say so.
- **Bands:** A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50 (used for the composite and for per-area grades alike).
- **Confidence flag** (High/Medium/Low) — attaches to the **composite** and is stated wherever the score appears. Assessed from assessable-rule count and how much of the problem volume was attributable to a detector.
  - **Config-only runs (R1 problem table is ⚪):** Confidence is always **Low**. Reason: "Scoring is based on configuration only; no volume data is available to corroborate noisy detectors or size reductions. The ranking reflects configuration risk, not measured impact."
  - **Full runs with volume:** Confidence depends on the volume attribution quality (see Phase 1). If <50% of the stream attributes to known detectors, confidence is Medium. If >75% attributes, confidence is High. **The attribution share MUST be computed from P6's distinct problem titles as a share of P2's total — never by summing P8's keyword buckets.** P8's buckets overlap by design (the phrases are adapted per tenant) and summing them overstates attribution — verified live 2026-07-28: the P8 sum gave 101%, which would have claimed High confidence from an impossible denominator.

## The custom-rule burden (the N pillar, plus the narrative it owes)

`custom_share_30d` is now **in the headline** through the N pillar — the composite can no longer show an A while half the stream is ported custom rules. But the pillar only carries the volume share; the *narrative* still owes the reader the depth behind it (Phase 3 deep-analysis): the count of deletable-duplicate / generalizable-family / OOTB-overlap rules, plus — once `C-alertidentity`/`C-entityref` are validated (probes.md §3 items 8–9, DRAFT) — missing `alertIdentityFields` and non-entity `by:{}` dimensions as two further structural noise mechanisms distinct from duplication, expressed as "% of the problem stream addressable by retiring/generalizing custom rules." A report whose N pillar is low must lead its findings with the custom-rule burden — the tuning worklist is never the headline story on such a tenant.

## Reduction estimation — labeling discipline

Every estimated reduction carries its method tag so nothing reads as a promise:
- **[counted]** — structural, exact: deleting K exact-duplicate rules, or disabling a detector in lower, removes a known fired share.
- **[replay]** — the problem records carried breaching magnitude and N of M would not fire under the proposed rule.
- **[derived]** — proportional estimate (detector's volume share × an assumed suppression fraction from the tuning); the assumption is stated inline.

Never publish a bare percentage. `~40% [derived: response-time detector owns 12% of the stream; a 50%→75% baseline threshold is assumed to suppress ~half]` is publishable; `40% reduction` is not.

**Config-only runs (no volume available):** Omit all reduction figures — no [counted], [replay], or [derived]. The change plan is ordered by **configuration risk and certainty of outcome**, not by reduction. Admission: "A row marked ⚠️ could be the tenant's largest single noise source, but without volume data, this ranking does not size the impact. Prioritize by configuration risk, then by your operational context."
