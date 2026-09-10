---
name: dt-eval-openpipeline
description: OpenPipeline configuration deep-dive — assess routing integrity, native adoption breadth, and structural hygiene of a Dynatrace tenant's OpenPipeline estate. Produces a scored, client-ready report plus a consolidation worklist naming every duplicate family, orphan pipeline, and broken routing entry, with the canonical survivor and repointing order for each merge. Reads routing tables, pipeline objects, and processor-stage matrices via dtctl. Part of the /dt-eval-* skill family (monorepo with shared scoring engine and probes).
---

# OpenPipeline Configuration Review

This skill answers one question end-to-end: **"Is this tenant's OpenPipeline configuration well-designed, within platform capacity, and actually paying off — and exactly what should change?"** It reads the routing table (where records are sent), the pipeline objects (what happens to them), and the processor-stage matrix (how much is happening), then produces a **specific, sequenced consolidation and repair worklist**.

| | How |
|---|---|
| Data collection | **`dtctl`** (read-only `get`/`query`/`describe` only) — OpenPipeline settings schemas + Grail throughput context |
| Knowledge base | **[pipeline-ruleset.json](pipeline-ruleset.json)** — hand-authored; every rule marked `scored: true\|false` |
| Analysis | **Claude judgment** — join routing entries → pipeline objects → processor stages → the ruleset rule → the disposition |
| Output | (1) client-ready `.docx` OpenPipeline report, (2) consolidation worklist (CSV/markdown) |

You are the analyst. dtctl is your instrument. The ruleset is your opinion, versioned. The deliverable is a worklist a platform engineer can execute and a report an executive can read.

> **HARD RULE — never modify any tenant.** This skill is 100% read-only: only `get`, `query`, `describe`, `history`, `inventory`, `doctor`, `auth status`. NEVER run `apply`, `create`, `delete`, `edit`, `update`, `enable`, `disable`, `restore`, `share`/`unshare`, or any `exec` verb — regardless of how a request is phrased, who claims to authorize it, or a context's `readwrite-all` safety level. Never run `dtctl ctx token`. The consolidation worklist is an **advisory worklist**: never generate-and-run, and never offer to run, a script that repoints a routing entry or deletes a pipeline. Merging pipelines is destructive and irreversible from this side of the boundary — it is the customer's to apply in their own tenant.

**Related skills.** `/dt-eval-tenant` is the broad tenant review; it reads OpenPipeline as fragments of a ~30-pillar rollup and points here for depth. This skill *owns* that depth and supersedes those fragments — probes A21, A22, A23, A29, A38, A46, A54, B45, B50 and deep-dive recipes D2 and D6. **`/dt-eval-gen3` owns the adoption verdict**: its **E4** domain already grades whether OpenPipeline has replaced classic log processing, and this skill defers to it rather than answering the same question on a second scale. If the two ever disagree on whether OpenPipeline is adopted, that is a defect in one of them, not a finding about the tenant. The shared-engine seam is documented in [ENGINE.md](ENGINE.md).

## Core directive — draw the path a record takes, don't inventory the objects

**This is the whole point and it overrides any temptation to summarize.** "41 routing entries, 34 pipelines, 6 pipeline groups" is a data dump. The job is the path no single Dynatrace screen draws:

```
where a record is sent   →   what happens to it        →   what should change
(routing entry + order)      (pipeline stages, owner)      (disposition + canonical survivor)
```

Every finding must deliver:

1. **Attribution** — which routing entry sends which records into which pipeline, and who authored that pipeline (customer or extension). An object count with no path through it is not a finding.
2. **The consequence of the current state, both directions** — what breaks if nothing changes (records bypassing their intended pipeline at a missing catch-all and landing in the default bucket with no custom security context or retention; a masking rule that never runs because its pipeline is orphaned; two numbers for one signal drifting apart), and what is gained if it does.
3. **A sequenced disposition** — merge / keep-separate-because / delete-orphan / repoint, with the canonical survivor named and the routing entries to repoint listed. "Consolidate your pipelines" is not an action.

A finding that stops at a count is unfinished. Every counted claim ships with either the client-runnable query that produced it or a sample of five of the things being counted — ideally both, per the repo's show-your-work rule.

## Three honesty rules that keep this skill credible

- **Absence of configuration is not health.** Most of what this skill measures is the *absence of defects*, and a tenant that has built nothing has no defects. That is why the adoption gate exists ([scoring.md](scoring.md)) and why a small estate gets no health score at all. Never let "nothing wrong found" read as "well built."
- **A permissions gap is never a configuration defect.** The single easiest way to produce a confidently wrong OpenPipeline finding is to read a partial pipeline set and describe it as thin. ⚪ is always the honest verdict when a read is denied — name the access that would close it.
- **Two of the defects this skill finds may be deliberate.** Governance drift and near-duplicate families can both be correct configuration. Neither enters the score until a human confirms it is accidental (Phase 4). Never recommend merging a drifted family without asking.

## Inputs to resolve (before any probing)

1. **Tenant ID** (required) — the environment identifier (e.g. `abc12345` from `https://abc12345.apps.dynatrace.com`). Ask explicitly if not provided.
2. **Customer name** (required) — the organization or team name. Ask explicitly if not provided. Used in cover pages and output directories.
3. **Dynatrace authentication context** — the `dtctl` context name. If the user named one, use `--context <name>` on every command. If exactly one exists, use it. If several and none specified, ask. Validate it points at the tenant ID above.
4. **Output location** — write deliverables to `<output-root>/<customer-name>/current/`, filenames `<tenantId>-OpenPipeline-<YYYY-MM-DD>(vN).<ext>`, or `[INTERNAL ONLY]-<tenantId>-OpenPipeline-<YYYY-MM-DD>(vN).<ext>` for an internal edition. **The `OpenPipeline` stem is fixed** — `dt-eval-rollup`'s `SKILLS` registry matches on it, and a renamed stem silently drops this skill's column from the dashboard. Resolve `<output-root>` from `DT_EVAL_OUTPUT_DIR` if set, else `~/Documents/Dynatrace-Reviews`. Expand `~`, create the dir.

   **Tenant layout — ask ONCE per customer, only when there is more than one tenant** (owner decision 2026-08-27). A customer with several tenants may keep every tenant's deliverables side by side in one `current/` folder (**flat**, the default and the existing behaviour), or give each tenant its own subtree (**per-tenant**, `<output-root>/<customer-name>/<tenantId>/current/` with its own `_superseded/` sibling). Run `.venv/bin/python ../.dt-eval-common/layout.py status --customer "<name>" --tenant <tenantId>` at Phase 0; when it reports **MULTI-TENANT, LAYOUT NOT CHOSEN**, ask the user (AskUserQuestion) which they want, pre-filled with *flat*, then record it with `layout.py set --customer "<name>" --layout <choice>` — which also **migrates what is already on disk** (files move, never deleted; a superseded edition stays superseded; a cross-tenant document stays at the customer level). A **single-tenant** customer is never asked and never nests. The answer is stored in `<output-root>/<customer-name>/.dt-eval-layout.json` and **every sibling skill inherits it without asking again** — the layout belongs to the customer, not to a run, because half a customer's reports nested and half flat is two live editions of one report in two folders, which is exactly what `current/` exists to prevent. `DT_EVAL_TENANT_LAYOUT` overrides and suppresses the prompt for headless runs. If `layout.py status` reports deliverables it could not attribute, pass the missing ids with `--tenant <id>` (repeatable) rather than letting them stay behind.
5. **Report audience** (optional) — External (customer-facing) or **(Internal)** (Dynatrace-facing; scoring machinery and diagnostic vocabulary exposed). Default: External. Both use the `detailed` scanner profile. Audience changes voice and sections, never the math. **Grades are an option and off by default on the External edition (owner rule, 2026-08-25):** it carries no score, grade badge, gauge or Score/Grade column unless this run was explicitly asked for a graded customer document — pass `--grades` to the builder then. Do not ask a separate question for it; the Internal edition is always graded. See [report-audiences.md](../.dt-eval-common/report-audiences.md) § *Grades are an option*.
6. **Scopes to assess** (optional) — default **all** OpenPipeline data-type scopes: `logs`, `bizevents`, `events`, `events.security`, `davis.problems`, `davis.events`, `events.sdlc`, `metrics`. Narrow only if the user asks. **Never merge findings across scopes** — a pipeline in one scope cannot receive another's records, so a "duplicate family" spanning two scopes is not a family.
7. **Time window** — default **7 days** for the throughput/liveness context reads. Configuration reads are point-in-time and carry no window. State the window on every volume figure and never on a configuration figure.
8. **Deliverables** — default to both: **(a)** Word OpenPipeline report, **(b)** consolidation worklist. One probe collection feeds both.

## Run state — one durable file per run

Every run lives in **`runs/<tenantId>-<YYYY-MM-DD>/`** in the skill repo: raw probe outputs as files plus **`run.json`**, managed by the shared [runlog.py](../.dt-eval-common/runlog.py). **Run `runlog.py` from this skill's own directory** — `runs/...` paths are cwd-relative and `runlog.py` refuses a relative run path that would land outside a skill's own `runs/` dir.

1. **Start:** `runlog.py init runs/<id>/run.json --tenant <id> --url <https://id.apps.dynatrace.com> --context <name> --customer "<customer-name>" --requested-by <email from dtctl auth whoami>`. If it prints `EXISTS`, you are resuming — reuse cache under 24 hours old by default; prompt if older; `--fresh` forces re-collection.
2. **After every probe:** save raw output to a file, then `runlog.py record run.json <probe_id> ok --summary '<compact JSON of the numbers you'll cite>' --raw <file>`. `unknown` for 403/⚪, `error` for retryable failures. **zsh:** alias the runner as an array (`RL=(.venv/bin/python ../.dt-eval-common/runlog.py)` → `"${RL[@]}" record …`), never a scalar — zsh does not word-split unquoted variables and every record silently fails.
3. **Cross-skill reuse.** Every probe this skill needs already exists, live-validated, in `/dt-eval-tenant`. Locate a same-day sibling cache with `runlog.py find <tenant> <date>` and reuse rather than re-billing the same query hours apart:

   | This skill | ≡ | Reads |
   |---|---|---|
   | `OP-routing` | A21 | routing table, entry order, catch-all detection |
   | `OP-pipelines` | A22 | pipeline objects + pipeline groups, per-pipeline governance fields — **run `diagnose_pipelines.py` for this, not a bare list read** |
   | `OP-breadth` | A23 | the non-logs OpenPipeline scopes |
   | `OP-classic` | A29 | classic-translation residue — **the CLI verb no longer exists (dtctl 0.38.0); use the B51 `route_name` split instead, see below** |
   | `OP-masking` | A38 | masking-layer coverage |
   | `OP-classic-log` | A46 | classic log-storage/security-context rules (the contrast object) |
   | `OP-schema-reads` | A54 | direct-by-name schema reads for the whole `openpipeline.*` family |
   | `OP-throughput` | B45 | routing-record throughput — **context only, never scored** |
   | `OP-dup-collectors` | B50 | duplicate metric ingestion paths |
   | `OP-stage-matrix` | D2 | per-pipeline processor matrix + ownership partition |
   | `OP-consolidation` | D6 | duplicate families, governance drift, orphans |

   **`OP-metrics` — the self-monitoring surface, and the one read that survives an unreadable
   pipeline set (added 2026-08-26, after two live tenants gated on unreadable pipeline objects
   while this family answered most of the same questions).** `dt.sfm.openpipeline.*` is the
   platform's own OpenPipeline telemetry and it is NOT settings-object data, so object-level read
   shares do not gate it. It is the surface the in-product *OpenPipeline usage overview* dashboard
   is built on. Five reads carry the weight:

   ```
   // per-pipeline throughput — the pipeline INVENTORY when the objects will not read.
   // pipeline_id == "default" is the platform pipeline; any other value is customer-authored
   // and carries the pipeline's NAME in the identifier.
   timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-7d,
     by:{pipeline_id, configuration}
   | fieldsAdd total = arraySum(records) | fields configuration, pipeline_id, total | sort total desc
   ```
   ```
   // per-route throughput — which routing entries actually match, and how much they carry.
   // A configured, enabled rule absent from this result matched NOTHING in the window.
   timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-7d,
     by:{route_name, configuration}
   | fieldsAdd total = arraySum(records) | fields configuration, route_name, total | sort total desc
   ```
   ```
   // ingest by signal type — the denominator for every share, and the scope-coverage picture.
   timeseries s = sum(dt.sfm.openpipeline.ingest_sources_in.records), from:-7d, by:{configuration}
   | fieldsAdd total = arraySum(s) | fields configuration, total | sort total desc
   ```
   ```
   // records discarded before storage, by reason — `intentionally_dropped` is a drop pipeline
   // working; `not_valid` is malformed input. Reconcile against the drop pipeline's own routed
   // count: a drop pipeline should discard everything it receives.
   timeseries n = sum(dt.sfm.openpipeline.not_stored.records), from:-7d, by:{reason, configuration}
   | fieldsAdd total = arraySum(n) | fields configuration, reason, total | sort total desc
   ```
   ```
   // forwarding health, where forwarding is configured at all.
   timeseries { ok = sum(dt.sfm.openpipeline.forwarding.successful_records, scalar:true),
                fail = sum(dt.sfm.openpipeline.forwarding.failed_records, scalar:true) }, from:-7d
   ```

   **What this changes about the gate.** `pipeline_id` yields a **measured floor** on `n_authored`
   — the pipelines that processed records in the window — which is not the same as the configured
   inventory, because a configured-but-idle pipeline never appears. So it does **not** by itself
   release `adoption_not_assessable`: report the floor, name the pipelines, quantify their
   throughput, and keep the gate. It does mean a gated report is no longer thin — live 2026-08-26,
   it turned two "we could not read anything" reports into ones naming every live pipeline, its
   volume, and a fully reconciled drop chain. **Run it on every OpenPipeline review, not only when
   the objects fail to read** — per-route throughput answers "which rules actually match", which
   the configuration alone cannot.

   Record reused evidence in this skill's own `run.json` with `--note "reused from dt-eval-tenant run"`.
4. **Compare:** if a prior completed run exists, `runlog.py compare` — did the customer-authored pipeline count, the duplicate-family count, or the orphan count move? Also run `runlog.py delivered <tenantId>`: deliverables without run state mean a prior review exists with no baseline to diff.
5. **Finalize:** `runlog.py finalize run.json --skill openpipeline --report <docx-path> --overall <score> --grade <G> --confidence <High|Medium|Low> --pillars '<json>'`. Pillars carry `routing_integrity` / `native_adoption_breadth` / `structural_hygiene`. **`--skill openpipeline` is mandatory** — it namespaces the result under `results.openpipeline` so this finalize never clobbers a same-day sibling's score. **For a gated run, pass no score and instead `--no-grade-reason "<the string from findings_schema>"`.**

   **Saying "the inventory could not be read" on a command line: `--n-authored not-assessable`.**
   Both `scoring.py` and `assemble_findings.py` accept the literal `not-assessable` where an integer
   would go, and it parses to the `None` that raises the `adoption_not_assessable` gate. **Never pass
   `0` for that case** — `0` asserts you looked and the tenant has none, which is
   `below_adoption_floor`, a different finding with the opposite meaning to a customer. The two were
   collapsible until 2026-08-26 because both CLIs declared `--n-authored` as `type=int`, so the
   documented gate had no documented way to reach it and a live run had to import the library
   directly.

> **Prerequisite:** `--skill openpipeline` requires the O1–O6 engine registration from the spec to have landed. Without O1 the `finalize` call fails argparse validation; without O2 it writes no `headline` block at all and the rollup has nothing to read. Verify with a dry-run finalize against a synthetic run before collecting real evidence.

## Phase 0 — Preflight

```bash
dtctl version                        # setup.sh enforces ≥ 0.35
dtctl ctx                            # confirm target context
dtctl doctor --context <ctx>         # connectivity + auth health
dtctl auth status --context <ctx>    # auth type + token health
```

Map token reach with `--check-scopes` before probing so denied areas are pre-declared ⚪ rather than discovered mid-run. A 403 is ⚪, never a finding. **Scope note:** the only OpenPipeline-specific OAuth scope is `openpipeline:configurations:read`, needed solely for the classic-translation read (`OP-classic`). Everything else is `settings:objects:read`, already present in the standard manifest.

> **🔴 Read every `openpipeline.<scope>.*` schema DIRECTLY BY NAME. Never gate a read on `settings-schemas` discovery.** Discovery is unreliable for this entire family: a regex over `settings-schemas` returns one unrelated hit and **zero** matches for the routing and pipelines schemas — all of which are real, populated, and directly readable. Broadening the regex surfaces decoy `internal.open-pipeline.*` schemas holding 0 objects. Concluding a schema is absent from a discovery miss produces a false "not adopted" reading that would depress the breadth pillar and could wrongly trip the adoption gate.

## Phase 1 — Routing and pipelines (the two surfaces, and the join between them)

Run `OP-routing` and `OP-pipelines` for every in-scope data type, then **immediately assert the join**.

**🔴 The A21↔A22 overlap assertion is mandatory and comes before every other conclusion — and it is now EXECUTABLE. Run [diagnose_pipelines.py](diagnose_pipelines.py) rather than performing the join by hand:**

```
python3 diagnose_pipelines.py --context <ctx> --json runs/<id>/pipeline-diagnosis.json
```

It reads every in-scope routing table and pipelines list, joins the routing entries' `pipelineId` values against the objects actually returned, asserts the overlap, and on a zero or partial overlap runs the three-step diagnosis below in order. It prints the value to hand straight to `--n-authored` and exits **0** for a determinate count, **2** for not-assessable. It also collects the B51 throughput floor as corroboration — and if the routing tables read clean while the platform's own counters show customer pipelines processing records, it refuses the "unbuilt" verdict and returns not-assessable with the contradiction recorded.

**Why this is code and not a checklist.** The pipelines list returns `{"ok":true,"result":[]}` in two situations that mean opposite things: the tenant has built nothing (→ `below_adoption_floor`), or every pipeline object is withheld by object-level sharing (→ `adoption_not_assessable`). Same bytes, opposite findings. Only a direct read of a pipeline the routing table *names* separates them. This was a procedure from the day the skill shipped, and a procedure is a rule someone has to remember; the cost of forgetting is not a missing number but the **wrong gate**, which tells a customer with working pipelines that they have built nothing. Live 2026-08-25, that sentence was one un-run command away from two tenants moving 16.3B and 82.5B records a week.

The three steps it performs, unchanged in substance:

1. **The surface dtctl reads is not the surface the app reads (corrected 2026-08-26 — read this before concluding anything about permissions).** A direct read of a routed `pipelineId` returns `403 No read share for object`. That message is **not a statement about the user's access.** `dtctl get settings` reaches the settings-object API; the OpenPipeline app reads `GET /platform/openpipeline/v1/configurations/<scope>`, dtctl implements **no verb** for it (`dtctl get apis` maps that base path to `preview-processor` alone), and the scope that endpoint needs — `openpipeline:configurations:read` — is typically **already granted**. The same user who gets the 403 can open the same pipelines in the browser. Record the stages **⚪ not assessable**, never as "thin" or absent — and **do not raise an access request**: it will not help. The remedy is an export (see below). This module's first version called it a read-share denial and a live engagement drafted a grant request that would have changed nothing.
2. **Pipeline groups** — the pipeline-groups schema. It may legitimately hold 0 objects, so absence there proves nothing, and the script records it without drawing a conclusion from it.
3. **Scope / pagination.**

Zero overlap is **⚪, never a routing-integrity defect** — it is a tooling artifact, and scoring it would report "we could not read this" to the customer as "your configuration is broken." Pass the script's verdict through unchanged: `--n-authored not-assessable`, never `--n-authored 0`.

**The export path — how to actually get the definitions (2026-08-26).** Because dtctl cannot reach the endpoint, ask the operator for a browser export. In the OpenPipeline app, open the signal type's **Pipelines** and **Dynamic routes** screens; each has an export control, and the browser Network tab also carries the raw `GET .../configurations/<scope>` response. What you need per signal type carrying custom routing:

- **pipelines** — the full definitions: `processing`, `securityContext`, `costAllocation`, `productAllocation` and `storage` processor arrays. This is what duplicate, drift and orphan analysis compares.
- **dynamic routes** — the ordered routing entries with their `pipelineId` targets, which is what the join needs.

**Watch the identifier trap.** A pipeline's `customId` is a *stale internal name* that does not track renames, while `displayName` is what the app shows and what the operator will recognise. The throughput metric's `pipeline_id` dimension carries the **customId**. Live 2026-08-26: `pipeline_drop_otel_collector_info_logs_nonprod_6887` is displayed as *"USF - Process Default Logs"* and is a 25-processor **processing** pipeline, not a drop pipeline — a report written from the metric dimension alone called it the opposite. **Always reconcile `customId` to `displayName` from the definitions before naming a pipeline in a deliverable.**

Once exported, the definitions unlock everything the gate otherwise blocks: exact-duplicate and near-duplicate detection, governance drift across a family, orphan detection (a pipeline no routing entry references), and per-processor findings that no counter can reach — a flatten step that never removes its source, a bucket-assignment rule that exists for a store nobody writes to, a storage stage with no enabled fallback.

Then read, per scope:
- **Routing entry count, enabled share, and order.** Routing is ordered and first-match-wins — read the **last** enabled entry before concluding anything.
- **Catch-all detection.** A trailing enabled entry whose matcher is literally `true` routes every unmatched record into a pipeline, so nothing falls through to the classic/default flow. Its presence earns nothing (it is the platform default); its **absence** caps routing integrity into the D band, because unmatched records fall through to the default pipeline and bucket — they receive default processing with no custom security context or retention. **They are not dropped.** Size the tail before writing the finding: measure the default-bucket share (live 2026-08-10: 0.027% of a 191M-record day on one estate), because the severity of this finding scales with that share and the cap does not. Zero enabled entries is categorically a different finding — everything really does fall through. State which world the tenant is in.
- **Dangling entries** — an enabled entry targeting a pipeline ID that resolves to nothing. Only assessable once the overlap assertion has passed; a merely-unreadable pipeline is not dangling.
- **Shadowed entries** — unreachable because an earlier enabled entry subsumes them. Entries following a catch-all are shadowed by construction; report them as such, not as a separate defect class.
- **Do NOT infer routing maturity from the default-bucket share.** That measures the *bucket*, not the pipeline.

## Phase 2 — Ownership partition, breadth, and masking

**🔴 MANDATORY before any orphan, duplicate, or consolidation logic: partition every pipeline by `externalId`.**

| `externalId` | Owner | Disposition |
|---|---|---|
| starts `com.dynatrace.` (the whole namespace, not only `.extension.`) | Platform default | **Never** a consolidation target, whatever its shape or route status. Report the count separately ("N extension-default pipelines, not assessed for consolidation") and stop there for that subset. |
| starts `monaco:` (config-as-code) or **null** (authored in the OpenPipeline app) | Customer-authored | In scope. **This subset alone is `N_authored`** — the adoption gate's denominator and the hygiene pillar's. |

Skipping this step turns platform defaults into a false consolidation finding. Live: 9 of 10 metrics pipelines read as "orphans" and all 10 carried extension `externalId`s — including two with identical 2-processor structures that would otherwise have matched the exact-duplicate test.

Then run `OP-breadth`, `OP-classic`, `OP-masking`, `OP-classic-log`:
- **Breadth** — which of the eight signal-type scopes carry a live pipeline.
- **Classic-translation residue** (`OP-classic`) — substantive output means migration is pending. **The `dtctl get classic-pipelines-translation` verb was removed and returns `unknown resource type` on dtctl 0.38.0 (verified live 2026-08-26); there is no settings-schema replacement.** Record it `unknown` with the note "CLI surface unavailable in this dtctl version" and **answer the question behaviourally instead**: the B51 `dt.sfm.openpipeline.routing.records` read grouped by `route_name` shows the share of each signal type still landing on the platform default route rather than on a customer-authored one. That is the stronger evidence — it measures what happens to records, not what is configured — and it is the comparison the in-product *OpenPipeline usage overview* dashboard makes. Where the read genuinely errors on a tenant that still has the verb: **graceful-degrade to ⚪, never fail the pillar, and never read an error as "no residue."** `classic_pending=None` is the correct input to `native_adoption_breadth()` in both cases. **On the command line say it out loud: `--classic-pending not-assessable`** (2026-08-26). Omitting the flag has always produced the same `None`, but an invisible convention is not a usable one — the obvious `--classic-pending ""` fails with `invalid int value: ''`, and since the CLI verb behind this read no longer exists, the ⚪ path is now the *only* correct path on every tenant. `--masking-coverage` and `--fall-through-pct` take the same literal, for the same reason. **Still never `0`** — that asserts a measured result of none.
- **Masking coverage** (`OP-masking`) — OpenPipeline mask processors are one of three enforcement layers. Score the OpenPipeline layer; name the other two in the narrative.
- **Classic log-storage rules** (`OP-classic-log`) — the explicit contrast object for "is this configuration split across two systems?"

## The adoption gate — check it here, before any deep-dive

Once `N_authored` is known, evaluate the gate ([scoring.md](scoring.md)). **Below the floor there is no OpenPipeline Health Score**: routing integrity and structural hygiene are ⚪ because their denominators are too small to mean anything, the headline becomes **"OpenPipeline Adoption (configuration-only)"**, and confidence is Low. `scoring.py` enforces this by refusing to emit a composite.

**The report cover — not just the appendix — must carry the notice:** *"This tenant has not yet built enough OpenPipeline configuration for a health verdict. The findings below describe the current state and the path to adoption."* A gated tenant is **"not applicable yet", never "scored 0"** — reporting a zero would rank a tenant that has not started below every tenant that has.

🔴 **That wording is the BELOW-FLOOR sentence only, and the not-assessable gate needs one of two different ones. Pass `--diagnosis` so the builder can tell them apart (2026-08-26).** `adoption_not_assessable` has two causes that call for **opposite actions from the customer**, and one sentence served both until this was split:

| Cause | `diagnosis` | What the cover must say | What the customer should do |
|---|---|---|---|
| **Tooling gap** — the definitions sit on a surface dtctl has no verb for | `dtctl_cannot_read_this_surface`(`_partial`), `scope_or_pagination`, `partial_overlap_unexplained`, `pipeline_read_errored` | not a limitation of anyone's access; no permission change needed; export from the OpenPipeline app | **Export.** A grant changes nothing |
| **Access gap** — the routing tables themselves would not read | `routing_unreadable` | could not be read with the access available for this review | **Grant.** There is no second surface to export from |
| Cause not established | *(omit the flag)* | states only that the configuration was not retrieved | Ask which of the two it is |

`diagnose_pipelines.py` already prints the right value — hand it straight through: `--diagnosis "$(jq -r .diagnosis runs/<id>/pipeline-diagnosis.json)"`. **Getting this wrong is not cosmetic**: v1.37.0 corrected `diagnose_pipelines.py`'s `remedy` field to say *"Not an access problem"* precisely because a live engagement drafted an access request off the earlier reading, and the cover was still telling the customer the opposite for another day. Guarded by `test_report_helpers.py`.

Phases 3 and 4 still run and still produce findings; they simply feed the narrative instead of a score.

## Phase 3 — The consolidation deep-dive

Local jq/python over the Phase-1 pipeline objects, **customer-authored subset only**, **per scope**.

1. **Exact duplicates** — two or more pipelines with byte-identical `processing` / `metricExtraction` / `dataExtraction` / `securityContext` / `storage` / `costAllocation` arrays (normalize away `objectId`/`title`/timestamps first). Zero-risk to merge: no processing content changes for any source. Typically one pipeline created per source at onboarding instead of routing every source at one existing pipeline.
2. **Near-duplicate families** — same processor **types and order**, differing only in literal parameters. Strip the literals, group on the resulting shape. **This is NOT an automatic generalization** — a pipeline processor has no general "handle N field-name variants in one step" primitive. Flag the family and its literal deltas; recommend generalizing only where the deltas are genuinely equivalent-shaped (same field semantics, different name or regex). Where they are not, tag it *"same processing, source-specific parameters — not a mergeable clone"*.
3. **Governance drift** — within a candidate family, diff `securityContext`, `storage`, `costAllocation`. Identical processing **+ identical governance** = genuinely redundant, merge it. Identical processing **+ different governance** = deliberately separated for ABAC scoping, bucket assignment, or cost attribution, and merging would silently reassign one source's security context or cost center to another's — a governance regression dressed as a simplification.
4. **Orphan cross-check** — a pipeline is unreferenced only if missing from **BOTH** consumer surfaces: the enabled routing entries **and** pipeline-group membership. A pipeline referenced only via a group is not orphaned. Ownership partition applies first.
5. **Volume-weight the canonical survivor** — pull each member's observed record share (`OP-throughput` where resolvable, else the routing/default-bucket split as a proxy) and keep the **highest-volume** member as canonical. Repointing low-volume entries onto an established pipeline is lower-risk than the reverse.
6. **Duplicate collection paths** (`OP-dup-collectors`) — third-party collector metrics that duplicate a native signal. **Join on entity**, not namespace overlap alone. Distinguish *zero candidate keys* (no collector runs at all — nothing to consolidate) from *zero overlap* (a collector runs but duplicates nothing); they have different remediation implications.

> **`OP-throughput` has no `pipeline` dimension.** `dt.openpipeline.pipeline`, `.pipeline.id`, `.route`, `.configuration`, `.endpoint` and `record_type` all silently null-bucket — a split on any of them produces a confident-looking chart of nothing. Only `dt.openpipeline.source` is real. And `pct_through_pipelines` reads ~100% on any Gen3 tenant regardless of migration depth: **volume and liveness context only, never an adoption score.**

## Phase 4 — Capacity, and the two confirmations

**Capacity.** Count processor stages per pipeline and pipelines per scope. Report both against the **public** limits page (`docs.dynatrace.com/docs/platform/openpipeline/reference/limits`) — that is the citable figure. The internal default/soft/hard tier structure is adjustable, not publicly documented, and **internal-audience deliverables only**; use it to rank which overloaded pipeline to split first, never to score. Both limits are soft: **lead with the structural fix** (split along an existing content seam, consolidate a duplicate family), not a limit-increase request.

**The two confirmations — a required human step, not an inference.** Governance drift and near-duplicate families are `scored_after_confirmation` in the ruleset. Before either enters the score:

- **Governance drift:** ask the owner, by family and by name — *"These pipelines share identical processing but differ in security context / storage / cost allocation. Is that separation deliberate?"* Deliberate ⇒ keep-separate, reported as a note, out of the score. Accidental ⇒ it joins the exact-duplicate defect set.
- **Near-duplicate families:** ask whether the per-member literal deltas are equivalent-shaped. Equivalent ⇒ genuinely generalizable, joins the defect set. Not equivalent ⇒ keep-separate, out of the score.

If the confirmation cannot be obtained this engagement, **both stay out of the score** and are reported as open questions with the specific question named. An unconfirmed assumption is never scored as a defect — scoring possibly-correct configuration is how a review loses the room.

## Phase 5 — Deliverables

Build from the shared `run.json`. Structure in [output-spec.md](output-spec.md), rubric in [scoring.md](scoring.md), meta schema in [findings_schema.py](findings_schema.py) — build `findings.json`'s `meta` via `assemble_findings.py` rather than hand-typing it, so a run cannot invent its own vocabulary.

1. **Word OpenPipeline report** — client-ready `.docx` via the shared [docx_style.py](../.dt-eval-common/docx_style.py): cover with the **scale stat line** — and the Health Score only where the edition carries grades (Internal always, External with `--grades`; owner rule 2026-08-25) — (customer-authored pipelines · routing entries · signal-type scopes configured), executive summary, the routing and pipeline picture, deep-dive findings (attributed, interpreted, sequenced), the consolidation worklist, and a "verify these findings yourself" section of client-runnable DQL.
2. **Consolidation worklist** — a table with one row per family: `family_id · member_pipelineIds · canonical_pipelineId · member_record_share · governance_drift (y/n + which field) · disposition (merge / keep-separate:<reason> / delete-orphan) · routingEntries_to_repoint`. This is the artifact a platform engineer executes from.

**Verify before reporting back:** reopen each deliverable, assert non-empty, then run the shared hygiene scanner — `.venv/bin/python ../.dt-eval-common/verify_docx.py <file> --profile detailed` for External, `--profile internal` for Internal. A scanner finding is banned content **or** a scanner bug — never reword correct prose to appease it. **Scan the worklist too**, passing the subject explicitly rather than letting it be inferred, taking the value from `run.json`'s `meta.customer` and never from memory of the session:

```
.venv/bin/python ../.dt-eval-common/verify_docx.py <worklist.md> --profile detailed --customer "<customer>" --customer <tenantId>
```

Then report the resolved output paths, the score with its three pillars (or the gated headline and its reason), the top three dispositions by yield, and anything ⚪ with the access needed to close it.

## Scoring (summary — full rubric in [scoring.md](scoring.md), formulas in [scoring.py](scoring.py))

The headline is the **OpenPipeline Health Score** (0–100, A/B/C/D bands) — `0.40·R + 0.30·N + 0.30·C`: **R** routing integrity, **N** native adoption breadth, **C** structural hygiene. Compute via `scoring.py`, never by hand. Two rules carry the most weight in practice: **the adoption gate** (below the floor there is no score — most of what this skill measures is the absence of defects, and a tenant that built nothing has none), and **the platform-default rule** (*a check whose ✅ state is the platform default earns nothing; only its absence may move a score*). Never attach the word "Overall" to a single pillar. The score is a health headline; the *worklist* is the deliverable.

## Hygiene (same rules as the Tenant Eval)

- **Read-only always.** The skill never changes tenant config; it recommends and the customer applies.
- **Client-facing docs state what/how/window** and what was not assessed — never internal machinery (run paths, `run.json`, probe IDs, raw API error strings, context names → plain language). "Not assessed in this review" plus the access that would include it, never "out of scope."
- **⚪ items never appear in the report body** — appendix footnotes only; the body legend is ✅/💡/⚠️.
- **No cross-tenant references.** Each report is self-contained to its tenant. No rankings, no comparative superlatives.
- **Gen3-first.** Never score the absence of a classic construct as a gap and never recommend creating one. The classic log-storage read is a contrast object, not a target state.
- **Ground recommendations in docs.dynatrace.com** (authoritative — verify each recommendation against it this run); the BPN OpenPipeline material is further reading only. Cite what you actually opened.
- **Cost guardrails are non-negotiable.** Configuration reads are cheap settings-object reads. The throughput context read stays inside the standard guardrails; never widen it to a full unscoped `fetch`.

## Reference data (illustrative example)

Illustrative only; each run measures fresh. A representative mid-size estate: several dozen customer-authored pipelines across two or three scopes, a routing table roughly 20% larger than the pipeline count, a catch-all present, a handful of dangling entries from decommissioned sources, one or two exact-duplicate families created during a per-source onboarding push, and a near-duplicate family of vendor security-log pipelines sharing an identical normalize stage behind vendor-specific parse patterns — the generalizable case. Extension-default pipelines typically outnumber customer-authored ones in the metrics scope and must be partitioned out before any of the above means anything.
