# Field notes — verified platform patterns and gotchas

Hard-won, live-verified knowledge (dtctl 0.33 / platform state mid-2026; floor now ≥ 0.35 — see the `inventory` note below). Trust these over training-data assumptions; re-verify when the platform ships changes.

**This is the shared core — general-use gotchas every `/dt-eval-*` skill hits.** Split 2026-08-07 for context economy (the same reason [probes.md](probes.md) was split into a router): sibling-exclusive content moved to its own file, read only by the skill that needs it — [field-notes-gen3.md](field-notes-gen3.md) (`/dt-eval-gen3` domain-scoring detail) and [field-notes-mz2seg.md](field-notes-mz2seg.md) (`/dt-eval-mz2seg` zone-dimension/consumer-cutover mechanics). General mechanics learned while building those two (OpenPipeline routing/management-zone gotchas; `dt.sfm.*` delivery/ingest surfaces) stayed here since every skill needs them, not just the one that discovered them.

> **⚠️ Before running ANY repeated dtctl flag from a shell variable — zsh does not word-split unquoted scalars.** `C="--context abc12345"; dtctl get buckets $C` fails with the actively misleading error **`Error: unknown flag --context, did you mean --context?`** (the flag arrives as the single token `--context abc12345`; live 2026-07-29 this failed 14 probes in two batches at once). The prescribed pattern for any repeated flag is the **array form**: `C=(--context abc12345)` → `dtctl get buckets "${C[@]}" -o json`. Full detail and the two other bite variants (optional `${var:+…}` flags, interpreter+script scalars) in the dtctl/CLI section below.

## Grail / DQL surfaces

- **Entity fetches return only `id` + `entity.name` by default** — every other attribute needs explicit `fields`/`fieldsAdd`. A `FIELD_DOES_NOT_EXIST` means the *attribute name* is wrong for the Grail view, not that the data is unreachable.
- **OneAgent version**: the field is **`installerVersion`** on `dt.entity.host` (parse: `parse installerVersion, "INT PUNCT INT: version PUNCT INT"`). `agentVersion`, `agent_version`, `oneAgentVersion` do not exist. `smartscapeNodes ONEAGENT` carries the full version string as `dt.agent.module.version` — names stragglers precisely.
- **Monitoring mode is migrating off the host entity.** Classic `monitoringMode` on `dt.entity.host` still works; the successor is `smartscapeNodes ONEAGENT` → `dt.agent.monitoring_mode` (join via `lookup(..., lookupField:references[monitors.host][0])`). Run both — a delta = stale entities.
- **A name is not evidence — never conclude from a naming convention what a read can tell you (2026-08-12).** The recurring false-positive shape in this project, and it has shipped three times: segments dismissed as "targeting nonexistent dimensions" resolved real values once their `variables.value` query was actually run (7 of 10, A6); pipelines flagged as orphan config debt were `com.dynatrace.*` vendor defaults (9 of 10, D2); byte-identical pipeline families were deliberately separated for ABAC and cost attribution (D6). The same trap in cloud/K8s shape: a disk named `*ASRReplica*`/`*DR*`/`*standby*` is usually intentional, an idle-looking VM matching an HA pattern (`*hdb1c01/02/03`) is usually a legitimate standby, and a namespace containing "fargate" tells you nothing about the billing model — the node hostnames (`fargate-ip-*`) do. **Read the config, run the query, join the topology, or ask the owner. Then record how you checked** (`finding_section(..., excluded=[{item, reason, verified_by}])` — `verified_by` is mandatory, CLAUDE.md core directive 5).
- **Smartscape census caveat**: unknown node-type names return **0, not an error** — absence of a type is indicative, never proven. Node types carry cloud metadata (`aws.account.id`, `cloud.provider`), `isMonitoringCandidate`, `lifetime` (derive RUNNING/INACTIVE via `getEnd(lifetime) >= now() - 10m`), and a `tags` object that can be `{}` while classic entity tags exist (surfaces don't auto-propagate). The new SERVICE layer can be thinner than classic `dt.entity.service` — validate before building on it.
- **ActiveGates ARE in Smartscape (since ~mid-2026 — re-verified 2026-07-28, dtctl 0.35.0, overturning the 2026-07-09 negative): the type name is `ACTIVEGATE`, no underscore.** `smartscapeNodes ACTIVEGATE` returns the fleet with `dt.active_gate.version` (full string — the B13-style `parse …, "INT PUNCT INT: version PUNCT INT"` extracts the sprint band), `dt.active_gate.group.name`, `dt.network_zone.id`, `modules[]`, `os.*`, `is_containerized`, `is_fips`, `startup_time`, `lifetime`, addresses (probe B36). Three gotchas: `smartscapeNodes ACTIVE_GATE` (underscore) returns **0 rows, not an error** — and 0 rows on any tenant = "no AGs visible", never proven absence (cross-check B15 metrics); `fetch dt.entity.active_gate` still errors ("entity type wasn't found") — Smartscape is the only entity surface; **`AUTOUPDATE` in `modules[]` is module presence, NOT auto-update status** — update status has no query surface (Deployment Status app / A25 policy only). Fleet **health** still comes from the `dt.sfm.active_gate.*` self-monitoring metrics (dims: `dt.active_gate.id`, `.group.name`, `dt.network_zone.id`; key health: `communication.messages.dropped/rejected` — any >0 = data loss), which can see AGs Smartscape doesn't (and vice versa) — a disagreement between the two surfaces is itself a finding (live 2026-07-28: 16 via metrics vs 11 via Smartscape, 31% apart). Count rule: metric-side = fleet size, Smartscape = version-assessed subset — report both, never pick one silently (resolution rule in probes-grail.md B36).
- **Buckets via DQL**: `fetch dt.system.buckets` (fields `dt.system.bucket`, `records`, `dt.system.retention_days`) — works with storage read; `dtctl get buckets` needs bucket-definition read. Group log records by **`dt.system.bucket`** (`dt.bucket.name` returns null). Unscoped `fetch logs` only sees default-IAM-scope buckets — measure custom-bucket population from lifetime `records` + bucket-scoped queries (`fetch logs, bucket:"<name>"`), never from unscoped shares alone.
- **Billing/consumption is in Grail**: `timeseries sum(dt.billing.full_stack_monitoring.usage)` etc.; log-ingest attribution dimension is named `costcenter` on `dt.billing.logs.ingest.usage_by_costcenter` (all-null = unattributed). Records can carry `dt.cost.costcenter` while billing still shows null — recent config or not landing; report the discrepancy, don't guess. **The log-ingest family is plural — `dt.billing.logs.*`**; the natural singular guess `dt.billing.log.ingest.usage` does not exist and resolves to nothing without erroring, which reads as "no log-ingest billing data" (bitten live 2026-07-28). Discover the real family with `metrics | filter startsWith(metric.key, "dt.billing")` before concluding a billing surface is dark.
- **Davis events live in cheap dedicated buckets** — filter `dt.system.bucket` to `{"default_davis_events","default_davis_custom_events","default_k8s_ops_events"}` for saturation analysis; affected entities via `smartscape.affected_entity.ids`; dedupe with `countDistinctExact(event.id)`.
- **Behavioural system tables (Effective Consumption pillar §D — verified live 2026-07-10):** `dt.system.events` carries `event.kind` ∈ {`WORKFLOW_EVENT`, `QUERY_EXECUTION_EVENT`, `AUDIT_EVENT`, `BILLING_USAGE_EVENT`, `ANALYZER_EXECUTION_EVENT`, …}. Large (millions of rows) but system-scoped and cheap — no unscoped-log guardrail applies; keep the `event.kind`/`event.type` filters selective.
  - **Workflow runs**: `event.kind=="WORKFLOW_EVENT"`; `event.type` is `WORKFLOW_EXECUTION` (run level) vs `ACTION_EXECUTION` (task level). Terminal state = `dt.automation_engine.state.is_final==true` with `dt.automation_engine.state` ∈ {`SUCCESS`,`ERROR`} (`RUNNING` is non-final — filter it out or you double-count). Dedup by `dt.automation_engine.workflow_execution.id`. Runner = `...workflow_execution.actor`; runtime `...trigger.type` ∈ {`Schedule`,`Event`,`Manual`} — **there is no "Davis problem" runtime trigger**, so problem-attachment must come from the config side (`dtctl get workflows` → classify `.trigger`). **⚠️ The prefix is `dt.automation_engine.*` on EVERY workflow field — the natural guesses (`trigger.type`, `dt.event.workflow.id`) resolve to null WITHOUT erroring**, and grouping by a null field collapses all executions into one row while looking like a valid result (live 2026-07-28: 11,223 executions → "1 of 17 workflows ran, FPR 0.000", both artifacts; real: 25 distinct titles, FPR 0.034). A null-resolving field is more dangerous than a failing one — sanity-check any `by:{…}` that returns exactly one group. **The same rule generalizes to dedup (2026-07-28): a `dedup` that drops >90% of rows means the KEY is wrong or unpopulated on this tenant, never that the data collapses** — on one estate `workflow_execution.id` itself was unpopulated and `dedup` collapsed ~17.5k execution events to one row; compare `countDistinct(<key>)` vs `count()` before trusting any dedup. **Tenant-variant fallbacks (both validated live 2026-07-28):** WFR without the id key = count by `{dt.automation_engine.state, …state.is_final}` (no dedup — `SUCCESS/(SUCCESS+ERROR)` over final rows); FPR without runtime trigger fields = task-level events by `dt.automation_engine.workflow.title` joined to the A4 config trigger classification (state the task-volume basis). The task-level `event.type` has been observed as `ACTION_EXECUTION` (2026-07-10) *and* `TASK_EXECUTION` (2026-07-28) — filter `in(event.type, {"TASK_EXECUTION","ACTION_EXECUTION"})`. Full queries in [effective-consumption.md](effective-consumption.md) §4/§4b.
  - **Config changes (COC/self-service)**: `event.kind=="AUDIT_EVENT"` + `isNotNull(details.dt.settings.object_summary)` for settings changes; **`isNull(authentication.token)` is the human/automation switch** (token present ⇒ Terraform/Monaco/API — exclude for human self-service, invert for automation coverage). Filter out `user.id` ∈ {`UNKNOWN`,`system`}.
  - **CCS (token-driven share, verified live 2026-07-14):** drop the token filter, then `countIf(isNotNull(authentication.token))/count()` = config-as-code share (reference: 2/253 = **0.008**, 1 token actor vs 11 human). **`countDistinct(if(cond, field))` counts only the non-null branch** — no `else:` needed — which gives token vs human actor counts in one pass.
  - **Outlier fence on actor distributions (verified live 2026-07-14):** `percentile(changes, 25|50|75)` works over an already-summarized per-actor row set and interpolates (fractional results on small n are normal); fence = `p50 + 3*(p75-p25)` (reference: 11 users, fence ≈ 132, max actor 85 → nothing fenced). Fenced actors leave COC/SSU/QEI and join the CCS/automation story.
- **`dt.system.query_executions`**: one row per executed query; `user.id`/`user.email`, `scanned_bytes`, `table`, `bucket`, `query_pool`. Human interactive queries = `isNull(client.internal_service_context)` (internal service actors — anomaly detectors etc. — set it, and run under a real `user.id`, inflating naive distinct-user counts); exclude `query_pool=="AUTOMATION"` for pure human engagement.
- **Engagement excludes Dynatrace-internal HUMANS, not just machine actors (owner correction 2026-07-28).** The machine-actor fence (`internal_service_context` / `AUTOMATION`) does **not** remove Dynatrace employees (CSM / support / consulting) who log into the customer tenant and run queries — their activity inflates *apparent customer adoption* (this is how a Gen3 report over-claimed leverage). Add `| filterOut endsWith(lower(coalesce(user.email,"")), "@dynatrace.com")` to **every** QEI / engagement / Gen3-usage read (EC13–EC16 in [effective-consumption.md](effective-consumption.md); B34). Heuristic — catches `@dynatrace.com` accounts; the operator may extend the exclusion list (partner/MSP domains). Counting the excluded share is itself a finding ("N of M apparently-active users were Dynatrace logins"). To split with one pass rather than dropping the rows: `countDistinct(if(not(endsWith(lower(user.email),"@dynatrace.com")), user.id))`. Note `countDistinctIf` does **not** exist — and neither does `countDistinctExactIf` (verified live 2026-07-29) — use `countDistinct(if(cond, field))` / `countDistinctExact(if(cond, field))`.
  - **Richer fields (verified live 2026-07-14, large estate):** `client.client_context` (interactive app cards produce a distinct context per card — humans accrue tens–hundreds; external pollers show 1–3, often tool-named e.g. `<slo-tool>;…`), `client.source`, `scanned_bytes.included` / `scanned_bytes.on_demand` (on-demand = not covered by included query capacity — the query-spend side), `delivered_records`, `execution_duration_ms`, `query_string`. **The internal-service filter does NOT exclude external tools polling under a user identity** — an external SLO platform's poller (tens of thousands of queries over ~2 weeks across a few contexts) landed in QEI's sustained numerator; fence by the volume+context signature (EC15).
- **`event.kind` inventory beyond the EC battery (verified live 2026-07-14, large estate):** `ANALYZER_EXECUTION_EVENT` (Gen3 analyzers executing: `dt.analyzer.name`, `dt.analyzer.result_status` ∈ SUCCESSFUL / **SUCCESSFUL_WITH_WARNINGS** / FAILED — warnings are degraded-not-failed, don't count them as errors; `dt.task.scheduling_type` FIXED_RATE = platform-scheduled), `GENAI_EVENT` (Davis CoPilot invocations; `event.provider=="DAVIS_COPILOT"`, full `response` text present, **no populated user.id** — count volume/active-days only), `LOG_SOURCE_STATUS`/`LOG_SFM` (log-source health, ~1M events/day on a large estate — field mapping unverified, candidate surface), `EXTENSIONS_EVENT`, `BILLING_USAGE_EVENT`.
- **CCS decomposition is mandatory before crediting config-as-code (owner correction 2026-07-14):** group token-driven audit events `by:{user.id, details.dt.settings.schema_id}` — the large estate's raw CCS ~0.84 was 4,213 `builtin:deployment.oneagent.updates` writes + ~4,900 `builtin:alerting.maintenance-window` writes (two tokens, ~80/day) + `builtin:os-services-monitoring`; zero declarative actors → CCS-Q 0.0. Churn signature = 1–2 schemas hammered daily; CaC signature = schema breadth with batchy cadence.
- **`countDistinctExact` hard-fails above 1M values** (`UDF_ELEMENT_LIMIT_WITH_ALTERNATIVE`) — use `countDistinctApprox` for event.id-scale cardinalities (e.g. `dt.davis.events` over 30d on a large estate).
- **Problem title field is `event.name`** on `dt.davis.problems` (`problemName` also exists); dedup by `display_id` first, then `summarize by:{event.name}` for the EC16 title-pattern read. Severity-in-title prefixes (`APP|MAJOR|`, `INFRA|MINOR|`, `CTX|…`) = an imported rule library — their problem share should reconcile with the CUSTOM_ALERT category share (large estate: 70.6% vs 70.9%).
- **Host-group-derived tag families (verified on the large estate, 2026-07-14):** estates that encode `<app>.<env>.<division>` in host-group names often carry parsed `HGApp`/`HGDiv`/`HGEnv` tags — treat these as the app/org/env baseline key families alongside `[Environment]primary_tags.*` and `[VMware]*` variants (one concept, parallel conventions — a consolidation finding, not triple credit). Watch for **case-duplicate host groups** (`X.Development.MMD` vs `x.development.mmd`) inflating the group census. Segment `variables` DQL can be run verbatim to test effectiveness (A6) — large estate: Environment→6, Application→1,459, host-group→3,308 rows = all live.
- **`dt.davis.problems` for usefulness/noise**: **one record per status transition** → always `dedup {display_id}`. Root cause = `isNotNull(root_cause_entity_id) or isNotNull(root_cause.smartscape_entity.id)` — **check both fields, not just the classic one** (field-team, verified live 2026-08-05): `root_cause_entity_id` is the classic Smartscape field and is deprecating; `root_cause.smartscape_entity.id` is 3rd-gen Davis and is what a migrated tenant actually populates — reading the classic field alone silently reads 0% on such a tenant rather than erroring. The API-era name `rootCauseEntity` (camelCase, no underscore) does not exist in Grail at all and also silently returns always-null; never use it. Same dual-field rule for impact cardinality: `arraySize(affected_entity_ids) or arraySize(smartscape.affected_entity.ids)`, classic vs 3rd-gen respectively. Full writeup: [dt-eval-prob/probes.md](../dt-eval-prob/probes.md) P4. Noise flags `dt.davis.is_duplicate` / `dt.davis.is_frequent_event` / `dt.davis.mute.status` / `maintenance.is_under_maintenance`. Status transitions are `CLOSED`/`UPDATED`/`REFRESHED` — **no `REOPEN`**, so reopen-rate is not directly derivable.
- **Host foundation fields (SCI/FCS/MCS)**: `tags` (array) and `hostGroupName` are **direct fields** on `dt.entity.host` — `arraySize(tags)`, `isNotNull(hostGroupName)`. `entityAttr(id, "…")` fails with `INVALID_ENTITY_TYPE`; use direct field access. **Gen3-first**: score these platform-native surfaces, never management-zone/classic-tag presence.
- **QEI = sustained active engagement, NOT diversity or scan volume (fix, 2026-07-10):** measure QEI as `sustainedUsers/activeUsers` where sustained = human users querying on ≥10 distinct days in 30d (`summarize activeDays=countDistinct(toString(bin(timestamp,1d))), by:{user.id}` then `countIf(activeDays>=10)`). **Two traps that both over-score:** (1) bucket/table **diversity** trivially maxes out — any estate where someone touches ~15 buckets scores 1.0 while a handful of real users hide behind huge ingest (a large estate scored 1.0 on diversity with only ~50 sustained users of 450 active, 60% one-or-two-day); (2) **scanned-bytes-vs-ingest** inflates on repeated/broad scans (same estate scanned 25× its ingest). Also weigh sustained-user *count* against estate size (host count) as a qualitative shelfware overlay — org headcount isn't in Grail. Validated: reference 10/19=0.53; large estate 50/450=0.11.
- **No single "DPS" scalar in Grail**: billing exposes per-capability `dt.billing.*.usage` metrics in differing units — not summable into one DPS number. For CQR/QEI use query activity + bucket/table diversity (the notebook author's own simplification), and if a ratio is needed divide a single capability's ingest (e.g. `dt.billing.logs.ingest.usage_by_product`) by human query count and label it *derived*.
- **KPI trends** (`by:{week=bin(timestamp,7d)}`): the `bin`+`summarize`+`sort` form yields the metric line directly and charts cleanly — prefer it over `makeTimeseries` for ratio KPIs (which returns arrays needing per-element division). **A stable-but-low line = chronic (fix the design); a falling line = regression (find what changed)** — the reference tenant's WFR held 32–37% every week (chronic). **Low-sample trap:** ratios on small weekly denominators are noisy (the reference tenant's weekly COC swings 0.31→0.5 on 2–3 participants) — always carry the per-bucket count next to the ratio and don't narrate moves on thin data.
- **`dtctl get workflows` for the config↔events stitch (verified live 2026-07-10):** returns a JSON array; per workflow `id`, `title`, `owner`/`ownerType` (configured owner — the authoritative WOS ownership input), `actor` (service identity), `isDeployed`, `isPrivate`, and `trigger`. Classify: `trigger.schedule` = schedule; `trigger.eventTrigger.triggerConfiguration.type` ∈ {`davis-problem`,`davis-event`,…}; no trigger key = manual/none. **Workflow activation requires BOTH `isDeployed == true` AND trigger activation.** There is **NO top-level `isActive` field** — reading one yields null (verified live 2026-07-28). Check **`trigger.eventTrigger.isActive`** for event-triggered workflows, or **`trigger.schedule.isActive`** for scheduled workflows. A workflow can be deployed but have no active trigger (or vice versa) — both conditions must be true for delivery. Observed: a large estate had 4 deployed workflows with triggers off and 1 with active trigger but undeployed = zero native delivery despite 5 correctly-configured workflows. **Config population > executed population** (val tenant: 90 configured, 42 ever ran) — dormant workflows are invisible to events. To get problem-attached WFR / SQI workflow leg, pull the `davis-problem` id set and inject it into the workflow-event query (`filter in(dt.automation_engine.workflow.id, {<ids>})`); ids that never fire simply don't appear in events — that absence *is* the finding ("defined ≠ delivering").
- **Required-key coverage trap (SCI/MCS from a standards list):** `filter in(key, {...required...}) | summarize by:{key}` returns **no row for a required key with zero coverage** — so `avg()` over the result silently averages present-only keys and overstates the score. Compute the mean over the *full required set*, filling missing keys as 0 (reference: required `{Team,dt.owner,environment}` → environment 0/10 has no row → SCI 0.67, not 1.0).
- **Security events**: distinguish **`NOT_AUTHORIZED_FOR_TABLE` / 403** (⚪ — grant `storage:security.events:read`) from **scope-granted-but-0-events** (AppSec genuinely dark — a real finding). This distinction applies to every table.
- **Sampled log scans** (`samplingRatio: 100, scanLimitGBytes: N`) are fine for volume *trends*, never for exact counts.

## Application-observability, value & security planes (verified live on `playground` 2026-07-11)

These back probes B17–B29. **Several BPN-notebook field names were wrong** — the notebooks flag their own security/RUM fields as inferred, and live validation confirmed the corrections below. Trust these.

- **`fetch spans` obeys the log cost guardrail** — high-volume raw table, ≤ 5-minute windows + single-pass `countIf()` only.
- **Span failure flag is `request.is_failed`** (boolean). `span.status_code` exists but is lowercase `error`/`ok` and **null on the majority of spans** (only OTel-populated) — never gate failure on it. `service.name` is **null on OneAgent spans** (they carry `dt.entity.service`; OTel spans carry both) → always `coalesce(service.name, dt.entity.service)`. `duration` is **nanoseconds**; `dt.ingest.size` is per-span (enables ingest-waste findings); `endpoint.name` = normalized route (`http.route` often null); spans live in `default_spans`.
- **Databases ride on spans**: `filter isNotNull(db.system)` — `db.system`/`db.namespace` populated; **`db.statement`/`db.operation` null by default** (statement capture off) — group by `db.system` + `db.namespace` + `span.name`.
- **OpenTelemetry**: `otel.scope.name`, `telemetry.sdk.language`, `telemetry.sdk.name` on spans (`otel.library.name` null). OTel-vs-OneAgent split = `countIf(isNotNull(otel.scope.name))`. Collector self-health = `otelcol_*` metrics (`otelcol_exporter_send_failed_spans`, `otelcol_exporter_queue_size`, `otelcol_process_cpu_seconds`, `otelcol_process_runtime_heap_alloc_bytes`) — `send_failed > 0` = data loss.
- **Kubernetes census uses entity tables, NOT Smartscape**: `smartscapeNodes KUBERNETES_CLUSTER` returns **0** (wrong type name); use `dt.entity.kubernetes_cluster` / `kubernetes_node` / `cloud_application` (workloads) / `cloud_application_namespace`. Metric family (verified present): `dt.kubernetes.container.{cpu_usage,cpu_throttled,memory_working_set,requests_cpu,requests_memory,limits_cpu,limits_memory,oom_kills,restarts}`, `dt.kubernetes.node.{cpu_allocatable,memory_allocatable,pods_allocatable,conditions}`, `dt.kubernetes.persistentvolumeclaim.{used,capacity,available}`, `dt.kubernetes.{workloads,pods,nodes,containers,events}`. Dimensions: `k8s.namespace.name`, `k8s.workload.name`, `k8s.container.name` — **`k8s.cluster.name` is NOT among the verified ones; confirm it with a bare `summarize by:{k8s.cluster.name}` before building a per-cluster split on it.** Right-sizing = `requests_cpu` vs `cpu_usage` (playground had 150× over-reservation); reliability = `oom_kills`/`restarts`. KSPM config schema `builtin:kubernetes.security-posture-management` can be **empty `[]` (not enabled) even while `COMPLIANCE_FINDING` events flow** (CSPM ≠ KSPM). **Gen3-first**: score K8s alerting on `builtin:anomaly-detection.kubernetes.*`, not classic host thresholds.
- **`requests_*` is a SPEC value, not a rate — never average it over a long window (B20, corrected 2026-08-12).** Three ways a right-sizing number goes wrong, and only two of them are fixable in the query: (1) **window churn** — an `arrayAvg` over hours blends every pod that lived and died inside the window, so a churn-heavy namespace (CI/CD runners, batch/Spark-style executors) reads as reserving far more than it ever held at once; read it point-in-time (`arrayLast` over one short, **offset** bucket — a trailing window returns nulls on ingest lag, and that is lag, never absence). (2) **Null denominator** — `100.0 * usage / requests_cpu` divides by the very field whose absence is itself the finding; unbounded containers must be *counted* in their own column, never divided. (3) **Non-Running pods — OPEN, and not fixable in the metric query today**: Pending/Failed pods keep reporting spec `requests_*` via kube-state-metrics while consuming no node capacity, and a point-in-time read does **not** drop a *currently* Pending pod. **No pod-phase dimension exists on the verified `dt.kubernetes.container.*` list** — phase lives on the pod entity's config (`config[status][phase]`), so a phase filter needs an entity join, not a metric filter. **Until that is verified live, the guard is the capacity ceiling**: `sum(dt.kubernetes.container.requests_cpu)` must not exceed `sum(dt.kubernetes.node.cpu_allocatable)`; if it does, the aggregation is wrong and nothing derived from it may be reported. Generalize the habit — **every derived total has a physical ceiling; check the total against it before the number reaches a page.**
- **RUM uses the dotted Grail model — the BPN camelCase names all return null.** `user.sessions`: `duration`, `user_action_count`, `user_interaction_count`, `error.count`, `error.has_crash`, `error.exception_count`, `error.http_4xx_count`, `error.http_5xx_count`, `error.anr_count`, `characteristics.has_replay`, `dt.rum.user_type`, `dt.rum.application.type`, `browser.name`, `os.name`, `frontend.name` (an **array** — `expand` before grouping), `dt.rum.application.entities` (NOT `hasSessionReplay`/`totalErrorCount`/`userActionCount`). **The per-application dimension is `frontend.name` / `dt.rum.application.entities`** — `app.short_name`, `application.name` and `dt.rum.application.name` are null on 100% of sessions (verified live 2026-07-29), so grouping on them returns `apps: 0` with no error and reads as "RUM is dark" on a tenant serving thousands of sessions/day. **Core Web Vitals** on `user.events`: `web_vitals.largest_contentful_paint`, `web_vitals.interaction_to_next_paint`, `web_vitals.cumulative_layout_shift`, `web_vitals.time_to_first_byte` — **LCP & INP are in nanoseconds** (÷1e6 for ms; CLS is unitless). Google bands: LCP ≤2500 ms / INP ≤200 ms / CLS ≤0.1 = Good. Percentile 75 is the standard.
- **Synthetic: use the metric, not the event.** `dt.synthetic.browser.availability` / `dt.synthetic.http.availability` (+ `.duration`, `.executions`) are authoritative; `dt.synthetic.events` `success`/`event.status` fields returned null. TLS `result.statistics.peer_certificate_expiry_date` is candidate — verify live.
- **SLO**: config schema `builtin:monitoring.slo` (+ `.normalization`) — **camelCase throughout: `targetSuccess`, `targetWarning`, `evaluationWindow`, `errorBudgetBurnRate`, `metricExpression`** (verified live 2026-07-29; the snake_case guesses return `None` on every object without erroring — **an all-`None` read across every object is a field-name error, never a measurement**). This schema is the *classic* SLO surface; `dtctl get slos` (A3) is the *platform-native* one — disjoint populations, read both (probes-config.md A3/A37). SLI metrics `dt.service.request.count`, `dt.service.request.failure_count`, `dt.service.request.response_time`. Coverage finding = combined SLO count (A3 + A37) vs service count (B7).
- **`security.events` — the BPN field names are wrong.** Real `event.type` values: `VULNERABILITY_STATE_REPORT_EVENT`, `VULNERABILITY_FINDING`, `COMPLIANCE_FINDING`, `DETECTION_FINDING`, `VULNERABILITY_SCAN` (NOT `POSTURE_FINDING`/`ATTACK_EVENT` for findings). Vulnerability risk axis is the **Davis Security Score**: `vulnerability.davis_assessment.level` (CRITICAL…NONE), `.exposure_status` (`PUBLIC_NETWORK`), `.exploit_status` (`AVAILABLE`), `.vulnerable_function_status` (`IN_USE`), `.data_assets_status`, `.score` — NOT `vulnerability.risk.level`. Also `vulnerability.cvss.base_score`, `vulnerability.external_id` (CVE), `vulnerability.mute.status`, `affected_entity.reachable_data_assets.count`. Dedup `{vulnerability.display_id}`; `event.status` ∈ OPEN/RESOLVED. The must-fix list = the intersection (exposed ∧ exploit-available ∧ function-in-use), not the raw critical count. Compliance: `compliance.result.status.level` (FAILED/…), `compliance.rule.severity.level`, `compliance.standard.short_name` (CIS/PCI DSS/HIPAA/GDPR/DORA/…); dedup `{compliance.rule.id, compliance.result.object.name}`. **RAP = enablement-by-presence**: `event.type=="ATTACK_EVENT"` (0 in playground/72 h); corroborate with `dt.billing.runtime_application_protection.usage`.
- **Davis efficacy** = `dt.davis.events` count ÷ `dt.davis.problems` dedup `{display_id}` count (playground 19,026→128 ≈ 149:1). Low ratio + high alert volume = paging on raw events, not root causes.
- **Mobile RUM shares `user.sessions`/`user.events`** split by `dt.rum.application.type` (web value confirmed **lowercase** `"web"`; the mobile value is **unconfirmed** — no accessible tenant had live mobile traffic; confirm before quoting). `dt.entity.mobile_application` census works (found on the large estate). Mobile-specific reliability fields: `error.has_crash`, `error.anr_count`.
- **`dt.rum.user_type` values are lowercase too — `real_user` / `robot` (verified live 2026-07-28).** The uppercase guess `"REAL_USER"` matches zero rows *without erroring* — B22 then reads as "RUM is dark" on a tenant serving 1,000+ sessions/day. Same casing family as `dt.rum.application.type` above: **RUM enum values are lowercase; verify any new value literal with a bare `summarize by:{field}` before filtering on it.**
- **RUM error-session rate: use `error.count > 0` — `hasError` and the `error.*_count` breakdown fields can be ENTIRELY null (verified live 2026-07-28).** On a tenant where `error.count` was populated (27k+ errors, 98%+ of sessions carrying at least one), `hasError` was null on every session (null, not false) and `error.js_count`/`error.request_count`/`error.custom_count` were all null too — so `countIf(hasError == true)` silently returned 0 and read as "no errors", the *opposite* of the truth. **A null-driven zero is not evidence of absence** — same trap class as `dt.bucket.name` above: only the aggregate `error.count` is reliably populated; gate error-session math on it, and treat any all-null boolean as an unpopulated field, never a measured false.
- **Enrichment ratio (B30): governance fields are NOT dedicated entity fields** — `dt.security_context`, `dt.cost.costcenter`, `dt.cost.product` raise `FIELD_DOES_NOT_EXIST` on `dt.entity.host`; they live inside the `tags` object, so match with `fieldsAdd t = toString(tags) | countIf(contains(t, "security_context"))` etc., uniformly across `dt.entity.host`/`process_group`/`service` (`append` + `sum()` to roll up). This is the **entity/source-side** enrichment view — the twin of B5's **record-side** view (records get these from pipeline stages, entities from source tags); a high-record/low-entity split means enrichment is pipeline-only and Smartscape-tag consumers are blind. Verified live: playground 470 entities, 0% security_context, 0.4% cost tags.
- **Masking / PII posture (A38/B31) is config, three enforcement layers** (verified schema ids + shapes on playground): *at capture* — `builtin:oneagent.side.masking.settings`, `builtin:attribute-masking` (per object `value.enabled` + `value.key` + `value.masking` ∈ `MASK_ENTIRE_VALUE`/…); *at ingest* — `builtin:logmonitoring.sensitive-data-masking-settings` (array, per-rule `value.enabled` — the built-in "Private key masking" ships **`enabled:false`**), `builtin:logmonitoring.log-dpp-rules`, plus mask/redact processors in A22 pipeline `processing`; *at display/RUM* — `builtin:sessionreplay.web.privacy-preferences` (`value.maskingPresets.recordingMaskingPreset`/`playbackMaskingPreset` ∈ `MASK_ALL`/`MASK_USER_INPUT`/`ALLOW_ALL`, `enableOptInMode`), `builtin:rum.mobile.privacy`, `builtin:preferences.ipaddressmasking` (empty `[]` = IPs unmasked), `builtin:preferences.privacy`. The finding is the **intersection of masking-off and data-present** — never scan content for PII; report the control posture per layer and cross-read with data presence (B1/B12/B22) and compliance findings (B27).

## Detector rule analysis

- Rule shape: `value.analyzer.input[]` keys = the DQL query, `threshold`, `alertCondition`, `alertOnMissingData`, sliding-window params. Analyzer `StaticThresholdAnomalyDetectionAnalyzer` = static.
- **The query lives under EITHER `query` or `query.expression`, and the two coexist inside one fleet — always read both (verified live 2026-08-11).** The key varies per detector, not per tenant: on a 899-detector estate, **853 used `query` and 46 used `query.expression`**. Reading only `query.expression` (as `detector_families.py` did until this was found) sends every other detector to an empty query string, where they all group together and are reported as one enormous clone family — that estate came back as "1 clone family, 853 objects" when the truth was 31 families over 67 objects, and the title-blind exact-rule grouping was wrong the same way (82/777 reported vs 8/16 actual). The failure is silent and confident, so treat an empty query as **unreadable evidence, never a grouping key**: exclude those detectors from any query-keyed grouping and state the coverage. `detector_families.QUERY_KEYS` / `_query()` is the shared accessor; use it rather than reaching into the input list.
- **The dead-rule check is the killer**: extract every metric key the rules query (e.g. `log.<domain>.<name>.count`), then verify the metric store has them (`metrics | filter startsWith(metric.key, "log.")`). Rules watching nonexistent metrics with `alertOnMissingData: false` are **silently dead** — perceived coverage, zero real coverage. Cross-correlate with pipeline routing: unrouted extraction pipelines = the metrics died with them.
- Estates differ in failure mode — measure, don't assume: mass-generated clones (hundreds of per-host copies), dormancy (rules disabled but retained), audit noise (login events as alerts), or genuine-but-untuned SRE rules. The dedup/family/OOTB-overlap clustering (probes-grail.md D5) distinguishes them.
- **A detector can opt itself out of root-cause analysis, and `dt.davis.is_rootcause_relevant` will NOT tell you (verified against captured detector configs, 2026-07-28).** Two flags govern RCA participation: `dt.davis.is_rootcause_relevant` (may this event be *named* as a root cause) and `dt.davis.is_merging_allowed` (may it be *correlated into* a problem at all). Both are settable as `value.eventTemplate.properties[]` entries — a `{key, value}` list where the values are **strings** (`"false"`, not `false`). On a reference estate `is_rootcause_relevant` was set by **0 of 1,276** detectors while **1,254 (98.3%)** set `is_merging_allowed: "false"` — so a probe reading only the first field reports 100% root-cause-relevant on a stream that measures 0.0% root-cause. Read them as a pair; the merging flag is the discriminating one. `dt.settings.object_id` on the event carries the detector `objectId` for the join back to config.
- **An ABSENT merge flag does NOT mean merging is allowed — config can prove exclusion, never participation (verified live 2026-08-03, 807 detectors across two estates).** The natural reading of "absent key ⇒ platform default ⇒ allowed" is wrong, and it fails in the direction that ships a false all-clear. On both estates **zero** detectors set either flag, yet **every** custom-alert event in the stream was non-mergeable — so a config-side check treating absence as *allowed* reported **100% RCA-capable** against a measured **0.0% mergeable**. The mechanism is the emitted alert type: all 807 detectors carried `event.type: CUSTOM_ALERT` in their event template, and that alert class is excluded from correlation without any per-detector flag. Two consequences: (1) `event.type` is the config-readable predictor to use when the flags are absent, and (2) the config check must report a **lower bound** with no "capable" verdict — an absent flag is `unknown`. Also correct the reason-string reading: `dt.davis.disable_merging_reason == "Set by event reporter"` names the reporting *component*, **not** proof that the detector's own template did it — it appeared on every event on estates where no template set the flag. Where the event stream is readable it outranks the config check; where it is not, say the participation could not be established rather than that it is fine.
- **`threshold: 0` + `alertCondition: ABOVE` is CORRECT on count and state metrics — it is the "alert on any occurrence" idiom, not a defect** (verified live 2026-07-30 across two tenants: 67 detectors carry it, 66 of them correctly). It reads as `count() > 0` on a log-occurrence rule, or `max(<state metric>, filter:{ state == "PAUSED" }) > 0` on a connector-state rule. It is broken *only* on a bounded-percentage series (an explicit `… / … * 100`), where it fires continuously. **Judge by the projected series type, never by the threshold value** — and never by substring-matching the query body: `usage` / `ratio` / `utilization` appear inside filter clauses of rules whose projected value is a lag count, a log count, or a latency in ms, which is exactly how the naive form of this check produced 21 hits with 1 true positive. Same asymmetry upward: `threshold > 100` carries no information on count, duration, byte, or lag series.
- **Self-referential expressions are a real and silent failure mode** — live: `(cpu_alloc[] / cpu_alloc[]) * 100`, a field divided by itself, constant by construction, enabled, and reading in the configuration as active node-CPU monitoring. It produced 5 problems in 30 days against a correctly-formed sibling's 503. Grep the projected expression for the same field on both sides of a `/` or `-`; it is cheaper than the plausibility checks and has no false-positive surface.
- **Falsify any "broken by construction" verdict against fired volume before reporting it.** A rule you call "can never fire" that produced problems, or "fires permanently" that produced 46 in a month, is a failed verdict — the config read lost to the measured stream.

## dtctl / CLI

- **zsh does not word-split unquoted variables**: `C="--context x"; dtctl get $r $C` passes one malformed argument. Write `--context <name>` inline in loops. **Second bite (2026-07-28):** `${var:+--flag "$var"}` inside a zsh function also expands to a *single* argument — optional flags built this way (e.g. for `runlog.py`) arrive silently malformed. Pass optional flags via explicit conditionals or arrays (`args+=(--flag "$var")`), or use bash. **Third bite (same day, runlog):** `RL="python3 …/runlog.py"; $RL record …` → `no such file or directory` — a batch of 16 record calls all failed this way while the surrounding chain looked fine. Not a dtctl-only issue: alias ANY interpreter+script pair as an array (`RL=(python3 …/runlog.py)` → `"${RL[@]}" …`), never a scalar.
- **`dtctl -o json` does not always emit valid JSON** (two modes, both on real data, 2026-07-28 — `json.loads` and `jq` both fail): (1) **raw control characters** inside strings (multi-line `description` fields) → `Invalid control character`; (2) **invalid escape sequences** (`"bare\-metal\-onpremise"`) → `Invalid \escape`. Hit on `get settings --schema builtin:tags.auto-tagging`, `builtin:management-zones`, `get apps`, others. Both modes (and the envelope split below) are handled by the shared loader — **`.dt-eval-common/dt_json.py`: `load_dtctl_json()` / `load_dtctl_file()`** — use it for every dtctl output parsed in Python. Manual fallback: `json.loads(text, strict=False)` clears mode 1; mode 2 needs a pre-pass rewriting any backslash not starting a legal JSON escape (`\\ \" \/ \b \f \n \r \t \uXXXX`). Parse-failure on a probe is a **retry-with-lenient-loader** situation, never "probe failed → ⚪".
- **dtctl output shape is inconsistent across commands**: some return a bare array (`get buckets`, `get anomaly-detectors`, `get workflows`), others the agent envelope `{"ok":…, "result":…, "context":…}` (`get settings`, `get lookups`, `get slo-templates`, `get copilot-skills`, every `query`, `inventory`) — a naive `len(payload)` on an envelope returns 3 (its key count), not the row count. Always unwrap: if the top level is an object with both `ok` and `result`, take `result` (and treat `ok:false` as the error, with the API message); expect either shape from any command — the split is not documented and may shift with agent-mode auto-detection. **Two zero-row shapes break naive counters even after unwrapping** (verified live 2026-07-28): `{"ok":true,"result":null}` (e.g. `get aws|azure|gcp connections` with none configured — `null`, NOT `[]`) and a DQL match of zero rows returning `{"kind":"records"}` with the `records` key **absent**. Both are genuine zero-row results — **a null/absent `records` with `ok:true` is zero rows; only a non-ok payload or an explicit `NOT_AUTHORIZED` is ⚪.** `dt_json.rows()` normalizes all of it to a plain list — use it instead of hand-rolled `len(payload)`.
- `dtctl get workflows -o json` includes the full `trigger` object inline — no per-ID describes needed. Executions field is `state` (not `status`).
- `dtctl get aws|azure|gcp connections|monitoring` exist as nested subcommands (not in the flat resource list).
- **`dtctl get users` / `get groups` can fail with rc=1 and EMPTY stderr/stdout** (verified live 2026-07-28) — no API message on either stream, so a runner records a bare `error` and the analyst cannot tell a permission gap from a transport failure. Treat this silent mode exactly like a 403: record the probe **⚪ naming the `account-idm-read` scope ask** (never plain `error`). Distinct from the enumeration-400 mode (an API constraint, not a scope gap — see probes-config.md A19): `get users` → `400: Mandatory query param partialString or uuid`, and **`get groups` has the same constraint** (`400: Mandatory query param partialGroupName or uuid`, verified live 2026-07-28) — a 400 on either is "enumeration not available via the CLI", never a scope ask; worth raising upstream with dtctl.
- **`dtctl get classic-pipelines-translation logs` is a read-only classic→OpenPipeline translator (migration-readiness signal) — but the endpoint can return HTTP 500; treat as not-assessable.** When substantive output exists (classic config still present), grade the migration by **enabled/total per group**, not total: the `processing`, `metricExtraction`, `davis`, and `storage` groups each carry enabled counts that reveal whether classic stages are actively routing data (not just configured). Observed: `davis` 1/54 enabled, `metricExtraction` 31/37 enabled — a total-only reading inverts the migration conclusion.
- `dtctl history <resource> <id>`: "No history" = never edited since creation — a maintenance-staleness signal.
- **Segment effectiveness (A6) — evaluate, don't count (verified live 2026-07-11).** `dtctl get segments -o json` returns per segment: `uid`, `name`, `isPublic`, `owner`, and `variables` (`{type:"query", value:"<DQL>"}`). The `variables.value` DQL populates the segment's filter dropdown; **run it and count rows** to test effectiveness: 0 rows = dead segment (typo'd filter or references entities/tags that don't exist), and **a segment with no `variables` block at all is an empty placeholder**. Gotcha: a filter matching demo namespaces (`easytrade`/`astroshop`) or demo hosts on a real tenant = a segment copied from a demo tenant and never adapted — it returns 0. Live case: 8 segments, 5 effective (K8s namespace 325, ServiceTag 1000+, Host Group 77, K8s cluster 46, Cloud Provider 2), 3 dead (one demo-copy returning 0, two empty placeholders "Four"/"Two"). The queries are cheap (entity/Smartscape fetches). Same dead-config pattern as D5 dead-detector-inputs and empty custom buckets.
- **Config-posture schemas A39–A50 (verified live on `playground` 2026-07-11):** the settings catalog is ~355 schemas; these close finding gaps beyond A1–A38.
  - **Deep-monitoring exclusions (`builtin:process-group.monitoring.state`, FAQ-12 §4.2) are `PROCESS_GROUP`-scoped, `multiObject:false`** — a no-scope read returns **0**, so there is NO cheap tenant-wide list. Detect tenant-wide via telemetry (Full-Stack host in B3 whose PGs emit no spans B17/services B7); read the authoritative per-PG object only for flagged PGs (`--scope <PG-id>`). Check `dtctl describe settings-schema <id>` for `allowedScopes` before assuming an environment read works.
  - **`builtin:failure-detection.service.general-parameters` = 0 objects means all-default failure detection** (not an error) — the platform's default "failed request" definition is in force; error-rate findings (B17/B25) rest on it.
  - **`builtin:service-detection-rules`** (`value.{enabled, rule}`), **`builtin:span-capturing`** (`value.spanCaptureRule` — ignore-rules cut trace ingest), **`builtin:alerting.maintenance-window`** (`value.{enabled, filters, schedule}` — standing windows suppress alerts; config side of the EC 40%-under-maintenance finding), **`builtin:networkzones.zones`** (`value.{id, alternativeZones, fallbackMode}` — config side of B15 zone topology), **`builtin:logmonitoring.log-storage-settings`** (`value.{matchers, send-to-storage, enabled}` — classic pre-OpenPipeline log routing) all confirmed live.
  - **`builtin:davis.anomaly-detectors`** (`value.{analyzer, enabled, title, source}`) is the **Gen3-native** Davis detector surface — score detection capability here, distinct from A2 (classic custom `anomaly-detectors`) and A13 (classic `metric-events`). `dtctl get analyzers` lists the Davis analyzer *catalog* (Forecast/Seasonal/Novelty/LogPattern) — capability color, not per-tenant config.
  - **Extension shelfware:** `dtctl get extensions` field is `extensionName`; `dtctl get extension-configs <extensionName>` returns its monitoring configs (0 = installed-not-collecting). "access denied to extension X" = X isn't installed — iterate only the installed list.
  - **`builtin:oneagent.features` is huge (490 objects live)** — never dump it; filter to features relevant to a surfaced finding.
- **`timeout` does not exist on macOS** (rc=127; GNU coreutils ships it as `gtimeout`) — and the failure mode is nasty: rc=127 with a zero-byte output file looks like a probe that returned nothing rather than a command that never ran. Use `gtimeout` when coreutils is installed, or the portable fallback `perl -e 'alarm shift; exec @ARGV' 110 dtctl …`.
- **`--jq 'length'` returns the agent envelope, not a bare number** — `dtctl get dashboards -o json --jq 'length'` prints `{"ok":true,"result":186,"context":{}}`; any script doing `int(output)` fails. Route every `--jq` result through `dt_json.load_dtctl_json()` like any other dtctl output.
- **The same trap bites shell-variable capture even when `--jq` selects a single scalar field (verified live 2026-08-07).** `OID=$(dtctl get settings --schema <s> -o json --jq '.[0].objectId')` does NOT put the bare object ID in `$OID` — it puts the whole `{"ok":true,"result":"<id>","context":{}}` envelope, because `--jq` filters what dtctl prints, not what the shell captures; the shell has no way to know a `--jq` filter is "supposed to" return a scalar. Feeding `$OID` straight into a second `dtctl describe settings "$OID"` call then fails confusingly (a 404 with the whole JSON blob as the "id"). For ad-hoc one-liners, extract from a saved raw file with external `jq -r '.result…'` instead of chaining `--jq` output through a shell variable — the two unwrap differently and only the external-`jq`-on-a-saved-file path is safe to assume unwrapped.
- **Never run `dtctl ctx token`** (prints the credential). Global `--check-scopes` predicts required scopes without executing — use it in preflight to pre-declare ⚪ areas.
- **`dtctl inventory` (new in 0.35) — the preflight data-existence map.** Read-only, budgeted battery of DQL discovery queries; nothing persisted server-side. Reports fetchable vs query-only data objects, buckets + segments, the entity-type census, and capabilities present/absent/unknown **with the evidence cited for every absent capability**; `unknown` = could-not-check (failed probe / exhausted budget), never absent — the same semantics as ⚪. Defaults: `--budget-queries 100`, `--budget-seconds 300`, **`--scan-limit-gbytes 25` per discovery probe — always tighten to 5 on customer tenants** (25 GB/probe is over the cost guardrails for this tenant class). Custom capability definitions mergeable via `--definitions file.yaml`. 0.35 also caches the OAuth access token (~0.5–1 s saved per command — material across a ~90-probe run).
  **Output shape (verified live on `playground`, dtctl 0.35.0, 2026-07-28 — 4 queries / ~29 s at `--scan-limit-gbytes 5`):** with `-o json` from a script the output is the **agent envelope** `{ok, result, context}` — the inventory document lives at **`.result`**, so always unwrap (`jq .result`). `.result` fields: `context` (name), `generatedAt`, `capabilities` (**plain string names of *present* capabilities**, e.g. `["aws","logs","rum","spans",…]` — no per-capability evidence objects), `absent` (array of `{name, evidence}`, e.g. `{"name":"gcp","evidence":"no GCP_* entities in the live census"}`), `entityTypes` (object, TYPE → live-census count — sourced from Smartscape, so it includes types `fetch dt.entity.*` misses, e.g. `ACTIVEGATE`), `dataObjects` (fetchable stream names), `queryOnly` (catalog objects without fetch support — `metrics`, `smartscape.nodes/edges`), `entityViews` (count), `buckets` (name strings), `segments` (`{uid, name, description}`), `notes` (advisory strings worth reading — they encode the fetch-vs-smartscape and events-vs-davis divergences), `discovery` (`{queries, seconds}`). An `unknown` array was **not observed** on this run (every probe completed) — its shape is still unconfirmed; treat any capability missing from both `capabilities` and `absent` as unknown/⚪.
  **`absent` is ENTITY-CENSUS-scoped (verified live 2026-07-28): it means no *entities* of that type are modelled — metric DIMENSIONS from the same cloud/platform may still be fully populated** (extensions ship `aws.*`/`k8s.*`/`azure.*` metric dimensions without creating the entities). Never infer dimension absence from entity absence: on a tenant whose inventory said `aws` and `k8s` were absent, 7 of 10 ready-made segments resolved real values (42 distinct `aws.account.id`, 8 `k8s.namespace.name`, …) — a "segments target dimensions that do not exist" conclusion drawn from the inventory had to be retracted from two reports. The only valid test of a segment's dimension is running its `variables` DQL (A6).
- OAuth SSO sessions carry the *user's* IAM permissions — the ⚪ map can differ from a platform-token run on the same tenant. IAM `users`/`groups` listings may 403 or demand query params depending on tenant IAM shape.
- **Custom-domain CNAMEs work transparently** (`https://<alias>.apps.dynatrace.com`) for login, contexts, and all commands.

## Metric-ingest rejections — reason → remediation (verified across 7 tenants, 2026-07-29/31)

- **`Timestamp too old` is the DOMINANT reason, not cardinality overflow.** 5 of 7 tenants showed rejections and it was the *only* reason on every one of them; dimension overflow appeared on exactly 1. Probe text that leads with cardinality is leading with the rare case — read `rejectionreason` and report what the tenant shows.
- **`Timestamp too old` → the publisher is stamping logical/batch time instead of ingest time**, or a misparsed log date is producing a systematically old timestamp. Fix at the publisher. For genuinely historical values, publish as a **business event** (arbitrary timestamps accepted) rather than a metric — metrics enforce an ingest window and will keep rejecting, so no amount of retrying helps.
- **`Dimension limit reached for metric` → an exploding dimension**; drop it or bucket it to a bounded set at the publisher. Live: ~886k rejections/7d on one metric family.
- **The finding is the detector intersection, not the rejection count.** Rejected keys that no detector watches are a data-quality issue; rejected keys that a `timeseries` detector watches are *silently starved detectors* — live, 521k rejected datapoints/week across 13 `log.infra.*` keys under ~958 log-metric detectors. Compute the intersection in code (B40b), never by eye.
- **Sequencing: fix ingest before re-tuning detectors.** A threshold calibrated against a holed series is calibrated against the holes and must be redone after the ingest repair. When the B40b intersection is non-empty, ingest repair outranks every threshold change in the `/dt-eval-prob` plan.

## OpenPipeline metrics scope, duplicate-collector detection & pipeline consolidation — A54/B50/D6 (VERIFIED LIVE 2026-08-07 on `playground`, dtctl 0.36.0)

- **🔴 `settings-schemas` discovery cannot be trusted to find ANY `openpipeline.<scope>.*` schema — the single most important correction from this run.** Neither `test("openpipeline";"i")` nor the broader `test("open.?pipeline";"i")` surfaced `builtin:openpipeline.logs.routing`, `.logs.pipelines`, `.metrics.routing`, or `.metrics.pipelines` in the schema listing — all four are real and populated (17/1/10 objects respectively on `playground`) and readable directly by name. The broader regex instead surfaces 16 `builtin:internal.open-pipeline.*` schemas that **are not the same objects** (`builtin:internal.open-pipeline.pipelines` returned 0 objects on the same tenant where the real `openpipeline.logs.pipelines` returned 17 — a decoy, not a fallback). **This means A21/A22's own "discover the schema set first" instruction is unsafe as written on dtctl 0.36.0** — keep the discovery call as an informational cross-check, never as the gate before reading a named schema, and never report a scope's absence from discovery output as evidence the scope doesn't exist.
- **A54's actual finding on `playground`: metrics ARE OpenPipeline-routed.** `openpipeline.metrics.routing` has 1 enabled entry ("OpenTelemetry Host Monitoring") into a 10-pipeline `openpipeline.metrics.pipelines` set — confirming Case (a) of the original design, reached by direct-name-guessing per A23's pattern (extended to include `metrics`), not by discovery.
- **Extension-owned pipelines will masquerade as both "orphans" (D2) and "duplicate families" (D6) if you skip the `externalId` check — this is the second major correction.** All 10 metrics pipelines on `playground` carry `externalId` starting `com.dynatrace.extension.*` (Cisco/Juniper/generic-SNMP/Postgres/MySQL/MariaDB/Oracle/SQL-Server/OpenTelemetry) — including 9 of the 10 that have no routing entry at all, and including two (Cisco and generic-SNMP-device) whose processing stages are structurally identical enough to pass D6's exact-duplicate test. Neither is a real finding: extension-bundled pipelines aren't routing-table-dependent and aren't a customer's to merge. **The discriminator: `com.dynatrace.*` — the WHOLE namespace, not only `.extension.` — = platform-owned, exclude; `monaco:*` or null = customer-authored, in scope.** D2 and D6 (step 0) both now require this partition before any orphan/duplicate/family read. **WIDENED 2026-08-10 by a second live tenant:** a pipeline carrying `com.dynatrace.filesystem_filesystem-metrics` is plainly Dynatrace-supplied but does not match the `.extension.` prefix, so the narrow rule filed it as customer-authored AND unrouted — a false orphan, the exact finding class this partition exists to prevent. Widening is safe in the other direction: a customer cannot author a `com.dynatrace.*` externalId, that namespace is set by Dynatrace provisioning.
- **D6 validated on a real, customer-authored near-duplicate family.** The `cisco-asa` and `fortinet-fortigate` log pipelines (Monaco-managed, so they pass the ownership filter) are 4-processor `dql` pipelines in identical order, normalizing to an identical target schema (`action`, `src_ip`, `severity`, `source_vendor`, …) — differing only in the vendor-specific parse pattern. This is exactly the "near-duplicate family, deltas are equivalent-shaped, worth generalizing" case D6 step 2 was designed to catch, and it caught it.
- **D6 (pipeline consolidation) has no `by:{}`-equivalent generalization primitive — don't over-promise it in a report.** D5's detector-family fix is a single clean mechanism (add a `by:{}` dimension); D6's near-duplicate-family fix depends on whether the literal deltas between pipelines are actually equivalent-shaped — that is a per-family judgment call, not a mechanical rewrite, even once ownership is confirmed customer-side. Report exact-duplicate families (mechanical, safe) and near-duplicate families (a recommendation to evaluate, not a guaranteed merge) as two different confidence levels.
- **Governance drift (D6 step 3) is the trap most likely to produce a wrong recommendation.** Two pipelines with identical processing but different `securityContext`/`storage`/`costAllocation` are not accidental duplicates by default — verify with the owner whether the split was deliberate before ever naming a merge in a report; the field cost of being wrong here (silently reassigning a source's security context) is far higher than D5's threshold-drift analog. Not yet observed live (no governance-drift family surfaced on `playground`) — the mechanism is unverified until one does.
- **B50 ran clean but found nothing to test the mapping table against.** Zero `custom:`/`telegraf.`/`statsd.` keys on `playground` in a 7-day window, confirmed genuine (not a dark metrics surface — a plain count query on the same tenant returned real volume). The query syntax, timeframe rule, and dedup discipline are now verified; the collector→native-equivalent mapping table itself remains unconfirmed against a tenant that actually runs a third-party collector.
- **This trio closed a genuine gap, not duplicate work.** Before adding it, OpenPipeline effectiveness for *logs* was well covered (A21–A23, A29, A38, A46, D2) and metric-ingest *health* was covered (B40 rejections/cardinality, A49 OTel config, B33 extension volume) — but nothing checked OpenPipeline's metrics-scope coverage specifically, and nothing checked for metrics accepted-but-redundant with a native signal (B40 only catches metrics *rejected* during a migration, a data-loss finding, not a redundancy one).

## Re-issuing a delivered report — hand-work, deliberately (decided 2026-07-31)

- **Re-issue is NOT a supported skill operation.** There is no rebuild-from-`run.json`-plus-delta mode and no `results.reissue_of` field; do not invent one mid-run.
- **Never splice into a built `.docx` body.** The ~45-document sweep of 2026-07-29/30 did exactly that — loading a delivered file, appending paragraphs, and moving XML elements before an anchor heading. Two failure modes followed: anchor lookup by heading text silently missed on ~8 documents built by different skills with different section titles (content landed at the end instead), and a later pass identified its own new elements with `id()` on lxml proxies, whose addresses dangle once the proxies are garbage-collected — it then **moved a pseudo-random subset of pre-existing elements**, permuting 3 of 13 documents. One reached the owner as an "incomplete document"; all passed the text-level hygiene scan. `verify_docx.structural_findings()` (v1.17.3) now catches the scrambling, but the correct move is not to splice at all.
- **The supported shape:** append **one clearly-labeled section** at the end, built with `docx_style` helpers (`finding_section`, `styled_table`) so it carries house style rather than a hand-rolled approximation, and save as a new `(vN)` — never overwrite a delivered file. If a re-issue needs to change the body, **rebuild the report from the skill** rather than patching the artifact.

## Report-shaping lessons

- **Config ↔ observation cross-checks find root causes counts can't**: bucket lifetime records vs 24 h recency ("billions lifetime + 0/24 h = routing regressed"); routing-table entries vs observed default-bucket share; deployment default-mode vs fleet mode split; pipeline enrichment stages vs record-level field coverage (a 1:1 match between null-share and catch-all share = config absence, not ingest bug); host tags vs record fields (tags at source don't reach records without pipeline enrichment).
- Every tenant profiles differently — the same toolkit produced: "built design, switched off", "demo breadth, operating gaps", "production discipline, propagation debt", "mature capabilities, governance gaps", "config-layer only". Let the evidence pick the story.

## Result caps & date rollover (verified live 2026-07-16)

- **`metrics` reads truncate silently at 1,000 records** (dtctl default `--max-result-records`; the
  truncation warning goes to stderr and is easy to lose in scripts). For any distinct-key inventory:
  `metrics | filter … | dedup {metric.key} | fields metric.key` **plus `--max-result-records 30000`**.
  And `metrics | filter … | summarize count()` counts rows/series, NOT distinct keys — on the same tenant
  the same filter returned ~14k rows but only ~100 distinct `log.*` keys. A liveness/dead-detector
  finding computed from either trap is wrong in the customer's favor or against — always dedup + raise
  the cap + spot-verify one live and one dead key with `timeseries`.
  **⚠️ A raised cap is still not proof of completeness (verified live 2026-07-28):** on a large
  production tenant, `dedup {metric.key}` at `--max-result-records 30000` returned 606 keys while keys
  provably present were missing from the list — a targeted `filter contains(metric.key, "…")` returned
  them. **Absence from any full enumeration is unproven.** Existence checks must be per-key
  (`filter in(metric.key, {…})` or `filter metric.key == "<key>"` + a `timeseries` probe). An
  enumeration-based first pass reported 81 dead-input detectors; the per-key-verified figure was 2.
- **`metrics` timeframe rules differ from `fetch`** (each cost a failed round-trip, 2026-07-28):
  `metrics, from:-30d` → `PARSE_ERROR` — the source takes `metrics from:now()-30d` (**no comma**,
  unlike `fetch logs, from:-2m`); and metric **metadata is capped at 10 days**
  (`INVALID_METRICS_TIMEFRAME` beyond) — keep liveness windows ≤ 10d.
- **Sessions cross midnight.** `datetime.date.today()` re-derived at build time pointed at a
  nonexistent `runs/<tenant>-<new-date>/run.json` and a same-day refresh overwrote a completed
  prior-day baseline before the rollover was noticed. Rules now in SKILL.md: pin the run date from the
  run-directory name; before reusing a "same-day" run dir, check the clock — after midnight it's a new
  run dir; a completed prior-day run.json is a comparison baseline and must never be overwritten.
- **Same-day telemetry variance is real**: 2-minute log samples on one tenant ranged 0.94M–2.9M records
  (≈3×) and 5-minute span samples 0.12M–3.5M across one day — cite observed ranges (or state the sample
  time) rather than presenting one sample as the rate.

## OpenPipeline routing & management-zone mechanics (general-use; learned building the Gen3 recipe, 2026-07-24 — Gen3-domain-specific notes moved to [field-notes-gen3.md](field-notes-gen3.md))

- **OpenPipeline schema gotcha (verified live):** `builtin:openpipeline.logs` **errors** — the real
  native-processing surfaces are **`builtin:internal.open-pipeline.pipelines`** (the pipeline set) and
  **`builtin:openpipeline.logs.routing`** (the routing table). Use those for the E4 native signal, and
  discover them with `dtctl get settings-schemas | jq '[.[]|select(.schemaId|test("open.?pipeline";"i"))|.schemaId]'`
  rather than guessing the id.
- **A29 `classic-pipelines-translation` can return a permission error** (it did on playground) → E4
  classic residue is ⚪, graded on native presence — the graceful-degradation path works as designed.
- **`builtin:openpipeline.logs.pipelines` returns only *part* of the pipeline estate — the routing
  table can target pipelines it never lists** (live-verified on a reference tenant: the schema
  returned 5 tech pipelines while routing fed 9 different IDs, **overlap zero**). **Always join
  A21's `pipelineId` set against the objects you read and assert a non-empty overlap** before
  drawing any conclusion about processing, security context, cost allocation, or storage.
  **The usual cause is object-level read-share, NOT pipeline groups** (corrected 2026-07-27 after an
  initial misdiagnosis): `dtctl describe settings <pipelineId>` returning `403 No read share for
  object` means the pipeline exists and is simply not shared with the review identity → the stages
  are **⚪ not assessable**, named with the share required, never reported as "thin" or absent. On
  that tenant the readable 5 were all `extension:*`-owned (world-readable) and all 9 user-created
  ones were denied; the `…logs.pipeline-groups` schema existed but held **0 objects**, so it was not
  the cause. Check read-share first, groups second, scope/pagination third.
- **Never truncate a dtctl error before matching on it.** Settings object IDs run ~140 characters and
  the reason trails them, so `head -c 120` on `403 No read share for object with id <140 chars>`
  hides the reason entirely — a check written that way reported all 9 denied pipelines as readable.
  Match against the full stderr.
- **Routing is ordered and first-match-wins; a trailing enabled `matcher: true` is a catch-all.**
  With one present, every record is routed into a pipeline and **nothing falls through to the
  classic/default flow** — the tenant is native end-to-end for log processing however sparse the
  config looks. Without one, unmatched records really do fall through. These are categorically
  different findings and the check is one `jq` away; run it before characterizing E4.
- **Bucket ≠ pipeline.** `dt.system.bucket == "default_logs"` measures where a record was *stored*,
  not which pipeline *processed* it. A record can be fully OpenPipeline-processed and still land in
  `default_logs` because no bucket-assignment processor fired. A high `in_default` share is a
  **storage-configuration** finding; it is not evidence of immature routing, and inferring the
  latter from the former is a real error to avoid.
- **`managementZones` on the entity tables is an ARRAY — `expand` it before grouping.** Grouping
  directly buckets by the whole membership *combination*, so an entity in three zones produces one
  row for that triple and populated zones silently read as empty.
- **Management zones are best evaluated by dimension, not by object or rule count.** A zone needs one
  rule per entity type to express a single logical statement, so ~6 rules per zone is normal and
  means one idea, not six. Group conditions by tag-key prefix; ~120 zones with ~730 rules reduced to
  four dimensions on a reference tenant. Tag keys differing only by case or a dropped letter match
  **nothing** — count those variants, they are zones scoping less than their author believes.
- **Primary tags (`primary_tags.*`) resolve reliably from `metrics`**, which is what tenant segment
  definitions themselves use; do not assume they are present on the `dt.entity.*` tables. When
  comparing entity populations against a primary-tag dimension, carry the entity through a metric
  (`timeseries … by:{dt.entity.host, primary_tags.application}`) and note that this counts only
  entities *reporting in the window* — a conservative skew, which is the safe direction.
- **Collection reminder:** zsh does not word-split unquoted variables (see the CLI section above) —
  pass every `dtctl` flag explicitly, never via one combined `$VAR`, or the first read fails with
  `unknown flag --context`.

## Delivery/ingest self-monitoring surfaces — dt.sfm.* (general-use; learned during the mz2seg validation sweep, 2026-07-29 — feeds B39/B39b/B40/B41; MZ→Segments-plan-specific notes moved to [field-notes-mz2seg.md](field-notes-mz2seg.md))

- **`dt.sfm.*` self-monitoring surfaces for delivery/ingest health (verified live 2026-07-29 on
  two tenants; sourced from the community Platform Health dashboards, tile queries verified —
  never trusted blind).** Present and dimension-verified: `dt.sfm.server.notifications.
  problem_notifications` (dims `notification.type`, `notification.display_name`,
  `notification.delivery_status` — values `Success` / `Invalid HTTP status code` / `Could not
  connect…` — `http_status_code` as a STRING and null on Email, plus `alerting_profile.
  display_name`, `problem.status`; companion `…problem_notifications_duration`);
  `dt.sfm.server.metrics.rejections` (dims `metric_key`, `rejectionreason`, `description` —
  live: ~886k/7d rejections, reason "Dimension limit reached for metric", on a reference
  tenant); `dt.sfm.server.service_calls.{received,processed,persisted,persisted.data_size}`
  (capture rate = processed/received; 100% at ~18M calls/24h on the reference tenant);
  `dt.sfm.server.anomaly_detection.metric_events.monitored_dimensions` (by `dt.config.name`);
  `dt.sfm.server.metrics.ingest.external_datapoints(_by_source_address)`. **The delivery
  counter is the authoritative alert-delivery read** — on a production tenant it named a
  ServiceNow integration failing tens of thousands of deliveries over 7 days with a constant
  HTTP 401, where execution sampling could only report "most of the recent runs errored".
- **`dt.sfm` quota/cardinality family is NOT uniformly on Grail (2026-07-29):**
  `dt.sfm.server.metrics.{custom_metrics,custom_dimensions,builtin_dimensions,
  custom_metrics_usage,custom_dimensions_usage,builtin_dimensions_usage,
  metric_dimensions_usage,high_cardinality_dimensions}` and
  `dt.sfm.billing.fullstack.maximum_included_trace_volume_per_minute` were absent from the
  9-day Grail metric enumeration on BOTH verification tenants, while the classic selectors for
  the same data exist (`dsfm:server.metrics.…` with `:filter(not(existskey("dt.tenant.uuid")))`).
  Absence on two tenants is not proven absence everywhere — treat these keys as verify-live per
  tenant; when absent, report "quota proximity not readable via Grail on this tenant", never
  health. (The classic `dsfm:` surface has no dtctl query path — GUI/classic-API only.)
- **`get settings-schemas` (A20) does NOT carry `maxObjects`** — the listing is
  `schemaId`/`displayName`/`version` only (verified 2026-07-29 over 463 schemas); per-schema
  limits require `describe settings-schema`. A51 therefore describes a TARGETED list (~10
  schemas the battery already reads + the known-large caps), never a full-catalog sweep.
- **`dt.sfm` surface availability is per-tenant and has THREE distinct states — separate them or a
  missing check reads as a passed one** (seven-tenant matrix, 2026-07-29/30 sweep):

  | Tenant class | `…metrics.rejections` | `…service_calls.*` | `…notifications.problem_notifications` |
  |---|---|---|---|
  | large K8s estate | present, 88.7M rejections/7d | present, 3.42B calls/24h | present, 37.5k attempts/7d |
  | mid enterprise A | present, **empty** (genuine zero) | present, 542M/24h | present, 8.3k/7d |
  | mid enterprise B | present, 7 datapoints | present, 100M/24h | present, 6.2k/7d |
  | mid enterprise C | present, ~380 datapoints | present, 76.8M/24h | present, 60.5k/7d |
  | large non-prod | present, 521k rejections/7d | present, 106M/24h | **present but ZERO rows** |
  | large production | **ABSENT from the metric catalog** | **present but a single token datapoint** | present, 29k/7d |

  The three states and what each licenses you to say: (a) **key present with real data** → measure
  and grade normally; (b) **key present, zero/near-zero rows** → distinguish *genuine zero*
  (rejections empty on a healthy tenant = ✅) from *nothing configured* (notifications zero rows =
  nothing is being delivered, a finding) from *token series* (see below); (c) **key absent from the
  catalog** → "not readable on this tenant", never health either way.
- **A present key returning a token series is NOT a measurement, and the arithmetic hides it.** Live:
  `service_calls.received/processed` existed on a production tenant but returned a single datapoint,
  so `capture_pct` computed to a perfect **100% from `r=1, p=1`** — indistinguishable in the output
  from a genuinely healthy 542M-call read, and it would have shipped as a ✅. **Every sfm-derived
  ratio needs a minimum-volume guard** (B41 uses `if(r >= 10000, …)`; the same reasoning applies to
  dropped/rejected shares and per-gate percentages): state the denominator alongside any percentage,
  and below the floor report the raw counts plus "not measurable", never a number.
- **Volume-sorted delivery reads hide failures — the failure-filtered query is mandatory (B39b).**
  On 3 of 7 tenants in the sweep, B39's `sort total desc | limit 20` read "all Success" while a
  `NOT matchesValue(delivery_status, "Success")` follow-up found live failures the busy healthy
  lanes had pushed off the list (bounce-list-blocked email on two tenants, an automation hook
  returning 500s on a third). "Top-20 all Success" is never a delivery ✅ on its own. Verified
  `delivery_status` values beyond the obvious: `Email blocked by bounce list`, `Email sent with
  warning. Some recipients were on the bounce list`, `Invalid HTTP status code`, `Could not connect
  to the specified URL`.

## Upgrade-readiness surfaces B42–B46 (verified live 2026-07-31 across four tenants)

Reproduced from the platform's own ready-made **Check your upgrade readiness** dashboard
(`dynatrace.upgrade.readiness.migration-status`, app `dynatrace.upgrade.readiness`, `isPrivate: false`).
Its two lookup tables are transcribed in [classic-to-native-map.md](classic-to-native-map.md).

- **`dt.sfm.server.management_zones.queries_counter` EXISTS** — dimensions
  `dt.management_zone.id`, `dt.management_zone.name`; described in-tenant as *"Tracks which
  Management Zones are queried and how often."* This is the surface the mz2seg spec and SKILL.md
  both recorded as nonexistent ("query activity has no probe surface; never phrase as measured
  usage"). **That caveat is retired** — `unused` is now measured (B42/V43). Two limits survive and
  belong next to every number: absence from the census means *"no queries observed in the window"*,
  and self-monitoring retention is short, so a zone driving a quarterly review reads silent on 7 days.
- **Classic-app opens are `event.kind == "AUDIT_EVENT"`, NOT `CLASSIC_TRACKING_EVENT`.** Filter on
  `event.provider == "CLASSIC_APPS"` + `event.type == "app.opened"` — the provider is the reliable
  discriminator (`CLASSIC_TRACKING_EVENT` appears in the source dashboard but did not match on any
  tenant checked). Useful sub-fields: `dt.app.id`, `user.id`, `details.page_dashboard_id`.
- **🔴 `authentication.token` comes back CLEARTEXT** on `AUDIT_EVENT`/`CLASSIC_API` rows —
  `dt0c01.` + 24 chars, the token's *public* identifier (a full token is
  `dt0c01.<publicId>.<secret>`), so not a usable credential but a token identifier all the same.
  Registered in the security policy with marker `***REDACTED_TOKEN_ID***`; `redact.py` carries both a
  key rule and a narrow value-shape rule (`TOKEN_ID_RE`). **Never alias the field in the probe query**
  — redaction matches whole key names, so `caller = authentication.token` writes cleartext to the run
  directory. Note `user.id` reads `UNKNOWN` on these rows, so the token is the *only* attribution,
  which is exactly why it gets copied into reports if you let it. Some classic paths also embed the
  tenant ID (`/e/<tenantid>/api/…`) — strip it, that is a rule-5 leak.
- **🔴 THE TWO CALIBRATIONS — raw counts on both new caller probes massively overstate customer debt.**
  Learned by running them, not by reading the dashboard:
  1. **Classic-passthrough volume is mostly Dynatrace's own apps.** `API_GATEWAY` rows on
     `/platform/classic/*` are dominated by `dynatrace.appshell`, `clouds`, `infraops`, `synthetic`,
     `kubernetes`, `extensions.manager` and a large null-`dt.app.id` bucket. That is **Dynatrace's**
     migration debt. Restrict to customer-authored artifacts (dashboards / notebooks / anomaly
     detectors / automations, or a non-null workflow id). `event.provider == "CLASSIC_API"`
     (token-authenticated) is customer traffic by construction and needs no such filter.
  2. **Never report the raw `CLASSIC_ENTITY_MIGRATION_ADVISED` share.** On a reference tenant it was
     **~83% of all successful query executions** — and **~92% of the flagged executions had a null
     `client.application_context`**, with most of the attributable remainder coming from Dynatrace's
     own first-party apps. The customer-owned portion was a small fraction of the headline. The
     reportable number is **how many customer-authored documents need rewriting, named** — a
     worklist, never a percentage. `flags` is an ARRAY, so `in("…", flags)` is the correct test.
- **🔴 `dt.sfm.openpipeline.routing.records` has NO pipeline dimension, and the throughput ratio is
  not an adoption measure (correction, same day).** `dt.openpipeline.pipeline`, `pipeline`,
  `dt.openpipeline.pipeline.id`, `dt.openpipeline.route`, `dt.openpipeline.configuration`,
  `dt.openpipeline.endpoint`, `record_type` — **all return one null bucket**; DQL returns null for an
  unknown dimension rather than erroring, so the grouping looks like it works. Only
  `dt.openpipeline.source` is populated. And `pipelines_out / ingest_sources_in` read **100.0%** and
  **99.8%** on two tenants whose configured estate was one routing entry and 2–3 pipelines — the
  **default** pipeline counts, so the ratio is ~100% on any platform tenant. **E4 stays graded on the
  config side (A21/A22/A29);** B45 gives ingest scale per source and a liveness check (a ratio
  materially below 100% is the real signal). The family is
  `dt.sfm.openpipeline.{ingest_sources_in,routing,pipelines_out}.records`.
- **🔴 Redaction must PSEUDONYMIZE token identifiers, not collapse them.** A constant marker merged 14
  distinct integrations into one caller on a live tenant — and a merged group is indistinguishable
  from a real one downstream, so nothing flags the loss. `user.id` is `UNKNOWN` on `CLASSIC_API` rows,
  making the token the only discriminator. `redact.py` now emits `***REDACTED_TOKEN_ID_<8hex>***`
  (truncated SHA-256 of the public identifier — one-way, stable across runs so an integration keeps
  its alias between reviews). Generalize the lesson: **when redacting a field that is also a join or
  grouping key, pseudonymize; only flatten fields with no analytical role.**
- **`dt.sfm.openpipeline.routing.records` exists** with `dt.openpipeline.source` resolving to real
  ingest lanes (`oneagent`, `rumagent`, `/api/v2/logs/ingest`, `/api/v2/otlp/v1/traces`,
  `com.dynatrace.extension.*`, cloud forwarders). **A null-source bucket is normal and is often the
  largest row** — residual attribution, not "unrouted data"; report the named lanes and say a
  residual bucket exists.
- **Scale note for `dt.system.events`:** a large estate showed **millions of `CLASSIC_API` audit
  events per day**. It is a small dedicated bucket, but scope the window anyway (`from:-24h`, or
  `-2h` on the largest estates) and keep the `limit`.

## Access model & service detection — B47 / A52 / A53 (verified live 2026-07-31)

- **`PLATFORM_PERMISSION_READINESS_EVENT` exists and is a DAILY SNAPSHOT.** Carries
  `legacy_permissions_groups` (classic RBAC) and `default_policies_groups`, both arrays of group
  objects, plus `account.uuid`. **`sort timestamp desc | limit 1` is load-bearing** — aggregating a
  week of snapshots multiplies the estate. A reference tenant read **20 groups on classic RBAC roles
  against 5 on default policies**. `account.uuid` identifies the customer account and must never
  reach a deliverable (rule 5); group names are organizational identifiers, fine internally,
  generalized externally.
- **B47 is a SECOND surface for group permissions, and that is its real value.** `/dt-eval-mz2seg`
  blocks every retire-\* zone disposition while the access job is unmeasured, and A19 (IAM groups)
  403s on some tenants. B47 reads permissions from Grail self-monitoring instead, so it still
  establishes whether classic role bindings exist — but **it never says which zone a binding
  scopes**. It therefore moves `access-unknown` → `access-classic-roles-present` and **never releases
  a retirement**. Wired into `analyze_mz2seg.py`; the HARD RULE is unchanged.
- **Service-detection schemas are dtctl-readable; failure-detection often legitimately returns 0.**
  Live on a reference tenant: `builtin:service-detection.full-web-request` 4 objects,
  `.full-web-service` 3, `builtin:failure-detection.environment.rules` **0**,
  `.parameters` **0**, `builtin:enhanced-endpoints-for-sdv1` 1. **0 objects = no rules of that kind
  = ✅ for that family, never ⚪** — do not report a missing global failure-detection rule set as an
  unassessed gap.
- **Verified object shape** (matches the dashboard's flag logic exactly): `value` carries
  `conditions`, `enabled`, `idContributors`, `managementZones`, `name`; a condition carries
  `attribute`, `compareOperationType`, `ignoreCase`, `tagValues`. **`managementZones` is a list that
  exists on every object — test emptiness, not key presence.** Enhanced Endpoints `value` carries
  `enabled` and `resolveRequestAttributes`.
- **⚪ Two of Dynatrace's four rule families are NOT dtctl-reachable.** *Request Attributes* and
  *Request Naming* have **no settings schema** (`builtin:request-attributes` 404s) and **no `dtctl`
  verb** (the `get` resource list has neither) — they live on the classic config API. Their flag
  criteria are recorded in the A52 recipe so the gap is *specified*, not merely admitted, and the
  report footnotes the surface that would include them. Both endpoints are **VISIBLE** in the
  post-upgrade API map: they survive the upgrade, so the rules keep working as API objects while
  still needing the scope rework — **"endpoint survives" is not "no work required."**
- **`builtin:settings.calculated-service-metrics` does NOT exist** (404 on a reference tenant), and
  a `metric.series | filter startsWith(metric.key, "calc:service.")` probe returned nothing. The
  calculated-service-metrics domain has **no verified surface yet** — do not build it on either of
  those assumptions without re-testing.

## A19 groups/users cannot enumerate — it is a 400, not a 403 (verified live 2026-07-31)

The catalog and both migration skills describe A19 as "403 → ⚪ footnote", i.e. a *permission*
failure. On two live tenants it fails differently and more fundamentally:

```
dtctl get groups → API error (400): Mandatory query param partialGroupName or uuid was not provided
dtctl get users  → API error (400): Mandatory query param partialString or uuid was not provided
```

**This is a contract failure, not a grant failure — it cannot succeed on any tenant, at any scope.**
The account-management API refuses to list without a name fragment or a uuid. `dtctl get groups
--filter=<str>` works but enforces `size must be between 3 and 320`, so there is **no enumeration
path**: a full census would need a 3-character sweep (~17.6k requests) and even that guarantees
nothing. `--filter` is a *lookup* tool — useful once you already have a candidate group name, useless
for a census.

**Two consequences, and they compound:**
1. **`iam:groups:read` is also rarely granted in practice** (owner, 2026-07-31). So even when the
   call is fixed, the scope usually is not there.
2. Therefore **the management-zone access job is effectively never measurable from A19**, on most
   engagements, for two independent reasons. **B47 is not a fallback — treat it as the primary
   access signal** and A19 as the exception that occasionally adds specificity.

**What this does NOT change:** B47 establishes *that* classic role bindings exist, never *which zone
each one scopes*, so the mz2seg HARD RULE stands — no zone is finally dispositioned retire-\* until
bindings are verified. The plan says so and holds the retirements; that is the designed behavior,
not a degraded one. Live: both tenants ran with `access_measured: false` and
`classic_roles_present: true`, and every zone carried `access-classic-roles-present`.

## Field discovery: a one-record sample cannot prove a field is absent (2026-07-31)

**The mistake, recorded because it produced a confident wrong statement.** To find out whether
classic-dashboard open events carry a title, a single event was fetched with `limit 1` and its
non-null keys listed. `details.page_dashboard_name` was not among them, and the conclusion drawn was
*"the events carry the ID but no title — every populated field was checked."*

**That is not what the sample showed.** It showed the fields populated **on one record**. The field
exists — the platform's own upgrade-readiness dashboard reads it — it is simply unpopulated here.
The correct probe is an aggregate over the window:

```
fetch dt.system.events, from:-30d
| filter event.provider == "CLASSIC_APPS" and dt.app.id == "dynatrace.classic.dashboards"
| filter event.type == "app.opened"
| summarize total = count(), withName = countIf(isNotNull(details.page_dashboard_name))
```

which answered it properly: **0 of 15,531 events across two tenants over 30 days**. Same conclusion
for these tenants, arrived at by evidence that supports it — and it now also says the field is worth
reading, because a tenant where it *is* populated gets its classic dashboards named for free.

**Generalize it:** to claim a field is unavailable, count non-nulls over the window. `limit 1` +
"these are the populated keys" answers a different question, and DQL will not object — an unknown
field is null, not an error, so the two failure shapes are indistinguishable from one sample.

**Two DQL idiom traps found in the same read:**
- **`collectDistinct` KEEPS nulls** — verified: `["x","y",null]`. `collectDistinct(f)[0]` can
  therefore be null. Use `arrayRemoveNulls(collectDistinct(f))[0]`.
- **`takeFirst` after `sort timestamp desc` returns the NEWEST value**, which is null whenever the
  most recent event lacks the field — so a sparsely-populated field reads as absent. Collecting
  non-nulls across the window is strictly stronger. (The vendor's own tile uses the `takeFirst`
  construction with a `coalesce` fallback to the ID; ours collects instead.)

## Zone definitions vs. zone consumers — two different reads (verified 2026-07-31)

Worth stating plainly because the two get conflated, and the conflation makes the migration plan
look more blind than it is.

**Management-zone DEFINITIONS are fully reachable** via `settings:objects:read` — that is **A17**
(`builtin:management-zones`), and it is the backbone of the whole dimension map. Live on a reference
tenant: **323 zones**, each carrying `value.name`, `value.description` and
`value.rules[]` → `attributeRule` → `entityType`, `pgToHostPropagation`, `pgToServicePropagation`,
and `conditions[]` with `key`, `operator`, `stringValue`, `caseSensitive`. Nothing about what a zone
*matches* is hidden.

**What is missing is the reverse index: which things CONSUME a zone.** A zone definition carries no
consumer list, and it cannot — a dashboard filtering on a zone is a fact about the *dashboard*.
Consumers are assembled from the other side (A13 metric events, A14 profiles, A15 notifications,
A16 auto-tags, A19 group bindings), and the one consumer class with no dtctl-reachable side is the
**classic dashboard**, whose filter lives at `dashboardMetadata.dashboardFilter.managementZone`.

**"Just read it from settings" does not work — checked, so it need not be rechecked.** The only
dashboard-related settings schemas on a live tenant are `builtin:dashboards.general` (0 objects),
`builtin:dashboards.presets` (0 objects) and `builtin:dashboards.image.allowlist` (1 object, an
image-domain allowlist). All three are **preferences**; none carries tiles or a zone filter. Classic
dashboard definitions are not in the settings surface at all — see MANUAL-EXTRACTION §9b for the
opt-in classic-API audit, which is usage-driven and has a pre-upgrade deadline.

**So the honest framing in a report:** the zone estate's *intent* is fully measured; its *consumer
list* is complete except for classic-dashboard filters, which is why a retire-\* disposition is
held rather than asserted.

## DPL (Dynatrace Pattern Language) — two things that cause silent failures

Applies whenever writing `parse`, `parseAll`, `matchesPattern`, `replacePattern`, or `splitByPattern` in a DQL query or OpenPipeline rule. Full reference: [BPN FAQ-15](https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/blob/main/FAQ%20-%20Frequently%20Asked%20Questions/markdown/-%5BFAQ%5D-15-how-dpl-works.md).

**1. No backtracking.** A quantified matcher that over-consumes never gives characters back — the pattern fails and returns `null` with no error. A quantified class must never be able to match the delimiter that follows it:

```dql
parse(log.content, "[a-z.]+:x '.' [a-z]+:y")   // "john.doe@corp.com" → null  (class ate the dot)
parse(log.content, "[a-z]+:x  '.' [a-z]+:y")   // → {x:"john", y:"doe"}
```

**2. Masking fails open.** `replacePattern()` returns the input **unchanged** when the pattern does not match — no error, no signal. A broken masking rule deploys cleanly and ships unmasked PII. Syntactic validity (`verify_dql`) proves nothing. Always test against real samples and assert the output differs from the input.

These two failures are invisible in testing and in logs. Both are confirmed against live tenants in BPN FAQ-15 §5 (failure taxonomy) and §10 (diagnostic recipe). The [DPL Grammar docs](https://docs.dynatrace.com/docs/platform/grail/dynatrace-pattern-language/log-processing-grammar) outrank both FAQ-15 and this note on any conflict.

## Why the delivery/ingest probes earn their place (seven-tenant sweep, 2026-07-29/30)

Kept when the improvement log that recorded it was retired — the log's open items moved to
tracked issues, and this evidence moved here because it is the justification for the probes
continuing to run, not a task. Tenants are pseudonymous.

Five of seven tenants produced a finding no prior probe could have surfaced:

- **tenant E:** ServiceNow integrations rejecting **28,160 of 28,972 notifications with HTTP 401**
  over 7 days — a production incident-routing outage, invisible to config reads, only approximated
  by workflow-execution sampling.
- **tenant F:** 521k log-metric datapoints/week lost to stale timestamps, under a detector
  estate built on those keys.
- **tenant A:** 88.7M SNMP sensor readings/week lost to dimension-limit overflow on the network
  monitoring backbone.
- **tenant C:** the busiest custom alert integration failing every delivery (6,228 × HTTP 400)
  while its parallel email lane succeeded.
- **tenant B / tenant D / tenant G:** delivery verified healthy from counters — a ✅ that previously
  could only be asserted.

Two of these (tenant E 401, tenant C 400) are **live operational issues predating the reviews** and
were flagged to the operator for out-of-band escalation.
