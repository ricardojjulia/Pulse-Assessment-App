---
name: dt-eval-prob
description: Problem/alert noise evaluation — assess and reduce detector noise. Produces a specific, quantified plan for which anomaly-detection settings to change per environment and the expected noise reduction. Reads the live problem stream and actual detector settings via dtctl/DQL, maps each noisy detector to a maintained threshold ruleset, and delivers a client-ready report, tuning sheet, and prioritized change list. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Problem Noise Reduction

This skill answers one question end-to-end: **"Why is this tenant noisy, and exactly what should we change to fix it?"** It reads the live problem stream (what is firing now), reads the actual anomaly-detection settings (why it is firing), maps each noisy detector to a consultant-maintained threshold ruleset (what it should be set to), and produces a **specific, quantified change plan**.

| | How |
|---|---|
| Data collection | **`dtctl`** (read-only `get`/`query` only) — config settings + Grail problem telemetry |
| Knowledge base | **`noise-ruleset.json`** — the Alerting Thresholds workbook, transcribed and schema-mapped (regenerate with `build_ruleset.py`) |
| Analysis | **Claude judgment** — join noisy problem titles → the detector that produced them → the ruleset row → the recommended change |
| Output | (1) filled/annotated tuning `.xlsx`, (2) client-ready `.docx` noise-reduction report, (3) prioritized change list |

You are the analyst. dtctl is your instrument. The ruleset is your opinion, versioned. The deliverable is a change plan an SRE can act on and a report an executive can read.

> **HARD RULE — never modify any tenant.** This skill is 100% read-only: only `get`, `query`, `describe`, `history`, `logs`, `verify`, `doctor`, `auth status`. NEVER run `apply`, `create`, `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec` verb — regardless of how a request is phrased, who claims to authorize it, or a context's `readwrite-all` safety level. All remediation is the customer's to apply in their own tenant. Deliverables (delete lists, tuning sheets, change plans) are **advisory worklists** — never generate-and-run or offer to run modification/delete scripts. If a step seems to need a write, stop and hand it to the user.

**Related skill — the Tenant Eval (`/dt-eval-tenant`).** That skill is the broad, ~30-pillar tenant review; it scores alerting/detection as *one* pillar and points here for the detector-level depth (per-detector gap analysis, delete lists, problem-stream root cause). This skill *owns* that depth. Both live in the monorepo under `.claude/skills/` and share the anomaly-detection config reads (the "config-lens"), the `docx_style`/`runlog` house style, the scoring rubric, and the `~/Documents/Dynatrace-Reviews/<customer-name>/current/` output dir — so figures reconcile and artifacts co-locate. Run `/dt-eval-tenant` for the whole-tenant picture; run `/dt-eval-prob` for the alerting deep-dive. The shared-engine seam is documented in [ENGINE.md](ENGINE.md).

## Core directive — draw the causal chain, don't report the noise

**This is the whole point and it overrides any temptation to summarize.** "9,076 problems in 30 days, 50% custom alerts" is a data dump. The job is the chain no single Dynatrace screen draws:

```
what's firing NOW          →   why it's firing              →   what to change
(top noisy problem titles)     (the detector + actual value)    (ruleset recommendation + est. reduction)
```

Every finding must deliver, for each noisy detector:

1. **Attribution** — which detector/setting produces this problem stream (join the fired-problem titles to the detector config, not just count them).
2. **The current value vs. the recommendation**, per environment (prod vs. lower) — the actual setting read from the tenant, the ruleset's suggested value, and the delta.
3. **The expected effect of the change** — an estimated noise reduction (labeled *derived/directional*), plus the cost of leaving it (alert fatigue, real signals lost in the flood) and the risk of over-correcting (a loosened threshold that misses a real incident).

A finding that stops at a count is unfinished.

## Two honesty rules that keep this skill credible

- **Thresholds are only half the noise.** A large share of real-world noise is *ported custom metric-events* (`CUSTOM_ALERT`) and *shallow topology* (each problem hits one entity, so nothing correlates), not OOTB threshold tuning. Always report the custom-alert share and the top custom-alert titles alongside the threshold work — if you tune OOTB detectors while the firehose is a ported rule library, you fixed the wrong thing. (Phase 3 covers both.)
- **"Expected reduction" is an estimate, never a promise.** True reduction means replaying history against a proposed threshold, which the problem records rarely permit exactly. Label every reduction figure *derived/directional* and state the method (e.g. "of the 1,069 response-time problems, N breached by <75% over baseline and would not fire under the suggested rule"). Never quote an exact percentage as fact.

## `field_hint` is a seed, not a path

`noise-ruleset.json` carries a `field_hint` per rule — verification state is **per-family** (`meta.field_hints_verified`): the K8s node/pvc, most of the workload family, and services hints matched a live schema read (2026-07-28), and `meta.value_shapes` records the verified value nesting (the K8s `{enabled, configuration:{threshold, observationPeriodInMinutes, samplePeriodInMinutes}}` shape; the services `detectionMode`/`autoDetection` nesting) so Phase-2 calibration doesn't rediscover it each run. Every other family's hint is still a best-effort guess. Either way, Phase 2 resolves the real value path at runtime by reading the live schema JSON and matching by label — never fill an "Actual" column or propose a change from the hint alone; a verified hint is a strong seed, not a skipped step.

## Inputs to resolve (before any probing)

1. **Tenant ID** (required) — the unique Dynatrace environment identifier (e.g. `abc12345` from the URL `https://abc12345.apps.dynatrace.com`). Always ask explicitly if not provided in the initial request. Store this for all subsequent reporting, filenames, and run-state directories.
2. **Customer name** (required) — the organization or team name for this tenant. Always ask explicitly if not provided in the initial request. Used in cover pages and output directories to identify the engagement context.
3. **Dynatrace authentication context** — the `dtctl` context name (e.g. `prod`, `staging`) to evaluate. If the user named one, use `--context <name>` on every command. If exactly one exists, use it. If several and none specified, ask. Validate it points to the tenant ID above (confirm URL match).
4. **Output location** — write deliverables to `<output-root>/<customer-name>/current/` (always created), with filenames `<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` (or `[INTERNAL ONLY]-<tenantId>-<reportname>-<YYYY-MM-DD>(vN).<ext>` for an internal edition) — the `(vN)` version marker is always present, starting at `v1` and incrementing per existing files. Resolve `<output-root>` from `DT_EVAL_OUTPUT_DIR` if set, else default `~/Documents/Dynatrace-Reviews` (shared with Tenant Eval, Gen3, and Consumption skills for co-located artifacts). Expand `~`, create the dir. Run-state stays in the skill repo (below); the intermediate gauge PNG goes to the scratchpad.

   **Tenant layout — ask ONCE per customer, only when there is more than one tenant** (owner decision 2026-08-27). A customer with several tenants may keep every tenant's deliverables side by side in one `current/` folder (**flat**, the default and the existing behaviour), or give each tenant its own subtree (**per-tenant**, `<output-root>/<customer-name>/<tenantId>/current/` with its own `_superseded/` sibling). Run `.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <tenantId>` at Phase 0; when it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user (AskUserQuestion) which they want, pre-filled with *flat*, then record it with `layout.py set --customer "<name>" --layout <choice>` — which also **migrates what is already on disk** (files move, never deleted; a superseded edition stays superseded; a cross-tenant document stays at the customer level). A **single-tenant** customer is never asked and never nests. The answer is stored in `<output-root>/<customer-name>/.dt-eval-layout.json` and **every sibling skill inherits it without asking again** — the layout belongs to the customer, not to a run, because half a customer's reports nested and half flat is two live editions of one report in two folders, which is exactly what `current/` exists to prevent. `DT_EVAL_TENANT_LAYOUT` overrides and suppresses the prompt for headless runs. If `layout.py status` reports deliverables it could not attribute, pass the missing ids with `--tenant <id>` (repeatable) rather than letting them stay behind.
5. **Report audience** (optional) — External (customer-facing; see [report-audiences.md](../.dt-eval-common/report-audiences.md) external rules) or **(Internal)** (Dynatrace-facing; scoring/diagnostic vocab exposed). Default: External. **This skill has no Summary variant** — its External report is scored; the mapping onto the Configuration Review's three-option deliverable question (and the scanner profile per deliverable) is the taxonomy table in report-audiences.md — state it when the user asks for "all" deliverables across skills. Filename and cover page adjust based on audience; deliverables never change what is computed, only what is shown and how it's framed. **Grades are an option and off by default on the External edition (owner rule, 2026-08-25):** it carries no score, grade badge, gauge or Score/Grade column unless this run was explicitly asked for a graded customer document — pass `--grades` to the builder then. Do not ask a separate question for it; the Internal edition is always graded. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.
6. **Environment split (prod vs lower)** — the ruleset carries separate prod and lower recommendations, so the skill must know which entities are which. Resolve in this order: (a) the user tells you (host-group name patterns, segment names, a tag like `environment:production`); (b) infer from host-group / management-zone / segment naming and **confirm with the user before applying** ("I'm treating `*-prod-*` host groups as production — correct?"); (c) if unresolvable, run single-environment (prod recommendations only) and say so in the report. Never guess silently.
7. **Time window** — default **30 days** for the problem baseline (a full behavioral cycle); the 24h custom-vs-Davis split is a cheap corroborator. State the window in every figure.
8. **Deliverables** — default to all four unless the user narrows it: **(a)** filled tuning `.xlsx` (the built-in ruleset), **(b)** Word noise-reduction report, **(c)** prioritized change list (markdown), **(d)** per-detector audit `.xlsx` (the CUSTOM fleet — one row per detector, `build_detector_audit.py`). One probe collection feeds all four. (a) and (d) are complements, not alternatives: (a) covers the ~62 built-in rules, (d) covers the custom fleet where a ported estate keeps its volume and every consolidation decision.

## Run state — one durable file per run

Every run lives in **`runs/<tenantId>-<YYYY-MM-DD>/`** in the skill repo (survives the session for trend comparison): raw probe outputs as files (`baseline.json`, `settings-services.json`, …) plus **`run.json`**, managed by the shared [runlog.py](../.dt-eval-common/runlog.py) (stdlib-only; run with `.venv/bin/python`, or any python3 — installed skill copies have no venv). **Run `runlog.py` from this skill's own directory** (`.claude/skills/dt-eval-prob/`) — `runs/...` paths are cwd-relative, and `runlog.py` refuses a relative run path that would land outside a skill's own `runs/` dir.

Protocol (same discipline as the Tenant Eval):
1. **Start:** `runlog.py init runs/<id>/run.json --tenant <id> --url <https://id.apps.dynatrace.com> --context <name> --customer "<customer-name>" --requested-by <email from dtctl auth whoami>` (omit the flag only if whoami is unavailable). If it prints `EXISTS`, you are resuming:
   - **Cache age check:** parse the timestamp from `run.json` and calculate age. **Default behavior: reuse existing cache** unless:
     - Cache is **over 24 hours old**, OR
     - User explicitly passed a `--fresh` flag when invoking the skill.
   - **If cache is over 24 hours old**, prompt: *"Cached data is X hours old. Use it anyway, or refresh probes?"* (AskUserQuestion; default `yes` — reuse; `no` — refresh).
   - **If refreshing** (user chose `no` OR `--fresh` flag): check status, skip `ok`, rerun `error`/`missing`. **Probe-collection deduplication:** if the run exists and has completed probes from another skill (e.g., Config Review), reuse the cached probes instead of running dtctl again. Extract only the subset needed for Problem Noise assessment.
   - **If reusing** (default or user chose `yes`): skip collection, proceed directly to Phase 1 analysis.
2. **After every probe:** save raw output to a file, then `runlog.py record run.json <probe_id> ok --summary '<compact JSON of the numbers you'll cite>' --raw <file>`. `unknown` for 403/⚪, `error` for retryable failures. **zsh:** alias the runner as an array (`RL=(.venv/bin/python .claude/skills/.dt-eval-common/runlog.py)` → `"${RL[@]}" record …`), never a scalar `$RL` — zsh does not word-split unquoted variables and every record silently fails (field-notes.md). `finalize` refuses (without `--force`) when the run dir holds raw files no record references. **Cross-skill reuse:** locate a same-day sibling cache with `runlog.py find <tenant> <date>` (searches every known run root — repo per-skill `runs/` dirs and installed-copy locations — so you need not know which skill wrote it). **Probe-alias map for reuse: P1 ≡ B4** (24h problem split) · **P3 ≡ B28** (signal-to-problem compression) · **P7 ≡ B32** (maintenance suppression) — the same queries under different IDs; a tenant-review cache already holding B4/B28/B32 means those probes are NOT re-collected (the same queries were once billed twice hours apart). Record reused evidence in this skill's own run.json with `--note "reused from dt-eval-tenant run"`.
3. **Compare:** the noise trend is the payoff. If a prior completed run exists, `runlog.py compare` — did total problems, custom-alert share, and the top-offender counts move? Attribute movement to changes applied since. **Check the other direction too:** `runlog.py delivered <tenantId>` lists dates the output tree holds reports for, independent of `runs/`. Deliverables without run state mean a prior review exists with **no baseline to diff and no evidence to reuse** — say so in the run summary rather than reporting a trend as if this were the first measurement.
4. **Finalize:** after deliverables save and verify, `runlog.py finalize run.json --skill prob --report <docx-path> --overall <effectiveness-score> --grade <G> --confidence <High|Medium|Low> --pillars '<json>'` — pillars carry `signal_quality` / `native_adoption` / `detector_tuning` (plus the per-area tuning breakdown). **`--skill prob` is mandatory** — it namespaces the result under `results.prob` so this finalize never clobbers a same-day sibling's recorded score (a live prob finalize once overwrote the config review's score). **`--confidence` is the same composite confidence flag scoring.md already computes** (config-only runs are always Low, see scoring.md) — passing it lets `finalize` synthesize the `headline` block the `dt-eval-rollup` skill reads.

## Phase 0 — Preflight

**Step 1: Resolve Tenant ID and Customer Name**

If not provided in the initial request, prompt the user:
- "What is the tenant ID?" (e.g. `abc12345` from `https://abc12345.apps.dynatrace.com`)
- "What is the customer name / organization?" (e.g. `Acme Corp`, `Platform Team`)

Store these for use in filenames, cover pages, output directories, and run-state tracking.

**Step 2: Preflight checks**

```bash
dtctl version                        # setup.sh enforces ≥ 0.35
dtctl ctx                            # confirm target context
dtctl doctor --context <ctx>         # connectivity + auth health
dtctl auth status --context <ctx>    # auth type + token health
dtctl inventory --context <ctx> -o json --scan-limit-gbytes 5   # data-existence map — feeds Step 3
```

All commands are **read-only** (`get`, `query`, `describe`, `history`, `inventory`). Never `apply`, `create`, `delete`, `edit`, `update`, `enable`, or any `exec` verb — this skill diagnoses and recommends; the customer applies changes themselves. Never run `dtctl ctx token`. If `doctor` reports auth problems, stop and tell the user. Map token reach with `--check-scopes` before probing so denied areas are pre-declared ⚪, not discovered mid-run. A 403 is ⚪ (not assessable), never a finding. `dtctl inventory` (≥ 0.35; read-only, budgeted) reports which data objects are fetchable and which capabilities are present/absent/unknown with cited evidence — its `unknown` means could-not-check, never absent, the same semantics as the R probes.

**Step 3: Reach check (Phase 0 reach probes)**

Run the §0 battery in [probes.md](probes.md): R1–R4 reach probes to check table accessibility. The preflight `00-inventory.json` pre-answers most of this — its fetchable-table catalog maps directly onto the R rows — so use it to anticipate the verdicts, then still run the R probes as the authoritative check (they are cheap, and the inventory is a preflight signal, not evidence). Record each as `ok`, `unknown`, or `no-data`:

- **R1 (problems table):** If `unknown` **after the verification gate below**, the problem stream is ⚪ — Phase 1 cannot run, and the run enters **config-only mode** (see below).
- **R2–R4:** If the status is `unknown`, or the read succeeded with a zero count (the `no-data` verdict — recorded as `ok` with `"count": 0`, since a reachable-but-empty table is a successful read), that area is ⚪ or context-dependent; note it and proceed.

**R1 verification gate — a single failure NEVER re-shapes the deliverable (added after a live 2026-07-28 false negative: one recorded `NOT_AUTHORIZED_FOR_TABLE` on a tenant whose problem table read fine shipped a config-only report scoring 68.7/C where full mode scored 10/D, with a tuning worklist aimed entirely at detectors that produce zero problems — the one detector producing 78% of the stream is only visible in the problem stream).** Before entering config-only mode:
1. **Match the error precisely.** Only a literal `NOT_AUTHORIZED_FOR_TABLE` / HTTP 403 in the response is a scope verdict. A transport failure, 5xx, timeout, expired-token message, or rc=1 with empty stderr is `error` (retry), **never** config-only.
2. **Retry R1 at least once**, after `dtctl auth status --context <ctx>` — an expired OAuth session surfaces as auth errors that must be fixed (ask the user to re-login), not converted into a scope verdict.
3. **Cross-check R2.** `dt.davis.events` and `dt.davis.problems` sit in the same permission family: R2 succeeding while R1 fails is strong evidence of a transient error — retry R1 again rather than concluding a scope gap. Both failing consistently with the literal 403 = genuine.
4. Only a **consistent, literal** authorization denial across the retries enters config-only mode; record the verdict with the verbatim error in the R1 note.

Announce reach results before Phase 1: if R1 is ⚪, state: *"The problem table is not accessible. This run will proceed in config-only mode: all findings are based on configuration; no measured volume is available to corroborate noisy detectors or size reductions."*

## Config-only mode (entered when R1 = ⚪ / problem table not readable)

**Trigger:** Phase 0 reach check (R1) returns a **verified** `NOT_AUTHORIZED_FOR_TABLE` (the verification gate above passed: literal error, retried, R2 cross-checked).

**Entry & announcement:** Automatic. Print the disclaimer above and proceed to Phase 2 (skip Phase 1). **The report COVER (not just the appendix) must carry a prominent notice:** *"Configuration-only review — the problem stream was not readable by the review credentials. Findings are configuration-based; measured volumes, reduction estimates, and volume-ranked priorities are not included. Re-run with problem-table read access for the complete review."* — a config-only report is a materially different artefact and the reader must be able to tell from page one.

**Rules in config-only mode:**
0. **There is no Alerting Effectiveness Score.** Both volume pillars (signal quality, native adoption) are unmeasurable, so the headline is **"Detector Tuning Score (configuration-only)"** — `noise_scoring.py` refuses to emit a composite in this state by design. Never present the tuning-only number as effectiveness.
1. **No reduction figures.** Omit all [counted] / [replay] / [derived] estimates. Report no bare percentages — drop the entire "Expected reduction" column from deliverables. Use the column space for "Rationale" instead.
2. **Area weighting = equal.** Without volume attribution, use equal weights for all applicable areas. State this in the score explanation: "Areas weighted equally due to lack of volume data."
3. **Findings ordered by risk & certainty,** not volume. Sequence on: (a) **Delete-dead-config** (disabled, dormant, never-fired rules), (b) **Correct-clear-errors** (detectors enabled where disabled is recommended; obvious misconfiguration), (c) **Owner-decisions** (threshold tuning for enabled detectors), (d) **Threshold-plausibility** (unit errors, floor/ceiling violations).
4. **Confidence is always Low.** Reason: "Scoring is based on configuration only; no volume data available to corroborate noisy detectors."
5. **Admission in the change plan:** *"Without volume data, the highest-risk finding could be your largest single noise source. Prioritize by configuration risk, then by your operational context."*
6. **All three deliverables still build:** filled tuning `.xlsx`, Word report, change list. Content differs (no reduction figures), but structure and rigor remain.
7. **RCA participation is still readable — run C-rcrel** (probes.md §3 item 7). It reads the detectors' own `eventTemplate`, not the stream, so it survives the loss of Grail and is the one root-cause-coverage finding config-only mode can still make. State it structurally — *"at least N of M enabled detectors cannot participate in root-cause analysis, so their alerts arrive with no root cause and a single entity"* — and **never as a rate or a reduction figure** (rule 1 still binds). It belongs in ordering bucket (b), correct-clear-errors.
   **A silent C-rcrel is never an all-clear.** The probe reports a *lower bound*: it can prove exclusion, never participation, so "no detector was found to opt out" means **not established**, not "correlation is healthy". Config-only mode is exactly where that distinction gets lost, because `D-rcrel` is unavailable to contradict it. If every detector comes back `unknown`, write that the review could not establish root-cause participation from configuration and name the access that would settle it — never that participation is fine.

## Phase 1 — Baseline the noise (what's firing now) — SKIPPED IN CONFIG-ONLY MODE

Run the §1 battery in [probes.md](probes.md). It establishes the noise baseline and the tuning worklist:

- **Volume & modernity split** (P1/P2): total problems over the window, `CUSTOM_ALERT` vs Davis share (24h corroborator + 30d category mix). High custom-alert share = the firehose is ported thresholds, and threshold tuning alone won't fix it — flag it up front.
- **Signal-to-problem compression** (P3): raw Davis signals collapsed per surfaced problem. Low compression next to high volume = the estate is being paged on raw events, not correlated problems.
- **Problem Usefulness & Noise KPIs** (P4/P5): PUI (root-cause / impact-cardinality / actionable weighting), duplicate rate, frequent-event rate, under-maintenance share, muted count. Near-zero impact-cardinality (every problem hits one entity) is itself a finding — shallow topology or per-entity static thresholds. **Always run the by-category split (the §4 D-pui-by-cat table) as part of Phase 1, not as an optional drill-down** — root-cause% and multi-entity% per `event.category` is the family's single strongest measurement (live: custom alerts 0.0%/0.0% vs Davis error problems 51.4%/54.1% — it converts "you have a lot of alerts" into "four fifths of your alerts cannot, by construction, tell you anything").
- **The tuning worklist** (P6): top problem titles by count. **This is the ranked target list** — each title maps to a detector, and the highest-count titles are where tuning pays off most. Split it two ways: OOTB detector titles (map to the ruleset) vs custom-alert titles (map to Phase 3's detector deep-analysis).
- **Maintenance suppression** (P7): cross-read configured windows against the under-maintenance share — windows that suppress real alerts nobody sees, or windows that scope nothing.
- **Time-to-detect** (P9): median/p90 minutes from event onset to problem-open, from `dt.davis.problems.snapshots`. Read next to PUI, not instead of it — fast detection on a low-usefulness stream is not progress.
- **Noisy-entity share vs. Dynatrace's own 0.1%-per-day over-alerting definition** (P10): the share of source-entity-days that exceed Dynatrace's documented alert-state threshold ([avoid-overalerting](https://docs.dynatrace.com/docs/dynatrace-intelligence/use-cases/avoid-overalerting)). This is the defensible headline noise number — a rate, not a raw count that just scales with estate size — quote it alongside P5, not as a replacement for it.

**Interpret, don't tabulate.** The finding is the *cross-read*: high volume + low compression + low PUI impact-cardinality + custom-alert-dominated titles = "this estate is run as a threshold pager," and that sentence, evidenced, is the report's thesis.

## Phase 2 — Read the actual settings (fill the "Actual" columns)

For each area in `noise-ruleset.json`, read the live OOTB detector settings (§2 battery in [probes.md](probes.md)):

```
dtctl get settings --schema builtin:anomaly-detection.infrastructure-hosts --context <ctx> -o json
# …services, databases, rum-web, infrastructure-disks, kubernetes.{cluster,node,namespace,workload,pvc}
```

**Calibration (first run against a tenant, or when a schema read shape is unfamiliar):** dump one schema, inspect the JSON structure, and build the `field_hint → real value path` map. Anomaly-detection schemas nest detection config under keys like `<detector>.{enabled, detectionMode, ...}` where `detectionMode` is `auto`/`fixed` and fixed detectors carry the threshold + a sliding-window (`samples`/`violatingSamples`/`dealertingSamples`). Record the resolved paths so the fill step and the tuning-sheet builder read the right values. **If a schema returns 403 → that area is ⚪** (Actual = "not readable"), excluded from scoring, listed in the appendix.

For each rule, populate its **Actual** value(s) — per environment where the settings are scoped per host-group/segment. Compare Actual vs `default` vs the ruleset's recommendation and tag each rule:
- **✅ at recommendation** — already tuned; no action.
- **💡 at default / generic** — an opportunity to tune (the bulk of the worklist). **This includes a readable schema returning 0 objects** — that is "platform defaults in force", a scoreable state: fill `Actual = "platform defaults (0 objects configured)"`, never leave the column empty (an empty Actual is indistinguishable from a denial, and both occurred on one live tenant).
- **⚠️ actively noisy** — a high-noise-risk detector at default that Phase 1 shows is firing heavily, or a detector enabled where the ruleset says disable (esp. in lower environments).
- **⚪ not readable** — a literal 403 ONLY: fill `Actual = "not readable"`, exclude from scoring, appendix footnote. **A 0-object read is never ⚪** — defaults are 💡 and scored; denials are ⚪ and excluded. The two must be distinguishable in the tuning sheet.

## Phase 3 — Attribute the noise (the join) + custom-detector deep-analysis

> **Run [detector_families.py](detector_families.py) before analyzing by hand.** It is the executable authority for probes.md §3 items 3 / 4b / 4f, the item 10 delivery-chain flags, and the item 12 / 13 / 14 destination, silent-source and capacity reads — `python3 detector_families.py runs/<id>/C-davis-detectors.json --json families.json --max-objects <maxObjects>`. It exists because the same estate was grouped by hand twice and produced different answers: including the detector *title* in the duplicate key found 50 families where the title-blind key found 249, and neither saw the 95 policy clusters covering 91% of the fleet. Hand-normalization is where this analysis silently under-reports. **Its `--json` output feeds `assemble_findings.py`**; do not retype its numbers into the report.
>
> **`--max-objects` comes from the tenant, not from memory:** `dtctl describe settings-schema builtin:davis.anomaly-detectors --context <ctx> -o json` → `maxObjects`. A remembered documentation figure was wrong by 4.5x on a live engagement (item 14), and the error inverted the finding rather than merely rounding it.
>
> **Four of these reads exist because a hand-run deep dive found them and the skill did not** (2026-08-10, a production estate): where each detector actually routes (item 12 — 48.9% of a production fleet ticketing into UAT, invisible to every other probe because property-driven routing bypasses the notification layer D4 reads), which detectors go silent when their source dies (item 13 — 100% of the fleet), how close the fleet is to its declared ceiling (item 14 — at exactly 100%), and whether two mechanisms deliver to one endpoint (item 15). They are cheap: all four are computed from `C-davis-detectors.json`, which §3 already collects, plus one schema `describe`. **The report is required to carry them** — output-spec.md §5b/§5c/§5d — so a future run cannot quietly drop back to the narrower analysis.

Two joins turn measurements into a plan:

1. **OOTB attribution.** For each high-count OOTB title from Phase 1's worklist, name the detector (Phase 2 setting) that produced it and the ruleset row that tunes it. Example chain: `"Response time degradation" (1,069 problems)` → `builtin:anomaly-detection.services` response-time detector at default `100ms abs / 50% baseline` → ruleset N21 recommends `100ms abs / 75% for 5 min` (prod). That is a finding.
2. **Custom-detector deep-analysis** (the other half of the noise — §3 battery). The `CUSTOM_ALERT` share comes from the Davis custom detectors (`dtctl get anomaly-detectors`, schema `builtin:davis.anomaly-detectors`); the older `builtin:anomaly-detection.metric-events` framework is a separate, often-dormant set (see §5 A7).

   > **Redact this read before it touches disk.** Migrated detector libraries bake notification routing into `eventTemplate`, so recipient addresses travel with the config — a reference estate carried **294 distinct employee addresses across 667 of 1,276 detectors**. Pipe the output through [`redact.py`](../.dt-eval-common/redact.py) (`dtctl get anomaly-detectors -o json | python3 redact.py - --probe-id C-detectors > runs/$RUN/C-davis-detectors.json`), emit the operator WARNING it prints, and record `report.summary()` in run.json. Analysis is unaffected — titles, `objectId`, `enabled` and `analyzer` are untouched by design. Full rules: [security-sensitive-data-policy.md](../dt-eval-tenant/security-sensitive-data-policy.md).

   Analyze the rule set, don't count it:
   - **Enabled + analyzer split** — dormant rules are prune candidates, not active noise; and if every detector uses `StaticThresholdAnomalyDetectionAnalyzer` while adaptive/seasonal/forecast analyzers go unused, that's the "bought the AI, turned it off" finding (§5 A5).
   - **Exact duplicates** — same query/threshold, different names (`_1/_2/_3`, "(copy)"); deletable at zero coverage cost.
   - **Near-duplicate families** — per-entity/per-segment clones that collapse to one generalized detector with a `by:{}` dimension.
   - **OOTB overlap** — custom rules re-implementing CPU/memory/disk/availability that Davis already detects natively; if the OOTB detector is disabled, enabling it replaces the clones (§2).
   - **Semantic intent classification (P3)** — analyze each detector's query pattern to infer its intent (e.g., "CPU_HIGH" measures resource contention) and suggest the best Davis native category to replace it with. Rank by problem volume to prioritize which detectors to retire first: *"If you retire the 11 RESOURCE_CONTENTION custom rules, you'll eliminate 520/597 custom problems (87%)"*.
   - **Top offenders** — join to the fired-problem titles (Phase 1 P6): which specific custom rules produce the noise. Name them (e.g. the top custom title driving 20%+ of the stream). Emit the per-detector delete/consolidate list (with `objectId`) as the CSV worklist.

## Phase 3b — Attribution drill-downs + adjacent checks

Two more read-only passes make the report sharp and honest (full commands in [probes.md](probes.md) §4–§5).

**Drill-downs (§4)** — for each top driver, name the cause and size the fix by grouping `dt.davis.problems` on the fields it carries (`k8s.cluster.name`, `k8s.workload.kind`, `affected_entity_names`, `resolved_problem_duration`, `event.status`): is "pods pending" real or all cronjobs? is a service driver spread across many or one bad service? is a host title a fleet issue or one app's GC? is a custom alert flapping (1-min median, 0 open now) or a sustained outage? **Always run D-pui-by-cat** — the PUI-by-category split (ported thresholds ~0% root-cause/multi-entity vs Davis categories far higher) is the single strongest correlation and proves Lever 1 raises usefulness, not just cuts noise.

**Run D-rca-buckets right after D-pui-by-cat, not as a separate optional step.** A raw root-cause percentage reads artificially low even on a healthy estate — some empty-RCA is legitimate (single-entity direct failures, infrastructure-impact problems, no-affected-entity enrichment gaps). D-rca-buckets splits the empty-RCA slice into expected-empty vs `should_have_had`, so the report states "of the 86% with no root cause, only N% should have had one and didn't" rather than letting a low headline number read as a blanket failure it may not be.

**D-source-fragmentation** complements D-cardinality: D-cardinality drills into one already-identified rule; D-source-fragmentation scans the whole estate for source entities firing more than once a day, surfacing fragmentation candidates before you know which rule to blame. Trend it day over day — a falling count after a tuning change corroborates that the change worked.

**RCA participation, per detector (C-rcrel / D-rcrel)** — D-pui-by-cat shows ported thresholds carry no root cause; these two name the *mechanism*, per detector, so the finding survives the question "why?". An event that cannot merge cannot be correlated into a problem with a root-cause chain — it becomes a single-entity problem by construction. Two mechanisms produce that, and the report must say which applies: a detector's own `eventTemplate` setting `dt.davis.is_merging_allowed: "false"`, **or** the alert type it emits, which excludes the event without any per-detector flag at all.

**Config can prove exclusion; it can never prove participation.** `C-rcrel` therefore reports a lower bound and has no "capable" verdict — an absent flag is `unknown`, not `allowed`. Reading absence as allowed inverts the finding: live 2026-08-03 it would have reported 100% RCA-capable on two estates whose streams measured 0.0% mergeable. **Read the two flags together, never `is_rootcause_relevant` alone**, and do not stop there — the pair is still wrong if absence scores as a pass. **When `D-rcrel` returns rows it outranks `C-rcrel`**, and `mergeablePct` is the column that discriminates; `rcRelevantPct` reads 100% on this detector class and means nothing on its own. C-rcrel is config-side and **runs in config-only mode**, which makes it the only RCA-coverage read available when Grail is unreachable — and the one place its lower-bound nature must be stated explicitly, because nothing is there to contradict it. Both key on the same `objectId` as the §3 worklist, so a high-volume detector that cannot participate is a retire-first candidate with its justification already written. **Diagnostic only — neither feeds the score** (PUI keeps its published weights; see [scoring.md](scoring.md)).

**Adjacent checks (§5, A1–A8)** — these repeatedly change how the noise should be *read*, so run them before finalising the story:
- **A1 maintenance windows** — do windows suppress real alerts, or is 0% under-maintenance simply because none exist?
- **A2 delivery chain** — do problems actually reach people (workflows `isDeployed`, notifications, profiles)? Delivered noise is costly; note delivery-layer hygiene (test/duplicate routers, personal ownership, dual lanes).
- **A3 host monitoring mode** — is shallow topology a coverage gap? All-Full-Stack = it is NOT (don't chase agents).
- **A4 service detection** — is the topology over-split? Reasonably shaped = not the topology culprit.
- **A5 Davis analyzers** — 100% static thresholds with adaptive/seasonal/forecast unused = the sharpest form of the custom-threshold problem.
- **A6 frequent-issue detection** — off in all scopes explains `frequentRate` 0; enabling it is a cheap dampener.
- **A7 metric-events** — the older framework, often all-dormant = config debt to delete.
- **A8 span-capturing / health spans** — is health-check span noise real (usually <1%)?
- **A9 legacy metric-events, stream corroboration** — A7 reads config; A9 reads whether the classic 2nd-gen schema (`dt.settings.schema_id == "builtin:anomaly-detection.metric-events"`) is still emitting events. Same precedence rule as K8s presence (probes.md §2): the stream corroborates the config read, it doesn't replace it. Use `schema_id` here, not `event.provider` — provider names the emitter, schema_id names the config generation, and only schema_id surfaces migration debt.

The convergence to watch for and state in the report (§I.8): A3/A4 rule out coverage/topology, A5 sharpens it, C-rcrel/D-rcrel supply the mechanism (these alerts are excluded from correlation — by an explicit per-detector opt-out, or by the alert type they emit; name whichever the evidence shows), and everything points back to the custom static-threshold sprawl (Lever 1) as the one structural fix. Where the mechanism is the alert type, the remediation is necessarily *replace with native detection* — there is no flag to flip — which makes the Gen3-first recommendation the only one available rather than the preferred one.

## Phase 4 — Recommend & quantify

For every ⚠️/💡 rule, produce a change record:

| field | source |
|---|---|
| detector / area | ruleset |
| environment | prod / lower (Phase 0 input #5) |
| current value | Phase 2 Actual (resolved, not the hint) |
| recommended value | ruleset resolution contract (suggested → ref_actual → default) |
| change type | loosen / disable / enable / tune / delete (custom dupes) |
| est. noise reduction | **derived/directional** — see below |
| priority | noise_risk × measured volume × ease (delete-dupes and disable-in-lower are high-ease, high-yield) |

**Estimating reduction honestly** — pick the strongest method the data supports and label it:
- *Direct replay* (best): where the problem records carry the breaching magnitude, count how many past problems would not fire under the proposed rule. State it: "N of M would not have fired."
- *Proportional* (common): the detector's share of total problems × an expected suppression fraction from the tuning (a loosened baseline % or added time-window). Label the assumption.
- *Structural* (dupes/disable): deleting K exact-duplicate rules removes their entire fired share; disabling a detector in lower removes 100% of its lower-env problems. These are countable, not estimated.

Sequence the plan: **delete exact duplicates and disable-in-lower first** (high yield, zero risk), then **loosen the high-volume OOTB thresholds** (services response-time/failure-rate, host CPU/memory), then **generalize near-duplicate families**, then **enable-for-coverage** items last (they may add intentional alerts). Warn where loosening a threshold trades noise for a slower catch on a real incident.

**Ingest repair outranks every threshold change (hard sequencing constraint).** This plan otherwise assumes the metric series it tunes against is complete. When metric ingest is rejecting datapoints on a key a detector watches, that assumption is false: the detector is evaluating a perforated signal, and **a threshold calibrated against a holed series is calibrated against the holes** — it will have to be redone after the ingest is repaired. Check it whenever a same-day tenant-review cache is available (the tenant skill's B40/B40b), or run the rejection read directly:

```
timeseries r = sum(dt.sfm.server.metrics.rejections), by:{ metric_key, rejectionreason }, from:-7d
| fieldsAdd total = arraySum(r) | fields metric_key, rejectionreason, total | sort total desc | limit 15
```

Intersect those `metric_key`s with the keys your `timeseries` custom detectors query (§3). **Non-empty intersection ⇒ move ingest repair ahead of the threshold work in the change plan and say why** — the tuning wave is otherwise paid for twice. Live shape: 521k rejected datapoints/week across 13 log-derived keys under a detection layer of ~958 detectors built on exactly those keys. `Timestamp too old` is the dominant rejection reason (publisher stamping batch time, not ingest time); cardinality overflow is the rarer one (field-notes carries the reason→remediation mapping).

## Phase 5 — Deliverables

Build the selected deliverables from the shared `run.json`. Full structure in [output-spec.md](output-spec.md). Scoring rubric in [scoring.md](scoring.md).

1. **Filled tuning sheet** — `build_tuning_sheet.py` renders an `.xlsx` mirroring the Alerting Thresholds layout with **Actual columns auto-populated** (resolved values) and a **Recommendation / Delta / Est-reduction / Priority** block added. The direct evolution of the manual worksheet.
2. **Word noise-reduction report** — a client-ready `.docx` (via the shared [docx_style.py](../.dt-eval-common/docx_style.py)): cover with the burden stat line — and the Alerting Effectiveness Score only where the edition carries grades (Internal always, External with `--grades`; owner rule 2026-08-25) — (problems/day · custom share · root-cause rate), executive summary (the thesis sentence + top drivers), the baseline, deep-dive findings (attributed, interpreted, sequenced), the change plan, and a "verify these findings yourself" section of client-runnable DQL. Reuses the Tenant Eval house style so figures and look match.
3. **Prioritized change list** — a concise ranked markdown table (detector · env · current → recommended · est. reduction · priority) for a ticket queue or working session.
4. **Per-detector audit workbook** — `build_detector_audit.py` renders one row per custom detector (query, threshold, window, missing-data handling, merge behavior, severity, destination, routing metadata, provenance, policy-cluster id) plus per-row flags and a fleet-summary tab. **This is the artifact that answers "which of my N detectors do I actually touch, and in what order?"** — the tuning sheet cannot, because it covers the built-in ruleset rather than the custom fleet. Internal by default (it carries objectIds and routing metadata), so it files under the `[INTERNAL ONLY]-` prefix. Run it on the REDACTED detector file the §3 protocol writes.

**Verify before reporting back:** reopen each deliverable, assert non-empty, then **run the shared hygiene scanner — `.venv/bin/python ../.dt-eval-common/verify_docx.py <file> --profile detailed` for the External report, `--profile internal` for the Internal one** (never re-derive the patterns from prose; a finding is banned content OR a scanner bug — never reword correct prose to appease it). Then report to the user the resolved output paths, the effectiveness score with its three pillars, the top 3 changes by yield, and anything ⚪ with the scope needed to close it.

> **The change list (3) is scanned too — it is the deliverable that needs it most.** `build_reports.py` scans the `.docx` and `.xlsx` for you, and both take the customer name from `run.json`, so theirs is right by construction. The change list is markdown you author by hand, so its header is retyped every run — and on 2026-07-31 two of them shipped naming a different customer while every built sibling in the same folder was correct. Run it explicitly, with the subject passed rather than inferred, since a change list is often written outside the delivery tree:
>
> ```
> .venv/bin/python ../.dt-eval-common/verify_docx.py <change-list.md> \
>   --profile detailed --customer "<customer>" --customer <tenantId>
> ```
>
> Take the `--customer` value from `run.json`'s `meta.customer`, never from memory of the session — running two tenant evaluations in one session is exactly how the wrong name gets typed.

## Scoring (summary — full rubric in [scoring.md](scoring.md), formulas in [noise_scoring.py](noise_scoring.py))

The headline is the **Alerting Effectiveness Score** (0–100, A/B/C/D bands) — `0.40·S + 0.30·N + 0.30·T`: **S** signal quality (100×PUI over the full 30-day stream), **N** native-detection adoption (100×(1−custom share)), **T** detector tuning (✅ at-recommendation = 100, 💡 at-default = 50, ⚠️ actively-noisy = 0, ⚪ = excluded from the denominator — never scored 0 — weighted by area noise-risk). The composite grades the alerting *outcome* the customer lives with; a well-tuned T beside a low S/N means "the engine is sound, the burden comes from outside it" — say it that way, and never attach the word "Overall" to the tuning sub-score alone. Compute via `noise_scoring.py`, never by hand. The score is a health headline; the *change plan* is the deliverable — never let the number replace the sequenced actions.

## Hygiene (same rules as the Tenant Eval)

- **Read-only always.** The skill never changes tenant config; it recommends and the customer applies.
- **Client-facing docs state what/how/window** and what was not assessed — never internal machinery (run paths, `run.json`, probe IDs, raw API error strings → plain language).
- **No cross-tenant references.** Each report is self-contained to its tenant.
- **Gen3-first.** Never recommend creating classic constructs; custom-detector findings point at retiring/generalizing, and coverage findings point at Davis-native detection.
- **Ground recommendations in docs.dynatrace.com** (authoritative) and the BPN alerting series (`dt-alerting`, BPN ALERT series) as further reading; cite what you actually opened.

## Reference data (illustrative example — 30-day window)

Illustrative only; each run measures fresh. A representative "run as a threshold pager" estate: ~9,000 problems over 30 days; custom-alert share ~50%; compression ~280:1; PUI ~0.38 with impact-cardinality ~8% (shallow topology) and actionable ~97%; low duplicate rate; under-maintenance 0%. The custom-alert stream concentrates in a few ported-detector families — e.g. a single high-volume log-count rule and a large per-workload container-metric family — alongside untuned OOTB service and host detectors. The OOTB titles map straight onto ruleset rows; the custom titles are the Phase-3 deep-analysis worklist.
