# Problem Noise — probe battery (full, validated)

Every probe below is **read-only `dtctl`** (`get` / `query` verbs only) and was **validated live against a real tenant** (results quoted as `[example: …]` are illustrative calibration figures — each run measures fresh). `-o json` always; save raw output to the run dir and `runlog.py record` each one.

Cost note: problem / event / entity / settings reads are cheap — full windows are fine. **Spans and unscoped logs are the only guarded tables — keep them to ≤ 5-minute windows with single-pass `countIf()` aggregates.**

Sections: **§0** reach check (table accessibility) · **§1** baseline the noise · **§2** actual detector settings · **§3** custom-detector deep-analysis · **§4** attribution drill-downs · **§5** adjacent checks (delivery / coverage / suppression / intelligence). Run §0 first (Phase 0 preflight); §1–§3 always; §4 to attribute the top drivers; §5 to contextualize (they repeatedly change how the noise should be read).

---

## §0 — Reach check (Phase 0 preflight)

**Purpose:** Verify table accessibility before Phase 1. OAuth scope and IAM policy grants are independent surfaces; this probe detects permission denials early so ⚪ areas are pre-declared, not discovered mid-run. Run these after `dtctl doctor` and before any Phase 1 probes.

**R1 — Problem table reach:**
```
fetch dt.davis.problems, from:-1h | summarize c = count()
```
Record as `ok` if it returns a count, `unknown` only for a **verified** `NOT_AUTHORIZED_FOR_TABLE` — verified means: the literal 403/NOT_AUTHORIZED error (a transport/5xx/timeout/empty-stderr failure is `error`, retry it), retried at least once after `dtctl auth status`, and cross-checked against R2 (same permission family — R2 ok + R1 failing = transient, retry again). If `unknown` after that gate, the problem stream is ⚪ (not readable); Phase 1 cannot run, and the run enters config-only mode (SKILL.md — the config-only cover must carry the prominent re-run notice). A single unverified failure once shipped a config-only report whose entire tuning worklist targeted detectors that produce zero problems.

**R2 — Event table reach:**
```
fetch dt.davis.events, from:-1h | summarize c = count()
```
Record as `ok` or `unknown`. Events are cheaper than problems and give per-signal volume; used for compression (P3) and detailed attribution (§4). If `unknown`, P3/P4/D-pui-by-cat skip but P1/P2 queries on problems (if available) still proceed.

**R3 — Entity table reach:**
```
fetch dt.entity.host | summarize c = count()
```
Record as `ok` or `unknown`. Used for presence checks (Item 2; see §2 below) and topology cardinality. If `unknown`, fall back to config presence signals only.

**R4 — Log ingest health (5-minute guard):**
```
fetch logs, from:-5m, samplingRatio:1000 | summarize c = count()
```
Record the runlog **status** as `ok` (the read succeeded, whatever it returned) or `unknown` (403/⚪ — the read was denied). **`no-data` is a verdict, not a status**: a reachable table that returned zero rows is a SUCCESSFUL read, so it records as `ok` carrying `"count": 0` in the summary, and the applicability logic below reads that count. `runlog.py record` accepts only ok/error/unknown and rejects `no-data` outright. Logs are read for log-based detectors (§5 A8); if `unknown`, that area is ⚪. If `no-data`, that is **not** a permission error — it means no logs arrived, so log detectors are not firing (not a finding, just context).

**Record each as:** `runlog.py record run.json R-<table> <status> --summary '{"table":"<table>", "status":"<ok|unknown|no-data>"}'`

---

## §1 — Baseline the noise

**P1 — Volume + modernity split (24h corroborator):**
```
fetch dt.davis.problems, from:-24h
| summarize total = count(),
    custom_alert = countIf(event.category == "CUSTOM_ALERT"),
    davis = countIf(event.category != "CUSTOM_ALERT")
```
High `CUSTOM_ALERT` share = the stream is ported static thresholds; OOTB threshold tuning alone won't fix it. `[example: 597 total / 220 custom / 377 davis in 24h]`

**P2 — Category mix over the window (30d):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}, sort:{timestamp desc}
| summarize problems = count(), by:{event.category} | sort problems desc
```
`[example: CUSTOM_ALERT 4,585 · RESOURCE_CONTENTION 2,461 · ERROR 1,283 · SLOWDOWN 1,093 · AVAILABILITY 77 — custom share 48%]`

**P3 — Signal-to-problem compression:**
```
fetch dt.davis.events, from:-24h | summarize signals = count()
| append [ fetch dt.davis.problems, from:-24h | dedup {display_id} | summarize problems = count() ]
| summarize signals = max(signals), problems = max(problems)
| fieldsAdd compression = round(toDouble(signals) / toDouble(problems), decimals:1)
```
Low compression next to high volume = paged on raw events. `[example: 322:1 — Davis IS correlating; the volume is real detector output]`

**P4 — Problem Usefulness Index (PUI):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}, sort:{timestamp desc}
| fieldsAdd rc = if(isNotNull(root_cause_entity_id) or isNotNull(root_cause.smartscape_entity.id), 1.0, else: 0.0)
| fieldsAdd im = if(arraySize(affected_entity_ids) > 1 or arraySize(smartscape.affected_entity.ids) > 1, 1.0, else: 0.0)
| fieldsAdd ac = if(dt.davis.mute.status=="NOT_MUTED" and dt.davis.is_duplicate==false and dt.davis.is_frequent_event==false, 1.0, else: 0.0)
| summarize problems=count(), rootCauseRate=avg(rc), impactMultiRate=avg(im), actionableRate=avg(ac)
| fieldsAdd PUI = round((0.4*rootCauseRate + 0.3*impactMultiRate + 0.3*actionableRate), decimals:3)
```
**Check the classic AND 3rd-gen field together, migration-safe (field-team, verified live 2026-08-05).** `root_cause_entity_id` is the classic field (deprecating); `root_cause.smartscape_entity.id` is 3rd-gen Davis (stable). A tenant that has moved onto 3rd-gen Davis populates only the second — reading the classic field alone silently reports 0% root-cause on an estate where root cause is in fact attached, because the field is simply never written there. (A related but distinct trap: the API-era field name `rootCauseEntity` — camelCase, no underscore — does not exist in Grail at all; DQL treats it as always-null and returns a *silent* 0% with no error. Never use it.) The same classic/3rd-gen split applies to impact cardinality: `affected_entity_ids` (classic) vs `smartscape.affected_entity.ids` (3rd-gen) — check both, same reasoning. Near-zero `impactMultiRate` = shallow topology OR per-entity static thresholds (P4 alone can't tell which — §4 D-pui-by-cat and §5 A3/A4 disambiguate). `[example: PUI 0.372 · rootCause 14.2% · impactMulti 7.6% · actionable 97.3%]`

**P5 — Noise / friction rates:**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}, sort:{timestamp desc}
| summarize problems=count(),
    duplicates=countIf(dt.davis.is_duplicate==true),
    frequent=countIf(dt.davis.is_frequent_event==true),
    muted=countIf(dt.davis.mute.status!="NOT_MUTED"),
    underMaint=countIf(maintenance.is_under_maintenance==true)
| fieldsAdd duplicateRate=round(100.0*toDouble(duplicates)/toDouble(problems),decimals:2)
| fieldsAdd frequentRate=round(100.0*toDouble(frequent)/toDouble(problems),decimals:2)
| fieldsAdd maintenanceRate=round(100.0*toDouble(underMaint)/toDouble(problems),decimals:1)
```
`[example: 9,499 problems · dup 2.39% · frequent 0% · muted 26 · underMaint 0%]` — frequent 0% is a clue: check §5 A6 (frequent-issue detection may be off).

**P6 — The tuning worklist: top problem titles:**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| summarize n = count(), by:{title = event.name} | sort n desc | limit 25
```
Then the custom-only cut to isolate ported-rule offenders:
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| filter event.category == "CUSTOM_ALERT"
| summarize n = count(), by:{title = event.name} | sort n desc | limit 15
```
**The ranked target list.** Split each title: OOTB detector title → §2 ruleset row; custom title → §3 deep-analysis. `[example — top titles: "a single high-volume custom log detector" 1,936 · "Pods stuck in pending" 1,869 · "Response time degradation" 1,078 · "Failure rate increase" 844]`

**P7 — Maintenance suppression cross-read:**
```
fetch dt.davis.problems, from:-24h
| summarize total = count(), under_maint = countIf(maintenance.is_under_maintenance == true)
```
Cross-read with §5 A1 (window inventory): `under_maint` = 0 **and** 0 windows = evidence-backed ✅ (noise fully real, not suppressed). `under_maint` > 0 = real alerts being suppressed unseen.

**P8 — Source attribution buckets (one pass; adapt the phrases to P6's titles):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| summarize total=count(),
    custom_family=countIf(matchesPhrase(event.name,"<a custom-detector family keyword>")),
    top_custom=countIf(matchesPhrase(event.name,"<the top custom title>")),
    kafka=countIf(matchesPhrase(event.name,"Kafka")),
    host_mongo_clones=countIf(matchesPhrase(event.name,"cpu user") or matchesPhrase(event.name,"atlas mongo")),
    oob_k8s=countIf(matchesPhrase(event.name,"Pods stuck") or matchesPhrase(event.name,"Container restart")),
    oob_services=countIf(matchesPhrase(event.name,"Response time degradation") or matchesPhrase(event.name,"Failure rate increase")),
    oob_host=countIf(matchesPhrase(event.name,"Memory saturation") or matchesPhrase(event.name,"CPU saturation") or matchesPhrase(event.name,"garbage-collection")),
    oob_rum=countIf(matchesPhrase(event.name,"JavaScript error"))
```
Buckets the whole stream by source so the report can state "four drivers each own ~20%." Nested `if(...)` for `by:{bucket}` **fails to parse** — use `countIf()` columns as above. `[example: the per-workload custom family 2,094 · the top custom detector 1,933 · oob-services 1,925 · oob-k8s 1,922 · oob-host 519 · kafka 505 · oob-rum 179]`
**These buckets OVERLAP by design** (the phrases are adapted, not partitioned) — **never sum them, and never present them as a partition of the stream** (verified live 2026-07-28: summing gave 101% attribution). The confidence denominator in scoring.md comes from **P6's distinct titles as a share of P2's total**, never from P8.

**P9 — Mean/median time-to-detect (MTTD):**
```
fetch dt.davis.problems.snapshots, from:now()-30d
| filter event.status_transition == "CREATED"
| filter not(dt.davis.is_duplicate)
| filter not(in(event.category, {"INFO","WARNING"}))
| fieldsAdd detect_latency_min = toLong(timestamp - event.start) / 60000000000
| filter detect_latency_min >= 0 and detect_latency_min <= 60
| summarize n = count(), mttd_median_min = median(detect_latency_min), mttd_p90_min = percentile(detect_latency_min, 90)
```
A new table for this skill — `dt.davis.problems.snapshots` is a separate object from `dt.davis.problems`, with its own access grant; if it 403s, this probe alone is ⚪, it does not demote the whole run to config-only. `detect_latency_min` is problem-open timestamp minus the underlying event's own start — the gap between "the condition began" and "Davis raised a problem" — capped to a 0–60 min window so a mis-timestamped snapshot or a multi-day stitched event can't distort the median (a negative or absurdly large gap is a data quirk, not a real detection delay; report the excluded share alongside the median rather than silently dropping it). Read this **next to P4/D-pui-by-cat, not instead of them**: a fast MTTD on a low-PUI stream still means the estate is detecting quickly and telling the responder nothing useful once it does — speed and usefulness are different axes, and tuning for one can regress the other (a shorter observation window lowers MTTD but raises flapping/duplicate rate).

**P10 — Noisy-entity share against Dynatrace's own over-alerting threshold:**
```
fetch dt.davis.events, from:now()-30d
| filter not(in(event.category, {"INFO", "WARNING"}))
| filter isNotNull(dt.smartscape_source.id)
| fieldsAdd duration_min = toLong(coalesce(event.end, now()) - event.start) / 60000000000
| fieldsAdd duration_min = if(duration_min > 1440, 1440, else: duration_min)
| summarize alert_minutes = sum(duration_min), by: {dt.smartscape_source.id, day = bin(event.start, 24h)}
| fieldsAdd alert_state_pct = (alert_minutes * 100.0) / (24 * 60)
| summarize total_entity_days = count(), noisy_entity_days = countIf(alert_state_pct > 0.1)
| fieldsAdd noisy_entity_day_pct = round((noisy_entity_days * 100.0) / total_entity_days, decimals:1)
```
**Cite this as Dynatrace's own definition, not an invented threshold:** [Best practices for avoiding overalerting](https://docs.dynatrace.com/docs/dynatrace-intelligence/use-cases/avoid-overalerting) states an alert should signal an abnormal state that occurs "in no more than 0.1% of observed time" — a source entity in an alerting state for more than ~1.4 minutes of any 24h day exceeds Dynatrace's own bar for what counts as a genuine anomaly rather than noise. This reframes "noise" from a raw alert count (which scales with estate size and window length, and invites the "but we have a lot of infrastructure" rebuttal) into a rate any entity can be judged against regardless of estate size — report `noisy_entity_day_pct` alongside P5's duplicate/frequent/muted rates, not instead of them; they measure different things (P5 is problem-stream hygiene, P10 is per-entity alert-state discipline). Per-event `duration_min` is capped at 1440 (24h) so one long-running or still-open event can't blow out a single day's bucket. **Entity grain:** this groups on `dt.smartscape_source.id` (the event's source), the same grain the fragmentation check below uses — do not confuse it with `smartscape.affected_entity.ids` (a problem's blast radius, used in P4/T8-style impact reads) or `root_cause.*` (RCA, P4/D-pui-by-cat) — three different entity-shaped fields answering three different questions on the same table family.

---

## §2 — Actual detector settings (fill the "Current" column) + override counting

Read the live OOTB settings per area — **`--scope environment`** returns the global config (the no-scope call omits it); a plain read returns entity-scoped overrides.

```
dtctl get settings --schema builtin:anomaly-detection.infrastructure-hosts   --scope environment -o json   # Host
dtctl get settings --schema builtin:anomaly-detection.infrastructure-disks   --scope environment -o json   # Disks
dtctl get settings --schema builtin:anomaly-detection.rum-web                 --scope environment -o json   # Web Applications
dtctl get settings --schema builtin:anomaly-detection.services               --scope environment -o json   # Services
dtctl get settings --schema builtin:anomaly-detection.databases              --scope environment -o json   # Database Services
dtctl get settings --schema builtin:anomaly-detection.kubernetes.cluster     --scope environment -o json   # K8s Cluster
dtctl get settings --schema builtin:anomaly-detection.kubernetes.node        --scope environment -o json   # K8s Node
dtctl get settings --schema builtin:anomaly-detection.kubernetes.namespace   --scope environment -o json   # K8s Namespace
dtctl get settings --schema builtin:anomaly-detection.kubernetes.workload    --scope environment -o json   # K8s Workload
dtctl get settings --schema builtin:anomaly-detection.kubernetes.pvc         --scope environment -o json   # K8s PVCs
```

**Reading the JSON:** detection blocks nest as `<detector>.{enabled, detectionMode|configuration, ...}`. `detectionMode` is `auto` / `fixed`; a fixed/threshold detector carries the threshold plus a window (`samples`/`violatingSamples`/`dealertingSamples` or `observationPeriodInMinutes`/`samplePeriodInMinutes`/`threshold`). **An empty `[]` at environment scope = pure Dynatrace default (no override object)** — that IS the "at default / untuned" state, not an error. `[example: services + all K8s areas configured; hosts/disks/rum-web/databases/k8s-namespace = [] (pure default)]`

**Override counting** (how many entities override the global setting) — run each schema **without** `--scope` and count records whose `scope != "environment"`:
```
dtctl get settings --schema builtin:anomaly-detection.services -o json     # env object + entity overrides
# scope=="environment" is the global; SERVICE-xxxx / HOST-xxxx entries are per-entity overrides
```
Report the override count per area and what each override does (a per-service override that DISABLES detection is a monitoring blind spot). **Exception — Dynatrace's built-in placeholder services:** overrides disabling detection on `Requests to unmonitored hosts` and `Requests to public networks` are **standard hygiene, not a blind spot** (these synthetic placeholders generate noise, not coverage) — name them as ✅ housekeeping, never as a defect (verified live 2026-07-28: both flagged as blind spots in a first pass before the carve-out). `[example: only Services has overrides — 2 SERVICE-scoped, both disabling detection; every other area 0]`

**Presence checks** (Item 2 — mark areas not applicable if the technology is absent):

**P-k8s — Kubernetes deployed? Entity presence is authoritative — check it FIRST:**
```
fetch dt.entity.kubernetes_cluster | summarize c = count()
# Secondary signal only: dtctl get settings --schema builtin:cloud.kubernetes -o json  (value.connections)
```
**`connections == 0` does NOT mean Kubernetes is absent** — it only means no *cloud connector* is configured; OneAgent-monitored clusters carry no connection object (verified live 2026-07-28: a production tenant with 0 connections was running 7 clusters / 272 namespaces / 437 workloads — following the old config-first rule would have excluded all K8s ruleset rows, including the tenant's single largest noise source at ~22% of the problem stream). K8s areas are N/A only when **both** the entity count is 0 **and** connections is empty; if Grail is unreachable (R3 unknown), fall back to the config read and say so. The same precedence applies to every presence check below: **entities prove presence; config reads only corroborate.**

**P-web — Web applications deployed?**
```
dtctl get settings --schema builtin:applicationdetection -o json
# Check: value contains a rum config OR
fetch dt.entity.application | summarize c = countDistinctExact(dt.entity.application)
```
RUM web schemas (rum-web) are N/A if no rum configs and no application entities. Config-first; fall back to entity count if Grail is available.

**P-db — Database services deployed?**
```
fetch dt.entity.database | summarize c = count()
```
`service.technology` **does not exist** on Grail service entities (`FIELD_DOES_NOT_EXIST` — verified live 2026-07-28); `dt.entity.database` is the working surface. Database schemas (databases) are N/A if count = 0. If Grail unavailable (R3 unknown), assume applicable and score normally.

**P-hosts — Any hosts deployed?**
```
dtctl get settings --schema builtin:host-grouping -o json | filter value.hostGrouping | arraySize > 0
# OR fallback:
fetch dt.entity.host | summarize c = count()
```
Host/disk schemas are N/A if no hosts. Config-first; entity count if available.

**P-logs — Log-based detection applicable?**
```
# If R4 (log ingest) is `unknown` (permission denied), mark log-detector areas (A8) as ⚪ not N/A.
# If R4 is `no-data` and no log ingest in 24h, mark as applicable but note no data.
```

Record presence checks in `run.json` under probe ids `P-k8s`, `P-web`, `P-db`, `P-hosts`, `P-logs`. Report each status as `applicable` or `not-applicable`. **If an area is N/A, it is excluded from scoring and listed in the appendix as "does not apply to this tenant" — explicitly distinguished from ⚪ (permission denied).**

Map each `builtin:anomaly-detection.*` value to the `noise-ruleset.json` rows (via `field_hint`, resolved by label) to populate the report's Current column and Status flag. `403 / NOT_AUTHORIZED` → area is ⚪ (excluded from scoring, appendix footnote). **An area marked N/A is also excluded from scoring; the status is "not applicable to this tenant."**

---

## §3 — Custom-detector deep-analysis (the other half of the noise)

The `CUSTOM_ALERT` stream comes from custom detectors. **`dtctl get anomaly-detectors`** returns the Gen3 Davis custom-detector framework (schema `builtin:davis.anomaly-detectors`); read it, then **analyze** locally (jq/python), never enumerate.

**⚠️ This read carries PII — redact on save.** Migrated libraries bake notification routing into each detector's `eventTemplate`, so recipient addresses ship with the config (reference estate: **294 distinct employee addresses across 667 of 1,276 detectors**, all under `opc_email_recipients`). Redaction is mandatory per [security-sensitive-data-policy.md](../dt-eval-tenant/security-sensitive-data-policy.md) and leaves the analysis intact — `objectId`, `title`, `enabled` and `analyzer` are never touched, so every analysis below computes identically on the redacted file:
```
dtctl get anomaly-detectors -o json \
  | python3 ../.dt-eval-common/redact.py - --probe-id C-detectors > runs/$RUN/C-davis-detectors.json
dtctl get settings --schema builtin:anomaly-detection.metric-events -o json  # the OLDER metric-event framework (see §5 A7)
```
`redact.py` prints the operator WARNING to stderr and exits **2** when anything was redacted; record its `summary()` (counts only, never an address) alongside the probe. **Do not filter on value keywords instead** — `secret`/`token`/`password` appear in 209 legitimate detector *titles*, which are the join key P6 and §3 rank by.
Per-detector fields: `value.{title, enabled, analyzer, eventTemplate, executionSettings, source}`; `analyzer.name` is the analyzer class; `analyzer.input[]` holds the query, `threshold`, `violatingSamples`, `slidingWindow`, `alertCondition`.

> **🔴 The query key is `query` OR `query.expression`, and both shapes coexist in one fleet — read both (found live 2026-08-11).** The key varies per detector, not per tenant: on a 899-detector estate **853 carried `query` and 46 carried `query.expression`**. `detector_families.py` read only `query.expression`, so 853 detectors resolved to an empty query and grouped together — it reported **1 clone family covering 853 objects** where the truth was 31 families over 67, and 82 exact-rule families over 777 objects where the truth was 8 over 16. Groupings 3, 4 and 4b are all wrong when this happens; 4f (policy clusters) is query-blind and unaffected. The failure is silent and looks confident, which is why the shared accessor exists: use `detector_families.QUERY_KEYS` / `_query()` rather than reading the input list yourself. An empty query is **unreadable evidence, not a grouping key** — such detectors are excluded from every query-keyed grouping and the coverage is declared in `query_coverage`, so a run can never again report a family that is really just the unreadable bucket.

Local analysis:
1. **Enabled split** — `value.enabled`. Dormant = prune candidates (not active noise). `[example: 701 detectors, 571 enabled]`
2. **Analyzer split** — group by `analyzer.name`. **All static-threshold, zero adaptive/seasonal/forecast = "bought the AI, turned it off."** `[example: 701/701 StaticThresholdAnomalyDetectionAnalyzer — 0 use AutoAdaptive/Seasonal/Forecast/Novelty]` (cross-ref §5 A5).
3. **Exact duplicates** — group by normalized `(query.expression, threshold, alertCondition)`; same rule, different names. Deletable at zero coverage cost.
4. **Near-duplicate families** — normalize titles (strip app-IDs, env/priority/test suffixes, digits) and query shapes → per-entity/per-severity clone families. `[example: a large per-workload custom family = 406 detectors across 62 workloads, a 7-detector bundle: CPU×2, memory×2, restart×2, readiness×1; 295 CRITICAL + 105 WARNING pairs]`
4b. **Clone families with config drift — the highest-yield grouping. Groupings 3 and 4 can BOTH return zero on a tenant full of clones** (verified live 2026-07-28: an estate carrying an 80-detector per-cluster database family and a 4-way clone set — grouping 3 missed the clone set because the *thresholds differ*, grouping 4's mid-string normalization failed because cluster/metric names vary in the middle of the title). Group by whitespace-normalized `query.expression` ALONE:

   ```python
   # identical query text, DIFFERING threshold = clone family with config drift
   groups = defaultdict(list)
   for d in enabled:
       groups[normalize_ws(d.query)].append(d)
   clone_families = {q: ds for q, ds in groups.items()
                     if len({d.threshold for d in ds}) > 1}
   ```

   The threshold *difference* is precisely the finding (live: byte-identical query at thresholds 80 / 3000 / 0 / 3000 — two of the four are broken by construction). And for title families whose entity/metric names vary mid-string, group on the **leading token before the first ` - ` or ` : ` separator** — live, that collapsed the 80-detector family (titles shaped `<Prefix> <Cluster> - <Metric> [critical]`) into 4 clean per-cluster families immediately.

4c. **Threshold plausibility — CLASSIFY THE SERIES FIRST; the threshold value alone decides nothing.** The earlier form of this check (threshold > 100 on a "percentage-implying" metric; threshold == 0 with `alertCondition == ABOVE`) was **wrong in both directions and false-fired at scale** — verified live 2026-07-30 on two tenants: 20 + 1 hits on rule (a) with **zero** true positives, 59 + 8 hits on rule (b) with **one**. Following it as written would have shipped mostly-false findings into both worklists.

   Rule (a) failed because the percentage inference substring-matched the **whole query text including the filter body**, so `usage` / `ratio` / `utilization` anywhere in a `fetch logs | filter …` or `timeseries max(group_offset_lag, …)` expression marked the rule a percentage. Every hit was a legitimate unbounded threshold: Kafka consumer-group lag at 1,999 and 299,999, log-occurrence counts at 500 and 5,000, span-percentile latency in ms at 5,000 and 29,999.

   Rule (b) failed because **`threshold 0` + `ABOVE` is the correct idiom for count and state metrics** — it is how "alert on any occurrence" is written: `fetch logs | filter matchesPhrase(content,"task failed") | …count`, `max(connect_connector_task_state, filter:{ state == "PAUSED" })`, `sum(dt.kubernetes.node.conditions, filter:{ node_condition == "DiskPressure" })`. None fired permanently; one produced 46 problems in 30 days, which by itself falsifies the verdict.

   **Classify the projected series, then apply the matching rule** — derive the type from the final projected field / aggregation, NEVER by substring-matching the query body:

   | Series type | How to recognize it | (a) threshold > 100 | (b) threshold 0 + ABOVE |
   |---|---|---|---|
   | Bounded percentage | an explicit `… / … * 100`, or a metric key whose **own** name ends in a percent/ratio suffix | ⚠️ can never fire | ⚠️ fires continuously |
   | Count | `count()`, `countIf()`, `sum()` of occurrences | not a finding | ✅ correct any-occurrence idiom |
   | State / gauge | a state or condition metric compared by `max()`/`sum()` | not a finding | ✅ correct any-occurrence idiom |
   | Duration / bytes / lag | latency, size, offset-lag series | not a finding | judgment call — usually correct |

   The single live true positive proves the discriminator is the series type, not the number: a detector projecting `cpu_used[] / cpu_alloc[] * 100` — a genuine bounded percentage — at threshold 0 ABOVE does fire at any non-zero CPU.

4d. **Self-referential expression — a silent blind spot, and the higher-value check.** Flag any projected expression carrying **the same field on both sides of a division or subtraction**. Live 2026-07-30: an enabled detector projected `(cpu_alloc[] / cpu_alloc[]) * 100` — constant by construction — against a threshold of 3,000. It is not a plausibility problem in either direction; it reads in the configuration as active node-CPU monitoring while being unable to vary with the quantity it names. It produced 5 problems in 30 days against its correctly-formed sibling's 503. Report it as a **coverage blind spot** ("this detector cannot vary with the quantity it names"), never as a threshold issue — the remediation is to fix the expression, not the number.

4e. **Falsify every plausibility verdict against fired volume before publishing it.** A rule verdicted "can never fire" that produced problems, or "fires permanently" that produced 46 in a month, is a **failed verdict** — drop it. This is the per-detector application of the same discipline the §0 R1 verification gate encodes for the config-only decision: a config-derived conclusion that the measured stream contradicts is a bug in the conclusion. In config-only mode the falsification step is unavailable, so report 4c/4d findings there as *configuration risk pending volume confirmation*, never as established breakage.
4f. **Policy clusters — the grouping that reframes the estate, and the only one that IGNORES the query (added 2026-08-10 from a live 4,500-detector estate).** Items 3, 4 and 4b all ask *"which detectors watch the same thing the same way"* — they key on `query.expression`. This one asks the opposite question: **"how many distinct alerting POLICIES exist, regardless of what each one watches?"** Group on the policy envelope alone — `alertCondition`, `threshold`, `violatingSamples`, `dealertingSamples`, `slidingWindow`, `alertOnMissingData`, `dt.davis.is_merging_allowed`, `dt_severity`, `dt_alert_target` — and discard the query entirely.
   **Why it matters more than the other three combined.** On the reference estate: item 3 found 249 families / 647 objects and 4b found 224 / 496, but policy clustering found **4,098 of 4,500 detectors (91.1%) collapsing into 95 policies**, the largest carrying 874. That is not 4,500 alerting decisions; it is 95 decisions copy-pasted as a migration ran metric-by-metric. The finding is not "delete these" — every one watches a different metric and is individually legitimate — it is that **every future change to one of those 95 policies currently means finding and editing every copy by hand.** Report it as a maintainability and templating finding, not a duplication one.
   **🔴 Policy is mergeable; routing usually is not — never conflate them.** Detectors inside one cluster routinely carry hundreds of distinct notification destinations *by design*. Live on that same estate: the 874-detector cluster carried **333 distinct `opc_email_recipients`** values, and the 493-detector ServiceNow cluster carried 42 distinct `dt_routing_grp` / 78 `dt_asset_tag` / 22 `dt_source_application`. Collapsing a cluster into one settings object would silently repoint every one of them. A cluster is only *fully* mergeable when its destination fields (`opc_email_recipients`, `dt_routing_grp`) are uniform **or** entirely `{placeholder}`-driven — placeholders resolve per record at event time and survive a merge, literal strings do not. On that estate **zero** destination values in the two largest clusters used placeholder syntax, so the correct recommendation was *templatize the policy fields, leave routing attached per detector.*
   **🔴 Redaction inverts this finding if you let it.** `redact.py` collapses every `opc_email_recipients` value to one constant marker, so a distinct-value count computed on the redacted file reads as **1** — "routing is uniform, safe to merge", the exact opposite of the truth. `detector_families.py` detects the marker and reports the divergence as `unknown` rather than a number. **Never derive a merge verdict for a redacted destination field.**
   Run it — do not re-derive it: `python3 detector_families.py runs/<id>/C-davis-detectors.json --json families.json`. That script is the **executable authority** for items 3, 4b and 4f (the way `noise_scoring.py` is for the composite); it was written after the same estate was analyzed by hand twice with different groupings and different answers.
5. **OOTB overlap** — detectors whose query targets `dt.kubernetes.container.{cpu_usage,memory_working_set,restarts}`, host CPU/memory, availability = re-implementations of OOTB detectors. If the OOTB one is disabled (§2), enabling it replaces the clones; if enabled, the clones are pure duplication. `[example: 64 CPU + 60 memory clones re-implement disabled OOTB highCpuUsage/highMemoryUsage; 64 restart clones duplicate enabled OOTB containerRestarts, fired 0]`
6. **Top offenders** — join enabled rules to P6's custom-title cut: which specific rules produce the noise.
7. **C-rcrel — RCA participation, per detector (config side; runs in config-only mode).** Read each detector's `value.eventTemplate.properties[]` — a key/value list — for `dt.davis.is_merging_allowed`, `dt.davis.is_rootcause_relevant` and `event.type`.

   **The absence of a flag proves NOTHING, and treating it as "capable" ships a false all-clear (verified live 2026-08-03 on two estates, 807 detectors).** The earlier form of this check read `merge != "false"` as *merging allowed* and emitted an `rca_capable` verdict from that. On an estate where **zero** detectors set either flag it therefore reported **100% RCA-capable** — while the event stream measured **0.0% mergeable**, every event carrying `dt.davis.disable_merging_reason == "Set by event reporter"`. The reporter disables merging **without writing an eventTemplate property**, so config-side absence is *unknown*, never *allowed*. Reading it as *allowed* inverts the finding on precisely the detector class this probe exists to characterise.

   Two estates, two opposite shapes of the same underlying fact — both must classify correctly:

   | Estate shape | `is_merging_allowed` set? | Config verdict | Stream (`D-rcrel`) |
   |---|---|---|---|
   | Reference (2026-07-28) | `"false"` on 1,254 of 1,276 | not capable — **proven** | 0% mergeable |
   | Live (2026-08-03) | set by **0** of 807 | not capable — **inferred from `event.type`** | 0% mergeable |

   **The executable authority is [rca_participation.py](rca_participation.py)** — run it rather than re-deriving the rule inline, the same way `noise_scoring.py` owns the score. It was pseudocode here until the inversion above shipped; a rule that lives only in a markdown block is a rule that gets re-typed slightly wrong.

   ```
   python3 rca_participation.py runs/<run>/C-davis-detectors.json     # the redacted dump is fine
   ```

   ```python
   from rca_participation import classify, summarize, phrase
   summary, rows = summarize(detectors)      # enabled-only by default
   report_line = phrase(summary)             # never phrased as an all-clear
   ```

   The classification, for reference — note there is no `capable` branch:

   ```python
   merge = props.get("dt.davis.is_merging_allowed")      # None = UNKNOWN, never "allowed"
   rcrel = props.get("dt.davis.is_rootcause_relevant")   # None = UNKNOWN, never "relevant"
   if merge == "false" or rcrel == "false":
       verdict = "not_capable"           # proven by an explicit opt-out
   elif props.get("event.type") == "CUSTOM_ALERT":
       verdict = "not_capable_by_type"   # inferred from the emitted alert type
   else:
       verdict = "unknown"               # configuration establishes nothing
   ```

   **There is no `rca_capable = True` outcome, by design.** Configuration can prove a detector is excluded from correlation; it cannot prove one participates. Report the split over **enabled** detectors as a **lower bound** — *"at least N of M enabled detectors cannot participate in root-cause analysis"* — and name the top not-capable families by volume (join to P6). Both `not_capable` states carry the same remediation (retire the rule in favour of native detection); they differ only in what the evidence proves, and the report should say which. `[reference example: 1,266 enabled — 1,253 (99.0%) not capable by explicit opt-out]` · `[live example: 572 and 109 enabled on two estates — 100% not capable by type, 0% by explicit opt-out]`

   **Never report `is_rootcause_relevant` on its own** — it is unset estate-wide on this detector class, so alone it reads as a uniform 100% pass while the stream measures 0.0% root-cause (see §4 D-rcrel). The same trap, one level down: it is not enough to read the *pair* if absence is still scored as a pass.

   This is the config-side twin of §4 **D-rcrel** — it needs no Grail access, so it is the one RCA-coverage read that survives config-only mode, and there it is stated as a structural finding rather than a measured rate. **When `D-rcrel` is available it outranks this probe**: a config verdict the stream contradicts is a bug in the verdict (the same falsification discipline as 4e).

8. **C-alertidentity — Records-variant detectors missing `alertIdentityFields` (DRAFT — not yet live-validated; per IS-Guide 3, "Custom Anomaly Detection"). A distinct duplicate-storm mechanism from items 3/4/4b above:** those group *separate detectors* that duplicate each other; this flags a *single* detector whose analyzer groups every matching record into one undifferentiated alert identity because it never declared which fields distinguish one alert from another.

   ```python
   # analyzer.name containing "Records" (e.g. RecordsAnomalyDetectionAnalyzer) is the affected class.
   # Field path below is a starting guess — confirm against one detector's raw JSON before trusting it;
   # alertIdentityFields may nest elsewhere depending on analyzer schema version.
   missing_identity = [
       d for d in enabled
       if "Records" in d["value"]["analyzer"]["name"]
       and not d["value"]["analyzer"].get("alertIdentityFields")
   ]
   ```

   Report the count plus a 5-item sample (`objectId`, `title`) per the reproduction-sample rule. **Do not report this as an established finding until confirmed live**: verify the field path, and confirm on at least one real detector that an absent/empty value actually produces the merged-identity symptom (rather than falling back to a safe default) before quoting it — until then, carry it the same way 4c/4e gate an unconfirmed plausibility flag: "configuration risk, pending confirmation."

9. **C-entityref — does a detector's `by:{}` dimension reference a Smartscape entity field or a bare string? (DRAFT — not yet live-validated; per IS-Guide 3).** A `by:{}` grouped on a bare string field (e.g. a raw log attribute) rather than a Smartscape entity reference (`dt.entity.*`, `dt.smartscape_source.id`, etc.) cannot participate in topology-based correlation or RCA regardless of any other setting — a cheap, grep-able signal alongside the existing C-rcrel/D-rcrel flags, and a direct structural explanation for a `not_capable` verdict there.

   ```python
   entity_ref_prefixes = ("dt.entity.", "dt.smartscape_source.", "dt.smartscape.")
   no_entity_ref = [
       d for d in enabled
       if not any(str(v).startswith(entity_ref_prefixes)
                  for v in d["value"]["analyzer"]["input"][0].get("dimensions", []))
   ]
   ```

   **Field path is illustrative, not confirmed** — the actual dimension-list key on `analyzer.input[]` needs verification against a live detector export before this ships as a probe. Report count + 5-item sample once verified; until then this is a hypothesis to validate, not a citable number.

Emit the per-detector delete/consolidate list (title, `objectId`, workload, metric, disposition) as the CSV worklist — the `objectId` is the durable handle for the customer to action.

**P3 — Custom-detector semantic intent classification (Python local analysis):**

Analyze each **enabled** custom detector to infer its intent and suggest a better Davis category replacement:

```python
# Semantic keyword patterns for intent classification
INTENT_MAP = {
    "RESOURCE_CONTENTION": {
        "keywords": ["cpu", "memory", "disk", "utilization", "saturation", "pressure", "cache", "throughput"],
        "metrics": ["builtin:host.cpu", "builtin:host.mem", "builtin:system.cpu", "builtin:process.memory", 
                   "builtin:tech.*.connections", "builtin:tech.*.queue"],
    },
    "SLOWDOWN": {
        "keywords": ["latency", "response time", "duration", "delay", "slow"],
        "metrics": ["builtin:service.request.time", "builtin:database.request.time", "builtin:rpc.*.duration"],
    },
    "ERROR": {
        "keywords": ["error", "failure", "exception", "http.5", "status.5", "5xx"],
        "metrics": ["builtin:service.errors", "builtin:service.request.count", "builtin:database.errors"],
    },
    "AVAILABILITY": {
        "keywords": ["availability", "up", "down", "alive", "dead", "unavailable"],
        "metrics": ["builtin:host.availability", "builtin:service.availability", "builtin:synthetic.availability"],
    },
}

# For each enabled detector:
for detector in enabled_detectors:
    title = detector['value']['title'].lower()
    query = detector['value']['analyzer']['input'][0]['query']['expression'].lower()
    
    # Classify by keyword + metric pattern matching
    intent = classify_intent(title, query, INTENT_MAP)
    
    # Emit suggestion
    if intent:
        emit({
            "objectId": detector['id'],
            "title": detector['value']['title'],
            "current_category": "CUSTOM_ALERT",
            "suggested_category": intent,
            "reason": f"Detector query pattern matches {intent} intent",
            "action": f"Enable native Davis '{intent}' detector; retire this rule"
        })
```

**Output:** Emit a remediations list grouped by suggested category, with counts:
```
Suggested Migration (33 enabled custom detectors)
├─ RESOURCE_CONTENTION (11): CPU_HIGH, MEM_SATURATION, DISK_FULL, ...
├─ SLOWDOWN (8): API_LATENCY, DB_QUERY_SLOW, ...
├─ ERROR (7): HTTP_5XX, EXCEPTION_RATE, ...
├─ AVAILABILITY (4): HOST_DOWN, SERVICE_UNAVAILABLE, ...
└─ UNCLASSIFIABLE (3): [manual review needed]
```

Join P3 output to P1's custom-alert events: rank by problem volume to prioritize which detectors to retire first.  
`[example: RESOURCE_CONTENTION group fires 520/597 custom problems in 24h; retiring those 11 rules alone would cut noise by 87%]`

10. **C-delivery — per-detector delivery-chain metadata: does a firing detector reach anyone, and does the receiving system know who owns it? (added 2026-08-10; computed by `detector_families.py`.)** D4 already checks the delivery chain at the *notification-integration and alerting-profile* level. This is the per-detector complement, read from the same `eventTemplate.properties[]` as `C-rcrel`, and it finds a class D4 structurally cannot: a detector that fires correctly, reaches a real destination, and arrives with nothing to route on.
    - **No `dt_alert_target`** — the detector fires and no automation is wired to act on it. A dead end, not a misroute. Rare and worth naming individually (live: 2 of 4,500).
    - **No `dt_severity`** — arrives with no priority for the receiving system to triage on.
    - **🔴 ServiceNow-bound with no assignment metadata** — `dt_alert_target` starts `snow_` but none of `dt_routing_grp` / `dt_asset_tag` / `dt_source_application` is set. The ticket is created and lands wherever that instance's fallback assignment sends it. **Live: 953 of 2,208 ServiceNow-bound detectors (43.2%)** on the reference estate — including several compliance/unauthorized-change detectors. This is materially different from "notifies no one": these *do* reach a real instance, they just arrive unassigned. Report the share, and state plainly that where they land is **configuration inside ServiceNow, not visible from the Dynatrace side** — "lands somewhere unassigned" is the hypothesis to confirm with that team, never a confirmed outcome.
    - **Where the field is populated, its values are usually free text**, not drawn from a controlled list — plausible-looking team names that nothing in the settings data confirms still exist. Say so rather than implying the populated ones are verified.
    - **Named individuals in `opc_email_recipients`** rather than team distributions — a notification path that depends on one person still holding a role. (Requires the unredacted stream; on a redacted file this is not computable, per 4f.)

11. **C-provenance — how much of this fleet was ported, and from where? (added 2026-08-10.)** Read `eventTemplate.properties[].opc_migration_source` (or the tenant's equivalent tag) and report the split against `native`. **This is context that reframes every other finding in §3**, and it is cheap: live, **4,492 of 4,500 detectors (99.8%) carried a single migration-source tag**, which turns "this tenant has a lot of static-threshold detectors" into "this tenant is running another product's alerting model on Dynatrace's static-threshold analyzer." SKILL.md's own honesty rule — *if you tune OOTB detectors while the firehose is a ported rule library, you fixed the wrong thing* — is only checkable if this is measured. A high migrated share also **raises the value of 4f's policy clustering**, because a metric-by-metric port is exactly what produces a small policy set copy-pasted thousands of times. Where the tenant carries no provenance tag at all, say the split could not be established rather than assuming native.
12. **C-targets — WHERE does each detector send its alert, and is that the right environment? (added 2026-08-10; computed by `detector_families.py`.)** Item 10 asks whether a destination *exists*; this asks *which one it is*. Read `eventTemplate.properties[].dt_alert_target` across the fleet and report the census, then join it to the consuming workflow's task graph (the `A2` delivery read) so each value maps to a real endpoint.
    **This finds a class every other probe in the battery is blind to.** D4 reads the *notification-integration* layer, and property-driven routing bypasses that layer entirely — the alert never touches a notification integration, so D4 sees nothing. Item 10 sees a populated destination and passes it. Only this census reads the value.
    **🔴 Live 2026-08-10, a production tenant: 2,202 of 4,500 detectors (48.9%) resolved to a UAT destination and 6 (0.1%) to the production one**, with the consuming workflow's conditional branches routing each value to a different ServiceNow instance — correctly, which is why nothing was failing and nothing surfaced. Half a production fleet was opening its tickets in a non-production instance.
    **Report the split; never assert the verdict.** The same value that is a finding on a production tenant is the *correct* setting on a lower one, and neither the module nor the probe can tell which environment it is looking at (Phase-0 input #6 resolves that, and it is an ask, not an inference). `detector_families.py` flags the non-production share against a documented token list (`uat`/`dev`/`test`/`stage`/`qa`/`sandbox`/`nonprod`) and attaches the confirm-with-the-owner note; the report states the share and asks the question. **Settle it before any consolidation work** — the same objects are the subject of both changes, and doing them separately means touching the fleet twice.
13. **C-missingdata — which detectors go silent when their source dies? (added 2026-08-10; computed by `detector_families.py`.)** Read `analyzer.input[].alertOnMissingData` across the fleet. A detector with it off does not fire when its input stops arriving — it has nothing to evaluate. **That is correct for a performance threshold and backwards for a security, audit, or compliance condition, where absence of data IS the signal**, and a ported library carries the default forward without ever prompting a per-detector decision. Live 2026-08-10: **100% of the fleet on both tenants reviewed** (4,500 and 1,207). **Count an unset value as silent but report it separately** — unset and explicitly-disabled behave identically, and merging them hides that nobody decided at all. Cross-read with B40/the ingest-rejection check: rejected datapoints on a key this fleet queries mean the silent-source condition is live, not theoretical, and that pairing is the finding. Remediate as a *policy field during templatization* (item 4f), never as a per-detector pass.
14. **C-capacity — how close is the fleet to the maximum this environment actually declares? (added 2026-08-10.)** `dtctl describe settings-schema builtin:davis.anomaly-detectors` returns `maxObjects` **for the tenant being reviewed**; pass it to `detector_families.py --max-objects`. Grade on `count/maxObjects` using the tenant-review limit-proximity bands (≥90% ⚠️, ≥75% 💡).
    **🔴 Read it live; never quote a remembered documentation figure.** A general figure of 1,000 was assumed on a live engagement while the schema on those tenants declared **4,500** — which turns "4.5× over an unenforced cap" into "at exactly 100% of the ceiling", a different finding with a different remediation and a different urgency (the next detector creation *fails*, and an automated attempt fails rather than queues). Live 2026-08-10: one tenant at 4,500 of 4,500 (⚠️), another at 1,207 of 4,500 (✅).
    **A fleet finishing at exactly the ceiling is worth one question:** a migration that ran metric-by-metric and stopped there may have been truncated by it, so confirm with whoever ran the port that every intended rule landed. **The structural fix is consolidation, not a limit increase** — item 4f's policy view is where the headroom already is. Capacity framing is required in the report whenever the fleet exceeds a documented maximum (output-spec.md §5b).
15. **C-dualdelivery — is more than one mechanism delivering to the same destination? (added 2026-08-10; a cross-read, not a new collection.)** Join the native notification integrations (`A2`, `builtin:problem.notifications`) to the endpoints the property-driven workflow posts to. Where an enabled integration targets an endpoint the workflow already targets, both fire for the same condition and the receiving system gets two events for one problem. Live 2026-08-10: **5 of 16 enabled integrations posted to the same production endpoint the workflow used**, and a sixth, *named* for production, was configured against the development instance — and was the same lane the delivery counters showed returning 8,044 authentication failures over seven days. **Read the integration's target, not its name**; where the two disagree, say so and let the owner reconcile them rather than assuming which is right. Duplicate delivery makes every ticket-side measure of alert volume untrustworthy, so resolve ownership before quoting one.

---

## §4 — Attribution drill-downs (name the cause, quantify the yield)

`dt.davis.problems` carries rich grouping fields: `k8s.cluster.name`, `k8s.namespace.name`, `k8s.workload.kind`, `affected_entity_names`, `affected_entity_ids`, `resolved_problem_duration` (ns), `event.status`. Use them to turn a noisy title into a root cause.

**D-k8s-pending — is "pods pending" real or normal churn?**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id} | filter event.name=="Pods stuck in pending"
| fieldsAdd durMin = toDouble(resolved_problem_duration)/60000000000.0
| summarize n=count(), medianDurMin=round(percentile(durMin,50),decimals:1),
    by:{cluster=arrayFirst(k8s.cluster.name), kind=arrayFirst(k8s.workload.kind)} | sort n desc
```
`[example: 1,875 — 100% cronjob workloads, median 23 min auto-resolve → exclude cronjob kinds, [counted] ~1,875]`

**D-services — spread or one bad service? + duration:**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| filter event.name=="Response time degradation" or event.name=="Failure rate increase"
| fieldsAdd durMin = toDouble(resolved_problem_duration)/60000000000.0
| summarize n=count(), medianDurMin=round(percentile(durMin,50),decimals:1),
    by:{svc=arrayFirst(affected_entity_names), ev=event.name} | sort n desc | limit 15
```
`[example: spread across 15+ services, none dominant, median 5–12 min → global loosen, not one service]`

**D-host — real hosts vs a concentrated app signal:**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| filter event.name=="Memory saturation" or event.name=="CPU saturation" or event.name=="Long garbage-collection time"
| summarize n=count(), by:{host=arrayFirst(affected_entity_names), ev=event.name} | sort n desc | limit 15
```
`[example: CPU/mem on ~5 physical hosts; GC concentrated on one service's pods = a real app signal to route, not tune away]`

**D-flapping — a single custom alert: flapping vs sustained outage** (replace the phrase with the top custom title from P6):
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id} | filter matchesPhrase(event.name,"<top custom title>")
| fieldsAdd durMin = toDouble(resolved_problem_duration)/60000000000.0
| summarize n=count(), p50dur=round(percentile(durMin,50),decimals:1), p90dur=round(percentile(durMin,90),decimals:1),
    openNow=countIf(event.status=="OPEN"), entities=countDistinctExact(toString(affected_entity_names))
```
`[example: 1,933 · 1 entity · median 1 min · 0 open now → flapping, not an outage; the detector counted warn-logs at 10/min with no sustained window]`

**D-family — a custom family's fired breakdown by metric type** (sizes the consolidation; replace the phrase with the family keyword):
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id} | filter matchesPhrase(event.name,"<custom-family keyword>")
| summarize total=count(),
    cpu=countIf(matchesPhrase(event.name,"cpuused") or matchesPhrase(event.name,"container cpu")),
    mem=countIf(matchesPhrase(event.name,"memory")), restart=countIf(matchesPhrase(event.name,"restart")),
    latency=countIf(matchesPhrase(event.name,"latency")), liveness=countIf(matchesPhrase(event.name,"liveness"))
```
`[example: CPU 1,196 · liveness 293 · memory 291 · latency 234 · restarts 0]`

**Title-normalization caution (verified live 2026-07-28):** `replacePattern(event.name, "<DPL pattern>", "{p}")` returned the **literal string `{p}`** instead of substituting the placeholder — every title normalized to the same value, and the grouping collapsed to one row that reads as "no variation". Verify `replacePattern` output on a handful of rows before building any grouping on it; until it's re-verified live, prefer `matchesPhrase` buckets (D-family above) or local normalization (Python over the saved P6 output).

**D-cardinality — per-entity scoping: is the rule STRUCTURALLY noisy?** (replace the phrase with the detector title or family keyword):
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id} | filter matchesPhrase(event.name,"<detector title>")
| summarize n = count(), distinct_titles = countDistinctExact(event.name)
```
A high `distinct_titles / detector` ratio is a direct, cheap indicator that the rule groups by an **ephemeral identity (pod) rather than a durable one (workload)** — every replacement pod mints a new title. `[example: one rule → 3,242 problems across 895 distinct titles]` This is what turns "this rule is noisy" into "this rule is *structurally* noisy — **raising the threshold will not help**; the fix is re-scoping the query's `by:{}` dimension to the durable entity." Low distinct-title count with high volume = the threshold/window is the problem instead (D-flapping).

**D-source-fragmentation — how many source entities fire more than once a day (estate-wide, not one rule):**
```
fetch dt.davis.events, from:now()-7d
| filter not(in(event.category, {"INFO","WARNING"}))
| filter isNotNull(dt.smartscape_source.id)
| summarize event_count = countDistinct(event.id), by: {dt.smartscape_source.id, day = bin(event.start, 24h)}
| filter event_count > 1
| summarize fragmented_sources = count(), by: {day} | sort day asc
```
Where D-cardinality drills into one already-identified rule, this is the estate-wide scan that finds candidates in the first place: any source entity firing more than one non-INFO/WARNING event on the same day is either flapping on its own or being hit by multiple overlapping detectors. Trend it day over day (7d default; widen if the estate is quiet) — a flat or falling `fragmented_sources` count after a tuning change is corroborating evidence the change worked; a stream that stays flat despite retiring detectors means the fragmentation has a different structural cause than the ones retired. **Same `dt.smartscape_source.id` grain as P10** — the two are naturally read together (an entity that is both high on the P10 alert-state share and here is the same entity described two ways: too much alerting time, and too many separate episodes producing it).

**D-cost — what the detector library costs to run** (the consumption bridge; full context in the tenant skill's effective-consumption.md §9c):
```
fetch dt.system.query_executions, from:now()-30d
| filter contains(toString(client.client_context), "anomaly-detectors")
| summarize queries = count(), gb = round(sum(scanned_bytes)/1073741824.0, decimals:1)
```
Every detector evaluation is a logged query execution, so the library's running cost is directly measurable. `[example: ~97% of ALL query executions and ~47% of all scanned bytes on a tenant with ~110 static detectors]` — this converts "too many hand-written detectors" from a qualitative complaint into a measured consumption fact, and prices the consolidation plan (each retired clone family removes its evaluation share). Quote it next to the Lever-1 noise reduction: the same fix cuts noise AND query load.

**D-pui-by-cat — PUI split by category (MANDATORY, run in Phase 1 — see SKILL.md):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| fieldsAdd rc = if(isNotNull(root_cause_entity_id) or isNotNull(root_cause.smartscape_entity.id), 1.0, else: 0.0)
| fieldsAdd im = if(arraySize(affected_entity_ids) > 1 or arraySize(smartscape.affected_entity.ids) > 1, 1.0, else: 0.0)
| summarize problems=count(), rootCausePct=round(100.0*avg(rc),decimals:1), multiEntityPct=round(100.0*avg(im),decimals:1),
    by:{category=event.category} | sort problems desc
```
Same classic/3rd-gen dual-field check as P4 — see there for why (a 3rd-gen-migrated tenant would otherwise silently zero out by category, which is exactly the shape a reader would misread as "custom alerts really are 0% useful across the board"). **The single most useful correlation.** `[example: CUSTOM_ALERT 0.0% root-cause / 0.0% multi-entity vs SLOWDOWN 46.1% / 26.3%]` — proves the custom-threshold block is 0-usefulness by construction; retiring it (Lever 1) both cuts noise AND raises PUI.

**D-rca-buckets — classify the empty-RCA slice: expected vs should-have-had (interpretive twin of D-pui-by-cat):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| filter isNull(root_cause_entity_id) and isNull(root_cause.smartscape_entity.id)
| fieldsAdd affected_count = arraySize(smartscape.affected_entity.ids)
| fieldsAdd bucket = if(affected_count == 0, "enrichment_gap",
             else: if(affected_count == 1, "expected_single",
             else: if(in("Infrastructure", dt.davis.impact_level), "expected_infra",
             else: if(event.category == "CUSTOM_ALERT", "custom_alert_review",
             else: "should_have_had"))))
| summarize count = count(), by: {bucket} | sort count desc
```
**Why this exists:** a raw root-cause percentage reads artificially low even on a healthy estate — some empty-RCA problems are *legitimately* empty, not broken. A single-entity direct failure, an infrastructure-impact problem, or a problem with no affected entity at all (`enrichment_gap`) has nothing further for Davis to attribute; splitting the empty slice into `enrichment_gap` / `expected_single` / `expected_infra` / `custom_alert_review` (already explained by D-pui-by-cat/D-rcrel) vs a residual `should_have_had` turns "RCA is only 14%" into "RCA is 14%, but of the remaining 86%, only N% *should* have had a root cause and didn't — the rest is expected by problem shape." That residual is the only slice worth chasing for remediation; the rest is not a defect to fix. If `should_have_had` is small relative to the whole empty-RCA slice, say so explicitly — it is evidence the low headline number is not the finding it looks like. If it is large, it is: name the categories/detectors driving it (cross-reference D-pui-by-cat's `category` column and P6's titles) rather than reporting the residual as an undifferentiated count. **One more legitimate-empty shape is not yet split out of `should_have_had`** — multi-entity, non-infra, non-custom-alert problems whose affected entities have no topology path between them (field finding, 2026-08-06 — see D-rca-topology below); run that optional deep-dive before reporting a large `should_have_had` as a blanket remediation target.

**D-rca-quality-sample — split "Attached" from "Correct" and "Actionable" (owner-sample step, DRAFT; per IS-Guide 5, "Assess Root Cause Analysis Quality" — the guide states as a hard rule: do not report attachment rate as RCA quality):**

D-pui-by-cat and D-rca-buckets both measure **attachment** — whether a root-cause field is populated at all. Attachment is necessary but not sufficient: Davis can name a root cause that is wrong (**Correct**), and even a correct root cause can point at something the team has no lever to act on (**Actionable**). Only a human sample can adjudicate the second and third — no query proves "Davis picked the right entity."

1. **Count the attached population** (same filter D-rca-buckets already applies as its complement):
   ```
   fetch dt.davis.problems, from:now()-30d | dedup {display_id}
   | filter isNotNull(root_cause.smartscape_entity.id) or isNotNull(root_cause_entity_id)
   | summarize attached = count()
   ```

2. **Pull the review sample, prioritized by blast radius:**
   ```
   fetch dt.davis.problems, from:now()-30d | dedup {display_id}
   | filter isNotNull(root_cause.smartscape_entity.id) or isNotNull(root_cause_entity_id)
   | fields display_id, event.name, root_cause.smartscape_entity.id, dt.davis.affected_users_count
   | sort dt.davis.affected_users_count desc
   | limit 5
   ```
   `dt.davis.affected_users_count` is not referenced anywhere else in this skill — it is the guide's prioritization field for which attached problems most deserve a domain specialist's limited review time, distinct from `smartscape.affected_entity.ids` (entity-count impact, already used in P4/D-pui-by-cat). The `limit 5` cap matches the repo's reproduction-sample rule; widen only for the analyst's own working set, never in what ships.

3. **A domain specialist (not this skill) reads each sampled problem and marks it Attached** (definitional — already proven by query 1) **/ Correct** (the named root cause is, on inspection, the actual originating fault) **/ Actionable** (it points at something the receiving team can own and fix, not e.g. a shared dependency three teams removed from the alert's owner). **Report all three rates side by side, never attachment alone.**

**Not yet run against a live tenant** — this is a new manual-review step layered on top of the existing attached/should_have_had arithmetic, not a change to D-rca-buckets' bucket logic. It belongs in the report as a caveat and a sample, never as a recomputed percentage.

**D-rca-topology — is `should_have_had` really remediable, or are the affected entities just not topologically connected (optional deep-dive, only worth running when `should_have_had` is large):**

**Why this exists.** A field discussion with Product on a live "no root cause expected" example (2026-08-05/06) surfaced a nuance D-rca-buckets doesn't model: **multiple affected entities are not sufficient for Davis to name a root cause — the entities also have to be reachable from one another in Smartscape, so Davis can trace cause → effect along the dependency chain.** If two things fail together but there is no topology/tracing link between them (common with custom or network entities, and with immature/partial Smartscape coverage), no chain forms even though `affected_count > 1` — and D-rca-buckets' current logic has no way to tell that apart from a genuine correlation miss. Every problem lacking that link is currently counted in `should_have_had`, which can overstate the slice actually worth chasing.

**This is NOT a one-line addition to the D-rca-buckets query — treat it as its own bounded, sampled step:**

1. **Pull a capped sample of `should_have_had` candidates** (do not attempt the full population — see cost note below):
   ```
   fetch dt.davis.problems, from:now()-30d | dedup {display_id}
   | filter isNull(root_cause_entity_id) and isNull(root_cause.smartscape_entity.id)
   | fieldsAdd affected_count = arraySize(smartscape.affected_entity.ids)
   | filter affected_count > 1
       and not(in("Infrastructure", dt.davis.impact_level))
       and event.category != "CUSTOM_ALERT"
   | fields display_id, event.name, affected_entity_ids = smartscape.affected_entity.ids
   | limit 50
   ```
   50 is a starting cap, not a rule — size it to what's actually worth a manual read; this is a qualitative check on the residual, not a full reclassification.

2. **Bucket the sample by affected-entity TYPE PAIR before writing any traversal.** A Smartscape ID's prefix up to the first `-` is its type (`K8S_POD-...`, `HOST-...`, `SERVICE-...`) — parse it with `splitString`/`substring` rather than an extra `smartscapeNodes` lookup. **There is no single query that checks connectivity for every type combination** — the correct edge-type chain depends on which two types you're connecting (load the `dt-dql-essentials` companion skill's Smartscape topology-navigation reference for the edge-type table — it is an external companion, not bundled in this repo, per AGENTS.md), so group the sample by its observed type pairs first and build one traversal per group.

3. **For the common same-type, common-ancestor shape** (e.g. two `K8S_POD`s under the same workload — the shape SKILL.md already flags as the "shallow topology" norm in container estates), this 2-hop pattern is verified live and cheap (~1,250 scanned records, 0 GB on a reference tenant, for a handful of entity pairs):
   ```
   smartscapeNodes "K8S_POD"
   | filter in(id, {<source ids in this batch, via toSmartscapeId()>})
   | traverse edgeTypes: {is_part_of}, targetTypes: {K8S_DEPLOYMENT}
   | traverse edgeTypes: {is_part_of}, targetTypes: {K8S_POD}, direction: backward
   | filter in(id, {<target ids in this batch, via toSmartscapeId()>})
   | fields source_id = dt.traverse.history[0][id], target_id = id
   ```
   Run this **once per type-pair group**, batching every source/target pair in that group into the two `in(id, {...})` sets — confirmed live that a multi-source, multi-target batch correctly returns only the pairs that are actually connected (a same-cluster, same-deployment pair matched; a cross-cluster pair and a same-cluster-different-service pair both correctly returned nothing), so this does not need to be one query per problem. A problem's affected-entity set counts as topology-connected if **any** pair in it matches a row here; if none do (within the hop depth you tried), reclassify it from `should_have_had` to a new bucket, `expected_no_topology_link`.

4. **If a type-pair in your sample has no codified chain yet, mark those problems `not_assessed` — never default them either direction.** Guessing the edge type is exactly the failure mode `smartscapeNodes`/`smartscapeEdges` warn about: a wrong edge type returns an empty result with no error, which reads identically to "genuinely disconnected" and would silently inflate `expected_no_topology_link`. Verify the edge type exists first with `smartscapeEdges "*" | filter source_type == "<TYPE>" or target_type == "<TYPE>"` before trusting an empty traversal result.

**Two caveats that gate how much this refines the number, both confirmed live (2026-08-06) rather than assumed:**

- **Accuracy depends on how mature the tenant's Smartscape topology is — the same caveat this skill already carries for A3/A4/B33, just applied per-problem instead of estate-wide.** Verified on a reference tenant: checking the `belongs_to`-to-`SERVICE` edge for two different, unrelated deployments in the same cluster, one resolved to a single shared/umbrella `SERVICE` node while the other had **no `SERVICE` mapping via that edge at all**. Either shape can mislead a naive check — the shared node risks a false "connected," the missing node risks a false "disconnected" — so a `should_have_had`→`expected_no_topology_link` reclassification is only as trustworthy as the topology coverage behind it, and that coverage should be stated alongside the number (cross-reference A3/A4's shallow-topology read for the same estate).
- **Not validated end-to-end against a live problem population.** Everything above is confirmed against real Smartscape entities in isolation (the traversal mechanics, the batching, the wrong-edge-type failure mode); it has not been run against a real `dt.davis.problems` `should_have_had` sample start-to-finish, because the tenant used to verify it did not grant `storage:events:read`. Run the full pipeline once against a real should_have_had sample before trusting the resulting split in a client deliverable, and say in the method note that this bucket is newer and less load-bearing than the others.

**A traverse-mechanics gotcha worth keeping, found while validating this (adds to the existing wrong-edge-type warning):** `dt.traverse.history[n]` only exposes `id`/`edge_type`/`direction` — not `name` or other entity fields — and `fieldsKeep` did not reliably carry a custom field across a *second* chained `traverse` in testing. Recover the origin of a multi-hop traversal via `dt.traverse.history[0][id]`, not a field you tried to carry through with `fieldsKeep`, and re-fetch names afterward if you need them for the report.

**Reporting:** treat `expected_no_topology_link` the same way D-rca-buckets treats its other expected-empty buckets — it is color explaining why the headline number isn't a blanket failure, never itself a remediation target. If it's a meaningful share of the old `should_have_had`, say so explicitly next to the (now smaller) residual, and name it as a topology-maturity signal worth its own finding (cross-reference A3/A4) rather than folding it silently back into "expected."

**D-topology-coverage — estate-wide vertical + horizontal Smartscape coverage, plus a tracing-completeness cross-check (DRAFT — adapted from IS-Guide 1, "Validate Topology, Baselines & Detection-Scoping Tags"; not yet live-validated against a real tenant — confirm field names and edge types before quoting any figure in a client deliverable):**

**Why this exists.** D-rca-topology above is a sampled, expensive check that only runs when `should_have_had` is already large. This is the cheap, estate-wide corroborator: coverage percentages that explain *why* topology-dependent RCA is thin, without touching the problem stream at all — a standing signal worth running every time, not just when the sampled deep-dive is warranted.

1. **Vertical coverage (service → host):**
   ```
   smartscapeNodes "SERVICE" | summarize total_services = count()
   | append [
       smartscapeEdges "runs_on"
       | filter source_type == "SERVICE" and target_type == "HOST"
       | summarize services_with_host = countDistinct(source_id)
     ]
   | summarize total_services = max(total_services), services_with_host = max(services_with_host)
   | fieldsAdd coverage_pct = round((services_with_host * 100.0) / total_services, decimals:1)
   ```
   Bands: ≥90% green · 80–90% amber · <80% red. **Verify `runs_on` is the correct edge type for this tenant's Smartscape schema first** — the same wrong-edge-type gotcha D-rca-topology step 4 already warns about: a wrong edge type returns an empty result with no error, indistinguishable from "genuinely uncovered."

2. **Horizontal coverage ("island services" — zero call edges):**
   ```
   smartscapeNodes "SERVICE" | summarize total_services = count()
   | append [
       smartscapeEdges "calls"
       | filter source_type == "SERVICE" or target_type == "SERVICE"
       | summarize services_with_calls = countDistinct(source_id)
     ]
   | summarize total_services = max(total_services), services_with_calls = max(services_with_calls)
   | fieldsAdd island_services = total_services - services_with_calls
   | fieldsAdd island_pct = round((island_services * 100.0) / total_services, decimals:1)
   ```
   A service with zero call edges cannot participate in any cross-service RCA chain no matter what the problem stream looks like — this is the structural explanation behind a share of D-rca-topology's `expected_no_topology_link` bucket.

3. **Tracing-completeness cross-check (traffic without spans) — sketch only, needs rework before use:** the comparison is services present in request-count metrics (traffic) but absent from span data (no trace) over the same window. Draft the actual query as a set-difference once verified live; keep any `fetch spans` read to the guarded ≤5-minute window per this skill's cost rule (probes.md header) regardless of how the query ends up shaped.

4. **Criticality/tiering tag coverage:**
   ```
   fetch dt.entity.service | fieldsAdd tier = primary_tags[?tagKey=="criticality"][0].value
   | summarize total = count(), tiered = countIf(isNotNull(tier))
   | fieldsAdd tier_coverage_pct = round((tiered * 100.0) / total, decimals:1)
   ```
   Target ≥90%. Below that, blast-radius prioritization elsewhere in the report (D-rca-quality-sample's `dt.davis.affected_users_count` ranking, above) is working off an incomplete tiering signal — name that dependency explicitly when both are low.

**Reporting:** state these percentages together as one "topology maturity" reading, cross-referenced everywhere this skill already carries a shallow-topology caveat (A3/A4, D-rca-topology's first caveat). **Do not publish any of these numbers in a client deliverable until the queries have been run live at least once and the edge types confirmed** — mark them `not_assessed`/draft in the interim, the same discipline D-rca-topology step 4 already applies to unverified edge-type traversals.

**D-rcrel — per-detector RCA participation (the mechanism behind D-pui-by-cat):**

D-pui-by-cat proves ported thresholds carry no root cause; it does not prove *why*, and "the category is CUSTOM_ALERT" is a label, not a cause. Two per-event flags decide whether a detector's output can participate in root-cause analysis at all, and they must be read **together**:

- `dt.davis.is_rootcause_relevant` — may this event be *named* as the root cause of a problem.
- `dt.davis.is_merging_allowed` — may this event be *correlated into* a problem with other events. When false, `dt.davis.disable_merging_reason` names who disabled it. **`"Set by event reporter"` means the reporting component, NOT necessarily the detector's own `eventTemplate`** — verified live 2026-08-03: every custom-alert event on two estates carried this reason while **zero** of their 807 detectors set the flag in configuration. Do not read the reason string as proof of a per-detector opt-out; use C-rcrel's `verdict` to distinguish an explicit opt-out from exclusion by alert type.

```
fetch dt.davis.events, from:now()-7d
| filter event.kind == "DAVIS_EVENT"
| summarize events = count(),
    rcRelevant = countIf(dt.davis.is_rootcause_relevant == true),
    mergeable  = countIf(dt.davis.is_merging_allowed == true),
    by:{detector = dt.settings.object_id, title = event.name, category = event.category}
| fieldsAdd rcRelevantPct = round(100.0*toDouble(rcRelevant)/toDouble(events), decimals:1)
| fieldsAdd mergeablePct  = round(100.0*toDouble(mergeable)/toDouble(events), decimals:1)
| fieldsAdd rcaCapable = if(rcRelevant > 0 and mergeable > 0, "yes", else: "no")
| sort events desc | limit 50
```

**Read `is_rootcause_relevant` ALONE and you will ship a false all-clear.** Verified against captured detector configs from two reference tenants (2026-07-28): `is_rootcause_relevant` was set by **0 of 1,276** custom detectors, so every event defaults it to `true` — a probe reporting only that field says "100% root-cause relevant" on an estate whose custom stream measures 0.0% root-cause in D-pui-by-cat. The flag that actually differs is the other one: **1,254 of 1,276 detectors (98.3%) explicitly set `dt.davis.is_merging_allowed: "false"` in their own `eventTemplate`.** An event that cannot merge cannot be correlated with anything, so it becomes a single-entity problem with no root-cause chain — which is precisely the 0.0% / 0.0% row. `rcaCapable = "no"` is therefore the per-detector verdict, and **`mergeablePct` is the discriminating column — read it, not `rcRelevantPct`.**

**This query is the authority when it returns rows.** Live 2026-08-03 it reported `rcRelevantPct` 100 alongside `mergeablePct` 0 on the same category — the two columns disagreeing is the normal shape on this detector class, not an anomaly to reconcile. `rcaCapable` is `"no"` whenever `mergeable` is 0, whatever the other column says. Where this query and C-rcrel disagree, **this one wins**: the stream measures what actually happened, and C-rcrel can only ever establish a lower bound (§3 item 7).

`dt.settings.object_id` is the **same `objectId`** the §3 delete/consolidate worklist keys on, so this joins straight onto it: a detector that is both high-volume (P6) and `rcaCapable = "no"` is a retire-first candidate with the reason already written. **Window:** 7d by default and **record which window was used** — these are rates over the event stream, not the deduped problem stream, so they are not comparable to P4 across different windows. Drop to `-24h` if the event volume makes the scan slow (P3 gives the per-day event count).

**Validation status: run live 2026-08-03 on two estates — the query shape is verified and returns rows.** Grouping on `dt.settings.object_id` did **not** populate for every event class, so the validated form groups on `category` (and optionally `title`); when the object-id grouping comes back null, group on `title`/`category` alone and say so rather than dropping the probe. Live shape worth expecting: `INFO` dominates the event count by three orders of magnitude and sits near 0% on both columns — **filter it out or report per category**, because an all-category rollup is swamped by it and reads as a near-total RCA failure across the estate.

**D-segments — Extract problem metadata dimensions for customer segmentation (enables filtered views + targeted routing):**
```
fetch dt.davis.problems, from:now()-30d | dedup {display_id}
| fieldsAdd durMin = toDouble(resolved_problem_duration)/60000000000.0
| summarize total=count(),
    durP50Min=round(percentile(durMin,50),decimals:1),
    durP90Min=round(percentile(durMin,90),decimals:1),
    openNow=countIf(event.status=="OPEN"),
    rootCauseRate=round(100.0*avg(if(isNotNull(root_cause_entity_id) or isNotNull(root_cause.smartscape_entity.id),1,else:0)),decimals:1),
    multiEntityRate=round(100.0*avg(if(arraySize(affected_entity_ids)>1 or arraySize(smartscape.affected_entity.ids)>1,1,else:0)),decimals:1)
| append [
  # By cluster + workload kind (K8s segmentation)
  fetch dt.davis.problems, from:now()-30d | dedup {display_id} | filter isNotNull(arrayFirst(k8s.cluster.name))
  | summarize n=count(), by:{cluster=arrayFirst(k8s.cluster.name), kind=arrayFirst(k8s.workload.kind)} | sort n desc
]
| append [
  # By entity type (infrastructure vs app vs platform)
  fetch dt.davis.problems, from:now()-30d | dedup {display_id}
  | summarize n=count(), by:{category=event.category} | sort n desc
]
| append [
  # By severity/duration tier (SLA impact grouping)
  fetch dt.davis.problems, from:now()-30d | dedup {display_id}
  | fieldsAdd durMin=toDouble(resolved_problem_duration)/60000000000.0
  | fieldsAdd tier = if(durMin<5, "flapping_<5min",
              if(durMin<60, "minor_5-60min",
              if(durMin<480, "major_1-8h",
              "sustained_8h+")))
  | summarize n=count(), by:{tier} | sort n desc
]
| append [
  # By resolution type (auto vs manual + muted)
  fetch dt.davis.problems, from:now()-30d | dedup {display_id}
  | fieldsAdd resolved = if(event.status=="CLOSED", "auto-resolved", "manual/open")
  | summarize n=count(), muted=countIf(dt.davis.mute.status!="NOT_MUTED"), 
    by:{resolved} | sort n desc
]
```

**Output:** Customer can use these dimensions to:
1. **Create problem segments** — drill problems by cluster/workload/category/duration tier in problem views
2. **Targeted routing** — route K8s cluster issues to infra team, app slowdowns to dev team (via `k8s.cluster.name`, `event.category` matchers in workflows)
3. **SLA grouping** — group flapping (<5min) separately from major incidents (1-8h) for different escalation thresholds
4. **Coverage gaps** — identify which teams/clusters see which problem categories

`[example: 30d view shows 3 clusters: prod 11,245 (CUSTOM_ALERT 65%, med 3min) | stage 2,133 (RESOURCE_CONTENTION 80%, med 45min) | dev 89 (SLOWDOWN 71%, med 2h) — prod noise vs stage/dev real issues = route differently]`

---

## §5 — Adjacent checks (context that changes how the noise reads)

These repeatedly decide the *interpretation* — run them before finalising the story. All read-only.

**A1 — Maintenance windows (suppression):**
```
dtctl get settings --schema builtin:alerting.maintenance-window -o json   # legacy
dtctl get settings --schema builtin:maintenance-windows -o json           # Gen3 (Preview)
```
Split by `value.schedule.scheduleType` (recurring DAILY/WEEKLY are the standing-suppression risk) and enabled. Cross-read P7. `[example: 0 + 0 → the 0% under-maintenance is fully explained; noise 100% real/unsuppressed]`

**A2 — Delivery chain (does the noise reach anyone?):**
```
dtctl get workflows -o json                                               # trigger + isDeployed (enabled state)
dtctl get settings --schema builtin:problem.notifications -o json
dtctl get settings --schema builtin:alerting.profile -o json
```
Workflow enabled field is **`isDeployed`** (not `enabled`/`isActive`); trigger under `trigger.eventTrigger` (event-triggered, e.g. davis-problem routers) vs `trigger.schedule` (polling anti-pattern). Report: live problem-routers (delivery works → noise is costly), delivery-layer hygiene (test/template/duplicate routers, personal ownership), classic-vs-workflow dual lanes, MZ-bound profile share. `[example: 17 workflows — 6 problem-routers (4 deployed → teams + OpsRamp), 11 scheduled polling; 3 classic notifications; 3 profiles, 0 MZ-bound; a "-test" router deployed in prod]`

**A3 — Host monitoring mode (is shallow topology a coverage gap?):**
```
fetch dt.entity.host | fieldsAdd mode = monitoringMode | summarize hosts = count(), by:{mode} | sort hosts desc
```
`FULL_STACK` vs `INFRASTRUCTURE`. All-Full-Stack = coverage is NOT the topology bottleneck (corrects the usual assumption). `[example: 90/90 FULL_STACK — the low PUI is the custom-alert burden, not missing agents]`

**A4 — Service detection (is the topology over-split?):**
```
dtctl get settings --schema builtin:service-detection-rules -o json
fetch dt.entity.service | summarize services = count()
fetch dt.entity.service | fields name=entity.name | limit 3000     # local near-duplicate-family analysis
```
Over-splitting inflates the service census with near-duplicates and dilutes correlation. `[example: 17 rules, 532 services, ~54 near-duplicate Kafka-Connect worker services = mild; topology reasonably shaped, not the culprit]`

**A5 — Davis detectors + unused analyzers ("bought the AI, turned it off?"):**
```
dtctl get settings --schema builtin:davis.anomaly-detectors -o json   # same set as `get anomaly-detectors`; group by analyzer
dtctl get analyzers -o json                                            # the analyzer catalog
```
Join: which analyzers are actually referenced by detectors? Adaptive/seasonal/forecast available but wired into **0** detectors = idle AIOps. `[example: 571 enabled, 100% StaticThreshold; AutoAdaptive/Seasonal/Forecast/Novelty used by 0]`

**A6 — Frequent-issue detection (a cheap dampener):**
```
dtctl get settings --schema builtin:anomaly-detection.frequent-issues -o json
```
All-false = recurring problems are never flagged "frequent" (explains P5 `frequentRate` 0). Enabling lets Davis auto-flag recurring offenders for mute/de-prioritize. `[example: disabled in all 4 scopes]`

**A7 — Older metric-events framework (dormant debt):**
```
dtctl get settings --schema builtin:anomaly-detection.metric-events -o json
```
Separate from the §3 Davis detectors. `value.{enabled, queryDefinition, eventTemplate}`. `[example: 74, all disabled → config debt, zero noise; delete with the other dormant detectors]`

**A8 — Span-capturing + health-check span noise (guarded ≤5-min):**
```
dtctl get settings --schema builtin:span-capturing -o json            # ignore rules that drop noisy spans
fetch spans, from:-5m
| summarize total = count(),
    health = countIf(contains(span.name,"health") or contains(span.name,"ping") or contains(span.name,"ready") or contains(span.name,"alive") or contains(span.name,"actuator")),
    ingest_mb = round(sum(dt.ingest.size)/1048576.0, decimals:1)
| fieldsAdd health_pct = round(100.0*toDouble(health)/toDouble(total), decimals:1)
```
`[example: 0 span-capturing rules; health spans 0.9% of traffic → not a noise source, clean corner]`

**A9 — Legacy 2nd-gen metric-events still emitting (stream corroboration of A7):**
```
fetch dt.davis.events, from:now()-7d
| filter dt.settings.schema_id == "builtin:anomaly-detection.metric-events"
| summarize legacy_configs = countDistinct(dt.settings.object_id), legacy_events = count()
```
A7 reads the classic 2nd-gen metric-events framework from **config** (`dtctl get settings`); this reads the **stream** the same way the K8s presence check already established the precedence for this skill — **entities/events prove presence, config reads only corroborate.** A7 alone can show "74 detectors, all disabled" and still miss legacy detectors that are enabled but silent for other reasons (suppressed, misconfigured, scoped to an entity that no longer exists) — this probe is the cross-check: if A7 shows configs but this shows 0 events, the debt really is dormant; if this shows events but A7 undercounts configs, A7's read missed something and should be re-run. **Use `dt.settings.schema_id`, not `event.provider`, to classify config generation:** `event.provider` names who emitted the event (a diagnostic/operational fact); `dt.settings.schema_id` names the detector-config type that produced it — `builtin:anomaly-detection.metric-events` is classic 2nd-gen, `builtin:davis.anomaly-detectors` is 3rd-gen (the §3 custom-detector framework). `schema_id` is what actually surfaces migration debt; `provider` cannot make that distinction. Keep both fields in mind for different purposes rather than substituting one for the other. **Gen3-first framing applies here as everywhere in this repo:** a non-zero count is not "you're missing a classic construct" — classic 2nd-gen detectors are the thing to retire, and any live count here is itself the finding (residual legacy-engine noise still worth migrating to native Davis detection), never a gap to fill.

**A10 — Ready-made-alert category reclassification (DRAFT — config-only, zero-risk win; per IS-Guide 2, "Sensitivity Tuning". Check this before any per-detector threshold tuning):**
```
# Schema id below is a placeholder — confirm the actual settings schema live
# (dtctl get settings --list, grep for "category"/"reclassif") before shipping this as a probe.
dtctl get settings --schema builtin:alerting.category-update -o json
```
Some built-in infrastructure/Kubernetes alert types can be reclassified from problem-opening to informational via **Settings → Analyze and alert → Alerts → Category update** (requires OneAgent/ActiveGate ≥ 1.329 per the guide), without touching a single detector's threshold — a one-click, no-blast-radius change that can absorb noise otherwise "fixed" by loosening a threshold and losing real signal in the process. **Confirm the schema id and the version gate live before trusting this probe.** If the feature isn't present (older AG/OneAgent), record as `not-applicable — feature requires OneAgent/ActiveGate ≥ 1.329`, not ⚪.

---

## Probe → run-state IDs

Record with stable IDs so `compare` can trend run-over-run: `P1`…`P10` (§1), `S-<area>` (§2 settings), `OV-<area>` (§2 overrides), `C-classic`/`C-metricevents`/`C-rcrel`/`C-alertidentity`/`C-entityref` (§3 — the last two DRAFT, not yet live-validated), `D-<driver>` (§4, including `D-pui-by-cat`, `D-rca-buckets`, `D-rca-quality-sample`, `D-rca-topology`, `D-topology-coverage`, `D-rcrel`, `D-source-fragmentation` — `D-rca-quality-sample` and `D-topology-coverage` DRAFT), `A1`…`A10` (§5 — `A10` DRAFT). `C-rcrel` records `{detectors, enabled, merging_disabled_explicitly, rootcause_irrelevant_explicitly, not_capable_by_type, not_capable_total, unknown}` — **there is no `rca_capable` key**, because configuration cannot establish capability (§3 item 7); a run.json carrying one is from the superseded classifier and its verdict should not be quoted. `D-rcrel` records `{window, by_category[], mergeable_pct, rca_capable_no, top_offenders[]}` — the window is part of the summary because the rates are window-dependent. Every figure the report cites must appear in some probe's `--summary` so the deliverables rebuild from `run.json` alone. The reference run `runs/<tenantId>-<date>/` is retained as a worked example of the full battery.
