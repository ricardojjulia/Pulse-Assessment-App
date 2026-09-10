# Probe catalog — §B Grail probes**Fence note (read before batching these queries):** a single fenced block here may hold **several independent DQL statements**, one per line beginning at column 0 (`fetch dt.entity.service | summarize …` followed by `fetch dt.entity.process_group | summarize …`). A human runs them one at a time; a script that sends the whole fence as one query gets `PARSE_ERROR: 'fetch' isn't allowed here` and, if it records that as the probe's result, silently loses the probe. Split a block at each line whose first token is `fetch`, `timeseries`, `metrics`, `data` or `smartscapeNodes` — continuation lines start with `|` or whitespace. Five probes per tenant hit this on 2026-08-26.



Part of the dt-eval probe catalog — [probes.md](probes.md) is the router: the shared preamble (dtctl version floor, `--context` on every command, save-raw + `runlog.py record` rules) lives there and applies to every probe here. Cross-references to other sections point into sibling files: §A = [probes-config.md](probes-config.md) · §B = [probes-grail.md](probes-grail.md) (this file) · deep-dives D1–D6 = [probes-deepdives.md](probes-deepdives.md) · §C = [probes.md](probes.md) · §D = [probes-consumption.md](probes-consumption.md) · §E = [probes-gen3.md](probes-gen3.md). The keep-in-sync rule (CLAUDE.md) applies to this whole family.

## §B — Grail probes (`dtctl query "<DQL>" -o json`)

Cost model: unscoped `fetch logs` ≤ 5-minute windows only; **`fetch spans` obeys the same guardrail — it is a high-volume raw table, so keep every span probe to ≤ 5-minute windows and single-pass `countIf()` aggregates** (playground runs ~5–6k spans/min; a customer tenant is far larger). Entity/problem/event fetches are cheap (Davis events live in small dedicated buckets — filter `dt.system.bucket` to them as in B16). `timeseries` over metrics (`dt.kubernetes.*`, `dt.synthetic.*`, `dt.service.request.*`, `dt.billing.*`, `otelcol_*`) and `user.sessions`/`user.events`/`security.events` reads are cheap — full windows are fine there. For a coarse log-volume *trend* only, the sampled pattern is sanctioned: `fetch logs, samplingRatio: 100, scanLimitGBytes: <N>` (Infrastructure Observability dashboard tile 10) — sampling for shape, never for exact counts. `-o json` always; save raw.

**B1 — One-pass log health (2 min, single scan — routing, ABAC, K8s enrichment, parsing, volume):**

```
fetch logs, from:-2m
| summarize total = count(),
    in_default = countIf(dt.system.bucket == "default_logs"),
    null_seccontext = countIf(isNull(dt.security_context)),
    k8s_total = countIf(isNotNull(k8s.namespace.name)),
    k8s_missing_cluster = countIf(isNotNull(k8s.namespace.name) and isNull(k8s.cluster.name)),
    null_loglevel = countIf(isNull(loglevel)),
    hosts_shipping = countDistinctExact(host.name)
```

Derivations: `in_default/total` = routing health (≥90% in default with custom buckets defined = ⚠️); `null_seccontext/total` = ABAC coverage (100% null = ⚠️); day-rate = `total × 720` (label *derived*).

**B2 — Bucket-scoped recency, one per custom log bucket found in A1 (cheap — scoped):**

```
fetch logs, bucket:"<bucketName>", from:-24h | summarize records = count(), latest = max(timestamp)
```

Cross-check vs A1 lifetime `records`: billions lifetime + 0/24 h = **routing regressed** (stronger finding than "empty bucket"). Run for up to ~10 buckets, prioritizing highest lifetime `records`.

**B3 — Estate coverage & hygiene: monitoring modes, candidates, stale entities (the FAQ-12 ladder):**

Run **both** mode patterns — the delta between them is itself a finding (stale entities):

```
fetch dt.entity.host | fieldsAdd mode = monitoringMode | summarize hosts = count(), by:{mode} | sort hosts desc
```

```
// Official successor pattern (official Infrastructure Observability dashboard, tile 34 — Dynatrace Dashboards app):
// "monitoring mode does not exist anymore directly on the Host entity" — it now lives on ONEAGENT Smartscape nodes
smartscapeNodes HOST
| fields id
| fieldsAdd monitoringMode = lookup([
    smartscapeNodes ONEAGENT
    | fieldsAdd monitoringMode = coalesce(
        if(dt.smartscape_source.sender == "dynatrace_codemodule", "APP_ONLY"),
        if(isNotNull(dt.agent.monitoring_mode), dt.agent.monitoring_mode), "UNKNOWN")
  ], sourceField:id, lookupField:references[monitors.host][0])[monitoringMode]
| summarize hosts = count(), by:{monitoringMode}
```

(Verified live: both return the same actives; the classic view adds null-mode rows = inactive/stale entities. The classic field still works today — prefer reporting from it for continuity, cite the Smartscape pattern as the forward path.)

Estate hygiene + discovery coverage in one cheap scan:

```
smartscapeNodes HOST
| fieldsAdd state = if(getEnd(lifetime) >= now() - 10m, "RUNNING", else: "INACTIVE")
| summarize hosts = count(), candidates = countIf(isMonitoringCandidate == true), by:{state}
```

`isMonitoringCandidate` = discovered-but-unmonitored machines — the bottom of the mode ladder and a named coverage opportunity; a large INACTIVE share = stale entities inflating estate counts. High INFRASTRUCTURE share on app hosts = the biggest single coverage limiter. Entity fetches return only `id`/`entity.name` by default — pull attributes explicitly. `smartscapeNodes HOST` also carries cloud metadata (`aws.account.id`, `cloud.provider`, `os.version`) for the estate mix, and the `dt.host.availability` metric (dimension `availability.state`) gives availability % when a reliability angle is needed.

**B4 — Davis problems vs ported static alerts (24 h):**

```
fetch dt.davis.problems, from:-24h
| summarize total = count(),
    custom_alert = countIf(event.category == "CUSTOM_ALERT"),
    davis = countIf(event.category != "CUSTOM_ALERT")
```

High `CUSTOM_ALERT` share + A2 all-static detectors = the migration anti-pattern, config-confirmed.

**B4b — Custom-detector semantic intent classification (Python local analysis, shared with dt-eval-prob):**

Parse each **enabled** custom detector to infer its intent and map to Davis categories (RESOURCE_CONTENTION, SLOWDOWN, ERROR, AVAILABILITY):

```python
# For each enabled detector from dtctl get anomaly-detectors:
# 1. Classify by keyword + query pattern matching (see dt-eval-prob P3)
# 2. Join to B4's 24h custom-alert problems by detector title
# 3. Emit priority list: "Retiring 11 RESOURCE_CONTENTION detectors = 520/597 custom problems (87%)"

# Output example:
Detector Categories (33 enabled custom detectors / 597 CUSTOM_ALERT problems 24h)
├─ RESOURCE_CONTENTION (11 detectors, 520 problems, 87%): CPU_HIGH, MEM_SATURATION, ...
├─ SLOWDOWN (8 detectors, 45 problems, 8%): API_LATENCY, DB_QUERY_SLOW, ...
├─ ERROR (7 detectors, 22 problems, 4%): HTTP_5XX, EXCEPTION_RATE, ...
├─ AVAILABILITY (4 detectors, 10 problems, 2%): HOST_DOWN, SERVICE_UNAVAILABLE, ...
└─ UNCLASSIFIABLE (3 detectors, 0 problems, 0%): [manual review]
```

Prioritizes remediation by impact: retire the 11 RESOURCE_CONTENTION rules first (87% volume reduction), then SLOWDOWN, etc.  
Cross-ref: if RESOURCE_CONTENTION Davis detector is disabled (A2), enabling it replaces these 11 clones at zero coverage cost.

**B5 — Tag governance: classic entity tags + Grail governance fields (verified live 2026-07-09):**

Classic entity tags (typos, near-duplicates, missing mandatory keys):

```
fetch dt.entity.host | expand tags | parse tags, "LD:key ':' LD:val" | summarize hosts = count(), by:{key} | sort hosts desc
fetch dt.entity.service | fieldsAdd n = arraySize(tags) | summarize total = count(), tagged = countIf(n > 0)
```

Look for: typo'd keys, the same concept under multiple keys, absent `team`/`cost_center`/`environment`-class keys, malformed/null keys; run the coverage variant per entity type (service/PG/K8s) — hosts messy while services are 100% auto-tagged is a common split.

**Grail governance tags on records** (the platform's own tag fields — cheap, fold into or alongside B1):

```
fetch logs, from:-2m
| summarize total = count(),
    has_costcenter = countIf(isNotNull(dt.cost.costcenter)),
    has_product = countIf(isNotNull(dt.cost.product)),
    has_secctx = countIf(isNotNull(dt.security_context))
```

`dt.cost.costcenter` / `dt.cost.product` are the FinOps allocation tags (set at source or via the pipeline `costAllocation` stage — the same pipelines that set `securityContext` usually set both, so the coverage percentages tend to match). Then cross-check **attribution actually landing in billing**:

```
timeseries u = sum(dt.billing.logs.ingest.usage_by_costcenter), by:{costcenter}, from:-7d, interval:7d
| fields costcenter, total = arraySum(u) | sort total desc | limit 10
```

All-null `costcenter` with non-trivial usage = consumption is 100% unattributed. **Records carrying `dt.cost.costcenter` while billing shows all-null** = allocation was configured recently or isn't landing — report the discrepancy and recommend verifying, don't guess which.

**Smartscape-native tags** (the Grail tag surface on nodes):

```
smartscapeNodes HOST | fields name, tags | limit 5
```

An empty `tags: {}` object while the classic entity carries tags = tagging lives only on the classic surface; anything built on Smartscape tags (segments, new-platform filters) won't see them.

**B6 — Host groups (naming-scheme quality — qualitative read, label it as such):**

```
fetch dt.entity.host_group | fields name = entity.name | sort name asc | limit 500
```

**B7 — Topology depth:**

```
fetch dt.entity.service | summarize services = count()
fetch dt.entity.process_group | summarize process_groups = count()
```

Read against B3: depth confined to the Full-Stack share.

**B8 — RUM coverage (zero rows / 403 = RUM dark or scope missing):**

```
fetch user.sessions, from:-24h | expand frontend.name
| summarize sessions = count(), by:{frontend.name} | sort sessions desc
```

**Never use `app.short_name` as the application dimension** (live 2026-07-29, a large estate: null on 100% of ~6.8k sessions — `apps: 0` with no error on a tenant serving thousands of real-user sessions/day, which reads as "RUM is dark"; `application.name` and `dt.rum.application.name` are equally null). The live per-application dimension is **`frontend.name`** (an array — needs `expand`) or `dt.rum.application.entities`.

**B9 — Synthetic coverage:**

```
fetch dt.entity.synthetic_test | summarize browser_monitors = count()
fetch dt.entity.http_check | summarize http_monitors = count()
```

**B10 — Business events (1 h window):**

```
fetch bizevents, from:-1h | summarize events = count(), by:{event.provider} | sort events desc | limit 20
```

**B11 — Security posture via Grail (replaces the old securityProblems REST fallback):**

```
fetch security.events, from:-24h | summarize events = count()
```

Read the two failure modes apart: **403** = token lacks `storage:security.events:read` → ⚪ not assessable, never ⚠️. **Scope granted but 0 events** = AppSec (RVA) is dark on this tenant → a real coverage finding (grade against the estate: Full-Stack hosts with no security signal). When non-zero, break down:

```
fetch security.events, from:-24h | summarize n = count(), by:{event.type, event.provider} | sort n desc | limit 20
```

**B12 — Log source coverage vs host inventory (5 min, cheap-guarded):**

```
fetch logs, from:-5m | summarize hosts_reporting = countDistinctExact(host.name)
```

Compare with total hosts from B3 (short-window undercount is possible — say so).

**B13 — OneAgent fleet currency (DQL-native — the DTR tile-158 pattern; `installerVersion` is the field, `agentVersion` does not exist on Grail entities):**

```
fetch dt.entity.host, from:-5m
| fields id, name = entity.name, installerVersion
| parse installerVersion, "INT PUNCT INT: version PUNCT INT"
| summarize hosts = count(), by:{version} | sort version desc
```

Grade on spread and drift: majority on newest observed = ✅; stragglers >6 versions behind = 💡; >20 behind = ⚠️ (DTR bands). Null `installerVersion` = agentless/cloud-only hosts — exclude, don't penalize. Pair with A24: old versions + auto-updates off = policy gap.

**B14 — DPS consumption mix via billing metrics (DQL-native — replaces the consumption REST fallback; FINOPS-01 has worked variants):**

```
timeseries fullstack = sum(dt.billing.full_stack_monitoring.usage),
           infra = sum(dt.billing.infrastructure_monitoring.usage),
           fnd = sum(dt.billing.foundation_and_discovery.usage),
           from:-7d, interval:1d
```

The cost side of B3's mode ladder — paying Full-Stack rates while the estate's value sits in Infrastructure mode (or vice versa) is the first FinOps conversation. `dt.billing.logs.ingest.usage_by_product` / `usage_by_costcenter` break log-ingest spend down further; discover the full family with `metrics | filter startsWith(metric.key, "dt.billing") | fields metric.key`.

**B15 — ActiveGate fleet, topology & health via self-monitoring metrics (DQL-native; source: the Discovery & Coverage app's "ActiveGate diagnostic overview" dashboard; authoritative metric reference: docs.dynatrace.com → ActiveGate self-monitoring metrics):**

Fleet inventory + network-zone/group topology (verified live — sees AGs the entity model doesn't):

```
timeseries cpu = avg(dt.sfm.active_gate.system.cpu_usage),
  by: {dt.active_gate.id, dt.active_gate.group.name, dt.network_zone.id, host.name}, from:-24h
| summarize ags = countDistinctExact(dt.active_gate.id), by:{dt.network_zone.id, dt.active_gate.group.name}
```

Data-loss and load signals (the hard health checks):

```
timeseries dropped = max(dt.sfm.active_gate.communication.messages.dropped, default:0),
           rejected = max(dt.sfm.active_gate.communication.messages.rejected, default:0),
           modules = max(dt.sfm.active_gate.communication.agent_modules.connected),
  by: {dt.active_gate.id}, from:-24h
| fieldsAdd max_dropped = arrayMax(dropped), max_rejected = arrayMax(rejected), max_modules = arrayMax(modules)
| fields dt.active_gate.id, max_dropped, max_rejected, max_modules
```

Grading (thresholds from the official dashboard): **any dropped/rejected > 0 = ⚠️ data loss**; system/JVM CPU or memory sustained ≥70% = ⚠️ (≥40% = 💡); storage volume ≥80% = ⚠️ (≥50% = 💡); GC time ≥10% of interval = ⚠️; REST API responses ≥400 present = 💡 investigate. Further metrics in the family: `jvm.heap_memory_used/available`, `jvm.gc.major_collection_time`, `storage.volume.free/total`, `storage.directory.size/limit` (by `volume`, `module_name`), `thread_pool.busy_threads/queue_size` (by `thread_pool_name`), `rest.request_count/request_size/response_size` (by `operation`, `response_code`), `traffic.server|client.sent/received`.

Topology findings: a multi-AG fleet with every AG in the `default` network zone = no traffic-locality design (FAQ-05/FAQ-10); very uneven `agent_modules.connected` across AGs = load imbalance. (AG fleet version drift is graded by B36 via Smartscape; auto-update posture by A25.)

**B16 — Resource-saturation pressure (cheap — scoped to the Davis event buckets; Infrastructure Observability dashboard pattern, verified live):**

```
fetch events, from:-24h
| filter in(dt.system.bucket, {"default_davis_events", "default_davis_custom_events", "default_k8s_ops_events"})
| filter event.kind == "DAVIS_EVENT"
| filter contains(toString(smartscape.affected_entity.ids), "HOST")
| fieldsAdd rtype = if(matchesPhrase(event.name, "Disk") or matchesPhrase(event.group_label, "Disk"), "Disk",
    else: if(matchesPhrase(event.name, "Cpu") or matchesPhrase(event.name, "CPU"), "CPU",
    else: if(matchesPhrase(event.name, "Memory"), "Memory", else: "Other")))
| summarize events = countDistinctApprox(event.id), by:{rtype}
```

**`countDistinctApprox`, not `countDistinctExact`** — the exact form has a hard 1M-value ceiling and fails outright (`UDF_ELEMENT_LIMIT_WITH_ALTERNATIVE`) on large estates (live 2026-07-29: ~2.8M Davis events in 24 h). Use `countDistinctExact` only where cardinality is known bounded (e.g. B15's ActiveGate IDs); default to the approx form on any event/problem/span/host aggregate over a large estate.

Add `countDistinctApprox(toString(smartscape.affected_entity.ids))` for breadth (many events on one host = a hotspot; spread across many = capacity risk). Cross-read with A2/B4: heavy saturation events + all-static detectors = capacity managed by alert noise instead of baselines and forecasts.

---

### Application-observability plane (spans / DB / OpenTelemetry) — verified live on `playground` 2026-07-11

**Cost note (non-negotiable):** every `fetch spans` probe below is a ≤ 5-minute, single-pass aggregate — spans are as expensive as logs. Never widen the window to "get a better sample"; re-run the 5-minute scan instead. **And size the window DOWN adaptively on large estates** (2026-07-29 — span rates vary 30×+ across tenants: the reference runs ~5–6k spans/min, a live production estate ran 187k/min and a "guardrail-compliant" 5-minute scan still read ~1M spans / 1.8 GB): size a sizing sample first, then the real window to a target scan volume (aim ≤ ~100k spans or ≤ ~0.5 GB per probe), never default to the 5-minute ceiling — the ceiling is a maximum, not a target. **Concrete sizing procedure (2026-07-29 — the naive "sample the last 30 seconds" returns misleading zeros/undercounts):** offset the sizing window back at least 60 seconds to clear ingest lag — `from:-2m, to:-1m` with `samplingRatio:100` — then halve the window and re-measure if the sampled count exceeds ~150k. Recent spans are not yet queryable: live on a tenant ingesting ~12M spans/min, a trailing 10-second window returned **0 rows** and a trailing 60-second window under-read the rate 5×. **A zero-row result on a short trailing window is ingest lag, never absence — widen and offset before concluding anything.**

**B17 — Span/trace health (1 scan — coverage, failure rate, OTel/OneAgent split, ingest waste):**

```
fetch spans, from:-5m
| summarize total = count(),
    failed = countIf(request.is_failed == true),
    otel = countIf(isNotNull(otel.scope.name)),
    oneagent = countIf(isNull(otel.scope.name)),
    health_noise = countIf(contains(span.name, "health") or contains(span.name, "ping") or contains(span.name, "ready") or contains(span.name, "alive")),
    ingest_mb = sum(dt.ingest.size) / 1048576.0,
    by:{span.kind}
```

Then failure rate by service (the finding that names *which* service is unhealthy):

```
fetch spans, from:-5m
| filter span.kind == "server"
| summarize total = count(), failed = countIf(request.is_failed == true),
    by:{svc = coalesce(service.name, dt.entity.service)}
| fieldsAdd err_pct = round(100.0 * failed / total, decimals:2)
| sort total desc | limit 15
```

**Verified field semantics (these bit the notebook guesses — trust these, not the BPN text):** `request.is_failed` (boolean) is the reliable failure flag — `span.status_code` exists but is lowercase `error`/`ok` and **null on the majority of spans** (only OTel-set spans carry it), so never gate failure on it. `service.name` is populated on OTel spans but **null on OneAgent spans** (which carry `dt.entity.service`) → always `coalesce(service.name, dt.entity.service)`. `duration` is **nanoseconds**. `endpoint.name` is the Dynatrace-normalized route (`http.route` is often null). `dt.ingest.size` is present per span → the health-check-noise share × ingest_mb = a concrete "you pay to store readiness pings" finding. Derivations: `failed/total` = trace error rate; `otel/(otel+oneagent)` = instrumentation-source mix; `health_noise/total` = trace ingest waste.

**B18 — Database monitoring (rides on the span table — no separate DB agent needed):**

```
fetch spans, from:-5m
| filter isNotNull(db.system)
| summarize calls = count(), errors = countIf(request.is_failed == true),
    p95_ms = percentile(duration, 95) / 1000000.0,
    by:{db.system, db.namespace}
| sort calls desc | limit 20
```

`db.system` census = which database technologies the estate actually talks to (verified live: postgresql/dynamodb/mssql/mysql/redis/pinecone/h2/sqlite). **`db.statement` and `db.operation` are null by default** (full statement capture is off unless enabled) — group by `db.system` + `db.namespace` + `span.name` for the operation shape, and flag "statement-level capture disabled" rather than trying to read `db.statement`. A `p95_ms` outlier on one `db.system` (playground: pinecone 963 ms vs redis 2 ms) = the slow-tier finding; cross-read with B17 service error rate to see if DB latency is surfacing as service failures.

**B19 — OpenTelemetry ingestion + collector health:**

SDK/instrumentation inventory (which languages/scopes send OTel):

```
fetch spans, from:-5m
| filter isNotNull(otel.scope.name)
| summarize spans = count(), by:{telemetry.sdk.language, telemetry.sdk.name}
| sort spans desc | limit 15
```

Collector self-health (data-loss + saturation — the OTel analogue of B15's ActiveGate checks):

```
timeseries send_failed = sum(otelcol_exporter_send_failed_spans, default:0),
           queue = max(otelcol_exporter_queue_size, default:0),
           cpu = max(otelcol_process_cpu_seconds, default:0),
           heap = max(otelcol_process_runtime_heap_alloc_bytes, default:0),
  from:-1h
```

`otelcol_*` metrics exist whenever a Dynatrace/OTel Collector self-reports (verified live). **Any `send_failed > 0` = the collector is dropping telemetry** (data loss — ⚠️, same grading as B15 dropped/rejected messages); a climbing `queue` with rising `heap` = memory-limiter backpressure. The OTel/OneAgent split from B17 is the strategic read: a heavy OTel share with a lossy collector = the ingestion path the customer is standardizing on is the one silently losing data. Discover the full family with `metrics | filter startsWith(metric.key, "otelcol") | dedup {metric.key} | fields metric.key`.

### Kubernetes (dedicated) — verified live on `playground` 2026-07-11

**Census uses the entity tables, NOT Smartscape** (gotcha: `smartscapeNodes KUBERNETES_CLUSTER` returns **0** — the node type name differs; `dt.entity.kubernetes_cluster` is correct):

```
fetch dt.entity.kubernetes_cluster | summarize clusters = count()
fetch dt.entity.kubernetes_node | summarize nodes = count()
fetch dt.entity.cloud_application | summarize workloads = count()
fetch dt.entity.cloud_application_namespace | summarize namespaces = count()
```

**B20 — Workload right-sizing (the FinOps-meets-reliability finding).** 🔶 **Query shape revised 2026-08-12 — the three queries below are `candidate — verify live` on the next K8s tenant; the *readings* are unchanged and remain playground-verified.** The prior shape (`arrayAvg` over `from:-6h`) is a **multi-hour average of a quantity that only makes sense point-in-time**, and it divided by a denominator its own prose says is routinely null. Both are corrected below; the third contamination (non-Running pods) is an open question, stated as such rather than papered over.

**B20a — CPU reservation vs. use (point-in-time):**

```
timeseries req = avg(dt.kubernetes.container.requests_cpu),
           lim = avg(dt.kubernetes.container.limits_cpu),
           use = avg(dt.kubernetes.container.cpu_usage),
  from:-20m, to:-5m, interval:15m, by:{k8s.namespace.name, k8s.workload.name}
| fieldsAdd r = arrayLast(req), l = arrayLast(lim), u = arrayLast(use)
| fieldsAdd util_vs_request_pct = if(r > 0, round(100.0 * u / r, decimals:1), else: null)
| fieldsAdd unbounded = isNull(r) or isNull(l)
| fields k8s.namespace.name, k8s.workload.name, r, l, u, util_vs_request_pct, unbounded
| sort r desc | limit 20
```

**B20b — the memory twin (the one that was prose-only until 2026-08-12, and usually the bigger number):**

```
timeseries req = avg(dt.kubernetes.container.requests_memory),
           lim = avg(dt.kubernetes.container.limits_memory),
           use = avg(dt.kubernetes.container.memory_working_set),
  from:-20m, to:-5m, interval:15m, by:{k8s.namespace.name, k8s.workload.name}
| fieldsAdd r = arrayLast(req), l = arrayLast(lim), u = arrayLast(use)
| fieldsAdd util_vs_request_pct = if(r > 0, round(100.0 * u / r, decimals:1), else: null)
| fieldsAdd unbounded = isNull(r) or isNull(l)
| fields k8s.namespace.name, k8s.workload.name, r, l, u, util_vs_request_pct, unbounded
| sort r desc | limit 20
```

**B20c — the capacity ceiling (run this BEFORE reporting any reclaimable-capacity number):**

```
timeseries requested = sum(dt.kubernetes.container.requests_cpu),
  from:-20m, to:-5m, interval:15m, by:{k8s.cluster.name}
| fieldsAdd cluster_cpu_requested = arrayLast(requested)
```
```
timeseries allocatable = sum(dt.kubernetes.node.cpu_allocatable),
  from:-20m, to:-5m, interval:15m, by:{k8s.cluster.name}
| fieldsAdd cluster_cpu_allocatable = arrayLast(allocatable)
```

**Why the shape changed — three distinct contaminations, only two of them fixed here:**

1. **Window churn (fixed).** Requests are a *spec* value, not a rate. Averaging them across six hours blends every pod that lived and died inside the window, so a churn-heavy namespace (CI/CD runners, batch/Spark-style job executors) reads as reserving far more than it ever held at once. `arrayLast` over one offset bucket reads the reservation as it stands. **The window is offset (`to:-5m`) deliberately** — the repo's standing rule that a trailing window under-reads or returns nulls on ingest lag (see the span-sizing note above) applies here too, and a null last bucket is lag, never absence.
2. **Null denominator (fixed).** The old `100.0 * u / r` divided by `requests_cpu` — which the same probe's prose identifies as *routinely null, and that null is itself the finding*. Unbounded containers therefore produced a garbage utilization figure instead of being counted. They are now flagged in a separate `unbounded` column and never divided.
3. **Non-Running pods (OPEN — do not claim this is handled).** Pending/Failed pods still report their spec `requests_*` through kube-state-metrics while consuming no node capacity, and point-in-time reads do **not** remove a *currently* Pending pod. Filtering to Running-phase pods is the correct fix, but **no pod-phase dimension is present on the verified `dt.kubernetes.container.*` dimension list** (`k8s.namespace.name`, `k8s.workload.name`, `k8s.container.name`) — phase lives on the pod entity's config, not the metric. Until that is resolved live (see [field-notes.md](field-notes.md)), **B20c is the guard**: if `cluster_cpu_requested` exceeds `cluster_cpu_allocatable`, the aggregation is wrong and nothing derived from it may be reported. Investigate before writing a number.

**Readings (unchanged, playground-verified).** `util_vs_request_pct` far below 100 = over-provisioned reservations starving the scheduler of allocatable capacity (verified live: `agent-service` used 1.6 m CPU against a 250 m request = 0.6% — the cluster reserves 150× what it uses). `unbounded == true` = **no request or no limit set** — a noisy-neighbour reliability risk, and a distinct finding from over-reservation, never folded into it. Dimensions verified: `k8s.namespace.name`, `k8s.workload.name`, `k8s.container.name`; **`k8s.cluster.name` (B20c) is unverified on this metric family — confirm with a bare `summarize by:{k8s.cluster.name}` before relying on the per-cluster split**, and fall back to an estate-wide total if it is null.

**`limit 20` is a top-20, and the report must say so.** These queries sort by reservation size and truncate. A truncated table presented as the whole population is the silent-cap failure the family bans elsewhere — carry "top 20 of N by CPU reservation" in the table caption, with N from a `summarize count()` twin, or drop the limit if the workload census is small enough to print whole.

**B21 — Workload reliability (crashloops, OOM kills, throttling) + node/PVC capacity:**

```
timeseries restarts = sum(dt.kubernetes.container.restarts),
           oom = sum(dt.kubernetes.container.oom_kills),
           throttled = sum(dt.kubernetes.container.cpu_throttled),
  from:-24h, by:{k8s.namespace.name, k8s.workload.name}
| fieldsAdd tot_restarts = arraySum(restarts), tot_oom = arraySum(oom), tot_throttled = arraySum(throttled)
| fields k8s.namespace.name, k8s.workload.name, tot_restarts, tot_oom, tot_throttled
| sort tot_oom desc | limit 15
```

`oom_kills > 0` = memory limits set too low (or a leak) — verified live: `my-otel-demo-imageprovider` took **19 OOM-kills / 19 restarts in 2 h**, a textbook crashloop. Cross-read with B20: high OOM on a workload whose `limits_memory` is null or below `memory_working_set` = the direct fix. Node headroom from `dt.kubernetes.node.cpu_allocatable` / `memory_allocatable` / `pods_allocatable`; storage pressure from `dt.kubernetes.persistentvolumeclaim.used` vs `.capacity`. Full metric family (verified present): `dt.kubernetes.container.{cpu_usage,cpu_throttled,memory_working_set,requests_cpu,requests_memory,limits_cpu,limits_memory,oom_kills,restarts}`, `dt.kubernetes.node.{cpu_allocatable,memory_allocatable,pods_allocatable,conditions}`, `dt.kubernetes.{workloads,pods,nodes,containers,events}`, `dt.kubernetes.persistentvolumeclaim.{used,capacity,available}`, `dt.kubernetes.cluster.readyz`. **Gen3-first:** score K8s alerting capability on `builtin:anomaly-detection.kubernetes.*` (A36), never on classic host-level static thresholds; `affected_entity.management_zones` on any K8s object is inventory, not a gap.

### Value plane (RUM / Synthetic / SLO) — verified live on `playground` 2026-07-11

**B22 — RUM session engagement, errors, crash & replay coverage** (deepens B8 from a bare session count):

```
fetch user.sessions, from:-24h
| filter dt.rum.user_type == "real_user"
| summarize sessions = count(),
    replay = countIf(characteristics.has_replay == true),
    err_sessions = countIf(error.count > 0),
    http5xx_sessions = countIf(error.http_5xx_count > 0),
    crashed = countIf(error.has_crash == true),
    bounce = countIf(user_action_count <= 1),
    by:{app = dt.rum.application.type}
```

**`dt.rum.user_type` values are lowercase — `real_user` / `robot` / `synthetic`** (`real_user`/`robot` verified live 2026-07-28; `synthetic` verified live 2026-07-29 — a third population the two-value split silently drops, ~3% of sessions on the confirming tenant, carrying a **null `dt.rum.application.type`**, so any `by:{application.type}` split needs a null bucket): the natural uppercase guess `"REAL_USER"` matches nothing *without erroring*, and the zero-row result reads as "RUM is dark" on a tenant demonstrably serving 1,000+ sessions/day. With 17%+ of sessions on some tenants being `robot`, keep the `real_user` filter (or split by user type — all three values) so robot/synthetic traffic never inflates or dilutes experience-quality ratios. **Error math gates on `error.count > 0` — never `hasError`**: `hasError` and the `error.js_count`/`error.request_count`/`error.custom_count` breakdown fields can be entirely null while `error.count` is fully populated (verified live 2026-07-28 — `countIf(hasError == true)` returned 0 on a tenant where 98%+ of sessions carried errors); a null-driven zero is not evidence of absence (see field-notes.md). Verified session fields (the newer dotted Grail RUM model — the BPN camelCase names all returned null): `duration`, `user_action_count`, `user_interaction_count`, `error.count`, `error.has_crash`, `error.exception_count`, `error.http_4xx_count`, `error.http_5xx_count`, `error.csp_violation_count`, `error.anr_count`, `characteristics.has_replay`, `dt.rum.user_type`, `dt.rum.application.type`, `browser.name`, `os.name`, `frontend.name` (an **array** — `expand` before grouping), `dt.rum.application.entities`. The per-application dimension is `frontend.name`/`dt.rum.application.entities` — `app.short_name`, `application.name` and `dt.rum.application.name` are null (see B8). Derivations: `err_sessions/sessions` = experience-error rate; `replay/sessions` = Session Replay coverage; `bounce/sessions` = single-action bounce share. **Active-engagement, not vanity:** report the *quality* ratios above, never raw session count as the score.

**B23 — Core Web Vitals (the Google-standard experience quality bar):**

```
fetch user.events, from:-24h
| filter isNotNull(web_vitals.largest_contentful_paint)
| summarize views = count(),
    lcp_p75_ms = percentile(web_vitals.largest_contentful_paint, 75) / 1000000.0,
    inp_p75_ms = percentile(web_vitals.interaction_to_next_paint, 75) / 1000000.0,
    cls_p75    = percentile(web_vitals.cumulative_layout_shift, 75),
    ttfb_p75_ms = percentile(web_vitals.time_to_first_byte, 75) / 1000000.0
```

**LCP and INP are in nanoseconds** — divide by 1e6 for ms (verified: LCP p75 776 ms, INP 64 ms, CLS 0.015 on playground). Google bands: LCP ≤ 2500 ms Good / ≤ 4000 NI / else Poor; INP ≤ 200 / ≤ 500; CLS ≤ 0.1 / ≤ 0.25. p75 is the standard percentile. Add `by:{page = page.name}` or `by:{geo = ...}` to localize a Poor score. A tenant with RUM enabled but Poor CWV = instrumented but not acting on the data.

**B24 — Synthetic availability & performance (metric-based — cleaner than the event table):**

```
timeseries avail = avg(dt.synthetic.browser.availability), from:-24h, by:{dt.entity.synthetic_test}
| fieldsAdd a = round(arrayAvg(avail), decimals:2)
| fields dt.entity.synthetic_test, a | sort a asc | limit 15
```

Run the twin over `dt.synthetic.http.availability` for HTTP monitors. Metric family verified: `dt.synthetic.browser.{availability,duration,executions,step.duration}`, `dt.synthetic.http.{availability,duration,...}`. **Use the availability metric, not `dt.synthetic.events` success flags** (the event-level `success`/`event.status` fields returned null; the metric is authoritative). Sort ascending to surface the *failing* monitors first. Cross-read with B8/B13: a monitor at < 100% availability against a service that shows healthy spans (B17) = the outside-in path (DNS/TLS/CDN) is failing where inside-out is fine — the exact gap synthetics exist to catch. TLS-cert-expiry from `dt.synthetic.events` `result.statistics.peer_certificate_expiry_date` is a **candidate — verify live** (event fields were sparse on playground).

**B25 — SLO SLIs & error budget (deepens A3/A37 from a count to a reliability read):**

Availability SLI + error rate straight off the golden service metrics:

```
timeseries total = sum(dt.service.request.count),
           failures = sum(dt.service.request.failure_count),
  from:-24h, interval:1h
| fieldsAdd sli_pct = ((arraySum(total) - arraySum(failures)) / arraySum(total)) * 100
```

Latency SLI: `timeseries p95 = percentile(dt.service.request.response_time, 95), from:-24h`. Metrics verified: `dt.service.request.count`, `dt.service.request.failure_count`, `dt.service.request.response_time`; SLO config schema `builtin:monitoring.slo` (A37). **Coverage is the headline finding:** count SLOs (A3) against the service census (B7) — e.g. "8 SLOs over 260 services" means reliability targets exist for 3% of the estate. Compute the SLI for the top-traffic services that have *no* SLO and show the customer the number they aren't tracking.

### Intelligence & security plane (AppSec / Davis) — verified live on `playground` 2026-07-11

**B26 — Application Security: vulnerability reachability triage (the Davis Security Score, not naive CVE counting):**

```
fetch security.events, from:-24h
| filter event.type == "VULNERABILITY_STATE_REPORT_EVENT"
| dedup {vulnerability.display_id}, sort:{timestamp desc}
| filter event.status == "OPEN"
| summarize open = count(),
    internet_exposed = countIf(vulnerability.davis_assessment.exposure_status == "PUBLIC_NETWORK"),
    exploit_avail = countIf(vulnerability.davis_assessment.exploit_status == "AVAILABLE"),
    func_in_use = countIf(vulnerability.davis_assessment.vulnerable_function_status == "IN_USE"),
    by:{level = vulnerability.davis_assessment.level}
| sort open desc
```

**This is the strongest AppSec finding shape and it is NOT what the BPN notebooks describe** (their `vulnerability.risk.level` / `POSTURE_FINDING` / `ATTACK_EVENT` field names were wrong — verified live). The real risk axis is the **Davis assessment**: `vulnerability.davis_assessment.level` (CRITICAL/HIGH/MEDIUM/LOW/NONE), `.exposure_status` (`PUBLIC_NETWORK` = internet-reachable), `.exploit_status` (`AVAILABLE` = public exploit exists), `.data_assets_status` (reachable sensitive data), `.vulnerable_function_status` (`IN_USE` = the vulnerable code path is actually executed), plus `.score`, `vulnerability.cvss.base_score`, `vulnerability.external_id` (CVE), `vulnerability.mute.status`, `affected_entity.reachable_data_assets.count`. Real `event.type` values: `VULNERABILITY_STATE_REPORT_EVENT`, `VULNERABILITY_FINDING`, `COMPLIANCE_FINDING`, `DETECTION_FINDING`. The interpretation is the intersection, not the total: playground had 16 CRITICAL open, but only **9 with the vulnerable function in use and 3 internet-exposed** — that intersection is the true must-fix list, and reporting "16 criticals" without it is exactly the CVE-noise the customer already drowns in. Dedup on `vulnerability.display_id` (one record per state transition). RAP (Runtime Application Protection) enablement is **enablement-by-presence**: `event.type == "ATTACK_EVENT"` — zero rows against public-facing services = RAP not blocking (playground: 0 in 72 h); corroborate with `dt.billing.runtime_application_protection.usage` / `runtime_vulnerability_analytics.usage` non-zero (B14 family).

**B27 — Security posture: compliance findings by framework (CSPM/KSPM):**

```
fetch security.events, from:-24h
| filter event.type == "COMPLIANCE_FINDING"
| dedup {compliance.rule.id, compliance.result.object.name}, sort:{timestamp desc}
| summarize total = count(), failed = countIf(compliance.result.status.level == "FAILED"),
    by:{standard = compliance.standard.short_name}
| fieldsAdd fail_pct = round(100.0 * failed / total, decimals:1)
| sort failed desc | limit 12
```

Verified fields: `compliance.result.status.level` (FAILED/…), `compliance.rule.severity.level`, `compliance.standard.short_name` (playground carries CIS, DISA STIG, NIST, DORA, PCI DSS, ISO 27001, HIPAA, GDPR, …), `compliance.rule.title`, `compliance.result.object.name`. Report the fail rate per framework the customer is actually regulated under (ask which; don't dump all twelve). Cross-read with A36: KSPM schema empty `[]` while `COMPLIANCE_FINDING` rows exist = CSPM producing findings but Kubernetes-specific posture management not enabled — a named coverage gap.

**B28 — Davis efficacy: signal-to-problem compression + MTTR:**

```
fetch dt.davis.events, from:-24h | summarize signals = count()
| append [ fetch dt.davis.problems, from:-24h | dedup {display_id} | summarize problems = count() ]
| summarize signals = max(signals), problems = max(problems)
| fieldsAdd compression = round(toDouble(signals) / toDouble(problems), decimals:1)
```

Compression = raw signals collapsed per surfaced problem (verified live: 19,026 signals → 128 problems = ~149:1). **This is the number that proves Davis is earning its keep** — a low ratio (few signals per problem) next to high alert volume (B4) means correlation isn't happening and the estate is being paged on raw events. MTTR by category: `fetch dt.davis.problems, from:-30d | filter event.status=="CLOSED" | fieldsAdd dur = (event.end - event.start) | summarize p50 = percentile(dur,50), p95 = percentile(dur,95), by:{event.category}`. Cross-read with the EC pillar's PUI (§D): low compression + low PUI impact-multi = shallow topology, the same root cause surfacing two ways.

### Mobile RUM — entity + crash model (session values **candidate, verify live**)

**B29 — Mobile application coverage & crash rate:**

```
fetch dt.entity.mobile_application | summarize apps = count()
```

```
fetch user.sessions, from:-24h
| filter dt.rum.application.type == "mobile"          // both values confirmed live, lowercase
| summarize sessions = count(),
    crashed = countIf(error.has_crash == true),
    anr = sum(error.anr_count),
    by:{app = app.name}
| fieldsAdd crash_rate_pct = round(100.0 * crashed / sessions, decimals:2)
| sort sessions desc | limit 10
```

Mobile RUM shares the unified `user.sessions`/`user.events` model with web, split by `dt.rum.application.type`. `error.has_crash` and `error.anr_count` (Android "App Not Responding") are the mobile-specific reliability fields (present in the session schema). **`dt.rum.application.type == "mobile"` is verified live** (2026-07-29, a large estate: 2,000+ mobile real-user sessions in 24 h across four mobile frontends — lowercase `"mobile"`, filter works as written). Group mobile sessions by `frontend.name` (`expand` first — see B8), not `app.name`. A tenant with `dt.entity.mobile_application` entities but zero mobile sessions = mobile agent shipped but dark.

### Governance & compliance plane (enrichment ratio / masking) — verified live on `playground` 2026-07-11

**B30 — Enrichment ratio: one ABAC + FinOps readiness number across the foundation entities** (the wayfinder-engine governance KPI):

```
fetch dt.entity.host          | fieldsAdd t = toString(tags) | summarize total = count(), sec = countIf(contains(t,"security_context")), cc = countIf(contains(t,"costcenter")), prod = countIf(contains(t,"cost.product")), full = countIf(contains(t,"security_context") and contains(t,"costcenter") and contains(t,"cost.product"))
| append [ fetch dt.entity.process_group | fieldsAdd t = toString(tags) | summarize total = count(), sec = countIf(contains(t,"security_context")), cc = countIf(contains(t,"costcenter")), prod = countIf(contains(t,"cost.product")), full = countIf(contains(t,"security_context") and contains(t,"costcenter") and contains(t,"cost.product")) ]
| append [ fetch dt.entity.service | fieldsAdd t = toString(tags) | summarize total = count(), sec = countIf(contains(t,"security_context")), cc = countIf(contains(t,"costcenter")), prod = countIf(contains(t,"cost.product")), full = countIf(contains(t,"security_context") and contains(t,"costcenter") and contains(t,"cost.product")) ]
| summarize total = sum(total), sec = sum(sec), cc = sum(cc), prod = sum(prod), full = sum(full)
| fieldsAdd sec_pct = round(100.0*sec/total, decimals:1), cc_pct = round(100.0*cc/total, decimals:1), prod_pct = round(100.0*prod/total, decimals:1), fully_enriched_pct = round(100.0*full/total, decimals:1)
```

**`dt.security_context` / `dt.cost.costcenter` / `dt.cost.product` are NOT dedicated entity fields** (they raise `FIELD_DOES_NOT_EXIST` on `dt.entity.host`) — they live inside the `tags` object, so match them with `toString(tags)` + `contains()`, uniformly across all three entity types. This is the **source-side (entity) enrichment view**, the twin of B5's **record-side** view: records get these fields from pipeline `securityContext`/`costAllocation` stages (A22), entities get them from source tags (deployment config / K8s labels / cloud tags). Verified live: playground = 470 entities, **0% security_context, 0.4% cost tags** → a foundation with nothing for ABAC boundaries, cost chargeback, or ownership routing to key on. **Cross-correlate the two surfaces:** records enriched (B5 high) while entities are not (B30 low) = enrichment happens only in the pipeline, so anything built on entity/Smartscape tags (segments, new-platform filters, source-tag ownership) is blind — name that split. **Gen3-first:** this measures platform-native source tags + `dt.security_context`, never management-zone membership; 0 MZs with high B30 = strong foundation.

**B31 — Masking / PII-sanitization coverage (compliance posture — reads A38's settings):**

Summarize A38's schema reads into a three-layer coverage picture rather than dumping objects:

- **At capture:** count `builtin:attribute-masking` objects with `value.enabled==true` (and their `value.key` list); `builtin:oneagent.side.masking.settings` present.
- **At ingest:** enabled-share of `builtin:logmonitoring.sensitive-data-masking-settings` rules (a built-in rule left `enabled:false` = a shipped guard switched off), count of `builtin:logmonitoring.log-dpp-rules`, and any `mask`/`redact` processors in A22 pipeline `processing` stages.
- **At display / RUM:** `builtin:sessionreplay.web.privacy-preferences` `recordingMaskingPreset` (`ALLOW_ALL` while RUM is live = recording raw user PII), `builtin:preferences.ipaddressmasking` empty (`[]` = IPs stored unmasked), `builtin:rum.mobile.privacy`.

**The finding is the intersection of masking-off and data-present**, so cross-correlate: masking disabled at ingest **while** logs flow (B1/B12), or Session Replay `ALLOW_ALL` **while** RUM sessions are live (B22) = unredacted PII landing in Grail — pair it with B27 compliance findings under the framework the customer is regulated under (GDPR/HIPAA/PCI DSS). Masking configured but the corresponding telemetry dark = a control with nothing to act on (note it, don't score it as a win). Purely config-side — no expensive content scan for PII; report the *control posture* per layer, and recommend the customer confirm with their own regulated-data query.

**B32 — Maintenance-window suppression: measure the effect, don't infer it from the config count (Gen3 surfaces, verified live 2026-07-22):**

The Gen3 maintenance-window model records executions in Grail and enriches affected telemetry, so suppression became measurable rather than inferable from A44's object count:

```
fetch dt.maintenance.windows, from:-24h | summarize executions = count()
```

```
fetch dt.davis.problems, from:-24h
| summarize total = count(), under_maint = countIf(maintenance.is_under_maintenance == true)
```

The same `maintenance.is_under_maintenance` boolean is present on `dt.davis.events`.

**The finding is the cross-read against A44, not either number alone:**

- **A44 > 0 but `under_maint` = 0** → the configured windows are scoping nothing they were meant to catch (or nothing breaches during them). Either way the configuration is not doing what its author believed — a real finding that the config count alone reads as healthy.
- **`under_maint` share materially > 0** → real alerts are being suppressed; check whether A44's `DAILY`/`WEEKLY` recurring windows are the ones absorbing them.
- **A44 = 0 and `under_maint` = 0** → an evidence-backed ✅, far stronger than "no windows configured". Verified live: a tenant with zero windows showed 0 of ~51.9k problems flagged under maintenance.
- **Table readable but `executions` = 0 on a tenant that *does* hold legacy windows** → the legacy windows do not emit to the Gen3 surface. Say that, rather than concluding nothing ran.

Cheap — these are small dedicated tables, so full 24h windows are fine. `NOT_AUTHORIZED_FOR_TABLE` on either read is ⚪, never ⚠️.

**B33 — Extension entity model migration audit (Gen3 §E domain E8 — "are entities Gen3-native?"; validated live 2026-07-28 on a reference tenant):**

Classic (Gen2) extensions write `CUSTOM_DEVICE-*` entities; Gen3 extensions write **typed** Smartscape nodes (`EXT_NETWORK_DEVICE`, `F5_LTM_POOL`, …). When a Gen3 extension binary is installed but its monitoring configurations have not been re-saved, the typed node exists **alongside a populated `id_classic`** pointing at the legacy `CUSTOM_DEVICE` — installed-but-not-cut-over, one level below the config layer. `id_classic` = "the entity ID of the corresponding classic entity" (verified: docs.dynatrace.com → Smartscape on Grail). The audit restricts to extension-sourced nodes via `troubleshooting.upsert_source startsWith "extension:"`, then joins extension metric volume as the footprint/priority weight. **Hard caveat (upgraded 2026-07-29 — the 2026-07-28 "all-null on HOST" version was far too narrow): `troubleshooting.upsert_source` is sparsely populated in general.** Live on a large estate it was populated on **6 of ~118k typed extension nodes** — the filter dropped 99.995% of the estate and reported every major extension as "Migration not started" when every one of those nodes carried a populated `id_classic` (the truth was "Configs not updated": a completely different verdict with a mechanical, low-risk remediation instead of a binary update). **Treat a zero-or-tiny row set after this filter as a probe failure, never a finding.** Never sanity-check the field on HOSTs (null there proves nothing), and never reuse it to scope any host-inclusive audit.

**Mandatory corroboration — run the typed-node census FIRST, and classify from `id_classic`, which does not depend on `upsert_source`:**

```
smartscapeNodes "*"
| fields id, id_classic, type
| filter not(in(type, {"HOST","PROCESS","SERVICE","K8S_POD","K8S_NODE","DISK","CONTAINER",
                       "ONEAGENT","NETWORK_INTERFACE","OS_SERVICE","ACTIVEGATE"}))
| summarize nodes = count(), with_classic = countIf(isNotNull(id_classic)), by:{type}
| fieldsAdd migrated_pct = round(100.0*(nodes - with_classic)/nodes, decimals:1)
| sort nodes desc
```

Before reporting **any** extension as "Migration not started", cross-check its typed-node types in this census and A11's installed list. A B33 row set whose `smartscapeNodes` sum is far below the census total is the `upsert_source` filter failing, not the estate un-migrated. **Second reconcile (2026-07-29): compare each measured extension's node count against the entity census for that extension's types and state the measured share** — live, a one-row B33 read (~120 entities) sat beside an entity census of ~8.7k F5 entities and shipped a "60% migrated" figure computed over 1.4% of the population; separately, a `smartscapeNodes "*"` follow-up filtered to those same types returned **zero rows**, so the `"*"` wildcard's enumeration is itself not complete — when census and wildcard disagree, say which surface each number came from. The attribution query (below) remains useful where `upsert_source` IS populated — as extension attribution, never as the population:

```
smartscapeNodes "*"
| fields id, id_classic, type, upsert_source = troubleshooting.upsert_source
| filter startsWith(toString(upsert_source), "extension:")
| parse upsert_source, "'extension:' LD:extShortName '|'"
| summarize smartscapeNodes = countDistinct(id), classicEntities = countDistinct(id_classic), by: {extShortName}
| join [
    metrics
    | filter startsWith(dt.openpipeline.source, "extension")
    | filter not(startsWith(dt.metrics.source, "custom:"))
    | summarize metricCount = count(), by: {extension = dt.metrics.source}
    | fieldsAdd extShortName = if(contains(extension, ".extension."),
        substring(extension, from: indexOf(extension, ".extension.") + 11),
        else: substring(extension, from: lastIndexOf(extension, ".") + 1))
    | filter isNotNull(extShortName)
    | summarize metricCount = sum(metricCount), by: {extShortName, extension}
  ], kind: outer, on: {left[`extShortName`] == right[`extShortName`]}, prefix: "right."
| fieldsAdd extShortName = coalesce(extShortName, right.extShortName), fullName = right.extension
| fieldsAdd smartscapeNodes = coalesce(smartscapeNodes, 0), classicEntities = coalesce(classicEntities, 0), metricCount = coalesce(right.metricCount, 0)
| fieldsAdd migrationStatus = if(smartscapeNodes == 0 and metricCount == 0, "No data — investigate",
    else: if(smartscapeNodes == 0,               "Migration not started",
    else: if(classicEntities == 0,               "3rd Gen — fully migrated",
    else: if(smartscapeNodes == classicEntities, "Configs not updated",
    else: if(classicEntities > smartscapeNodes,  "Partial — more classic than 3rd gen",
    else:                                        "Partial — more 3rd gen than classic")))))
| fieldsAdd migrationPriority = if(metricCount > 10000, "P1 — Critical volume",
    else: if(metricCount > 1000, "P2 — High volume", else: if(metricCount > 100, "P3 — Medium volume", else: "P4 — Low volume")))
| fields extShortName, fullName, smartscapeNodes, classicEntities, metricCount, migrationStatus, migrationPriority
| sort migrationPriority asc, migrationStatus asc
```

Read per extension: **`smartscapeNodes` > 0 ∧ `classicEntities` = 0 = ✅ fully migrated** (no action) · **`smartscapeNodes` > 0 ∧ `classicEntities` > 0 = 💡 mid-migration** (binary updated, configs still need re-saving; **% migrated = `smartscapeNodes / (smartscapeNodes + classicEntities) × 100`**) · **`smartscapeNodes` = 0 ∧ `metricCount` > 0 = ⚠️ not started** (the extension *binary* needs updating before any config migration) — **but a "not started" verdict is only valid after the census corroboration above confirms the type genuinely has no typed nodes**; typed nodes at scale with populated `id_classic` = 💡 "Configs not updated", never ⚠️. **Headline callout (owner's explicit ask): P1/P2 extensions still `Migration not started` = the highest operational risk** — name them. Caveats (all from the owner, preserve them): `id_classic` is *normal* for core/K8s/service nodes (they have classic counterparts by design — the `extension:` filter is what isolates real migration debt, never drop it); `metricCount` reflects the last ~2 h and is a **relative** volume/footprint indicator, not an absolute entity count; a Smartscape-only extension with `metricCount` = 0 (e.g. WMI) is OneAgent-driven and its priority is understated; a metrics-only extension (`smartscapeNodes` = 0 but real metrics) still needs migration though it creates no entities; `No data — investigate` and Smartscape-only-zero-metric rows are **anomaly flags**, not migrations. Cost: `smartscapeNodes` reads are cheap; the metric join is a 2 h window — well inside guardrails. The join's `metrics` side needs `storage:metrics:read`; if the run identity lacks it, the smartscape side still yields status classification minus volume weighting — degrade gracefully, say so. **Population reconcile — MANDATORY (added 2026-07-29): join this row set against A11's installed-extension list and report the unmeasured remainder explicitly.** B33 only sees extensions that produced typed nodes or metric volume in its window; live, a "20 measured extensions" read sat beside A11's 59 installed — the silent 39-extension gap read as if 20 were the extension estate. The E8 domain line must say "N of M installed extensions measured; the remaining K produced neither typed nodes nor metric volume in the window (not assessed, not proven migrated)".

**B34 — Real-user (non-Dynatrace) Gen3 UX engagement (Gen3 §E domain E5 correction; verified valid live 2026-07-28):**

Gen3 dashboards/notebooks run on **Grail** (every open executes `dt.system.query_executions`); classic dashboards run on the classic metrics API and leave **no** Grail query trace. So *low real-user Grail engagement is itself proof the users are still on classic* — a native dashboard *count* (A8/A9) can be high while nobody uses it (vanity; CLAUDE.md rule 6). **Never grade dashboarding on object count.** This read measures actual human, non-Dynatrace interactive Grail use, and quantifies how much apparent "Gen3 usage" is really **Dynatrace-staff** logins (the engagement to throw out):

```
fetch dt.system.query_executions, from:-30d
| filter isNull(client.internal_service_context) and query_pool != "AUTOMATION"   // human interactive
| filterOut in(user.id, {"UNKNOWN", "system"})
| fieldsAdd isDynatraceStaff = endsWith(lower(coalesce(user.email, "")), "@dynatrace.com")
| summarize queries = count(),
            activeDays = countDistinct(toString(bin(timestamp, 1d))),
            by: {user.id, user.email, isDynatraceStaff}
```

**PII — redact on save:** this query returns `user.email` in cleartext for every active user (field
finding, 2026-08-05: 64-67 distinct real addresses per run on a reference tenant, non-prod — the same
operational gap A5 had, the rule lived nowhere so nothing failed closed). The address carries no
analytical role here — engagement math keys on `user.id` and `activeDays`, and the Dynatrace-staff
exclusion keys on the `isDynatraceStaff` boolean already derived at query time — so redaction on save
costs nothing. Pipe through [`redact.py`](../.dt-eval-common/redact.py)
(`dtctl query '<the query above>' -o json \| python3 redact.py - --probe-id B34 > runs/$RUN/B34.json`);
`user.id`/`activeDays`/`queries`/`isDynatraceStaff` are untouched. Per
[security-sensitive-data-policy.md](security-sensitive-data-policy.md).
**On a large tenant this read SPILLS, and the pipe above only started covering that on 2026-08-26.**
dtctl writes a big result to `~/Library/Caches/dtctl/results/<tenantId>/q-<hash>.jsonl` and returns a
`result-file` envelope; before the fix, `redact.py` redacted the envelope's column sample and left
every row in cleartext outside `runs/` (live: ~500 and ~1,000 distinct addresses on two tenants).
The command is unchanged — `redact.py` now follows the pointer — but two things are on the operator:
delete or `--scrub-cache` the cache copy afterwards, and **never treat the spilled row count as a
total.** One tenant's file stopped at exactly 1,000 rows; the real figures (1,051 active users, 216
sustained) came from the aggregate form, which is the shape to use for any number that reaches a
report:
```
… | summarize activeDays = countDistinct(toString(bin(timestamp, 1d))), by:{user.id, isDynatraceStaff}
  | summarize users = count(), staff = countIf(isDynatraceStaff == true),
              sustained_real = countIf(activeDays >= 10 and isDynatraceStaff == false)
```

Read: **exclude `isDynatraceStaff == true` rows from every engagement/adoption number** — they are Dynatrace employees (CSM/support/consulting) working *in* the tenant, not customer adoption. Then over the remaining (real) users: distinct real users and the sustained subset (`activeDays >= 10`) are the true Gen3-UX engagement; **near-zero real-user Grail engagement + native dashboards present ⇒ E5 = ⚠️/💡, never ✅** (this is the fix for the over-claim that read native presence as leverage). Also **name the Dynatrace-staff share as its own finding** ("N of the M apparently-active users were Dynatrace logins" — the reason a naive count over-reported adoption). Notes: `@dynatrace.com` on `user.email` is a heuristic that catches DT-employee accounts in the tenant — the operator may extend the exclusion list (partner/MSP domains); it composes with the existing machine-actor (`internal_service_context`) and `AUTOMATION` fences (see [effective-consumption.md](effective-consumption.md) QEI). Dashboard/notebook/app-specific attribution uses `client.source` / `client.client_context` where resolvable (verify-live). Cost: `query_executions` reads are cheap (small dedicated table).

**B35 — Gen3 SLO enumeration (Gen3 §E domain E9 — "did SLOs get upgraded?"; native count is verify-live):**

Classic SLOs use a metric-expression + entity-selector SLI; Gen3 SLOs express the SLI as a **single Grail DQL query** (verified: docs.dynatrace.com → Upgrade Classic SLOs). **A3 and A37 are disjoint populations, not a drill-down of each other** (probes-config.md A3/A37; live 2026-07-29: A3 = 0 while A37 held 278 tuned classic SLOs on the same tenant). **Both counts are exact:** `dtctl get slos` (A3) is the platform-native count and `dtctl get settings --schema builtin:monitoring.slo` (A37) is the classic count. **Gen3 confirmation is verify-live** — beyond A3, the new SLO app has no documented settings-schema / Grail table / `dtctl` resource; resolve the reachable surface at run time (try `dtctl get documents -o json` type-filtered for SLO documents · the SLO Service Public API · a `metrics | filter startsWith(metric.key, "dt.slo")`-style presence tell where `storage:metrics:read` is granted) to corroborate A3's count. Read per E9: **classic SLOs present ∧ 0 Gen3 = ⚠️ not started · both = 💡 dual-running (name the double-maintenance cost) · only Gen3 (0 classic) = ✅.** If no Gen3 enumeration surface is reachable, grade on classic residue + confirmed Gen3 *presence* and **state that the precise native count is verify-live — never fabricate one** (same discipline as B34's classic-dashboard footnote). Path forward = the docs "Upgrade Classic SLOs" runbook (metric→Grail Upgrading-Metrics table; entity-selector→DQL). Footprint/adoption weight for E9 = SLOs actually evaluated/consumed (burn-rate-wired, B25) — 0 SLOs ⇒ ~0 weight, so an SLO-light tenant is not dragged by E9.

**B36 — ActiveGate fleet version drift via Smartscape (DQL-native; the surface that lifted the §C hold, 2026-07-28 — verified live on `playground`, dtctl 0.35.0):**

```
smartscapeNodes ACTIVEGATE
| fields name, full = dt.active_gate.version, group = dt.active_gate.group.name, zone = dt.network_zone.id
| parse full, "INT PUNCT INT: version PUNCT INT"
| summarize ags = count(), gates = collectDistinct(name), by:{version}
| sort version desc
```

The type name is **`ACTIVEGATE`** — `ACTIVE_GATE` (underscore) returns 0 rows, not an error (verified). Per node the surface also carries `modules[]`, `os.*`, `is_containerized`, `is_fips`, `startup_time`, `lifetime`, addresses — richer drill-down when a straggler needs naming. Grade on **drift within the fleet, never an external "latest"** (§C rule, same as B13): all AGs on one version = ✅; a minority cohort 1–2 sprint versions behind = 💡 (name the stragglers from `gates`); any AG ≥3 sprint versions behind the fleet's newest, or a fleet fragmented across 3+ versions = ⚠️. Cross-reads: **A25** — drift alongside auto-update disabled/no update windows = the policy gap that produced it (drift with auto-update *on* = update windows/groups worth checking); **B15** — an AG in the `dt.sfm.active_gate.*` metrics but absent here (or vice versa) = the two surfaces disagree on this tenant. **Resolution rule for the reported COUNT:** the metric-side (B15) count is the **fleet size** (self-monitoring sees gates that have not yet materialized in Smartscape), and the Smartscape (B36) count is the **version-assessed subset** — report both readings with those labels ("16 ActiveGates reporting, 11 version-assessed via Smartscape"), never silently pick one; the discrepancy detail belongs in the appendix, not the body. Two cautions: **0 rows = "no ActiveGates visible in Smartscape on this tenant", never proven absence** — if B15 metrics show a fleet while this returns 0, the Smartscape surface isn't populated there yet; grade fleet/health from B15 + A25 and state that the version read was not available. And **`modules[]` containing `AUTOUPDATE` is module presence, NOT auto-update status** — no query surface exposes update *status*; A25 remains the update-posture signal.

**B37 — Management-zone population census (collected only for the `/dt-eval-mz2seg` Migration Plan; the E2 population read promoted to a cached probe):**

```
fetch dt.entity.host           | fields mz = managementZones | expand mz | summarize Hosts = count(), by:{mz}
| append [ fetch dt.entity.process_group | fields mz = managementZones | expand mz | summarize PGs = count(), by:{mz} ]
| append [ fetch dt.entity.service       | fields mz = managementZones | expand mz | summarize Services = count(), by:{mz} ]
| summarize Hosts = max(Hosts), PGs = max(PGs), Services = max(Services), by:{mz}
```

Definitions (A17) say what a zone *should* match; only this census says what it *does* — the retire-now vs build-then-retire disposition split in [mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md) depends on it. **`managementZones` is an array — `expand` it or populated zones silently read as empty** (grouping falls on the membership *combination*, one row per triple instead of per zone); a null column after `append` means "none of that entity type", never "not measured" (both in field-notes.md). Entity-table reads only — no log/span scan, cost-guardrail-trivial. A zone with no census row *and* no consumer (A13/A14/A15 joins) goes straight to the retire list; zones absent here but named by a consumer stay blocked until the consumer is rehomed. Verification twin **V38**; offline stages of the same plan (dimension reduction, segment classification, consumer census) are a recipe over A17/A6/A13–A16 — see the spec and `analyze_mz2seg.py` in the `dt-eval-mz2seg` skill dir.

**B38 — Source-tag propagation census (collected only for the `/dt-eval-mz2seg` plan; Stage 1b's provenance evidence — verified live 2026-07-29):**

```
smartscapeNodes HOST
| fieldsAdd t = toString(tags)
| summarize hosts = count(), <key> = countIf(contains(t, "<key>")) [, … one column per candidate key]
```

**No key-enumeration function exists on the `smartscapeNodes` surface** (`recordKeys` and `fieldsNames` both return UNKNOWN_FUNCTION — verified live), so this is a **candidate-key census**: one `countIf` column per `tag:` dimension found in the plan's Stage 1. What it decides: **segments, IAM policies, and dashboards key on primary Grail tags** (source-set — host tags/`DT_TAGS`, K8s labels, cloud tags, OpenPipeline enrichment; visible in Smartscape `tags`), while **classic auto-tag rules (A16) compute tags that exist only on classic entities and retire with them** — B5's `dt.entity.* | expand tags` surface includes those computed tags, so **presence in B5 is NOT evidence a tag is source-set**; only this Smartscape read is. A **token presence (< 1% of the fleet) is not propagation** — a handful of pilot hosts must not grade as a usable foundation. Field-validated decisive on a reference estate: the estate-management tags behind the biggest zones were ~93%-fleet propagated (segment-ready immediately), while the dominant app-ID tag — 80+ zones and every bridge segment keyed on it — showed on six hosts of tens of thousands: the plan's single biggest tagging-at-source work item. Verification twin **V39**.

**B39 — Notification delivery health (dt self-monitoring — the platform's own delivery counters; verified live 2026-07-29 on two tenants):**

```
timeseries n = sum(dt.sfm.server.notifications.problem_notifications),
  by: { notification.type, notification.display_name, notification.delivery_status, http_status_code },
  from:-7d
| fieldsAdd total = arraySum(n)
| fields notification.type, notification.display_name, notification.delivery_status, http_status_code, total
| sort total desc | limit 20
```

**This is the authoritative alert-delivery read — prefer it over inferring delivery health from A5's execution sample or A4b's event counts alone** (both remain the workflow-side reads; this is the classic-notification side, and the two together cover the whole delivery estate). **But this read alone can never produce a delivery ✅ — it is volume-sorted and truncated, so failing lanes fall off the list whenever successful lanes out-volume them. B39b below is MANDATORY.** Dimensions verified live: `notification.type`, `notification.display_name`, `notification.delivery_status` (`Success` / `Invalid HTTP status code` / `Could not connect…` / `Email blocked by bounce list` / `Email sent with warning. Some recipients were on the bounce list`), `http_status_code` (string; null on Email), plus `alerting_profile.display_name` and `problem.status` for the profile-side split. A companion `…problem_notifications_duration` metric exists (delivery latency). **Zero rows on a tenant with configured notifications (A15) + problems (B4) = nothing is being delivered at all** — a stronger form of the A4b finding. Cost: trivial (sfm metrics, small dedicated bucket). A 403 → ⚪ naming `storage:metrics:read`.

**B39b — Delivery FAILURES (mandatory companion to B39; a hard gate, not a drill-down):**

```
timeseries n = sum(dt.sfm.server.notifications.problem_notifications),
  by: { notification.type, notification.display_name, notification.delivery_status, http_status_code },
  from:-7d, filter: { NOT matchesValue(notification.delivery_status, "Success") }
| fieldsAdd total = arraySum(n)
| fields notification.type, notification.display_name, notification.delivery_status, http_status_code, total
| sort total desc | limit 15
```

**Run this EVERY time B39 runs — same status as A4b's configured-vs-executed gate** (added 2026-07-30 after the 2026-07-29 seven-tenant sweep: on **3 of 7 tenants** B39's top-20 read "all Success" while this filtered read found real, ongoing failures — bounce-list-blocked email lanes on two tenants and an automation hook returning server errors on a third. The failures were invisible purely because successful lanes out-volumed them). Rules:

- **"Top-20 all Success" is NEVER a delivery ✅ on its own.** A ✅ requires B39b returning zero rows. If B39b was not run, delivery is **not assessed** — say so rather than reporting healthy.
- **Any sustained non-`Success` lane = ⚠️, with the integration named and the failure class in plain language.** A stuck `401`/`403` is a broken credential, not a transient; a constant `400` is a payload/endpoint contract mismatch; `Email blocked by bounce list` means the subscribed humans receive nothing while the console still shows them configured. Live scale for calibration: 24,174 × `401` on one production ServiceNow integration and 6,228 × `400` on one custom integration, both over 7 days, both invisible to execution sampling (which could only say "most recent runs errored").
- **Isolated failures are normal** — two `Could not connect` rows in 60,000 attempts is network noise, not a finding. Grade on *sustained* share per named lane, not on the presence of any failure row.
- Cost: trivial (same metric, one extra filter).

**B40 — Metric ingest health: rejections + cardinality pressure (verified live 2026-07-29):**

```
timeseries r = sum(dt.sfm.server.metrics.rejections),
  by: { metric_key, rejectionreason }, from:-7d
| fieldsAdd total = arraySum(r)
| fields metric_key, rejectionreason, total
| sort total desc | limit 15
```

**Sustained rejections = silent metric data loss on named keys** — the ingest-side twin of B15's dropped-messages check. Dimensions verified live: `metric_key`, `rejectionreason` (also `description`). Cardinality overflow (`"Dimension limit reached for metric"`, ~886k rejections/7d on one metric family) is the *dramatic* reason, but not the common one — see the reason split below. Rejected `telegraf.*`/custom keys during a metric migration = the parallel-collector path losing data.

**B40b — the detector intersection (MANDATORY companion, not a prose cross-read).** Rejections matter most when a *detector is watching the perforated key*. Intersect B40's rejected `metric_key`s with the metric keys D5's input-liveness pass extracts from `timeseries` detectors, in local code — never by eye:

```python
starved = sorted(set(rejected_keys) & set(detector_metric_keys))
```

Emit a named finding with the intersection count and the affected detector titles. **Sequencing rule — fix ingest BEFORE re-tuning detectors:** a threshold calibrated against a holed series is calibrated against the holes, so tuning done first has to be redone once ingest is repaired. This is a hard constraint on the `/dt-eval-prob` change plan, whose sequencing otherwise assumes the series it tunes against is complete — when the intersection is non-empty, ingest repair moves ahead of every threshold change in that plan. Live shape: **521,452 rejected datapoints/week across 13 `log.infra.*` keys** on a tenant whose detection layer was ~958 detectors built on log-derived metrics — every one of them evaluating a perforated signal, which no config read can show.

**Two remediation shapes, by `rejectionreason` — name the one that applies:**

| Reason | What it means | Remediation |
|---|---|---|
| **Stale timestamps** (`Timestamp too old`) — **the common case**: 5 of 7 tenants in one sweep, and the only reason on every one of them | The publisher is stamping *logical/batch* time rather than ingest time, or a misparsed log date is producing a systematically old timestamp | Correct the publisher to stamp ingest time. For genuinely historical values, publish as a **business event** (arbitrary timestamps accepted) rather than a metric — metrics enforce an ingest window and will keep rejecting |
| **Dimension overflow** (`Dimension limit reached for metric`) — the rarer case, seen on 1 of 7 | A dimension is exploding the series count past the per-metric limit | Drop the exploding dimension, or bucket it to a bounded set, at the publisher |

Do not lead a finding with cardinality overflow by default — read `rejectionreason` and report what the tenant actually shows. (Both shapes recorded in field-notes so the mapping is not re-derived per run.) **The dimension-usage/cardinality quota family is verify-live per tenant**: `dt.sfm.server.metrics.{custom_metrics,custom_dimensions,builtin_dimensions,custom_metrics_usage,custom_dimensions_usage,builtin_dimensions_usage,metric_dimensions_usage,high_cardinality_dimensions}` was **absent from the Grail metric enumeration on both verification tenants** (2026-07-29) while the classic selectors (`dsfm:server.metrics.…`, filter `not(existskey("dt.tenant.uuid"))`) exist for the same data — if the Grail keys are absent on a tenant, say "quota proximity not readable via Grail on this tenant" rather than concluding health, and note the classic surface exists (field-notes). Ingest-source color: `dt.sfm.server.metrics.ingest.external_datapoints(_by_source_address)` (verified present) sizes the external-API metric ingest. Cost: trivial.

**B41 — Ingest throughput vs capture rate (service-call self-monitoring; verified live 2026-07-29):**

```
timeseries received = sum(dt.sfm.server.service_calls.received),
           processed = sum(dt.sfm.server.service_calls.processed),
  from:-24h, interval:1h
| fieldsAdd r = arraySum(received), p = arraySum(processed)
| fieldsAdd capture_pct = if(r >= 10000, round(100.0 * p / r, decimals:2))
| fields r, p, capture_pct
```

**MINIMUM-VOLUME GUARD — `capture_pct` is only meaningful at scale; below 10,000 calls in the window report "not measurable on this tenant", never a percentage** (added 2026-07-30; the `if(r >= 10000, …)` above returns null under the floor so the guard is in the query, not just the prose). Live failure this prevents: a production tenant whose `service_calls` keys **exist but return a single token datapoint** computed `capture_pct = 100` from `r=1, p=1` — a meaningless 100% that is indistinguishable from a genuinely healthy 542M-call read, and would have shipped as a ✅. **Generalize the rule to every sfm-derived ratio** (capture rate, any dropped/rejected share, any per-gate percentage): a ratio computed over a trivial denominator is not a measurement — state the denominator alongside any percentage, and where the denominator is below the floor, report the raw counts and "not measurable" instead.

`processed/received` sustained below ~98% (**at a credible denominator**) = the platform is not keeping up with what agents send (adaptive capture / throttling engaged) — coverage findings built on span or service data are then floors, and the gap belongs in the method note. Verified live at real scale: 100% at 542M, 3.42B, 106M, 100M and 76.8M calls/24h across five tenants. `dt.sfm.server.service_calls.persisted(.data_size)` (verified present) gives the persisted-volume side; **the tile pairing it against `dt.sfm.billing.fullstack.maximum_included_trace_volume_per_minute` is verify-live** — that billing key was absent on every verification tenant; when absent, report throughput without the limit ratio rather than fabricating a ceiling. Cost: trivial. Cross-read: capture < 100% alongside B17's span totals = size the undercount; alongside B15 AG drops = locate the loss (server-side vs gate-side).

## Upgrade-readiness probes B42–B46 (added 2026-07-31; all five verified live)

**Provenance.** These five reproduce reads from the platform's own **Check your upgrade readiness**
dashboard (`dynatrace.upgrade.readiness.migration-status`, app `dynatrace.upgrade.readiness`,
`isPrivate: false` — a ready-made public dashboard present in the customer's own tenant). That makes
each one **customer-reproducible against a Dynatrace-authored surface**, which is why they are citable
in a client deliverable (see [classic-to-native-map.md](classic-to-native-map.md) for the two lookup
tables from the same dashboard, and the report-citation rule in [verification-queries.md](verification-queries.md)).
Every query below was run read-only during the 2026-07-31 build; the live shapes quoted are
de-identified per CLAUDE.md.

**B42 — Management-zone query-activity census (the surface `/dt-eval-mz2seg` recorded as nonexistent; verified live on `playground` 2026-07-31):**

```
timeseries queries = sum(dt.sfm.server.management_zones.queries_counter, default:0),
  by: { dt.management_zone.id, dt.management_zone.name }, from:-7d
| fieldsAdd total = arraySum(queries)
| fields dt.management_zone.id, dt.management_zone.name, total
| sort total desc
```

**This closes a documented gap, and the closure is the point.** The mz2seg plan spec and SKILL.md
both stated *"query activity has no probe surface; never phrase as measured usage"* and downgraded
the `unused` zone verdict to an explicit proxy. This metric — the platform's own, described by the
tenant as *"Tracks which Management Zones are queried and how often"* — **is** that surface. With
B42 present, `unused` becomes a **measurement** and the usage-proxy caveat is retired for zones the
census covers (see [mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md) Stage 6).

**Three rules, because a zero here is easy to over-read:**

- **Absence from the census is NOT proof a zone is unqueried** — it is "no queries observed in the
  window". Pair every zero with B37 population and the A13–A16/A19 consumer census before any
  retire disposition, exactly as before; B42 *strengthens* the `unused` verdict, it does not replace
  the consumer read. A zone with no consumers **and** no query activity **and** no population is the
  only unambiguous retire-now row.
- **State the window with the number.** Self-monitoring metric retention is shorter than config
  history; a 7-day zero on a zone driving a quarterly compliance review is not an unused zone.
  Report "no query activity in the last 7 days", never "unused".
- **A dashboard or API caller querying through a zone counts here** — that is the value: it catches
  consumers the config-side census structurally cannot see (a classic dashboard filter, an external
  integration passing a zone parameter).

Cost: trivial (sfm metric). Live shape: on the Dynatrace `playground` tenant a single zone returned
~100 queries/24h with the rest of the estate silent. Verification twin **V43**. A 403 → ⚪ naming
`storage:metrics:read`.

**B43 — Deprecated classic API & settings usage BY CALLER (the integration break list; verified live 2026-07-31):**

```
fetch dt.system.events, from:-24h
| filter event.kind == "AUDIT_EVENT"
| filter event.provider == "CLASSIC_API"
    or (event.provider == "API_GATEWAY" and startsWith(resource, "/platform/classic/"))
| fieldsAdd resource = replaceString(resource, "/platform/classic/environment-api", "/api")
| fieldsAdd resource = replaceString(resource, "/platform/classic/config-api", "/api/config")
| fieldsAdd resource = replacePattern(resource, "'/e/'[a-z]{3}[0-9]{5}'/'", "/")
| fieldsAdd resource = replacePattern(resource, "UUIDSTRING", "{uuid}")
| fieldsAdd resource = replacePattern(resource, "SMARTSCAPEID", "{entity}")
| summarize calls = count(), by: { resource, authentication.token, dt.app.id }
| sort calls desc
| limit 50
```

**Do NOT alias `authentication.token` in the query.** `redact.py` matches sensitive keys on the
**whole** key name, so the field must reach the saved JSON as `authentication.token` — aliasing it
to `caller` produces a column the redactor does not recognize and writes a cleartext token
identifier into the run directory. (The value-shape rule `TOKEN_ID_RE` is a second net, not a
licence to rename the column.)

**🔴 MANDATORY REDACTION — this probe returns credential-shaped strings.** `authentication.token`
comes back as a **cleartext token public identifier** (`dt0c01.` + 24 chars). It is the public ID,
not the secret half, so it is not a usable credential — but it is a token *identifier*, it will trip
the C7 cleartext-credential scan, and it must never reach a deliverable or a committed doc. Redact
to `***REDACTED_TOKEN_ID***` on save and carry a stable per-token alias (`Integration A`, `Integration B`)
for the analysis. Registered in [security-sensitive-data-policy.md](security-sensitive-data-policy.md).
The **tenant ID also appears inside `resource`** on some paths (`/e/<tenantid>/api/v2/tags`) — the
`replacePattern` above strips it; keep that line, a tenant ID in a report is a rule-5 leak.

**THE CALIBRATION THAT MAKES THIS PROBE HONEST — filter to customer-authored callers.** Raw
`AUDIT_EVENT`/`API_GATEWAY` volume is dominated by **Dynatrace's own first-party apps** calling the
classic passthrough (`dynatrace.appshell`, `dynatrace.clouds`, `dynatrace.infraops`,
`dynatrace.synthetic`, and a large null-`dt.app.id` bucket). **That is Dynatrace's migration debt,
not the customer's, and reporting it as theirs is a fabricated finding.** For the E10 domain and any
customer-facing count, restrict the gateway side to customer-authored artifacts:

```
| filter event.provider == "CLASSIC_API"
    or (event.provider == "API_GATEWAY" and startsWith(resource, "/platform/classic/")
        and (in(dt.app.id, {"dynatrace.dashboards","dynatrace.notebooks",
                            "dynatrace.davis.anomalydetection","dynatrace.automations"})
             or isNotNull(details.dt.automation_engine.workflow.id)))
```

`event.provider == "CLASSIC_API"` (direct token-authenticated calls) is customer traffic by
construction and needs no such filter — `user.id` reads `UNKNOWN` on those rows, so **the token is
the only attribution available**, which is precisely why the redaction rule above matters.

**Interpretation — the BLOCK share is the finding, not the call count.** Classify every returned
`resource` against Table 2 of [classic-to-native-map.md](classic-to-native-map.md) in priority order
(lowest priority number wins — it is a longest-match ruleset, never a grep). Then per caller:
**BLOCK share = 0** → not migration debt, do not report it as such; **BLOCK share > 0** → a named
integration that stops working on upgrade day, and the report says which endpoints and what replaces
them. This converts "classic APIs are going away" into a per-integration break list, which is the
single question customers actually ask.

Live shape (de-identified): a large estate showed **millions of classic-API audit events per day**,
with one token driving ~460k calls in two hours against a single deprecated tagging endpoint —
invisible to every config-side probe in the catalog. Cost: `dt.system.events` is a small dedicated
bucket; still scope the window (`from:-24h`, `-2h` on the largest estates) and keep the `limit`.
Verification twin **V44**.

**B44 — Classic entity-model DQL usage BY DOCUMENT (the migration worklist; verified live 2026-07-31):**

```
fetch dt.system.query_executions, from:-24h
| filter status == "SUCCEEDED"
| filter in(client.application_context, "dynatrace.dashboards", "dynatrace.automations",
            "dynatrace.notebooks", "dynatrace.site.reliability.guardian")
    or (client.application_context == "dynatrace.segments.management"
        and contains(client.client_context, "variables-data"))
    or contains(client.source, "anomaly_detection")
| filter in("CLASSIC_ENTITY_MIGRATION_ADVISED", flags)
    or contains(query_string, "entityName(") or contains(query_string, "entityAttr(")
    or contains(query_string, "classicEntitySelector") or contains(query_string, "dt.entity.")
| parse client.source, "LD '/ui/dashboard/' [a-z0-9-]+:dashboard_id"
| parse client.source, "LD '/ui/notebook/' [a-z0-9-]+:notebook_id"
| parse client.source, "LD '/segments/segment/' [a-zA-Z0-9_-]+:segment_id"
| fieldsAdd document_id = coalesce(dashboard_id, notebook_id, client.workflow_context, segment_id)
| filter isNotNull(document_id)
| summarize executions = count(), by: { document_id, client.application_context }
| sort executions desc
| limit 50
```

**`flags` is a platform-emitted migration advisory we had never read.** The query engine itself tags
executions `CLASSIC_ENTITY_MIGRATION_ADVISED` — this is Dynatrace telling you which queries need
rewriting, not our inference. Verified live: `flags` returns as an array
(`["CLASSIC_ENTITY_MIGRATION_ADVISED"]` or null), so `in(…, flags)` is the correct test.

**🔴 THE UNFILTERED FLAG COUNT IS NOT THE FINDING — this is the calibration that keeps B44 from
lying.** On a reference tenant, **~83% of all successful query executions carried the flag** — an
alarming number that means almost nothing, because **~92% of those had a null
`client.application_context`** and most of the attributable remainder came from **Dynatrace's own
first-party apps** (`dynatrace.kubernetes`, `dynatrace.infraops`, `dynatrace.extensions.manager`,
`dynatrace.appshell`) issuing classic-entity DQL internally. The customer-owned debt was a small
fraction of the headline. **Never report the raw flag count or its percentage.** The authoring-surface
filter plus `isNotNull(document_id)` above is mandatory, and the number that goes in the report is
**how many customer-authored documents need rewriting**, named — a worklist, not a percentage.

Feeds the existing **`dt-migration` skill** directly (classic entity DQL → Smartscape/dimension
filters): each returned `document_id` is one migration task with a resolvable deep link. Cost:
trivial. Verification twin **V45**.

**B45 — OpenPipeline throughput (CORRECTED 2026-07-31 — read the correction before using it):**

```
timeseries inn  = sum(dt.sfm.openpipeline.ingest_sources_in.records, default:0),
           out  = sum(dt.sfm.openpipeline.pipelines_out.records, default:0),
           rout = sum(dt.sfm.openpipeline.routing.records, default:0), from:-7d
| fieldsAdd i = arraySum(inn), o = arraySum(out), r = arraySum(rout)
| fieldsAdd pct_through_pipelines = if(i > 0, round(100.0 * o / i, decimals:1))
| fields i, o, r, pct_through_pipelines
```

Per-source volume (the part that is genuinely useful):

```
timeseries records = sum(dt.sfm.openpipeline.routing.records, default:0),
  by: { dt.openpipeline.source }, from:-7d
| fieldsAdd total = arraySum(records)
| fields dt.openpipeline.source, total
| sort total desc | limit 25
```

**🔴 CORRECTION — this probe shipped earlier the same day claiming to grade E4 on "OpenPipeline vs
classic volume share". It cannot, and the claim is withdrawn.** Two facts, both established by
running it on two production tenants:

1. **There is no pipeline dimension.** `dt.openpipeline.pipeline`, `pipeline`,
   `dt.openpipeline.pipeline.id`, `dt.openpipeline.route`, `dt.openpipeline.configuration`,
   `dt.openpipeline.endpoint` and `record_type` **all return a single null bucket** — DQL returns
   null for an unknown dimension rather than erroring (the same trap as `ACTIVE_GATE` vs
   `ACTIVEGATE` in B36), so the original grouping looked like it worked and silently grouped nothing.
   Only **`dt.openpipeline.source`** is populated.
2. **`pct_through_pipelines` is ~100% on any Gen3 tenant, so it is not an adoption measure.** Live:
   **100.0%** and **99.8%** on two tenants whose *configured* OpenPipeline estate was one routing
   entry and two-to-three pipelines. The platform's **default** pipeline counts in `pipelines_out`,
   so the ratio says "the OpenPipeline layer is live and carrying the traffic" — architecturally
   true on every platform tenant — not "this customer has migrated their processing."

**What B45 IS good for:** the **scale and shape of ingest** (per-source volume: which lanes carry the
estate's data, at what magnitude) and a liveness check on the OpenPipeline layer. Treat a
`pct_through_pipelines` materially **below** 100% as the signal worth chasing — it means records are
being ingested that the pipeline layer is not accounting for.

**E4 is therefore graded on the CONFIG side (A21 routing entries incl. the catch-all, A22 pipelines
incl. groups, A29 classic-pipelines-translation), with B45 as volume context only** — the pre-2026-07-31
rule, deliberately restored. A null-`dt.openpipeline.source` bucket is normal residual attribution and
often large; report the named lanes and say a residual bucket exists. Cost: trivial. Verification twin
**V46**.

**B46 — Classic app & classic-dashboard usage BY USER (the E5/E7 upgrade from presence to engagement; verified live 2026-07-31):**

```
fetch dt.system.events, from:-7d
| filter event.provider == "CLASSIC_APPS" and event.type == "app.opened"
| filter isNotNull(dt.app.id)
| summarize opens = count(), users = countDistinct(user.id), by: { dt.app.id }
| sort opens desc
```

Classic-dashboard drill-down (which specific classic dashboards are still opened):

```
fetch dt.system.events, from:-7d
| filter event.provider == "CLASSIC_APPS" and event.type == "app.opened"
| filter dt.app.id == "dynatrace.classic.dashboards" and isNotNull(details.page_dashboard_id)
| filterOut in(details.page_dashboard_id, "global", "default")
| summarize opens = count(), users = countDistinct(user.id),
            names = arrayRemoveNulls(collectDistinct(details.page_dashboard_name)),
            by: { details.page_dashboard_id }
| fieldsAdd label = coalesce(names[0], details.page_dashboard_id)
| fields details.page_dashboard_id, label, opens, users
| sort users desc, opens desc | limit 20
```

**`details.page_dashboard_name` exists — take it when it is there, expect it not to be.** The field
is real and the platform's own upgrade-readiness dashboard reads it, but it was **populated on 0 of
15,531 classic-dashboard open events across two tenants over 30 days** (verified 2026-07-31). That is
why the vendor's own tile coalesces to the ID, and why this query does too — `label` degrades to the
ID rather than the row disappearing. Where the field *is* populated, the estate gets named for free
with no classic-API call.

**Two idiom traps, both verified:** `collectDistinct` **keeps nulls** (`["x","y",null]`), so
`names[0]` can be null — wrap it in `arrayRemoveNulls`. And `takeFirst` after a `sort timestamp desc`
returns the *newest* value, which is null whenever the most recent event lacks the name; that is the
vendor's construction and it is strictly weaker than collecting non-nulls across the window.

**Note the kind: these rows are `event.kind == "AUDIT_EVENT"` with `event.provider == "CLASSIC_APPS"`**
— filter on the provider and `event.type`, not on a `CLASSIC_TRACKING_EVENT` kind (verified live on
three tenants; the provider is the reliable discriminator).

**This replaces E5's verify-live-only classic-dashboard footnote with a measured read.** The prior
design could only *assert* Gen3 dashboard engagement from B34 and footnote the classic side as
unmeasurable via the classic config API. B46 measures the classic side directly and in the same
currency as B34 — **opens by distinct real users** — so E5 becomes a genuine both-sides comparison
rather than one measured side and one caveat. Join `dt.app.id` against Table 1 of
[classic-to-native-map.md](classic-to-native-map.md) to name each successor app; rows whose successor
is `— none yet` are ⚪ and belong in the appendix, never graded as a gap.

**Apply the B34 real-user discipline here too** — exclude Dynatrace-staff actors before grading, or
a handful of internal sessions reads as customer engagement. Live shape: classic-app opens present on
every tenant checked, ranging from a few dozen to a few thousand per day, concentrated in a small
number of named users — which is the useful finding (**a short, nameable enablement list**, not a
tenant-wide re-training programme). Cost: trivial. Verification twin **V47**.

**B47 — IAM readiness snapshot: classic RBAC roles vs default policies (Gen3 §E domain E11; verified live 2026-07-31):**

```
fetch dt.system.events, from:-7d
| filter event.kind == "PLATFORM_PERMISSION_READINESS_EVENT"
| sort timestamp desc
| limit 1
| fieldsAdd classic_groups = arraySize(legacy_permissions_groups),
            policy_groups  = arraySize(default_policies_groups)
| fields timestamp, classic_groups, policy_groups
```

Group-level drill-down (which groups are still on classic roles):

```
fetch dt.system.events, from:-7d
| filter event.kind == "PLATFORM_PERMISSION_READINESS_EVENT"
| sort timestamp desc | limit 1
| fields grp = legacy_permissions_groups
| expand grp
| parse grp, "JSON:obj"
| fieldsAdd group_name = obj[name]
| fields group_name
| sort group_name asc
```

**This is a platform-emitted readiness snapshot, refreshed daily** — not our inference. Verified
live: the event exists with both arrays populated, and a reference tenant showed **20 groups still
on classic RBAC roles against 5 on default policies**. Because it is a snapshot, `sort timestamp
desc | limit 1` is load-bearing — without it you aggregate a week of daily snapshots and multiply
the estate.

**🔴 THE CROSS-SKILL PAYOFF — this can unblock held zone retirements in `/dt-eval-mz2seg`.** That
plan carries a hard rule: *no zone may be finally dispositioned retire-\* while its access job is
unmeasured*, and when **A19** (IAM groups) is unreadable every zone falls to `access-unknown` and
retirements are blocked. B47 is a **second, independent read of group permissions from a different
surface** (Grail self-monitoring, not the IAM API), so on a tenant where A19 403s it can still
establish whether groups carry classic role bindings. **It is corroboration with a stated limit, not
a substitute:** B47 reports *that* groups hold classic roles, not *which management zones each
binding scopes to*. Use it to resolve `access-unknown` → `access-classic-roles-present` (retirements
stay blocked, but the finding is now measured and named) and never to promote a zone straight to
retire-now. When A19 *is* readable, A19 wins on specificity and B47 corroborates the total.

**Handling:** group names are organizational identifiers, not PII — they may appear in an internal
deliverable and should be generalized in an external one ("N groups across the platform, security
and application teams"). **`account.uuid` on this event identifies the customer account — never put
it in any deliverable** (rule 5); it is useful only for the operator's own account-management deep
link during the run. Cost: trivial (a handful of events). 0 rows = the readiness snapshot is not
emitted on this tenant → ⚪ *"access-model migration not assessed in this review"*, never "no classic
roles". Verification twin **V48**.

**B48 — Coverage DEPTH per technology (the quality counterpart to B3's breadth; source: the Dynatrace Discovery & Coverage app's own findings queries, verified live on a reference tenant 2026-08-02):**

**This is a quality-not-quantity probe and the single sharpest demonstration of that rule.** B3 answers *"is every host monitored?"* (breadth — `isMonitoringCandidate`, mode split) and routinely returns a clean bill: 0 unmonitored candidates, every host has an agent. That says **presence**, not **depth**. B48 answers the question B3 cannot: *"is each thing monitored at the depth its role warrants?"* — and on the same tenant where B3 was clean, B48 found 71% of application servers with no code-level monitoring and ~770 database processes effectively unmonitored. **Never let a clean B3 stand in for coverage; a host count cannot see a shallow-coverage estate.** The Discovery & Coverage app computes a `compliant` boolean per entity per technology; these are the load-bearing checks distilled from it. Entity fetches — cheap; full windows fine.

*App-server full-stack depth* — code-level visibility requires FULL_STACK, not just an agent:
```
fetch dt.entity.process_group_instance, from:-15m
| filter in(processType, {"JAVA","DOTNET","GO","NODE_JS","PHP","APACHE_HTTPD","NGINX"})
| fieldsAdd h = belongs_to[dt.entity.host]
| lookup [fetch dt.entity.host | fieldsAdd monitoringMode], sourceField:h, lookupField:id, prefix:"host."
| summarize total = count(), fullstack = countIf(host.monitoringMode == "FULL_STACK")
```
`fullstack/total` well below 1 = app servers running infrastructure-only: no traces, no code-level. Cross-check the gap against B3's INFRASTRUCTURE host count — they should match (live: 767 app-server gap = 767 infra-mode hosts).

*Database monitoring depth* — a detected DB process is not a monitored database; the extension must produce an entity. Per DB tech, compare detected processes to linked extension entities:
```
fetch dt.entity.process_group_instance, from:-15m | filter matchesValue(softwareTechnologies, "*type:MICROSOFT_SQL_SERVER*") | summarize detected = count()
fetch `dt.entity.sql:sql_server_host` | summarize monitored = count()
```
Run the twin per tech: MySQL (`dt.entity.mysql:instance`), PostgreSQL (`dt.entity.sql:postgres_host`), Oracle (`dt.entity.sql:com_dynatrace_extension_sql-oracle_instance`), Redis (`dt.entity.prometheus:com_dynatrace_extension_redis_node`), MongoDB (via listenPorts/host mode). **`detected > 0` with `monitored = 0` while the extension is INSTALLED (A11) — and especially CONFIGURED (A48) — is the sharpest shelfware finding there is: the licence and extension are paid for and collecting nothing.** Live: 206 SQL Server + 465 Redis + 90 PostgreSQL processes at 0% monitored, SQL extension installed *and* configured. Quality-not-quantity: report *what the extension is failing to monitor*, never the extension count.

*OS log coverage* — system logs are a per-OS enablement, not automatic:
```
fetch dt.entity.process_group_instance, from:-7d | filter processType == "WINDOWS_SYSTEM"
| summarize total = count(),
    logged = countIf(isNotNull(logPathLastUpdate) or (isNotNull(logSourceState) and contains(toString(logSourceState),"SEND_TO_STORAGE")))
```
Run the `LINUX_SYSTEM` twin. `logged/total` low = OS logs uncollected (live: Windows 0%, Linux 52%).

**Interpretation (the whole point):** grade coverage on the *outcome capability per population*, never on the host count. A ✅ requires depth appropriate to the role (app hosts full-stack, detected DBs producing monitored entities, OS logs flowing); an estate that is 100% agent-covered but 29% code-level, 0% database-monitored and 0% Windows-logs is **⚠️ shallow coverage**, and the report must say so — the finding a breadth check structurally cannot make. Full per-technology query set (13 checks) lives in the Discovery & Coverage app; import and run it in-tenant for the exhaustive list, or run the three load-bearing checks above for the report.

**B49 — Anomaly-detector schema-generation share (the E13 Gen3 Migration Progress footprint weight; added 2026-08-05):**

```
fetch dt.davis.events, from:now()-30d
| filter dt.settings.schema_id == "builtin:anomaly-detection.metric-events" or dt.settings.schema_id == "builtin:davis.anomaly-detectors"
| summarize legacy_events = countIf(dt.settings.schema_id == "builtin:anomaly-detection.metric-events"),
    native_events = countIf(dt.settings.schema_id == "builtin:davis.anomaly-detectors")
| fieldsAdd legacy_share_pct = round(100.0 * toDouble(legacy_events) / toDouble(legacy_events + native_events), decimals:1)
```

Config-side, A13 (`builtin:anomaly-detection.metric-events`, classic) and A2/A43 (`builtin:davis.anomaly-detectors`, Gen3) already establish domain E13's ✅/💡/⚠️ status for free — this probe exists only to **weight** that status by real usage rather than raw enabled-detector-count, the same correction B34 made for dashboard object counts: a disabled clone family and a firing one count identically by enabled-count alone, so `legacy_share_pct` is what actually sizes the migration debt. **Use `dt.settings.schema_id`, never `event.provider`, to tell classic from Gen3** — `provider` names the emitting component, not the detector-config generation that produced the event, and cannot make this distinction at all. 0 rows for both schema_ids = no custom-detector activity in the window (⚪ excluded from this domain's footprint weight, not a finding — matches the SLO-domain precedent for a tenant with no SLOs). **Fallback when this read is unavailable:** the enabled-detector-count share from A2/A13/A43 (less precise, but the domain's status is unaffected either way). Verification twin **V51**.

**B51 — OpenPipeline self-monitoring throughput (added 2026-08-26; the surface that survives an unreadable pipeline set):**

```
timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-7d, by:{pipeline_id, configuration}
| fieldsAdd total = arraySum(records)
| fields configuration, pipeline_id, total
| sort total desc
```

`dt.sfm.openpipeline.*` is platform self-monitoring telemetry, **not** settings-object data, so the
object-level read shares that can hide the pipeline configuration do not gate it. **Verified live
2026-08-26 on `playground`, which is also where the premise proved itself**: the same identity got
`403 Access denied` on both `builtin:openpipeline.logs.pipelines` and `.metrics.pipelines` while this
query listed 34 pipelines.

**🔴 Correction from that run — `pipeline_id` does not classify ownership, and this entry previously
said it did.** The claim was *"`default` is the platform pipeline; any other value is
customer-authored"*. `playground` returned `extension:generic-cisco-device`,
`extension:snmp-generic-juniper` and `extension:snmp-generic-device` — **extension-installed, not the
customer's work** — alongside genuinely customer-authored ids, and `databricks-workspace-metrics`,
which carries no prefix at all and cannot be classified from this surface. Counting every non-`default`
id as customer-authored inflates the authored-pipeline count, which is the number
`/dt-eval-openpipeline`'s adoption gate keys on — the same class of error as D2's `com.dynatrace.*`
"orphans" and exactly what core directive 5 exists to stop. Read it as: `default` = platform ·
`extension:*` = extension-owned · anything else = **candidate** customer-authored, confirmed by the
config read or the owner, never by the identifier. Compounding this, the identifier is the pipeline's
`customId`, which survives renames (see MANUAL-EXTRACTION.md's B51 section), so it is not a reliable
display name either.

Companion series: `.ingest_sources_in.records` (by `configuration` — ingest per signal type),
`.routing.records` by `route_name` (which routing rules actually match — an enabled rule absent from
the result matched nothing), `.not_stored.records` (by `reason` — `intentionally_dropped` vs
`not_valid` vs `not_persisted`, all three observed live), and `.forwarding.successful_records` /
`.failed_records`. **Counts pipelines that PROCESSED records in
the window, so it is a floor on the configured inventory, never the whole of it.** `/dt-eval-openpipeline`
owns the depth; this entry exists so the tenant review can cite pipeline throughput without it.
Verification twin **V54**.

**B50 — Duplicate/redundant metric ingestion: 3rd-party collector (e.g. Telegraf/StatsD/custom) vs. native equivalent (VERIFIED LIVE 2026-08-07 on `playground` — query syntax and `dedup`/timeframe discipline hold; the mapping table's actual entries remain unconfirmed against a tenant that has any custom-collector metrics to test):**

**Live result on `playground`: zero rows — no `custom:`-sourced or `telegraf.`/`statsd.`-prefixed keys in the 7-day window.** Confirmed this is a genuine "nothing to find" and not a broken query or dark metrics surface: a plain `metrics from:now()-7d | summarize count()` on the same tenant returned real volume. **State the distinction explicitly in a report: zero candidate keys is a different finding from zero overlap** — the former means no third-party collector runs on this tenant at all (nothing to consolidate, full stop); the latter (not yet observed live) would mean a collector runs but nothing it publishes duplicates a native signal. Don't collapse the two into one "✅, no redundant metrics" sentence — they have different remediation implications if the tenant later adopts a collector.

**Distinguish from B40 first:** B40 flags rejected `telegraf.*`/custom keys — data *lost* at ingest. B50 flags custom keys that are *accepted* and duplicate a signal OneAgent/an extension already collects natively for the same entity — money spent ingesting the same thing twice, plus two numbers claiming to measure the same signal that can silently drift apart. Different defect, don't conflate the findings.

Step 1 — enumerate custom-collector metric namespaces actually ingested. Apply the field-notes result-cap discipline throughout: dedup + `--max-result-records 30000`, the comma-less `metrics from:now()-Nd` timeframe, ≤10d metadata window, and treat absence from this enumeration as **unproven** — verify any specific key with a per-key `filter metric.key == "<key>"` + `timeseries` check before concluding it's absent (same trap D5 item 4 documents: a raised cap is not proof of completeness):

```
metrics from:now()-7d
| filter startsWith(dt.metrics.source, "custom:") or startsWith(metric.key, "telegraf.") or startsWith(metric.key, "statsd.")
| dedup {metric.key}
| fields metric.key, dt.metrics.source
```

Extend the prefix list to whatever collector namespaces the tenant's actual custom-ingest publishers use — Telegraf/StatsD are the common examples the field asks about, not an exhaustive list. `dt.metrics.source` starting `custom:` is the general "externally published via the Metrics API, not OneAgent/extension-native" tag — B33 already excludes it (`filter not(startsWith(dt.metrics.source, "custom:"))`) to isolate extension-native volume; B50 is the mirror read, keeping exactly what B33 throws away.

Step 2 — cross-reference the resulting key set against a curated collector-plugin → Dynatrace-native equivalent table. This is a lookup maintained here, not a query re-derived per run:

| Common 3rd-party metric shape | Native Dynatrace equivalent | Native surface |
|---|---|---|
| `cpu.usage_*` / `cpu.usage_idle` | `dt.host.cpu.usage` | OneAgent host monitoring |
| `mem.used_percent` / `mem.available` | `dt.host.memory.usage` / `.available` | OneAgent host monitoring |
| `disk.used_percent` | `dt.host.disk.used.percent` (per `device`/`mountpoint`) | OneAgent host monitoring |
| `diskio.*` | `dt.host.disk.{read,write}.*` | OneAgent host monitoring |
| `net.bytes_*` / `net.packets_*` | `dt.host.net.nic.*` | OneAgent host monitoring |
| `system.load1/5/15` | `dt.host.cpu.load` | OneAgent host monitoring |
| `processes.*` | process/process-group telemetry (`dt.process.*`) | OneAgent process monitoring |
| `docker.*` / `kubernetes.*` | `dt.container.*` / `dt.kubernetes.container.*` | OneAgent/K8s monitoring |
| `win_cpu.*` / `win_mem.*` | `dt.host.cpu.usage` / `.memory.usage` (Windows) | OneAgent host monitoring |

Step 3 — don't grade on namespace overlap alone; join on the same entity to prove actual double-collection, the same discipline B33 applies to extension entities. Pull the custom metric's host/entity dimension (whatever tag or `dt.entity.host` the publisher attaches) and check whether that same entity already reports the native equivalent (a `timeseries` read on the native key, or B3's Full-Stack-mode check for that host). **Only both present on the same entity is redundant** — a custom metric on a host with no OneAgent (Infrastructure-only, or a device class OneAgent can't reach) is legitimate gap-filling, not waste.

Read: native + custom both present on the same entity for the same signal, a handful of hosts = 💡 (name the entity count and the metric-ingest cost of the parallel collector); fleet-wide, or material volume against B41/consumption = ⚠️. Recommend retiring the custom collection for exactly the overlapping signals while keeping it only for what it uniquely provides (app-specific business metrics, a device class OneAgent doesn't reach). No overlap found (custom keys cover only signals with no native equivalent) = ✅ — state that explicitly rather than silently passing over the custom-ingest estate. Cost: `metrics` metadata reads are cheap and capped at 10 days; the per-entity native-presence join is a `timeseries`/entity read, well inside guardrails.

## Deep-dive recipes (D1–D6)

**Moved to [probes-deepdives.md](probes-deepdives.md) on 2026-08-07** for context economy — a run
collecting only the raw §B probes above no longer has to load the local jq/python analysis recipes
too. D2 (OpenPipeline stage matrix), D5 (detector rule deep-analysis) and D6 (pipeline consolidation)
are cross-referenced from several §B probes above by ID only; open that file when running a
deep-dive pass.

