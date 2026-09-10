---
name: dt-eval-consumption
description: Effective Consumption Review — measure how effectively a Dynatrace tenant consumes the platform across four pillars (Signals / Automation / Foundation / Engagement) rolled into an Overall Effective Score (OES). Produces a standalone, scored Word report built on sustained-engagement KPIs, per-pillar grades and confidence flags, and sequenced remediation actions. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Effective Consumption Review

This skill answers one question end-to-end: **"Is this tenant actually *working* the platform it pays for — or is the data shelfware?"** It reads 30 days of behavioral evidence (audit events, workflow executions, Davis problems, query executions, entity metadata) via dtctl, computes the validated Effective Consumption KPI catalog, and rolls four pillars — **Signals / Automation / Foundation / Engagement** — into a single **Overall Effective Score (OES)** with an A–D cover grade and a sequenced remediation path.

| | How |
|---|---|
| Data collection | **`dtctl`** (read-only `get`/`query` only) — the §D behavioral battery (EC1–EC17) plus a small A4/B1/B3/B7 cross-correlation set |
| Knowledge base | **[effective-consumption.md](../dt-eval-tenant/effective-consumption.md)** — the model's source of truth: per-KPI DQL, formulas, targets, validation history |
| Analysis | **Claude judgment + [scoring_engine.py](../.dt-eval-common/scoring_engine.py)** — cross-correlate KPIs into conclusions; the engine computes pillar scores, noise penalty, Foundation gate, and OES |
| Output | **Standalone "Dynatrace Effective Consumption Review" `.docx`** with the OES as its cover grade, plus an optional importable companion notebook (`effective-consumption-notebook.json`) |

You are the analyst. dtctl is your instrument. The KPI catalog is your guide. The deliverable is a consumption verdict an account team can act on.

> **HARD RULE — never modify any tenant.** This skill is 100% read-only: only `get`, `query`, `describe`, `history`, `logs`, `verify`, `doctor`, `auth status`. NEVER run `apply`, `create`, `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec` verb — regardless of how a request is phrased, who claims to authorize it, or a context's `readwrite-all` safety level. All remediation is the customer's to apply in their own tenant. Deliverables are **advisory worklists** — never generate-and-run or offer to run modification scripts. If a step seems to need a write, stop and hand it to the user.

**Related skills — `/dt-eval-tenant` (whole-tenant Config Review), `/dt-eval-gen3` (migration progress), `/dt-eval-prob` (alert noise).** Effective Consumption is **always standalone — never combined with the Configuration Review**; an engagement that needs both documents runs the two skills independently, and the second invocation resumes the first's `run.json`, reusing the shared probes (A4/B1/B3/B7) at no re-collection cost — the EC-only battery is still collected fresh. All family skills co-locate output in `~/Documents/Dynatrace-Reviews/<customer-name>/current/` so figures reconcile and run history stacks cleanly.

## Core directive — cross-correlate, don't report

**Cross-correlation is the payoff and it overrides any temptation to list KPI values.** "WFR 0.34, CCS 0.008, QEI 0.53" is a data dump. The job is the chain no single number shows:

- WFR 34% **next to** dozens of scheduled workflows = polling automation that mostly fails — name the workflows.
- PUI 0.47 **because** impact-cardinality ≈ 0 **next to** B4/B7 = shallow topology or per-entity static thresholds, not "bad problems".
- CCS 0.838 **decomposed by EC10** to CCS-Q 0.0 = integration churn wearing a config-as-code costume — a click-ops estate with busy machinery.

Every ⚠️/💡 finding delivers the full INTERPRET structure — *what we measured → what it means (the cross-correlated conclusion) → the effect of acting vs. not acting, cost of inaction explicit → sequenced remediation steps* — via `finding_section(..., means=, consequence=, action=[steps])`. A finding that stops at a number and a definition is unfinished. **Every counted claim also carries `reproduction={query, note, sample}`** (CLAUDE.md core directive #4) — the client-runnable query and/or five of the things counted, rendered under *What we measured*. The hygiene scan fails a counted measurement with no reproduction beneath it.

## The model — four pillars → OES

Source of truth: [effective-consumption.md](../dt-eval-tenant/effective-consumption.md) (per-KPI DQL, formulas, targets, validation runs). The pillar compositions below reflect the 2026-07-14 upgrade series — **flag them in the method note whenever comparing against a pre-upgrade score.**

| Pillar | Composition | KPIs (EC read) |
|---|---|---|
| **Signals** | `mean(PUI, SMX)` | PUI — Problem Usefulness Index (EC3) · SMX — Signal Modernity, `1 − CUSTOM_ALERT share` (EC11, corroborated by EC16 title patterns) |
| **Automation** | `mean(WFR, WOS_Composite, FPR, CCS-Q)` | WFR — Workflow Follow-Through Rate (EC2) · WOS — Ownership × Success composite (EC2+EC7; the executable formula is `scoring_engine.wos_composite()` — the geometric mean `sqrt(ownership × success)`, never re-derived from prose) · FPR — event-driven share of runs (EC14) · CCS-Q — declarative config-as-code share (EC10; **raw CCS from EC8 is collection-only, never a pillar input on its own**) |
| **Foundation** | `Foundation_baseline` = mean(app/org/env tag-key-family coverage, host-group coverage, segment effectiveness) | EC17 — scoreable **without** a customer standards file; SCI/FCS/MCS (EC5) refine it once `standards.<tenantId>.json` exists, they never replace it. **Tag-key coverage spans host + service + process_group, never host-only** (the ABAC/chargeback entity set — record the per-type breakdown; tagging that stops at the host boundary is the finding, not noise to average away). **Gen3-first**: graded on source tags / host groups / segments — never management-zone membership or classic-tag mapping; 0 MZs + segments + source tags scores *high* |
| **Engagement** | `QEI` | QEI — sustained active engagement: of humans who query at all, the share doing so on **≥ 10 distinct days in 30** (EC4), after the EC15 machine-actor fence and the `@dynatrace.com` staff exclusion. **Never** bucket/table diversity, never scanned-bytes |

**Context reads — reported, never OES inputs:** AIC (EC12, AI-tier presence + health; analyzer warnings are degraded not failed; GenAI events carry no user id — count volume/days, never "users") · QEC (EC13, query economics — a cost shape, not a maturity score) · EUB (EC9, expected-users baseline — assumed persona terms stay out of the OES). Self-service reads (COC → OwnershipIndex, SSU, the Self-Service Score from EC1) feed the ownership/self-service narrative and the rollup rows per the KPI catalog.

**⚪-gated until inputs exist (excluded from the denominator, never scored 0):** SQI's ticket leg (needs ITSM), SQ-BLP (needs a coverage definition), full SCI/FCS/MCS (need the customer standards file), and SSU's true non-admin form (needs the IAM admin roster — degrades gracefully to the participation rate until then). Each gated item appears in the appendix with the ask that would close it.

## Scoring — OES rollup (computed by the shared engine)

Implemented in [scoring_engine.py](../.dt-eval-common/scoring_engine.py); per-KPI derivations in [effective-consumption.md](../dt-eval-tenant/effective-consumption.md) (the per-KPI sections + the "OES — Overall Effective Score" rollup section), reproduced step-by-step in [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §7.

- **Weights (default = the code-block profile):** Signals **0.35** · Automation **0.35** · Foundation **0.20** · Engagement **0.10**. The source notebook documents an alternative prose profile (0.35/0.20/0.10/0.35) switchable via `oesWeights.profile` in the standards file — **state which profile was used in the method note.**
- **Normalization:** rates as-is, percentages ÷ 100, HHI → `OwnershipIndex = 1 − HHI`. Targets inform the grade bands, **not** the score (no dividing by target).
- **Noise penalty (multiplier, not a pillar):** `OES = RawScore × (1 − NoisePenalty)`, `NoisePenalty = min(0.5, duplicateRate + frequentRate + workflowRollbackRate)` from EC3/EC2 — **each term a proportion (0.02 = 2%). The EC3 query emits percentages; divide by 100 before calling `calculate_noise_penalty`** or the penalty inflates 100×, hits the cap, and silently halves the OES.
- **Foundation gate:** Foundation scored and < 0.5 → OES capped at **70**. Foundation ⚪ (entity tables denied) → gate inactive, the 0.20 weight drops and remaining weights renormalize.
- **⚪ reweighting:** any not-assessable pillar/KPI is excluded from the denominator and the weights renormalize — never scored 0.
- **Outlier / machine-actor guards, applied before any distribution KPI (COC, SSU, QEI):** the `median + 3×IQR` volume fence is a **candidate selector, never a decision** (correction 2026-07-28) — a candidate is excluded only when it *also* matches the machine signature (EC15 for query KPIs: 1–3 distinct `client.client_context`, tool-named context, and/or near-uniform inter-query timing; config-as-code signature for audit KPIs). **A high-volume actor with high context diversity is a power user and must be retained and credited** — fencing on volume alone lowers the adoption score *because* the estate has engaged users. Actors passing both tests are excluded from human-engagement math and counted toward the automation story. In the deliverable's method side-note, identify fenced actors **in de-identified role/tool form only** (e.g. "a service identity used by an external polling tool") — never a raw email or user id; raw identities stay in the run directory. Exclude `@dynatrace.com` logins everywhere QEI is computed and report the excluded share as an aggregate line — staff activity is not customer adoption.
- **Grade bands:** **A ≥ 85 · B ≥ 70 · C ≥ 50 · D < 50**, verbal labels (external) **A Excellent · B Strong · C Building · D Foundational** (`scoring_engine.GRADE_LABELS` — keyed by the `Grade` **enum**, so index as `GRADE_LABELS[oes.grade][0]`; if your build script holds the grade as a **string** (from `Score.grade.value` or a JSON round-trip), re-wrap it first: `GRADE_LABELS[Grade(letter)][0]` — a string key raises, but mixing in `docx_style.grade()`'s different label vocabulary is **silent**, both return plausible strings; pass the result to `cover_page(grade_label=…)`).
- **Confidence flags (per pillar, carried beside every score, per the KPI-catalog convention):** High — all major inputs computable, denominators ≥ 100 · Medium — one or two ⚪ inputs, or denominators 30–100 · Low — denominators < 30 or majority ⚪. (The engine implements the denominator bands and the majority-⚪ rule; the 1–2-⚪→Medium refinement is the analyst's to apply.) Report-level confidence = the **lowest** pillar flag. **Internal-audience** reports treat a Low-confidence bad score as a *scope-more* ask, not a finding; external reports still state the score with its Low flag.
- **Trend (when a prior run exists):** classify each KPI **Chronic** (misses target every week → recommend *activate*, never *restore*) / **Regression** (≥ 15-point in-window drop → ask what changed, check config `history`) / **Improving** (≥ 15-point rise → credit it explicitly). Never narrate a weekly move on thin bins — carry the per-bucket count next to every ratio. **Trend content enters the deliverable only under the Phase-4 comparison rule** (prior report delivered + user asked first); computing it for your own view is always fine.

---

## Inputs to resolve (before any probing)

**Phase 0 — gather inputs from the user.**

1. **Tenant ID** (required) — the unique Dynatrace environment identifier (e.g. `abc12345` from the URL `https://abc12345.apps.dynatrace.com`). Always ask explicitly if not provided in the initial request. Store this for all subsequent reporting, filenames, and run-state directories.
2. **Customer name** (required) — the organization or team name for this tenant. Always ask explicitly if not provided in the initial request. Used in cover pages and output directories to identify the engagement context.
3. **Dynatrace authentication context** — the `dtctl` context name (e.g. `prod`, `staging`) to evaluate. You will prompt for this interactively if not provided; the user's shell must have a valid `dtctl auth login` session active for the chosen context. Validate it points to the tenant ID above (confirm URL match).
4. **Output location** — where to write the `.docx` report. Default is `~/Documents/Dynatrace-Reviews/<customer-name>/current/` — one flat folder per customer, always created, and filenames are `<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` (or `[INTERNAL ONLY]-<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` for an internal edition) with an always-present `(vN)` version marker starting at `v1` (resolved from [output-config.json](../.dt-eval-common/output-config.json)'s `default_output_root`, or override the root with the `DT_EVAL_OUTPUT_DIR` env var — the `current/` subfolder still applied). At run time, the skill confirms and allows the user to redirect it. This governs deliverables only — run-state (`runs/…`) stays in the skill repo, and the intermediate gauge PNG goes to the scratchpad.

   **Tenant layout — ask ONCE per customer, only when there is more than one tenant** (owner decision 2026-08-27). A customer with several tenants may keep every tenant's deliverables side by side in one `current/` folder (**flat**, the default and the existing behaviour), or give each tenant its own subtree (**per-tenant**, `<output-root>/<customer-name>/<tenantId>/current/` with its own `_superseded/` sibling). Run `.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <tenantId>` at Phase 0; when it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user (AskUserQuestion) which they want, pre-filled with *flat*, then record it with `layout.py set --customer "<name>" --layout <choice>` — which also **migrates what is already on disk** (files move, never deleted; a superseded edition stays superseded; a cross-tenant document stays at the customer level). A **single-tenant** customer is never asked and never nests. The answer is stored in `<output-root>/<customer-name>/.dt-eval-layout.json` and **every sibling skill inherits it without asking again** — the layout belongs to the customer, not to a run, because half a customer's reports nested and half flat is two live editions of one report in two folders, which is exactly what `current/` exists to prevent. `DT_EVAL_TENANT_LAYOUT` overrides and suppresses the prompt for headless runs. If `layout.py status` reports deliverables it could not attribute, pass the missing ids with `--tenant <id>` (repeatable) rather than letting them stay behind.
5. **Report audience** (optional) — External (customer-facing; see [report-audiences.md](../.dt-eval-common/report-audiences.md) external rules) or **(Internal)** (Dynatrace-facing; scoring/diagnostic vocab exposed). Default: External. **This skill has no Summary variant** — its External report is scored; the mapping onto the Configuration Review's three-option deliverable question (and the scanner profile per deliverable) is the taxonomy table in report-audiences.md — state it when the user asks for "all" deliverables across skills. Filename becomes `<tenantId>-effective-consumption-<date>(vN).docx` or `[INTERNAL ONLY]-<tenantId>-effective-consumption-<date>(vN).docx` (the `[INTERNAL ONLY]-` filename prefix is the audience decision — one convention family-wide, report-audiences.md follows it). **Grades are an option and off by default on the External edition (owner rule, 2026-08-25):** it carries no score, grade badge, gauge or Score/Grade column unless this run was explicitly asked for a graded customer document — pass `--grades` to the builder then. Do not ask a separate question for it; the Internal edition is always graded. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*. **Follow-up question:** also write the importable companion notebook (`effective-consumption-notebook.json`)? (yes/no; default no).
6. **Standards file (optional)** — if `standards.<tenantId>.json` exists (template: [standards.example.json](../dt-eval-tenant/standards.example.json)), it closes the definition-gated KPIs (SCI/FCS/MCS), sets `oesWeights.profile`, admin rosters, targets, and persona counts. Never guess a standard — an unfilled standards file leaves gated KPIs ⚪.

**Confirm with user.** "Running Effective Consumption Review for tenant `<id>` (<customer-name>), context `<name>`. Output: `<path>`. Report: External [or Internal]. Notebook: [yes/no]. Confirm? (y/n)"

**Initialize run state** (`runlog.py` = [runlog.py](../.dt-eval-common/runlog.py); run with the repo-root `.venv/bin/python`, or any python3 — installed skill copies have no venv). **Run it from this skill's own directory** (`.claude/skills/dt-eval-consumption/`) — the `runs/...` path is cwd-relative, and `runlog.py` refuses a relative run path that would land outside a skill's own `runs/` dir:
```sh
runlog.py init runs/<tenantId>-$(date +%Y-%m-%d)/run.json \
  --tenant <tenantId> \
  --url https://<tenantId>.apps.dynatrace.com \
  --context <context-name> \
  --customer "<customer-name>" \
  --requested-by <email from dtctl auth whoami>
```
(omit `--requested-by` only if whoami is unavailable, e.g. a platform-token context)

**Run state protocol** (shared with all `/dt-eval-*` skills):
1. **Start:** `runlog.py init` as above. **Check the clock before reusing a "same-day" run dir** — if the session crossed midnight, init a new `runs/<tenantId>-<today>/`. If it prints `EXISTS`, you are resuming:
   - **Cache age check:** parse the timestamp from `run.json` and calculate age. **Default: reuse existing cache** unless the cache is **over 24 hours old** OR the user passed **`--fresh`**.
   - **If over 24 hours old**, prompt: *"Cached data is X hours old. Use it anyway, or refresh probes?"* (AskUserQuestion; default `yes` — reuse; `no` — refresh).
   - **If refreshing:** check status, skip `ok`, rerun `error`/`missing`. **Probe-collection deduplication:** if the run has completed probes from another skill (e.g. Config Review from `/dt-eval-tenant`), reuse those cached probes — extract only the subset needed (A4, B1, B3, B7); the EC1–EC17 battery is EC-only and is collected fresh when this report is selected. **Sibling lookup mechanism (each skill keeps its own `runs/`, so "the run" above means the sibling's):** `runlog.py find <tenantId> <date>` locates every sibling run.json across the known run roots (repo per-skill `runs/` dirs and installed-copy locations) — use it instead of guessing paths; read the sibling's `run.json` and raw files directly, and record each reused probe in **this skill's own** run.json with `--note "reused from dt-eval-<sibling> run"` so this run stays self-contained for compare.
   - **If reusing:** skip collection, proceed directly to Phase 2 analysis.
2. **After every probe** (as you go, never in a batch at the end): save raw output to the run dir, then `runlog.py record run.json <probe_id> ok --summary '<compact JSON of the numbers you will cite>' --raw <file>`. Use `unknown` for 403/⚪, `error` for retryable failures. The summary is the contract — every figure the report cites should appear in some probe's summary. **zsh:** alias the runner as an array (`RL=(.venv/bin/python .claude/skills/.dt-eval-common/runlog.py)` → `"${RL[@]}" record …`), never a scalar `$RL` — zsh does not word-split unquoted variables and every record silently fails (field-notes.md). `finalize` refuses (without `--force`) when the run dir holds raw files no record references.
3. **Finalize (EC-specific flags):** after the report saves and verifies — `runlog.py finalize run.json --skill consumption --ec-report <docx-path> --ec-oes <NN> --ec-grade <A|B|C|D> --confidence <High|Medium|Low> --audience <external|internal>` (omit `--overall/--grade/--report`; those belong to the Config Review; `--skill consumption` namespaces the result under `results.consumption` so same-day sibling finalizes never clobber each other; `--confidence` is the report-level flag — the **lowest** pillar confidence, per the rubric above).

**Concurrency:** different tenants run safely in parallel (separate run dirs). Same tenant + date is guarded by `run.lock`; `--wait` blocks until the other instance completes. A lock left behind by a run that died before `finalize` is cleared automatically when its recorded holder is provably gone on this host; a live, foreign-host, or unparseable lock still blocks and needs a deliberate `runlog.py unlock`.

---

## Phase 1 — Probe Collection (read-only)

**A. The §D battery — EC1–EC17** (definitions: [probes-consumption.md](../dt-eval-tenant/probes-consumption.md) (§D); verbatim query text: [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §7 — a **repo-root** file that installed skill copies (`~/.claude/skills/`) do not ship; when it is absent, the same queries live in [effective-consumption.md](../dt-eval-tenant/effective-consumption.md)'s per-KPI sections, which ARE shipped — use those). All reads are behavioral — `dt.system.events`, `dt.system.query_executions`, `dt.davis.problems`, `dt.entity.*` — over a **30-day window**:

| Read | Feeds | What it measures |
|---|---|---|
| EC1 | COC/SSU/Self-Service | Config ownership concentration (HHI) over human config changes (`isNull(authentication.token)` is the human/automation switch) |
| EC2 | WFR, WOS | Workflow executions: terminal runs deduped by execution id, completed/triggered |
| EC3 | PUI + noise penalties | Davis problems deduped by `display_id`: root-cause/impact/actionable rates + duplicate/frequent/muted shares |
| EC4 | QEI | Query executions by human users: sustained days-active distribution |
| EC5 | SCI/FCS/MCS skeletons (🔧 gated) | Entity tag/host-group coverage skeleton — zero-fill required keys with no coverage |
| EC6 | OES | The rollup itself |
| EC7 | WOS, SQI leg, delivery | `dtctl get workflows` config ↔ EC2 events stitch: ownership, davis-problem trigger ids, dormant lanes |
| EC8 | CCS (collection-only) | Token-driven share of all config changes — always decompose via EC10 before crediting |
| EC9 | EUB (context) | Expected-users baseline from cheap entity census vs actual query users |
| EC10 | CCS-Q | Declarative CaC (schema-broad, batchy) vs integration churn (1–2 schemas hammered daily) |
| EC11 | SMX | `CUSTOM_ALERT` share of problems, per-category durations, routing-intent coverage |
| EC12 | AIC (context) | Analyzer executions + Davis CoPilot GenAI events — presence + health |
| EC13 | QEC (context) | Scanned bytes, on-demand share, consumption source mix (`client.client_context`) |
| EC14 | FPR | Event-driven share of workflow runs by `trigger.type`; footprint vs estate scale |
| EC15 | QEI fence | Machine-actor audit of top query actors — pollers under user identities |
| EC16 | SMX corroboration | Problem-title patterns: concentration, severity-prefix convention (imported rule library proof) |
| EC17 | Foundation_baseline | Baseline metadata standard: key families + host groups + segment effectiveness (tests each segment's `variables` DQL — defined ≠ effective) |

**B. Cross-correlation subset — A4, B1, B3, B7** (from the shared tenant battery; reused from a same-day cache when available):
- **A4 — workflows** (`dtctl get workflows -o json`): trigger classification (schedule ⚠️ / davisProblem ✅ / davisEvent 💡) — the config side of the EC7 stitch and the WFR interpretation.
- **B1 — log ingest health**: the one-pass 2-minute health scan (routing, ABAC, enrichment, parsing, volume).
- **B3 — estate coverage**: monitoring-mode split, stale/INACTIVE share — the denominator context that weighs QEI's sustained-user count against estate size.
- **B7 — topology depth**: service + process-group census — the impact-cardinality context behind a low PUI.

Secondary shared inputs consumed where present: A3 (SLOs) + A28 (connectors) for the EC9 census, A6 (segments) for EC17, B6 (host groups) for EC17, B4 for the PUI cross-read, B14 (`dt.billing.*`) as the EC13 scan-to-ingest denominator and the internal rate-card depth table.

**C. Scope limits (cost guardrails, non-negotiable):**
- `dt.system.events` / `dt.system.query_executions` / `dt.davis.problems` are system-scoped and cheap — full **30-day** windows are the §D standard; always keep the selective `event.kind`/`event.type` filters.
- Never run unscoped `fetch logs` beyond a **2-minute one-pass aggregate** (B1 uses `from:-2m` + `countIf()`; it is the only raw-log read in this battery).
- Group by `dt.system.bucket` (NOT `dt.bucket.name`). No open-ended log/span/metric scans. Total scan is typically low single-digit GB — the `dt.system.*` tables are small.

**D. Sensitive data (mandatory, per [security-sensitive-data-policy.md](../dt-eval-tenant/security-sensitive-data-policy.md)):** the EC battery reads actor identifiers (`user.id`, `user.email`) from audit events and query executions. **Redact before writing raw outputs to the run dir** — replace `user.email` values with `***REDACTED_EMAIL***` in saved files wherever the analysis doesn't need the literal address (day-count and HHI math key on `user.id`; the `@dynatrace.com` test can be applied at query time and stored as a boolean/aggregate). Emit the operator WARNING when actor PII is detected. **Never share run directories** — that is the second layer, not the mitigation. Deliverables carry aggregates only: fenced/outlier actors appear in de-identified role/tool form in the method side-note, the `@dynatrace.com` exclusion is reported as a share, never a user list.

---

## Phase 2 — Analyze & Score

**A. Compute the KPI catalog** per [effective-consumption.md](../dt-eval-tenant/effective-consumption.md): apply the outlier fence (`median + 3×IQR`) before COC/SSU/QEI **as a candidate selector — the machine-signature test decides, and power users are retained** (§1/§9b); apply the EC15 machine-actor fence and the `@dynatrace.com` exclusion to QEI; decompose CCS → CCS-Q before any automation credit; zero-fill required standards keys with no coverage. **A zero KPI must carry its verification** (§4b rule, 2026-07-29): record `trigger_type_populated: true|false` in EC2/EC14's summary and `token_actor_check: true` for CCS-Q — **never average FPR or CCS-Q as 0 into the Automation pillar unless the verification flag is true** (an unverified zero is a possible non-measurement = ⚪, and the difference decides whether Automation is ~40 or ~80).

**B. Score with the shared engine** (`../.dt-eval-common/scoring_engine.py`, lowercase pillar keys — per-run build script pattern):

```python
engine = ScoringEngine()          # optional: weights=, noise_penalty_cap=, foundation_gate_score=
signals    = engine.score_pillar({"PUI": pui, "SMX": smx}, denominators={"problems": n}, pillar_name="Signals")
automation = engine.score_pillar({"WFR": wfr, "WOS_Composite": wos, "FPR": fpr, "CCS-Q": ccsq}, denominators={"executions": n}, pillar_name="Automation")
foundation = engine.score_pillar({"Foundation_baseline": fb}, denominators={"hosts": n}, pillar_name="Foundation")   # or None if ⚪
engagement = engine.score_pillar({"QEI": qei}, denominators={"users": n}, pillar_name="Engagement")
# EC3 emits these rates as PERCENTAGES — convert to proportions (÷100) first:
penalty = engine.calculate_noise_penalty(duplicate_pct/100, frequent_pct/100, rollback_pct/100)
oes = engine.calculate_oes(signals_score=signals, automation_score=automation,
                           foundation_score=foundation, engagement_score=engagement, noise_penalty=penalty)
```

**Every rate or proportion that reaches PROSE goes through `docx_style.fmt_rate()`** — never an f-string on the raw value. The engine returns full-precision floats (`penalty`, `wos`, and any `numerator/denominator` ratio), the table helpers round via `fmt_score`, and narrative sentences used to round nothing: `0.0016`, `0.9898`, `0.9658` shipped into derivation prose, and the pre-delivery scan caught them only *after* `doc.save()`, so each one cost a rebuild. `fmt_rate` renders a percentage (`0.16%`, `98.98%`), which keeps the magnitude a fixed `:.3f` would flatten to `0.002`:

```python
from docx_style import fmt_rate
method_note(doc, f"Noise penalty {fmt_rate(penalty)} applied to the raw OES; "
                 f"WOS composite {fmt_rate(wos)}.")
```

**C. Interpretation rules (the pillar earns its keep here):** never grade automation on reliability alone (WFR 98.9% + raw CCS 0.84 was once misread as "automation excellence" — EC10+EC14 first); diagnose a low PUI with SMX and EC16 before blaming Davis; the EC7 stitch beats either surface alone; AIC is presence + health, not a score; a high-volume maintenance-window writer is its own hygiene finding (cross-check EC3 `underMaint`).

---

## Phase 3 — Produce Report

Build with a Python script in the scratchpad importing the shared [docx_style.py](../.dt-eval-common/docx_style.py) — `sys.path.insert()` the **resolved absolute path** to `.claude/skills/.dt-eval-common/` (the relative form only works with the skill directory as CWD) — run with the repo `.venv/bin/python` **or any python3 with python-docx** (installed skill copies have no venv; verify the dependency before building, fail loudly). Parse dtctl JSON via the shared [dt_json.py](../.dt-eval-common/dt_json.py) loader (lenient + envelope-aware + zero-row-shape normalizing). Pin the run date once from the run-directory name — never re-derive via `date.today()`. Gauge PNG (`render_gauge_png`, Pillow optional → text badge fallback) goes to the scratchpad, never beside the deliverable.

**Cover:** title **"Dynatrace Effective Consumption Review"**; on an edition that carries grades (Internal always, External only with `--grades`), the OES as its own cover grade (`cover_page(..., grade_label=GRADE_LABELS[oes.grade][0], gauge_path=..., requested_by=<dtctl auth whoami email>)`); internal audience adds the *"Dynatrace internal — not for customer distribution"* subtitle. The AI-disclosure footnote (auto-added by `cover_page` via `requested_by=`) stays in place for every audience — never pass `disclosure=False` or reword it.

**Executive summary (~1 page, prose):** the consumption verdict sentence, the report-level confidence flag, 3–5 headline cross-correlated findings tied to business impact, what to do first. **The OES + grade belong here only on an edition that carries grades** (the Internal edition always; an External one only when the run passed `--grades` — owner rule 2026-08-25): on the default customer edition the verdict sentence carries the judgment in words, and the pre-delivery scan fails an "Overall Effective Score 61" line that survives into it.

**How to read this report:** legend ✅/💡/⚠️ only, plus one sentence that unassessable items are excluded from every score and listed as appendix footnotes.

**Pillar scorecard — assessed pillars only** (⚪ items never appear in the body: no scorecard rows, no N/A bars — a one-line footnote points to the appendix roster). **External, default (ungraded):** no bar chart — `pillar_summary_table(doc, scores, grades=False)` renders **Pillar | Status**, and the builder's own Pillar/Status/Confidence table carries the flags. **External with `--grades`:** `pillar_bar_chart` and/or the weight-free table — call `pillar_summary_table(doc, scores, labels=EXTERNAL_LABELS)` with **no weights argument** (weights are optional since v1.5.2; when absent the Weight column is omitted entirely); external reports never show pillar weights. **Internal:** the weights-bearing `pillar_summary_table(doc, scores, weights)` belongs in the OES-derivation section. Either way, render grade letters/labels from `scoring_engine.GRADE_LABELS` — the table's built-in grade column uses `docx_style.grade()`'s different vocabulary.

**Findings (main body):** one `finding_section` per ⚠️/💡 with `means=` (the cross-correlated conclusion), `consequence=` (both directions, cost of inaction explicit), `action=[sequenced steps]`, and the method note flagging composition upgrades, the weight profile, and any fenced actors.

**Verify-yourself section:** client-runnable DQL per finding — the **V18** twin battery in [verification-queries.md](../dt-eval-tenant/verification-queries.md) maps to EC1–EC17, with the GUI map row (Notebooks import / Workflows app / Account Management). The external document presents **customer-runnable DQL and GUI paths only** — never the internal probe/read IDs (`EC*`, `A*`, `B*`, `V*`) they twin.

**Appendix:** method (client-safe: what was measured, the 30-day window); the ⚪ roster — **external:** each excluded input in plain language with the scope/definition that would include it next time (no repo file names or internal machinery); **internal:** the verbatim, copy-pasteable ask roster per report-audiences.md; References (docs.dynatrace.com authoritative, BPN further reading); the standing community-tool disclaimer (`footer_disclaimer(label="Effective Consumption Review")`). Call `finalize_tables(doc)` once before `doc.save()`.

**Audience variants** ([report-audiences.md](../.dt-eval-common/report-audiences.md) — voice changes, math never does):
- **External:** grades and scores stay; derivation does not. No pillar weights, raw HHI, rate-card tiers/prices, sales vocabulary, diagnostic shorthand (use the substitution table — "shelfware" → "opportunity to activate"), probe/read IDs, or dtctl context names.
- **Internal is NOT a reworded external** — it layers three components: (1) a **summary-of-key-findings layer** — condensed per-pillar diagnostic bullets with grade + confidence flag, the top 3–5 ⚠️/💡 priorities in diagnostic voice, and flagged ⚪ inputs; (2) **exposed scoring machinery** — the OES derivation table (pillar | weight | score | contribution), the noise-penalty line, Foundation-gate status, outlier-guard note, per-pillar confidence flags; (3) **account-team material** — talk-track + expansion hook per pillar, the consolidated talk-track matrix, and the rate-card consumption-depth table (⚪ the whole section if `dt.billing.*` is unreadable). Internal grade labels add the lifecycle read (A *reference material* · B *expansion candidate* · C *enablement needed* · D *at-risk — CS intervention*) alongside the external verbal labels.

**Companion notebook (if requested in Phase 0):** write `effective-consumption-notebook.json` beside the report — the importable Dynatrace notebook with the WFR/COC/PUI/QEI/OES tiles. **Record it with `--variant notebook`** (`runlog.py finalize … --ec-report <notebook.json> --variant notebook`) so it files under `reports.effective_consumption.notebook` beside the `.docx` rather than displacing it — the variant key defaults to the deliverable's audience, and the notebook is an edition, not an audience.

---

## Phase 4 — Verify, Deliver, Finalize

**Pre-delivery scan (mandatory, paragraphs AND table cells) — run the shared scanner, never re-derive the patterns from prose:**
- **External:** `.venv/bin/python ../.dt-eval-common/verify_docx.py <file> --profile consumption` — the `consumption` profile carries the full internal/cross-tenant/security marker sets **plus** the probe-ID vocabulary this battery leaks most easily (`EC\d+`/`A\d+`/`B\d+`/`V\d+`), and drops the scoring-machinery patterns this report type is required to carry (the method note names pillars). It also enforces the C7 email rule (exactly one distinct address — the mandated AI-disclosure attribution; any second is a failure).
- **Internal:** `--profile internal` — machinery stays, cross-tenant/dollar/run-state markers stay banned, and the internal-distribution cover subtitle is asserted.
- **Both audiences, profile-independent:** `gen2-expansion` (no remediation that extends or creates a classic construct — Gen3-first, remediate at source), `foreign-customer-name`/`foreign-org-name` (hard rule 5 in its name form), and **distribution marking on every page** (build with `new_report_doc(internal=True)` for the internal twin — red `DYNATRACE INTERNAL — NOT FOR CUSTOMER DISTRIBUTION` in header and footer — and `internal=False` for the customer-facing report — the `AI Generated Evaluation` watermark) run under every profile; `build_reports.py` passes the subject customer so a redirected build still runs the name check.
- **C7 addendum (both audiences, beyond the scanner):** if redaction occurred during collection (any probe summary carries a `***REDACTED_*` marker), assert the corresponding mandatory security finding is present in the report — never suppress it. Also grep the text for dtctl context names used this run (tenant-specific — a static pattern list cannot know them).

**Verification-after-save:** reopen the file with python-docx, assert paragraph/table counts are non-zero, run the audience-appropriate scan, print the section headings. Then report to the user: the **full resolved output path** (`<output-root>/<customer-name>/current/…`), audience, **OES + grade** with report-level confidence flag, top 3 sequenced actions, and every ⚪ with the scope or definition needed to close it next time.

**Finalize:** `runlog.py finalize run.json --skill consumption --ec-report <path> --ec-oes <NN> --ec-grade <G> --confidence <High|Medium|Low> --audience <a>` — `status` and `compare` surface the EC record on future runs. **`--skill`/`--confidence` are the same mandatory pair as Phase 3's finalize line above** — this is the same call, not a second variant; a finalize missing either still writes the score but skips the `headline` block the `dt-eval-rollup` skill depends on.

**Comparison rule:** if prior completed runs exist for this tenant, ASK before building whether to compare — and comparison content enters the deliverable only when the prior report was itself delivered to the client.

**Check BOTH directions — run state and deliverables diverge.** `runlog.py delivered <tenantId>` lists the dates the output tree holds reports for, independent of `runs/`. Absent run state is *not* evidence of a first review: a refresh, another machine, or a cleanup empties `runs/` while delivered reports remain. Deliverables found without run state still count as "a prior review exists" for the comparison rule — say so in the run summary and initialise a run to hold the delta evidence, rather than treating a long-standing tenant as new. (`runlog.py find` now prints this warning itself when it comes up empty.)

---

## Hard rules & non-negotiables

1. **Read-only only** — never `apply/create/delete/edit/update/enable/restore/share` or any `exec` verb; never `dtctl ctx token`.
2. **Active engagement, never vanity metrics** — QEI is sustained distinct-day use weighed against estate size; never object counts, query diversity, or scanned bytes. Never inflate a pillar from a single ✅ check.
3. **No dollar figures attached to customer numbers; no peer benchmarks — either audience.**
4. **⚪ never in the body** — appendix footnotes only; excluded from every denominator, never scored 0.
5. **Gen3-first** — Foundation graded on source tags / host groups / segments, never management zones or classic-tag mapping; never recommend a classic construct.
6. **Always standalone** — never combined with the Configuration Review **in one invocation**; this is an invocation rule, not an engagement rule — an engagement needing both documents (or all four family deliverables) runs each skill independently in sequence, sharing the probe cache.
7. **Identical math across audiences** — audience changes what is shown, never what is computed.
8. **Cost guardrails** — unscoped `fetch logs` ≤ 2-minute one-pass aggregates; keep the selective filters on every 30-day system-table read.
9. **Citations bind both audiences** — docs.dynatrace.com authoritative (verify each recommendation this run); BPN further-reading only.

---

## Running this skill

```bash
# Interactive mode (prompts for context, output location, audience, notebook)
/dt-eval-consumption

# OR environment override (output location, headless)
DT_EVAL_OUTPUT_DIR=~/my-reviews /dt-eval-consumption
```

The skill will: confirm inputs → collect/reuse probes (EC1–EC17 + A4/B1/B3/B7) → compute KPIs and fences → score pillars + OES with the shared engine → build the standalone `.docx` (and optional notebook) → scan, verify, finalize.

---

## Troubleshooting

**Q: "dtctl: context not found"** — ensure `dtctl auth login --context <name> --environment <url>` is active and the context name matches.

**Q: "403 / unknown on dt.system.query_executions or dt.davis.problems"** — the context token lacks the read scope for that table. Record `unknown`, mark the dependent KPIs ⚪, and list the scope grant in the appendix roster (the V18 twin names the scopes a customer's own credentials usually have).

**Q: "Foundation came back ⚪"** — entity tables denied. The gate is inactive, the 0.20 weight reweights away; the appendix names the entity-read scope that would score it. (Since the EC17 baseline, ⚪ Foundation should be rare.)

**Q: "OES dropped vs the last run but nothing changed"** — check the method note first: composition upgrades (CCS→CCS-Q, +FPR, +SMX, Foundation baseline) legitimately move scores. `runlog.py compare` shows per-probe deltas.

**Q: "One user dominates every distribution"** — that's the outlier fence's job: fence at `median + 3×IQR`, name the actor in the method side-note, recompute. If the actor is a service identity, it also feeds the CCS/integration story.

**Q: "Some probes failed"** — check the repo-relative `runs/<tenantId>-<date>/` raw files and `.err` outputs; `runlog.py status` buckets ok/⚪/rerun-these/missing.

---

## Shared components (monorepo)

This skill relies on:
- **Model source of truth** — [effective-consumption.md](../dt-eval-tenant/effective-consumption.md) (KPI catalog, formulas, validation history) + [effective-consumption-notebook.json](../dt-eval-tenant/effective-consumption-notebook.json) (importable companion).
- **Probes** — [probes-consumption.md](../dt-eval-tenant/probes-consumption.md) (§D, EC1–EC17) + the shared §A/§B battery ([probes-config.md](../dt-eval-tenant/probes-config.md) / [probes-grail.md](../dt-eval-tenant/probes-grail.md), the A4/B1/B3/B7 subset).
- **Scoring engine** — [scoring_engine.py](../.dt-eval-common/scoring_engine.py) (pillar scoring, noise penalty, Foundation gate, OES, confidence flags, GRADE_LABELS).
- **Report audiences** — [report-audiences.md](../.dt-eval-common/report-audiences.md) (External vs. Internal voice and structure).
- **Verification queries** — [verification-queries.md](../dt-eval-tenant/verification-queries.md) (V18 = the EC1–EC17 twin battery; client-runnable DQL).
- **Report style & run-state** — [docx_style.py](../.dt-eval-common/docx_style.py), [runlog.py](../.dt-eval-common/runlog.py) (same house style and run-log framework as `/dt-eval-tenant`).
- **Output config** — [output-config.json](../.dt-eval-common/output-config.json) (default output root, prompt mode).
- **Standards template** — [standards.example.json](../dt-eval-tenant/standards.example.json) (closes the gated KPIs; `oesWeights.profile`).
- **Field notes** — [field-notes.md](../dt-eval-tenant/field-notes.md) (read before improvising DQL — verified field names, error semantics, e.g. `countDistinctIf` does not exist).
- **Manual reproduction** — [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) §7 (verbatim query text for every KPI + the 8-step OES rollup). Repo-root file, absent from installed skill copies — fall back to [effective-consumption.md](../dt-eval-tenant/effective-consumption.md)'s per-KPI sections (shipped, same queries).

All in this monorepo: domain docs under `.claude/skills/dt-eval-tenant/`, shared engine under `.claude/skills/.dt-eval-common/`. Keep them in sync when any skill updates shared components.

## Building the report

**Use the committed builder — never hand-write one.** `python3 build_consumption_report.py <run_dir> <content.py> [--external] [--internal]`

The builder holds the structure; a per-run content module (scratchpad only — it carries tenant data) holds every number and sentence, and a missing required field raises rather than shipping a placeholder. It scans each edition before saving and files earlier editions away only on a clean result.

This skill had no committed builder until 2026-08-11, so every run wrote a throwaway one and nothing enforced the rules above. On a sibling skill that same gap shipped four customer-facing reports in the internal diagnostic voice. The builder is where those rules now live:

- every finding carries evidence, meaning, consequence and sequenced steps;
- every pillar score is rendered with its own confidence flag, because a Low flag is meaningless unless it travels with the number it qualifies;
- a ⚪ finding cannot reach the body and must go to `scope_notes`;
- the customer edition is scanned under the `consumption` profile, which since 2026-08-10 also enforces the external-voice substitution table.
