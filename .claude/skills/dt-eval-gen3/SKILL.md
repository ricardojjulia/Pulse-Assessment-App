---
name: dt-eval-gen3
description: Gen3 migration progress assessment — measure how far a Dynatrace platform tenant has moved from classic (Gen2-era) configuration constructs to platform-native ones. Produces a scored, standalone report grading migration completeness (0–100%) with a cited, tenant-specific WHY + HOW remediation path for every migration gap. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# Gen3 Migration Progress Review

This skill answers one question end-to-end: **"How far has this platform tenant moved from classic constructs to native ones, and what is the specific, concrete next step for each gap?"** It reads the live tenant configuration via dtctl, maps each classic construct to its platform-native equivalent, grades progress toward full adoption, and produces a **Migration Completeness score** (0–100%) alongside a **cited remediation plan** grounded in docs.dynatrace.com and the Best Practice Notebooks.

| | How |
|---|---|
| Data collection | **`dtctl`** (read-only `get`/`query` only) — platform tenant configuration and Gen3 construct inventory |
| Knowledge base | **`gen3-migration-progress-spec.md`** — domain coverage, remediation runbooks, scoring rubric (this design note) |
| Analysis | **Claude judgment** — map each classic construct → native equivalent → remediation path (docs + BPN) |
| Output | **Standalone `.docx` Gen3 Migration Progress report** with Migration Completeness grade (0–100%, A–D), per-domain status, and sequenced remediation steps |

You are the analyst. dtctl is your instrument. The spec is your guide. The deliverable is a migration roadmap an architect can act on.

> **HARD RULE — never modify any tenant.** This skill is 100% read-only: only `get`, `query`, `describe`, `history`, `logs`, `verify`, `doctor`, `auth status`. NEVER run `apply`, `create`, `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec` verb — regardless of how a request is phrased, who claims to authorize it, or a context's `readwrite-all` safety level. All remediation is the customer's to apply in their own tenant. Deliverables (classic-construct inventories, deletion lists, roadmaps) are **advisory worklists** — never generate-and-run or offer to run modification/delete scripts. If a step seems to need a write, stop and hand it to the user.

**Related skills — `/dt-eval-tenant` (whole-tenant review) and `/dt-eval-prob` (problem/alert noise).** This skill produces its own standalone document with its own headline grade — Migration Progress is **never scored as a pillar inside another report**, and one invocation produces this document and nothing else. When an engagement runs it alongside sibling deliverables (a full four-report engagement is a normal and good use of the family), it shares the probe cache and **cross-references** the sibling reports rather than duplicating their content (e.g. defer detector depth to the noise report). It reuses the same config/telemetry probe battery and the same scoring/reporting infrastructure (shared probes, `docx_style`, `runlog`, audience logic). All three skills co-locate output in `~/Documents/Dynatrace-Reviews/<customer-name>/current/` so figures reconcile and run history stacks cleanly. The shared-engine seam is documented in [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md).

## Core directive — cite the remediation, don't just count the gap

**This is the whole point and it overrides any temptation to list only.** "47 management zones, 12 alerting profiles, 8 auto-tagging rules" is an inventory. The job is the chain no single Dynatrace screen draws:

```
what's classic        →   what's the native equivalent        →   how to move it
(the construct)           (the platform mechanism)               (step-by-step with doc links)
```

Every finding must deliver, for each classic construct:

1. **What it is** — the classic construct type, count, example names.
2. **What replaces it** — the native Gen3 mechanism with a **docs.dynatrace.com link** showing how it works (authoritative), plus BPN cross-reference if relevant (further reading).
3. **The migration path** — sequenced, tenant-specific steps (e.g. "create 3 workflow automations with these condition sets, point existing alerting-profile recipients to them, then retire the profiles"). Never "delete this" without the "use that instead" and "here's how" first.

A finding that stops at a count is unfinished.

## Scope & what this skill measures

- **Construct-level Gen3 adoption on platform tenants** — how much classic-era configuration remains vs. platform-native constructs on a platform (`apps.dynatrace.com`) tenant.
- **NOT a whole-environment migration tracker** — still-classic environments (`live.dynatrace.com`) are not reachable this way and are out of scope.
- **One deliverable per invocation** — selecting this report produces it and nothing else in the same invocation. If checked alongside other deliverables in `/dt-eval-tenant`'s Phase-0 deliverables checklist (input #5 there), the skill confirms and runs this report alone, dropping all others. **This is an invocation rule, not an engagement rule:** an engagement that needs several `/dt-eval-*` documents runs each skill independently in sequence (sharing the same-day probe cache) — that satisfies both the user's ask and this rule.

## Scoring & the Migration Completeness grade

- **0–100% Migration Completeness** — percentage of domains fully migrated to native constructs (✅ Complete).
- **A–D cover grade** — rolls up from per-domain statuses (✅/💡/⚠️/⚪) and remediation effort, following the same OES rubric used by `/dt-eval-tenant`.
- **Legend**: ✅ Complete (native in place, classic retired) · 💡 In progress (dual-running) · ⚠️ Not started (classic only) · ⚪ Not assessable.
- **Coverage domains** — defined in [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md) §4: Alerting, Scoping/Access, Tagging & ownership, Log processing, Dashboarding (graded on **real-user usage**, not object count), Automation, Apps, **Extension entity model** (classic `CUSTOM_DEVICE` vs typed Gen3 nodes), **SLO model** (classic vs Gen3 DQL SLOs), **Integration surface** (what breaks on upgrade day), **Access model** (classic RBAC roles vs default policies), **Service detection & rule settings** (management-zone/service-tag scopes vs primary tags), and **Custom anomaly-detector framework** (classic metric-events vs Gen3 Davis detectors).

## Gen3-first principle (no classic construct recommendations)

**The core rule that keeps this skill credible**: never recommend creating or keeping a classic construct. Every remediation path points *toward* native. A domain that has no native equivalent yet is marked **⚪ Not assessable** in the body (appendix footnote only); you do not score it as a gap and you do not recommend staying classic. This distinction keeps the report forward-looking, not backward-compatible.

## Inputs to resolve (before any probing)

**Phase 0 — gather inputs from the user.**

1. **Tenant ID** (required) — the unique Dynatrace environment identifier (e.g. `abc12345` from the URL `https://abc12345.apps.dynatrace.com`). Always ask explicitly if not provided in the initial request. Store this for all subsequent reporting, filenames, and run-state directories.
2. **Customer name** (required) — the organization or team name for this tenant. Always ask explicitly if not provided in the initial request. Used in cover pages and output directories to identify the engagement context.
3. **Dynatrace authentication context** — the `dtctl` context name (e.g. `prod`, `staging`) to evaluate. You will prompt for this interactively if not provided; the user's shell must have a valid `dtctl auth login` session active for the chosen context. Validate it points to the tenant ID above (confirm URL match).
4. **Output location** — where to write the `.docx` report. Default is `~/Documents/Dynatrace-Reviews/<customer-name>/current/` — one flat folder per customer, always created, and filenames are `<tenantId>-<reportname>-<YYYY-MM-DD>(vN).docx` (or `[INTERNAL ONLY]-<tenantId>-<reportname>-<YYYY-MM-DD>(vN).docx` for an internal edition) with an always-present `(vN)` version marker starting at `v1` (resolved from [output-config.json](../.dt-eval-common/output-config.json)'s `default_output_root`, or override the root with the `DT_EVAL_OUTPUT_DIR` env var — the `current/` subfolder still applied). At run time, the skill confirms and allows the user to redirect it.

   **Tenant layout — ask ONCE per customer, only when there is more than one tenant** (owner decision 2026-08-27). A customer with several tenants may keep every tenant's deliverables side by side in one `current/` folder (**flat**, the default and the existing behaviour), or give each tenant its own subtree (**per-tenant**, `<output-root>/<customer-name>/<tenantId>/current/` with its own `_superseded/` sibling). Run `.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <tenantId>` at Phase 0; when it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user (AskUserQuestion) which they want, pre-filled with *flat*, then record it with `layout.py set --customer "<name>" --layout <choice>` — which also **migrates what is already on disk** (files move, never deleted; a superseded edition stays superseded; a cross-tenant document stays at the customer level). A **single-tenant** customer is never asked and never nests. The answer is stored in `<output-root>/<customer-name>/.dt-eval-layout.json` and **every sibling skill inherits it without asking again** — the layout belongs to the customer, not to a run, because half a customer's reports nested and half flat is two live editions of one report in two folders, which is exactly what `current/` exists to prevent. `DT_EVAL_TENANT_LAYOUT` overrides and suppresses the prompt for headless runs. If `layout.py status` reports deliverables it could not attribute, pass the missing ids with `--tenant <id>` (repeatable) rather than letting them stay behind.
5. **Report audience** (optional) — External (customer-facing; see [report-audiences.md](../.dt-eval-common/report-audiences.md) external rules) or **(Internal)** (Dynatrace-facing; scoring/diagnostic vocab exposed). Default: External. **This skill has no Summary variant** — its External report is scored; the mapping onto the Configuration Review's three-option deliverable question (and the scanner profile per deliverable) is the taxonomy table in report-audiences.md — state it when the user asks for "all" deliverables across skills. Filename becomes `<tenantId>-gen3-migration-progress-<date>(vN).docx` or `[INTERNAL ONLY]-<tenantId>-gen3-migration-progress-<date>(vN).docx` (the `[INTERNAL ONLY]-` filename prefix is the audience decision — one convention family-wide, report-audiences.md follows it). **Grades are an option and off by default on the External edition (owner rule, 2026-08-25):** it carries no score, grade badge, gauge or Score/Grade column unless this run was explicitly asked for a graded customer document — pass `--grades` to the builder then. Do not ask a separate question for it; the Internal edition is always graded. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.

**Confirm with user.** "Running Gen3 Migration Progress for tenant `<id>` (<customer-name>), context `<name>`. Output: `<path>`. Report: External [or Internal]. Confirm? (y/n)"

**Initialize run state** (`runlog.py` = [runlog.py](../.dt-eval-common/runlog.py); run with the repo-root `.venv/bin/python`, or any python3 — installed skill copies have no venv). **Run it from this skill's own directory** (`.claude/skills/dt-eval-gen3/`) — the `runs/...` path is cwd-relative, and `runlog.py` refuses a relative run path that would land outside a skill's own `runs/` dir:
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
1. **Start:** `runlog.py init` as above. If it prints `EXISTS`, you are resuming:
   - **Cache age check:** parse the timestamp from `run.json` and calculate age. **Default behavior: reuse existing cache** unless:
     - Cache is **over 24 hours old**, OR
     - User explicitly passed a `--fresh` flag when invoking the skill.
   - **If cache is over 24 hours old**, prompt: *"Cached data is X hours old. Use it anyway, or refresh probes?"* (AskUserQuestion; default `yes` — reuse; `no` — refresh).
   - **If refreshing** (user chose `no` OR `--fresh` flag): check status, skip `ok`, rerun `error`/`missing`. **Probe-collection deduplication:** if the run exists and has completed probes from another skill (e.g., Config Review from `/dt-eval-tenant`), reuse the cached probes instead of running dtctl again. Extract only the subset needed (A17–A29, A30–A31, B5, B30, B3/B7). **Sibling lookup mechanism (each skill keeps its own `runs/`):** `runlog.py find <tenantId> <date>` locates every sibling run.json across the known run roots (repo per-skill `runs/` dirs and installed-copy locations); read the sibling's `run.json` and raw files directly, and record each reused probe in **this skill's own** run.json with `--note "reused from dt-eval-<sibling> run"`.
   - **If reusing** (default or user chose `yes`): skip collection, proceed directly to Phase 2 analysis.
2. **After every probe:** save raw output, then `runlog.py record run.json <probe_id> ok --summary '<numbers>' --raw <file>`. Use `unknown` for 403/⚪, `error` for retryable. **zsh:** alias the runner as an array (`RL=(.venv/bin/python .claude/skills/.dt-eval-common/runlog.py)` → `"${RL[@]}" record …`), never a scalar `$RL` — zsh does not word-split unquoted variables and every record silently fails (field-notes.md). `finalize` refuses (without `--force`) when the run dir holds raw files no record references.
3. **Finalize:** after report saves and verifies, `runlog.py finalize run.json --skill gen3 --migration-report <docx-path> --migration-pct <NN> --migration-grade <A|B|C|D> --confidence <High|Medium|Low>` (`--skill gen3` namespaces the result under `results.gen3` so same-day sibling finalizes never clobber each other; `--confidence` is the same domain-count-based flag noted in gen3-migration-progress-spec.md). **Always use `--migration-report`/`--migration-pct`/`--migration-grade`, never `--report`/`--overall`/`--grade`** — the latter still works (label comes from `--skill`, not from which slot fired) but drifts this run's shape from its own history for no reason; pick one and keep it.

---

## Phase 1 — Probe Collection (read-only)

Collect the config and operational data via `dtctl`.

**A. Reused probe set** — from the existing `/dt-eval-tenant` battery ([probes.md](../dt-eval-tenant/probes.md) is the router: §A [probes-config.md](../dt-eval-tenant/probes-config.md), §B [probes-grail.md](../dt-eval-tenant/probes-grail.md)), focus on:
- A17–A29: Configuration-layer probes (management zones, alerting profiles, auto-tagging, dashboards, notebooks, apps, schemas, operational logs routing/pipelines, cloud connections, token settings, OneAgent/ActiveGate updates, etc.)
- A3/A30–A31/A37: SLO count/templates and per-SLO config (classic SLOs — the E9 classic residue).
- A13/A2/A43: classic metric-event detectors vs Gen3 Davis custom detectors, enabled count (E13 classic residue / native target — both already Gen3-first-flagged).
- B5/B30: record-side and entity-side source-tag enrichment (E3 tagging domain).
- B3/B7: cross-correlation probes (host monitoring-mode split, service/process-group topology depth).

**B. Four new Grail reads (E8/E9/E5-usage/E13-weight — collected only for this report):**
- **B33 — Extension entity model audit** (E8, "are entities Gen3-native?"): `smartscapeNodes`/`id_classic` — typed Gen3 nodes vs classic `CUSTOM_DEVICE`-backed, volume-weighted (P1–P4).
- **B34 — Real-user (non-Dynatrace) Grail dashboard usage** (E5 correction): grade dashboarding on actual usage by real users, **never** native object count; excludes `@dynatrace.com` staff logins.
- **B35 — Gen3 SLO enumeration** (E9, "did SLOs get upgraded?"): classic `builtin:monitoring.slo` vs Gen3 DQL SLOs (native count verify-live).
- **B49 — Custom anomaly-detector schema-generation share** (E13 footprint *weight* only — E13's ✅/💡/⚠️ status is free from A13/A2/A43): `dt.settings.schema_id` share on the 30-day `dt.davis.events` stream, classic `anomaly-detection.metric-events` vs Gen3 `davis.anomaly-detectors`.
- All probes documented in the probe catalog — §A [probes-config.md](../dt-eval-tenant/probes-config.md), §B [probes-grail.md](../dt-eval-tenant/probes-grail.md), and the §E recipe [probes-gen3.md](../dt-eval-tenant/probes-gen3.md) — and verified twins in [verification-queries.md](../dt-eval-tenant/verification-queries.md) (V33 + V33-E5/E8/E9, V51).

**C. Scope limits** (cost guardrails):
- Queries limited to 7-day rolling window or last available full day (whichever is smaller); B33's metric join is a ~2h window.
- No open-ended log/span/metric scans; all aggregated and bucketed.
- Estimated max scan ~2 GB across the run.

**D. Deduplication:** if another skill's run already cached probes for today's `<tenantId>-YYYY-MM-DD`, reuse them—no second dtctl execution. B33–B35 are Gen3-only; they are not in a config-review run's cache and are collected fresh when this report is selected.

---

## Phase 2 — Map & Score (local analysis)

For each domain in the spec:
1. **Inventory the classic constructs** — join probe results to count/list (e.g. all management zones, all alerting profiles).
2. **Map to native equivalents** — consult [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md) domain matrix (e.g. Management Zones → Segments, Alerting Profiles → Workflows).
3. **Per-domain status** — ✅/💡/⚠️/⚪ based on:
   - ✅ Complete: Native construct present in tenant; classic variants fully retired (zero count, or zero usage).
   - 💡 In progress: Both classic and native present; dual-running.
   - ⚠️ Not started: Classic present; native absent.
   - ⚪ Not assessable: No native equivalent available yet, or probes did not complete.
4. **Effort estimate** — per domain, effort to remediate (low/medium/high).

**Migration Completeness % = adoption-weighted mean of assessable domains** (Complete 100 · In progress 50 · Not started 0; ⚪ excluded from the denominator, never scored 0). Each domain's weight is its **share of the tenant's active-usage footprint** (see [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md) §5 for the per-domain footprint proxy) — so migration debt in a domain the tenant actually uses moves the grade, and a barely-touched domain barely counts (CLAUDE.md rule 6). Extension debt is weighted by metric volume (P1–P4); an SLO-light tenant is not dragged by the SLO domain; a tenant with no custom-detector activity is not dragged by the anomaly-detector-framework domain (its weight, B49, is a 30-day event-stream share, with enabled-count share as fallback). Fall back to fixed weights where a footprint proxy is unavailable, and state which basis was used in the method note.

**Pillar grade** — roll up to A–D on the repo-standard bands (same as `/dt-eval-tenant`):
- A ≥ 85% complete — all domains have a clear path.
- B ≥ 70% — one or two domains need focused work.
- C ≥ 50% — clear remediation backlog.
- D < 50% — comprehensive re-architecture needed.

---

## Phase 3 — Produce Report

Generate a client-ready Word document (`.docx`) using the shared `docx_style.py` from `../.dt-eval-common/`.

**Cover:**
- Title: "Gen3 Migration Progress Review"
- Tenant ID, date, audience (External or Internal).
- **Migration Completeness** — large, prominent % (0–100) on every edition: it is a **progress** headline (distance to a target the tenant can reach and be finished with), which the grades rule exempts, and this is the one place a % belongs on a cover. The **A–D letter and the band gauge** beside it are grades and appear only where the edition carries grades — the Internal one always, the External one when the run passed `--grades` (owner rule 2026-08-25). Pass the computed values as they are: `cover_page` keeps the percentage and drops the letter and the dial, because `headline_format="percent"` declares `headline_kind="progress"`.
- Tagline: "Platform-native adoption path for <tenantId>, mapping each classic construct to its native equivalent."

**Executive Summary (1 page):**
- Migration Completeness % (every edition — progress is exempt from the grades rule), with the A–D grade beside it only where the edition carries grades.
- High-level domain breakdown: N ✅ complete, M 💡 in progress, P ⚠️ not started, Q ⚪ not assessable.
- Key insight: the single biggest remediation area (highest effort, highest impact).
- Next step: the first domain to tackle.

**Domain-by-Domain Report (main body):**

For each domain:
- **Status badge** — ✅/💡/⚠️/⚪.
- **Current state** — inventory (count + example names) of classic constructs in this domain. **The count carries its reproduction evidence** (CLAUDE.md core directive #4): `reproduction={query, note, sample}` on the section — the client-runnable query and/or five of the constructs counted. "Example names" is not optional garnish here; it is the sample, capped at five. **`docx_style.finding_section()` raises `UnreproducibleCountError` if you build a counted domain without it**, and the hygiene scan flags it (`structure-unreproducible-count`) by **status heading**, so inventing a different lead than *Current state:* no longer slips past — two delivered editions did exactly that. Where a domain's state is GUI-only with nothing enumerable, `reproduction={"note": …}` states why; silence does not build. **This skill has no builder and authors its reports by hand, which is precisely why the guard sits in `finding_section` rather than in the scaffold** — 33 delivered Gen3 documents carried 209 counted claims and zero reproduction blocks before it did.
- **Target state** — native equivalent, with **docs.dynatrace.com link** (authoritative) + BPN series cross-reference (further reading).
- **Remediation path** — sequenced, step-by-step instructions (e.g. "1. Create 3 workflow automations… 2. Migrate recipients… 3. Test failover… 4. Retire alerting profiles"). Each step cites its doc link.
- **Effort/risk** — effort estimate (low/medium/high) and any risk notes (e.g. "ensure no custom behavior depends on auto-tagging order").

**Appendix:**
- ⚪ Not assessable items (footnote only; never in body).
- Glossary of native constructs (Segments, Workflows, SLO, etc.) with doc links.
- Run metadata: context, tenantId, probes run, timestamp, Grail consumption estimate.

**Filename:** `<tenantId>-gen3-migration-progress-<date>(vN).docx` (internal audience: `[INTERNAL ONLY]-<tenantId>-gen3-migration-progress-<date>(vN).docx`).

**Output location:** User-confirmed path (default `~/Documents/Dynatrace-Reviews/<customer-name>/current/`, `(vN)`-versioned filename).

---

## Phase 4 — Finalize & Record

**Pre-delivery hygiene scan (mandatory) — run the shared scanner, never re-derive patterns from prose:** `.venv/bin/python ../.dt-eval-common/verify_docx.py <file> --profile gen3` for the External report, `--profile internal` for the Internal one. The `gen3` profile keeps every absolute rule (cross-tenant, run-state, dollar, raw-float, BPN series-code, security markers, plus the profile-independent `gen2-expansion`, foreign-customer-name and distribution-marking checks — build with `new_report_doc(internal=False)` for the External report and `internal=True` for the Internal one, so every page carries the watermark or the red banner respectively — this report type states classic inventories constantly, which is legal; recommending *more* of one never is) but drops the scoring-machinery patterns this report type is *required* to carry — the weighting-basis method note and the % headline are mandated content, and rewording correct prose to appease a scanner is the failure mode the scanner guidance forbids.

Use `runlog.py finalize --migration-report`:
- Append the report filename to `run.json` metadata.
- Log completion timestamp and output location.
- Ready for comparison on future runs (same context, later date).

---

## Hard rules & non-negotiables

1. **Read-only only** — `get`, `query`, `describe`, `verify` only. Never `apply`, `create`, `delete`, `edit`, `update`, `enable`, `restore`, `share`/`unshare`, or any `exec` verb.
2. **No classic-construct recommendations** — every gap points toward native. If native doesn't exist yet, mark ⚪ and foot-note.
3. **Every finding gets a remediation path** — with docs.dynatrace.com links and step-by-step actions. A count without a "here's how" is incomplete.
4. **No internal engagement documents cited** — facts with neutral attribution only. External reports hide all scoring math; internal reports expose it.
5. **No cross-tenant references** — this tenant only. No rankings or comparative language.
6. **Fully standalone deliverable** — selecting this report drops all others. Never paired.
7. **Citations bind both audiences** — docs.dynatrace.com (authoritative) and BPN series (further reading) cited for every domain.
8. **Name the domains, never number them, in customer copy** — write "Scoping and access boundaries", not "E2"; "the same work as the scoping domain", not "the same work as domain E2". `E1`–`E13` are the identifiers the §E recipe uses internally and they mean nothing to a reader. Cross-reference domains by name. The same goes for probe IDs behind a figure (`B37`, `A15`, `EC11`) and verification codes (`V33`): the customer sees the measurement, never the read that produced it. Since 2026-08-04 the hygiene scan enforces this on every customer-facing profile — three delivered Gen3 reports had already shipped numbered domains before it did. The Internal Report is exempt and should keep the identifiers.

---

## Design reference

Full domain matrix, remediation runbooks, scoring detail, and design rationale: [gen3-migration-progress-spec.md](../dt-eval-tenant/gen3-migration-progress-spec.md) (shared specification, live design note).

Client-runnable verification twins (DQL mirror queries): [verification-queries.md](../dt-eval-tenant/verification-queries.md) — query V33 (+ E5/E8/E9 sub-twins), and V51 for the E13 footprint weight.

Manual extraction (no-agent reproduction): [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) — §8. Repo-root file, absent from installed skill copies (`~/.claude/skills/`) — the §E recipe in [probes-gen3.md](../dt-eval-tenant/probes-gen3.md) (shipped) carries the same probe reads and scoring rules.

---

## Running this skill

```bash
# Interactive mode (user is prompted for context, output location, audience)
/dt-eval-gen3

# OR environment override (output location)
DT_EVAL_OUTPUT_DIR=~/my-reviews /dt-eval-gen3
```

The skill will:
1. Confirm inputs (context, tenantId, output path, audience).
2. Run read-only probe collection via dtctl.
3. Map and score per-domain Gen3 adoption.
4. Generate the standalone `.docx` report.
5. Record run metadata in the repo-relative `runs/<tenantId>-<date>/run.json` (gitignored; survives the session for future comparisons).

---

## Troubleshooting

**Q: "dtctl: context not found"**
- Ensure the user has run `dtctl auth login --context <name> --environment <url>` and the session is active.
- Verify the context name matches what the user has set up.

**Q: "Output path does not exist"**
- The skill will create the directory if it doesn't exist (using `mkdir -p`).
- Verify the user has write permission to the parent directory.

**Q: "Some probes failed or timed out"**
- Check `run.json` → `probe_results` → `.err` files for error details.
- Cost guardrails may have triggered; re-run with a narrower time window or check Grail budget.
- Contact support if `dtctl verify` reports authentication or connectivity issues.

**Q: "I want to compare this run to my last review"**
- Finalized runs are stored in the repo-relative `runs/<tenantId>-<date>/` directories (gitignored). The `runlog.py compare` subcommand (shared with `/dt-eval-tenant`) can diff two runs by date/context.
- **An empty `runs/` does not mean this is a first review.** Run state and delivered reports diverge — a refresh, another machine, or a cleanup removes the run directory while the output tree keeps the reports. `runlog.py delivered <tenantId>` lists the dates reports were delivered on, independent of `runs/`; when it finds some and `runs/` is empty, there is no baseline to diff and no cached evidence to reuse. Say so in the run summary instead of treating the tenant as new.

---

## Shared components (monorepo)

This skill relies on:
- **Probes** — defined in the probe catalog ([probes.md](../dt-eval-tenant/probes.md) router: [probes-config.md](../dt-eval-tenant/probes-config.md) A1–A54, [probes-grail.md](../dt-eval-tenant/probes-grail.md) B1–B50, [probes-deepdives.md](../dt-eval-tenant/probes-deepdives.md) D1–D6, [probes-gen3.md](../dt-eval-tenant/probes-gen3.md) §E). Domain-scoring gotchas specific to this skill live in [field-notes-gen3.md](../dt-eval-tenant/field-notes-gen3.md), alongside the shared [field-notes.md](../dt-eval-tenant/field-notes.md).
- **Scoring engine** — [scoring_engine.py](../.dt-eval-common/scoring_engine.py) (OES, pillar weights, confidence flags).
- **Report audiences** — [report-audiences.md](../.dt-eval-common/report-audiences.md) (External vs. Internal voice and structure).
- **Verification queries** — [verification-queries.md](../dt-eval-tenant/verification-queries.md) (V33 + sub-twins for Gen3 migration, V51 for the E13 footprint weight; client-runnable DQL).
- **Report style & run-state protocol** — [docx_style.py](../.dt-eval-common/docx_style.py), [runlog.py](../.dt-eval-common/runlog.py) (same house style and run-log framework as `/dt-eval-tenant`).
- **Output config** — [output-config.json](../.dt-eval-common/output-config.json) (default output root, directory structure).

All in this monorepo: domain docs under `.claude/skills/dt-eval-tenant/`, shared engine under `.claude/skills/.dt-eval-common/`. Keep them in sync when any skill updates shared components.

## Building the report

**Use the committed builder — never hand-write one.** `python3 build_gen3_report.py <run_dir> <content.py> [--external] [--internal]`

The builder holds the structure; a per-run content module (scratchpad only — it carries tenant data) holds every number and sentence, and a missing required field raises rather than shipping a placeholder. It scans each edition before saving and files earlier editions away only on a clean result.

This skill had no committed builder until 2026-08-11, so every run wrote a throwaway one and nothing enforced the rules above. On a sibling skill that same gap shipped four customer-facing reports in the internal diagnostic voice. The builder is where those rules now live:

- every domain carries its native replacement, evidence and sequenced steps — a count with no "here's how" is refused;
- a ⚪ domain cannot reach the body and must go to `not_assessable` with the access that would include it;
- the customer edition is scanned under the `gen3` profile, which since 2026-08-10 also enforces the external-voice substitution table.
