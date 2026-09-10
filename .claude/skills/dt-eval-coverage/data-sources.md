# Data Sources — Grail Source per Criterion

Source of truth: `ui/app/queries.ts`.
Version: v2.5.15 · Tenant Review App.

Every criterion runs one or two DQL queries against Grail. This file maps each criterion to its
primary Grail source and lists the required access scopes.

---

## Grail sources at a glance

| Source | DQL form | Scope |
|---|---|---|
| **Metrics** | `timeseries` | `storage:metrics:read` |
| **Entities** | `fetch dt.entity.*` | `storage:entities:read` |
| **Spans** | `fetch spans` | `storage:spans:read` |
| **Logs** | `fetch logs` | `storage:logs:read` |
| **Events** | `fetch events` | `storage:events:read` |
| **Davis problems** | `fetch dt.davis.problems` | `storage:events:read` |
| **Business events** | `fetch bizevents` | `storage:bizevents:read` |

---

## 1. Infrastructure Observability

Multi-source: metrics for live signals, entities for topology, logs for cloud enrichment, spans for cloud span context, Davis problems for detection coverage.

| ID | Check | Primary source |
|---|---|---|
| i1 | Host CPU coverage | metric `dt.host.cpu.usage` |
| i2 | Host memory coverage | metric `dt.host.memory.usage` |
| i3 | Host disk coverage | metric `dt.host.disk.used.percent` |
| i4 | Host availability coverage | metric `dt.host.availability` |
| i5 | Host network coverage | entity `dt.entity.network_interface` |
| i6 | Process CPU coverage | metric `dt.process.cpu.usage` |
| i7 | K8s cluster coverage | metric `dt.kubernetes.container.cpu_usage` |
| i8 | Host disk entity coverage | entity `dt.entity.disk` |
| i9 | Davis problem coverage | `fetch dt.davis.problems` |
| i10 | Cloud workload coverage | entity `dt.entity.cloud_application` |
| i11 | Host-process topology | entity `dt.entity.process_group_instance` |
| i12 | K8s workload mapping | entity `dt.entity.kubernetes_cluster` |
| i13 | Cloud host log enrichment | `fetch logs` (cloud.provider filter, entity join) |
| i14 | Cloud log enrichment | `fetch logs` (cloud.provider field) |
| i15 | Cloud region enrichment | `fetch logs` (cloud.region field) |
| i16 | Cloud AZ enrichment | `fetch logs` (cloud.availability_zone field) |
| i17 | Cloud account enrichment | `fetch logs` (cloud.account.id field) |
| i18 | Cloud span enrichment | `fetch spans` (cloud.provider attribute) |
| i19 | K8s node monitoring depth | metric `dt.kubernetes.container.cpu_usage` (per node) |
| i20 | Cloud namespace metric coverage | metric `dt.kubernetes.container.cpu_usage` (per namespace) |
| i21 | Container restart monitoring | metric `dt.kubernetes.container.restarts` |
| i22 | Container resource limits | metric `dt.kubernetes.container.limits_cpu` |

---

## 2. Application Observability

Primarily spans and entities. Service metric criteria (a5, a6, a7) use `dt.service.*` metrics.

| ID | Check | Primary source |
|---|---|---|
| a1 | Service tracing coverage | `fetch spans` |
| a2 | Service method coverage | entity `dt.entity.service_method` |
| a3 | Root span coverage | `fetch spans` (is_root=true) |
| a4 | OTel instrumentation | `fetch spans` (otel.* or instrumentation.name attributes) |
| a5 | Response time coverage | metric `dt.service.request.response_time` (percentile) |
| a6 | Failure tracking | metric `dt.service.request.failure_count` |
| a7 | Throughput | metric `dt.service.request.count` |
| a8 | Database span coverage | `fetch spans` (db.* attributes) |
| a9 | Messaging span coverage | `fetch spans` (messaging.* attributes) |
| a10 | Multi-service trace depth | `fetch spans` (trace_id grouping, count > 1 service) |
| a11 | Service-process mapping | entity `dt.entity.service` (toRelationships.runsOn) |
| a12 | Service tagging utilization | entity `dt.entity.service` (tags field) |
| a13 | Database call depth | `fetch spans` (db.system countDistinct) |

---

## 3. Digital Experience

Metrics for Web Vitals and RUM; entities for synthetic monitors.

| ID | Check | Primary source |
|---|---|---|
| d1 | RUM action coverage | metric `dt.frontend.user_action.count` |
| d2 | Session tracking coverage | metric `dt.frontend.session.active.estimated_count` |
| d3 | LCP coverage | metric `dt.frontend.web.page.largest_contentful_paint` |
| d4 | INP coverage | metric `dt.frontend.web.page.interaction_to_next_paint` |
| d5 | CLS coverage | metric `dt.frontend.web.page.cumulative_layout_shift` |
| d6 | Frontend error coverage | metric `dt.frontend.error.count` |
| d7 | Synthetic HTTP coverage | entity `dt.entity.http_check` |
| d8 | Synthetic browser coverage | entity `dt.entity.synthetic_test` |
| d9 | Mobile app coverage | entity `dt.entity.mobile_application` |
| d10 | Synthetic location diversity | entity `dt.entity.synthetic_location` |
| d11 | Synthetic availability coverage | entity `dt.entity.http_check` (availability attribute) |

---

## 4. Log Analytics

All 16 criteria query `fetch logs`. The most DPS-intensive capability on large tenants — relevant to cost planning at xLarge scale.

| ID | Check | Filter / field |
|---|---|---|
| l1 | Host log coverage | `dt.entity.host` join against entity count |
| l2 | Service log coverage | `dt.entity.service` join |
| l3 | Log source diversity | `countDistinct(log.source)` vs host count |
| l4 | Dedicated buckets usage | `dt.system.bucket` presence |
| l5 | Trace-correlated logs | `trace_id` field present |
| l6 | Entity-enriched logs | `dt.entity.host` field present |
| l7 | Error log coverage | `loglevel = "ERROR"` |
| l8 | Log severity diversity | `countDistinct(loglevel)` of 5 expected levels |
| l9 | Structured logging | `content` parses as JSON / `dt.process.log_format` |
| l10 | Multi-source host logging | hosts with `countDistinct(log.source) >= 2` |
| l11 | Custom attribute enrichment | custom attribute field presence |
| l12 | Process group log correlation | `dt.entity.process_group` field present |
| l13 | K8s log coverage | `k8s.namespace.name` or K8s entity join |
| l14 | Log retention validation | distinct sources in 24h window vs 2h window |
| l15 | Span-correlated logs | `span_id` field present |
| l16 | Log-based events | `fetch events` where source is log-derived |

---

## 5. Application Security

Events (SECURITY_EVENT type), spans (attack-surface detection), entities.

| ID | Check | Primary source |
|---|---|---|
| s1 | Service security coverage | `fetch events` (SECURITY_EVENT, entity join) |
| s2 | Runtime vulnerability baseline | entity `dt.entity.service` (process group join) |
| s3 | Database interaction security | entity `dt.entity.service` (DB span relation) |
| s4 | Attack detection coverage | `fetch events` (SECURITY_EVENT, attack type) |
| s5 | Error log security coverage | `fetch logs` (loglevel = ERROR) |
| s6 | Warn log security coverage | `fetch logs` (loglevel = WARN) |
| s7 | Security event type coverage | `fetch events` (SECURITY_EVENT type diversity) |
| s8 | HTTP request surface coverage | `fetch spans` (HTTP method/span kind) |
| s9 | Davis security problem coverage | `fetch dt.davis.problems` (security problem type) |
| s10 | Event kind diversity | `fetch events` (countDistinct eventKind) |
| s11 | Failed request coverage | entity `dt.entity.service` (failure rate metric) |

---

## 6. Threat Observability

Davis problems, events (security type), logs.

| ID | Check | Primary source |
|---|---|---|
| t1 | Davis problem entity coverage | `fetch dt.davis.problems` (entity join) |
| t2 | Problem entity correlation | `fetch dt.davis.problems` (affectedEntityIds) |
| t3 | Problem category coverage | `fetch dt.davis.problems` (problemType diversity) |
| t4 | Security event service coverage | `fetch events` (SECURITY_EVENT, service join) |
| t5 | Error log threat coverage | `fetch logs` (loglevel = ERROR, host join) |
| t6 | Log entity enrichment | `fetch logs` (dt.entity.host field) |
| t7 | Event entity correlation | `fetch events` (affectedEntityIds field) |
| t8 | Log source threat coverage | `fetch logs` (countDistinct log.source) |
| t9 | Trace-correlated threat logs | `fetch logs` (trace_id field) |
| t10 | Recurring affected entity detection | `fetch dt.davis.problems` (entity in ≥2 problems) |
| t11 | Problem resolution coverage | `fetch dt.davis.problems` (status = CLOSED) |

---

## 7. AI Observability

All 9 criteria query `fetch spans` filtered for `gen_ai.*` semantic convention attributes.

> **72-hour window** — fixed for all AI Observability criteria. GenAI workloads are bursty; a 2h window returned 0 spans on a tenant with 244,964 gen_ai spans in 72h. This window is load-bearing — do not narrow it.

| ID | Check | span attribute |
|---|---|---|
| ai1 | AI span service coverage | `gen_ai.system` or `gen_ai.provider.name` presence |
| ai2 | Token tracking coverage | `gen_ai.usage.input_tokens` or `gen_ai.usage.total_tokens` |
| ai3 | AI error tracking coverage | `status` = error on gen_ai spans |
| ai4 | AI provider diversity | `countDistinct(gen_ai.system)` of 5 known providers |
| ai5 | Agent invocation coverage | `gen_ai.agent.*` attributes present |
| ai6 | Prompt/response tracing | `gen_ai.prompt` or `gen_ai.completion` present |
| ai7 | Guardrail coverage | `gen_ai.guardrails.*` attributes present |
| ai8 | Cost tracking coverage | `gen_ai.usage.cost` or equivalent present |
| ai9 | AI tracing service breadth | gen_ai spans / total spans ratio |

---

## 8. Business Observability

All 8 criteria query `fetch bizevents`.

| ID | Check | Filter / field |
|---|---|---|
| b1 | Service bizevent coverage | `dt.entity.service` join |
| b2 | Bizevent type diversity | `countDistinct(event.type)` of 10 expected |
| b3 | Events with service context | `dt.entity.service` field present |
| b4 | Bizevent provider diversity | `countDistinct(event.provider)` of 5 expected |
| b5 | Revenue data coverage | monetary value field presence |
| b6 | Session-linked events | `dt.rum.session_id` or session correlation |
| b7 | Trace-linked events | `trace_id` field present |
| b8 | Cost center coverage | cost center / product / billing field present |

---

## 9. Software Delivery

Events (deployment type), metrics, entities.

| ID | Check | Primary source |
|---|---|---|
| sd1 | Service deployment coverage | `fetch events` (DAVIS_EVENT or CUSTOM_DEPLOYMENT, 24h) |
| sd2 | Custom deployment coverage | `fetch events` (CI/CD source markers) |
| sd3 | Event kind diversity | `fetch events` (countDistinct eventKind) of 5 expected |
| sd4 | Event type diversity | `fetch events` (countDistinct event.type) of 10 expected |
| sd5 | Service request baseline | metric `dt.service.request.count` |
| sd6 | Service failure baseline | metric `dt.service.request.failure_count` |
| sd7 | Ownership assignment | entity `dt.entity.service` (ownership tag) |
| sd8 | Davis problem detection | `fetch dt.davis.problems` (service entity join) |
| sd9 | Process group coverage | entity `dt.entity.process_group` (service relation) |
| sd10 | Process group tagging | entity `dt.entity.process_group` (tags field) |

---

## Time Windows

Windows are part of "the metric being validated" — they are load-bearing. Changing a window changes the score.

| Window | Count | Used for |
|---|---|---|
| `now() - 2h` (logs/events timestamp filter) | 56 | Live-signal freshness — logs, events |
| `from:now()-72h` | 27 | Bursty workloads — AI Obs, Davis problems |
| `from:now()-2h` | 13 | Live tracing / metric signals |
| `now() - 24h` | 7 | Security event accumulation, deployments |
| `now() - 72h` | 1 | Long-window log check |

Economy Mode may narrow the executed window from the catalog window (see `ui/app/scale-tier.ts`), but the score formula is unchanged and the difference is disclosed in the UI.

---

## Required Scopes

| Scope | Needed for |
|---|---|
| `storage:metrics:read` | Infra metrics, App metrics, Frontend metrics, Delivery metrics |
| `storage:entities:read` | Topology checks across all capabilities |
| `storage:spans:read` | App Obs tracing, AI Obs, App Security spans |
| `storage:logs:read` | Log Analytics, cloud enrichment, security logs |
| `storage:events:read` | Security events, Davis problems, Software Delivery events |
| `storage:bizevents:read` | Business Observability |

Missing a scope degrades the affected checks gracefully — the app shows the check as unavailable, excludes it from the denominator, and explains what grant would include it.
