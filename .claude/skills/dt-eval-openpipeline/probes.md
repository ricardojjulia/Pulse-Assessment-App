# OpenPipeline probes

Every probe here is **lifted from `/dt-eval-tenant`, not re-derived.** Each carries the verified gotcha from its source, verbatim in substance — those gotchas were each validated live against a real defect, and re-wording one is how a hard-won correction gets softened back into a wrong answer. The `source` line names the file and probe ID so a maintainer can read the original rather than trusting this copy.

**Local ID ↔ tenant-skill ID** is the alias table in [SKILL.md](SKILL.md); reuse a same-day sibling's cached evidence via `runlog.py find <tenant> <date>` rather than re-billing these queries.

All probes are **read-only**. Cost is trivial for every configuration read (settings objects); the two Grail reads stay inside the standard guardrails.

> **🔴 Applies to every `OP-*` schema read below — read DIRECTLY BY NAME; never gate on `settings-schemas` discovery.**
> Discovery is unreliable for the entire `openpipeline.*` family. Live-verified: a regex over `settings-schemas` returned exactly **one** unrelated hit (`builtin:internal.log.openpipeline.processing.settings`) and **zero** matches for `openpipeline.logs.routing`, `.logs.pipelines`, or any `.metrics.*` schema — all of which are real, populated, and directly readable (logs.pipelines returned 17 objects; metrics.pipelines 10; metrics.routing 1 real entry). Broadening the regex to catch a hyphenated variant surfaces 16 decoy `builtin:internal.open-pipeline.*` schemas instead, none of which are the real objects (`internal.open-pipeline.pipelines` returned **0** on the same tenant where `openpipeline.logs.pipelines` returned 17). **The `settings-schemas` listing must never be used to conclude an `openpipeline.<scope>.*` schema's absence — only a direct-by-name read can.** Treat discovery as a nice-to-have cross-check, never as the gate.
> *(source: probes-config.md A54, corrected 2026-08-07)*

---

## §1 — Routing and pipelines

### OP-routing (≡ A21) — the routing table

```bash
dtctl get settings --schema builtin:openpipeline.logs.routing --scope environment -o json
```

Read `routingEntries[]`: count, `enabled` share, `matcher` quality, target `pipelineId`.

**Routing is ordered and first-match-wins — read the LAST enabled entry before concluding anything.** A trailing enabled entry whose matcher is literally `true` is a **catch-all**: every record not matched earlier is routed into a pipeline, so **nothing falls through to the classic/default flow** and the tenant's log processing is native end-to-end regardless of how thin the rest looks. Detect it explicitly:

```bash
jq '[.[0].value.routingEntries[] | select(.enabled and (.matcher|tostring|test("^\\s*true\\s*$")))] | length'
```

State which of the two worlds the tenant is in — they are categorically different findings. **0 enabled entries** = everything really does fall through to the default pipeline.

**Do NOT infer routing maturity from the default-bucket share** — that measures the *bucket*, not the pipeline.

**Scoring note:** catch-all presence earns **nothing** (it is the platform default on any Gen3 tenant); its absence caps routing integrity at 40. See [scoring.md](scoring.md), "The default rule."

*Source: probes-config.md A21 · field-notes.md "Routing is ordered and first-match-wins".*

### OP-pipelines (≡ A22) — pipeline objects and pipeline groups

```bash
dtctl get settings --schema builtin:openpipeline.logs.pipelines --scope environment -o json
# and the pipeline-GROUPS schema for the same scope
```

Per pipeline, read: `securityContext` (ABAC assignment), `storage` (bucket assignment), `processing`, `metricExtraction` (log-to-metrics), `costAllocation`, and `externalId` (ownership — see §2).

**🔴 The pipelines schema does NOT necessarily return the pipelines the routing table targets.** Live-verified on a reference tenant: the schema returned 5 tech pipelines (database and OS integrations) while the routing table fed 9 *different* pipeline IDs — an overlap of **zero**. **Always join OP-routing's `pipelineId` values against the objects you read and assert the overlap is non-empty.** A zero or partial overlap means you are about to draw every conclusion about processing, security context, cost allocation, and storage from the wrong objects.

**Diagnose a mismatch in this order** (live-verified 2026-07-27):

1. **Object-level read-share** — `dtctl describe settings <pipelineId>`. A `403 No read share for object` means the pipeline exists but is not shared with the review identity → record the stages as **⚪ not assessable**, naming the share needed, **never** as "thin" or absent.
2. **Pipeline groups** — the pipeline-groups schema. It may legitimately hold 0 objects, so absence there proves nothing.
3. **Scope / pagination.**

On the reference tenant the cause was (1): the schema returned only the 5 `extension:*`-owned pipelines, which are world-readable, while all 9 user-created pipelines carrying the routing were denied. **This is the single easiest way to produce a confidently wrong OpenPipeline finding.**

**Scoring note:** zero overlap is **⚪, never a defect** — it is a permissions artifact.

*Source: probes-config.md A22.*

### OP-breadth (≡ A23) — the non-logs scopes

```bash
dtctl get settings --schema builtin:openpipeline.bizevents.pipelines --scope environment -o json
# repeat the same three schemas (routing / pipelines / pipeline-groups) per scope:
#   events · bizevents · events.security · davis.problems · davis.events · events.sdlc · metrics
```

Which non-log scopes have custom pipelines or routing at all — the "OpenPipeline beyond logs" maturity read. `ingest-sources` and `data-forwarding` schemas exist per scope too.

**Never merge findings across scopes.** A pipeline in one data-type scope cannot receive another's records, so a "duplicate family" spanning two scopes is not a family.

*Source: probes-config.md A23 (metrics scope added 2026-08-07 per the A54 correction).*

### OP-schema-reads (≡ A54) — the metrics scope, and the discovery correction

```bash
dtctl get settings --schema builtin:openpipeline.metrics.routing --scope environment -o json
dtctl get settings --schema builtin:openpipeline.metrics.pipelines --scope environment -o json
```

Direct-guess by name, exactly the pattern OP-breadth uses for its other scopes. The banner correction at the top of this file is this probe's finding, generalized to the whole family.

Where no metrics-scope schema exists at all — **verified by the direct read, never by discovery** — cross-reference the OTel metric-ingest config, ingest rejections/cardinality, extension metric volume, and `OP-dup-collectors` instead.

**Expect extension-owned pipelines to dominate this scope.** Live: 1 of 10 defined metrics pipelines carried a routing entry, and all 10 carried a `com.dynatrace.extension.*` `externalId` — do **not** report the other 9 as orphaned config debt before applying the §2 ownership partition.

*Source: probes-config.md A54, verified live 2026-08-07 (dtctl 0.36.0).*

---

## §2 — Ownership (run before every consolidation read)

### OP-ownership (≡ D2 step 0 / D6 step 0) — the `externalId` partition

**🔴 MANDATORY, before steps in §3.** Skipping it turns platform defaults into a false consolidation finding.

| `externalId` | Owner | Disposition |
|---|---|---|
| starts `com.dynatrace.` (whole namespace — **not** only `.extension.`) | Dynatrace-supplied | **Never** a customer consolidation target, whatever its processing shape or route status. Not routing-table-dependent by design. Report the count separately — "N extension-default pipelines, not assessed for consolidation" — and stop there for that subset. |
| starts `monaco:` (config-as-code) | Customer-authored | In scope. |
| **null** (created in the OpenPipeline app UI) | Customer-authored | In scope. |

The customer-authored subset alone is **`N_authored`** — the adoption gate's denominator and the structural-hygiene pillar's.

**Live evidence for why this is mandatory:** 9 of 10 metrics pipelines on a reference tenant were unrouted, and all 10 — including the one that *is* routed — carried a `com.dynatrace.extension.*` `externalId` (Cisco / Juniper / generic-SNMP / Postgres / MySQL / MariaDB / Oracle / SQL-Server / OpenTelemetry). **Zero** were consolidation candidates, despite two of them sharing an identical 2-processor structure that would otherwise have matched the exact-duplicate test.

*Source: probes-deepdives.md D2 and D6 step 0, corrected 2026-08-07.*

---

## §3 — Consolidation deep-dive

Local jq/python over the OP-pipelines output. **Customer-authored subset only, per scope.**

### OP-stage-matrix (≡ D2) — processor stages and the routed/orphan cross-check

Per pipeline, count processors in `processing`, `metricExtraction`, `dataExtraction` (Davis events), `securityContext`, `storage`, `costAllocation`. Then cross-check **routed vs orphan**: enabled `routingEntries[].pipelineId` (OP-routing) against defined `objectId`s.

**🔴 "Unreferenced = config debt" is wrong for extension-owned pipelines** — apply §2 first. Only a pipeline with a `monaco:*` or **null** `externalId` and no route is a genuine orphan.

Reportable shape: *N of M extract no metrics* · *N of M raise no Davis events* · *N routed pipelines set governance fields*. If observed record coverage exceeds what routed pipelines set, source-side enrichment dominates — say so.

*Source: probes-deepdives.md D2, corrected 2026-08-07.*

### OP-consolidation (≡ D6) — duplicate and near-duplicate families

The question OP-stage-matrix does not ask: **do multiple defined pipelines run the same processing and differ only in which sources route to them?**

1. **Exact duplicates** — two or more pipelines with byte-identical `processing` / `metricExtraction` / `dataExtraction` / `securityContext` / `storage` / `costAllocation` arrays (normalize away `objectId` / `title` / timestamps first). Pure administrative sprawl, typically one pipeline created per source at onboarding instead of routing every source at one existing pipeline. **Zero-risk to merge** — no processing content changes for any source.
2. **Near-duplicate families** — same processor **types and order**, differing only in literal parameters (a masking regex tuned per source, a metric-extraction field name, a DPL pattern). Strip the literal values, group on the resulting shape. **This is NOT an automatic generalization** — a pipeline processor has no general "handle N field-name variants in one step" primitive. Flag the family and its literal deltas; recommend generalizing only where the deltas are genuinely equivalent-shaped (same field semantics, different name or regex), and say explicitly when they are not — the family then stays separate, tagged *"same processing, source-specific parameters — not a mergeable clone"*.
   *Live-validated generalizable case:* two vendor security-log pipelines, each exactly four `dql`-type processors in the same order, normalizing to an **identical** 17-field target set, differing only in the vendor-specific parse pattern and value mapping. One shared normalize stage fed by a per-vendor parse stage selected on `log.source` collapses both.
3. **Governance drift — the highest-risk read, and the one to run before recommending ANY merge.** Within a candidate family, diff `securityContext`, `storage`, `costAllocation`. Identical processing **+ identical governance** = genuinely redundant, merge it. Identical processing **+ different governance** = the "duplicates" are deliberately separated for ABAC scoping, bucket assignment, or cost attribution, and merging would silently reassign one source's security context or cost center to another's — a governance regression dressed as a simplification. Report these separately and by name. **Never recommend merging a family with governance drift without first asking whether the drift is intentional design or accidental copy-paste** — the same family shape can be either, and only the owner knows which.
4. **Orphan cross-check** — a pipeline is unreferenced only if missing from **BOTH** consumer surfaces: OP-routing's enabled `routingEntries[].pipelineId` **and** OP-pipelines' pipeline-**group** membership. A pipeline referenced only via a group and never a direct route is not orphaned. §2 applies first. True double-negative orphans in the customer-authored subset are the cheapest, zero-ambiguity win: delete outright, no family analysis needed.
5. **Volume-weight the canonical survivor** — before naming which member survives, pull each member's observed record share (OP-throughput per-source volume where resolvable, else the routing/default-bucket split as a proxy) and keep the **highest-volume** member as canonical. Repointing low-volume routing entries onto an established, already-proven pipeline is lower-risk than repointing high-volume traffic onto a rarely-used one.

**The consolidation mechanic itself:** (a) name the canonical survivor `pipelineId`, (b) list every routing-entry `objectId` currently targeting a non-canonical member, the edit being "repoint `pipelineId` → `<canonical>`", (c) after repointing, re-run step 4's orphan check to confirm zero remaining references, then delete. Emit as the worklist: `family_id, member_pipelineIds, canonical_pipelineId, member_record_share, governance_drift (y/n + which field), disposition (merge / keep-separate:<governance reason> / delete-orphan), routingEntries_to_repoint`.

**Report shape:** total pipelines → orphans deleted → exact-duplicate families merged → near-duplicate families generalized-or-kept-separate (name which and why) → governance-drift families flagged, never auto-merged.

**Scoring note:** governance drift and near-duplicate membership are **confirmation-gated** — neither enters the score until an analyst confirms it is accidental / genuinely generalizable. See SKILL.md Phase 4.

*Source: probes-deepdives.md D6, verified live 2026-08-07 (dtctl 0.36.0).*

---

## §4 — Migration residue and governance contrast

### OP-classic (≡ A29) — classic-pipelines translation

```bash
dtctl get classic-pipelines-translation logs -o json
dtctl get classic-pipelines-translation bizevents -o json
```

Read-only translation of the tenant's **Classic** pipeline into OpenPipeline shape. Substantive output = classic processing rules still active → migration pending. **stderr warnings = rules needing manual rewrite — count them, that is the migration effort.**

**Requires the `openpipeline:configurations:read` OAuth scope** — the only OpenPipeline-specific scope this skill needs; everything else is `settings:objects:read`.

**This read can 500 or permission-error on some tenants. Graceful-degrade to ⚪ — never fail the pillar, and never read an error as "no residue."**

*Source: probes-config.md A29.*

### OP-classic-log (≡ A46) — classic log governance, the contrast object

```bash
dtctl get settings --schema builtin:logmonitoring.log-storage-settings -o json
dtctl get settings --schema builtin:logmonitoring.log-buckets-rules -o json
dtctl get settings --schema builtin:logmonitoring.log-security-context-rules -o json
```

Classic (pre-OpenPipeline) log governance — `value.{matchers, send-to-storage, enabled}`. Substantive classic rules alongside OpenPipeline routing = **the log configuration is split across two systems**. `log-security-context-rules` = 0 while records carry a non-null security context ⇒ security context is assigned by OpenPipeline, not the classic path — say which.

**🔴 Never score classic-path absence as a gap** (Gen3-first). This is a contrast object, not a target state, and this skill never recommends creating a classic construct.

*Source: probes-config.md A46.*

### OP-masking (≡ A38) — masking across the three enforcement layers

All read-only settings reads:

- **At capture:** `builtin:oneagent.side.masking.settings`, `builtin:attribute-masking` (per attribute: `value.enabled` + `value.key` + `value.masking`).
- **At ingest:** `builtin:logmonitoring.sensitive-data-masking-settings` (array of rules, each `value.enabled` — **verified live: the built-in "Private key masking" ships `enabled:false`, a real disabled-guard finding**), `builtin:logmonitoring.log-dpp-rules`, **plus the OpenPipeline mask processors in OP-pipelines' `processing` stages**.
- **At display / RUM:** `builtin:sessionreplay.web.privacy-preferences`, `builtin:rum.mobile.privacy`, `builtin:preferences.ipaddressmasking` (empty `[]` = IP masking not set, GDPR-relevant), `builtin:preferences.privacy`.

**This skill scores the OpenPipeline layer** and names the other two in the narrative — the full three-layer posture belongs to `/dt-eval-tenant`.

*Source: probes-config.md A38.*

---

## §5 — Volume context (never scored)

### OP-throughput (≡ B45) — routing-record throughput

```
timeseries inn  = sum(dt.sfm.openpipeline.ingest_sources_in.records, default:0),
           out  = sum(dt.sfm.openpipeline.pipelines_out.records, default:0),
           rout = sum(dt.sfm.openpipeline.routing.records, default:0), from:-7d
| fieldsAdd i = arraySum(inn), o = arraySum(out), r = arraySum(rout)
| fieldsAdd pct_through_pipelines = if(i > 0, round(100.0 * o / i, decimals:1))
| fields i, o, r, pct_through_pipelines
```

Per-source volume — the part that is genuinely useful, and the input to OP-consolidation step 5:

```
timeseries records = sum(dt.sfm.openpipeline.routing.records, default:0),
  by: { dt.openpipeline.source }, from:-7d
| fieldsAdd total = arraySum(records)
| fields dt.openpipeline.source, total
| sort total desc | limit 25
```

**🔴 There is no pipeline dimension.** `dt.openpipeline.pipeline`, `.pipeline.id`, `.route`, `.configuration`, `.endpoint` and `record_type` all silently null-bucket — a split on any of them produces a confident-looking chart of nothing. **Only `dt.openpipeline.source` is real.**

**🔴 `pct_through_pipelines` reads ~100% on any Gen3 tenant regardless of migration depth** — it is true on every platform tenant, not "this customer has migrated their processing." **Volume and liveness context only, never an adoption score.** Treat a value materially *below* 100% as the signal worth chasing: records are being ingested that the pipeline layer is not accounting for.

A null-`dt.openpipeline.source` bucket is normal residual attribution and is often large — report the named lanes and say a residual bucket exists.

*Source: probes-grail.md B45, corrected 2026-07-31 after the "volume share grades adoption" claim was withdrawn.*

### OP-dup-collectors (≡ B50) — duplicate metric ingestion

**Distinguish from ingest rejections first:** rejected custom keys are data *lost* at ingest — a different defect. This probe flags keys that are *accepted* and duplicate a signal OneAgent or an extension already collects natively for the same entity: money spent ingesting the same thing twice, plus two numbers claiming to measure one signal that can silently drift apart.

**Step 1 — enumerate custom-collector namespaces actually ingested.** Dedup, `--max-result-records 30000`, the comma-less `from:` timeframe, ≤10d metadata window. Treat absence from this enumeration as **unproven** — verify any specific key with a per-key `filter metric.key == "<key>"` + `timeseries` check before concluding it is absent.

```
metrics from:now()-7d
| filter startsWith(dt.metrics.source, "custom:") or startsWith(metric.key, "telegraf.") or startsWith(metric.key, "statsd.")
| dedup {metric.key}
| fields metric.key, dt.metrics.source
```

Extend the prefix list to whatever collector namespaces the tenant's publishers actually use — Telegraf/StatsD are the common examples, not an exhaustive list.

**Step 2 — cross-reference against the collector → native mapping** in [pipeline-ruleset.json](pipeline-ruleset.json) (rule `duplicate-collection-path`). It is a maintained lookup, not a query re-derived per run. **Its entries remain unconfirmed against a tenant that actually has custom-collector metrics** — treat a match as a candidate to verify, not a proven duplicate.

**Step 3 — join on the same ENTITY to prove actual double-collection.** Namespace overlap alone is not evidence. Pull the custom metric's host/entity dimension and check whether that same entity already reports the native equivalent. **Only both present on the same entity is redundant** — a custom metric on a host with no OneAgent (Infrastructure-only, or a device class OneAgent cannot reach) is legitimate gap-filling, not waste.

**Verdicts:** both present on the same entity for the same signal, a handful of hosts = 💡 (name the entity count and the parallel collector's ingest cost); fleet-wide or material volume = ⚠️. Recommend retiring the custom collection for exactly the overlapping signals, keeping it for what it uniquely provides. No overlap = ✅ — **state that explicitly** rather than silently passing over the custom-ingest estate.

**🔴 Zero candidate keys is a different finding from zero overlap.** The former means no third-party collector runs on this tenant at all (nothing to consolidate, full stop); the latter means a collector runs but nothing it publishes duplicates a native signal. Do not collapse the two into one "✅ no redundant metrics" sentence — they have different remediation implications if the tenant later adopts a collector.

*Source: probes-grail.md B50, query verified live 2026-08-07; mapping entries unconfirmed.*

---

## Keep-in-sync

Adding or changing a probe here means updating, in the same PR: the tenant skill's `probes*.md` (this file's source of truth), `verification-queries.md` (the verification twin + GUI row), `field-notes.md`, `MANUAL-EXTRACTION.md` (every query must be duplicable by hand), and — where the change touches what is scored — [pipeline-ruleset.json](pipeline-ruleset.json) and [scoring.md](scoring.md). A gotcha that lands here but not in the tenant skill will be re-derived wrongly by the next run of the other skill.
