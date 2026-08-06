# Pulse Assessment — Data Sources per Capability

Where the metrics validated by each of the 9 capabilities come from in Grail.
Every criterion runs a DQL query against one of these Grail data sources; the
result is a numerator divided by a denominator → coverage %.

Source of truth: `ui/app/queries.ts`. This doc is a consolidated index — when
queries.ts changes, re-run the extraction (see bottom) and update this file.

Version: v2.5.5 (criteria set unchanged in feat/davis-insights branch; see "What actually reaches Grail" for how Economy Mode rewrites the executed windows).

---

## Grail data sources at a glance

| Grail source | Used by | Scope required |
|---|---|---|
| **Metrics** (`timeseries`) | Infra host/process/K8s, Service RED, Frontend Web Vitals | `storage:metrics:read` |
| **Entities** (`fetch dt.entity.*`) | topology/relationship checks across most capabilities | `storage:entities:read` |
| **Spans** (`fetch spans`) | App Obs tracing, AI Obs, some App Security | `storage:spans:read` |
| **Logs** (`fetch logs`) | Log Analytics, cloud-enrichment, security logs | `storage:logs:read` |
| **Events** (`fetch events`) | Security events, Software Delivery deployments | `storage:events:read` |
| **Davis problems** (`fetch dt.davis.problems`) | problem coverage across Infra / Threat / Delivery | `storage:events:read` |
| **BizEvents** (`fetch bizevents`) | all of Business Observability | `storage:bizevents:read` |

---

## 1. Infrastructure Observability  (color #3B82F6)

| ID | What it validates | Grail source |
|---|---|---|
| i1 | Host CPU coverage | metric `dt.host.cpu.usage` |
| i2 | Host memory coverage | metric `dt.host.memory.usage` |
| i3 | Host disk coverage | metric `dt.host.disk.used.percent` |
| i4 | Host availability | metric `dt.host.availability` |
| i5 | Host network interfaces | entity `dt.entity.network_interface` |
| i6 | Process CPU | metric `dt.process.cpu.usage` |
| i7 | K8s cluster coverage | metric `dt.kubernetes.container.cpu_usage` |
| i8 | Host disk entities | entity `dt.entity.disk` |
| i9 | Davis problem coverage (hosts) | `dt.davis.problems` |
| i10 | Cloud workload coverage | entity `dt.entity.cloud_application` |
| i11 | Host-process topology | entity `dt.entity.process_group_instance` |
| i12 | K8s workload mapping | entity `dt.entity.kubernetes_cluster` |
| i13 | Cloud host log enrichment | `fetch logs` (cloud.provider) |
| i14 | Cloud log enrichment | `fetch logs` (cloud.provider) |
| i15 | Cloud region enrichment | `fetch logs` (cloud.region) |
| i16 | Cloud AZ enrichment | `fetch logs` (cloud.availability_zone) |
| i17 | Cloud account enrichment | `fetch logs` (cloud.account.id) |
| i18 | Cloud span enrichment | `fetch spans` (cloud.provider) |
| i19 | K8s node monitoring depth | metric `dt.kubernetes.container.cpu_usage` |
| i20 | Cloud namespace metric coverage | metric `dt.kubernetes.container.cpu_usage` |
| i21 | Container restart monitoring | metric `dt.kubernetes.container.restarts` |
| i22 | Container resource limits | metric `dt.kubernetes.container.limits_cpu` |

> Note: Infra is multi-source — metrics for live signals, entities for topology, logs for cloud enrichment, spans for cloud span context, Davis for problem coverage.

---

## 2. Application Observability  (color #8B5CF6)

| ID | What it validates | Grail source |
|---|---|---|
| a1 | Service tracing coverage | `fetch spans` |
| a2 | Service method coverage | entity `dt.entity.service_method` |
| a3 | Root span coverage | `fetch spans` |
| a4 | OTel instrumentation | `fetch spans` |
| a5 | Response time coverage | metric `dt.service.request.response_time` (percentile) |
| a6 | Failure tracking | metric `dt.service.request.failure_count` |
| a7 | Throughput | metric `dt.service.request.count` |
| a8 | Database span coverage | `fetch spans` |
| a9 | Messaging span coverage | `fetch spans` |
| a10 | Multi-service trace depth | `fetch spans` |
| a11 | Service-process mapping | entity `dt.entity.service` |
| a12 | Service tagging utilization | entity `dt.entity.service` |
| a13 | Database call depth | `fetch spans` |

---

## 3. Digital Experience  (color #EC4899)

| ID | What it validates | Grail source |
|---|---|---|
| d1 | RUM action coverage | metric `dt.frontend.user_action.count` |
| d2 | Session tracking | metric `dt.frontend.session.active.estimated_count` |
| d3 | LCP coverage | metric `dt.frontend.web.page.largest_contentful_paint` |
| d4 | INP coverage | metric `dt.frontend.web.page.interaction_to_next_paint` |
| d5 | CLS coverage | metric `dt.frontend.web.page.cumulative_layout_shift` |
| d6 | Frontend error coverage | metric `dt.frontend.error.count` |
| d7 | Synthetic HTTP | entity `dt.entity.http_check` |
| d8 | Synthetic browser | entity `dt.entity.synthetic_test` |
| d9 | Mobile app coverage | entity `dt.entity.mobile_application` |
| d10 | Synthetic locations | entity `dt.entity.synthetic_location` |
| d11 | Synthetic availability | entity `dt.entity.http_check` |

---

## 4. Log Analytics  (color #F59E0B)

All 16 criteria query **`fetch logs`** with different filters (host coverage,
service coverage, error logs, K8s logs, parsing/enrichment quality, etc.).

| ID range | Source |
|---|---|
| l1–l16 | `fetch logs` |

> Log Analytics is the single most `fetch logs`-heavy capability — relevant for DPS cost at xLarge scale (logs are the largest Grail table on most tenants).

---

## 5. Application Security  (color #EF4444)

| ID | What it validates | Grail source |
|---|---|---|
| s1 | Service security coverage | `fetch events` (SECURITY_EVENT) |
| s2 | Security event type coverage | entity `dt.entity.service` |
| s3 | Database tracing surface | entity `dt.entity.service` |
| s4 | Vulnerable span detection | `fetch spans` |
| s5 | Security-relevant error logs | `fetch logs` (loglevel ERROR) |
| s6 | Security event ingestion | `fetch events` |
| s7 | Security event diversity | `fetch events` |
| s8 | Attack surface spans | `fetch spans` |
| s9 | Security problem coverage | `dt.davis.problems` |
| s10 | Sensitive data spans | `fetch spans` |
| s11 | Security event breadth | `fetch events` (SECURITY_EVENT) |

---

## 6. Threat Observability  (color #F97316)

| ID | What it validates | Grail source |
|---|---|---|
| t1 | Threat problem coverage | `dt.davis.problems` |
| t2 | Threat problem types | `dt.davis.problems` |
| t3 | Threat problem recency | `dt.davis.problems` |
| t4 | Security event correlation | `fetch events` (SECURITY_EVENT) |
| t5 | Threat log coverage | `fetch logs` |
| t6 | Auth/access logs | `fetch logs` |
| t7 | Threat log diversity | `fetch logs` |
| t8 | Threat log recency | `fetch logs` |
| t9 | Threat Davis coverage | `dt.davis.problems` |
| t10 | Security event volume | `fetch events` |
| t11 | Security event breadth | `fetch events` |

---

## 7. AI Observability  (color #06B6D4)

All 9 criteria query **`fetch spans`** filtered for GenAI semantic-convention
attributes (`gen_ai.system`, `gen_ai.provider.name`, `gen_ai.request.*`,
`gen_ai.usage.*`, etc.).

| ID range | Source |
|---|---|
| ai1–ai9 | `fetch spans` (gen_ai.* attributes) |

> **CRITICAL window note**: AI Obs uses `from:now()-72h`, NOT 2h. GenAI
> workloads are bursty — a 2h window missed real spans on the reference tenant (244,964
> gen_ai spans in 72h, 0 in 2h). This was the v2.5.x AI-Obs bug fix. Do not
> narrow this window back to 2h.

---

## 8. Business Observability  (color #10B981)

All 8 criteria query **`fetch bizevents`** (business event volume, type
diversity, recency, field richness, etc.).

| ID range | Source |
|---|---|
| b1–b8 | `fetch bizevents` |

---

## 9. Software Delivery  (color #6366F1)

| ID | What it validates | Grail source |
|---|---|---|
| sd1 | Deployment events | `fetch events` (DAVIS_EVENT / CUSTOM_DEPLOYMENT) |
| sd2 | Deployment frequency | `fetch events` |
| sd3 | Deployment diversity | `fetch events` |
| sd4 | Deployment recency | `fetch events` |
| sd5 | Service throughput post-deploy | metric `dt.service.request.count` |
| sd6 | Failure rate tracking | metric `dt.service.request.failure_count` |
| sd7 | Service release readiness | entity `dt.entity.service` |
| sd8 | Delivery problem coverage | `dt.davis.problems` |
| sd9 | Process release mapping | entity `dt.entity.process_group` |
| sd10 | Service delivery topology | entity `dt.entity.service` |

---

## Time windows (relevant for "which data" + DPS cost)

Each query scopes its source to a window. Distribution across all criteria:

| Window | Count | Used for |
|---|---|---|
| `now() - 2h` (logs/events timestamp filter) | 56 | live-signal freshness on logs/events |
| `from:now()-72h` (spans/davis) | 27 | bursty workloads (AI Obs, problems) |
| `from:now()-2h` (spans/metrics) | 13 | live tracing/metric signals |
| `now() - 24h` (security events) | 7 | security event accumulation |
| `now() - 72h` (logs) | 1 | long-window log check |

The window IS part of "the metric being validated" — a host with CPU metrics
in the last 2h counts as covered; one silent for >2h does not. Narrowing or
widening a window changes the score, so treat windows as load-bearing.

### What actually reaches Grail (v2.5.5)

The table above is the **catalog**. Since Economy Mode, the *executed* window
can differ, and the difference is deliberate (`ui/app/scale-tier.ts`):

- Criteria that are a ratio of two plain counts keep their authored window and
  get `samplingRatio: 1000` instead — the sampling cancels in the ratio, so the
  score is preserved while the scan drops ~1600x.
- Criteria using `countDistinct` or `by:` grouping cannot be sampled (measured:
  distinct log sources 63 → 28), so they get a **narrower window** instead:
  short windows collapse to 15 minutes, long ones are capped at 4 hours.
- Where two sides of one criterion read different windows on purpose (l10, 24h
  of log sources vs 2h), both are divided by the same factor so the ratio they
  encode survives.

Consequence for anyone reading a score: distinct counts come out ~6% lower than
the catalog window would give, and ratios move by under 1.5 percentage points.
The app says so on screen. If you need catalog-exact numbers, read the executed
DQL from the perf report — every query is logged with the string that actually
ran.

---

## Denominators (the "÷ what")

Coverage = numerator ÷ denominator × 100. The denominator is usually a total
entity count (e.g. `fetch dt.entity.host | summarize count()`), OR a
`denominatorConstant` baked into the criterion when the expected total is a
known literal (e.g. "5 expected log levels"). The constant form avoids a
wasteful DQL that scans Grail just to return a fixed number — see the
`denominatorConstant` field doc in `queries.ts:24`.

---

## How to regenerate this index

When `queries.ts` changes, re-extract:

```bash
cd /Users/marcelo.coletta/pulse-assessment-dyna-version
python3 - <<'PY'
import re
src = open("ui/app/queries.ts").read()
cap_re = re.compile(r'name:\s*"([^"]+)",\s*\n\s*color:', re.M)
caps = [(m.group(1), m.start()) for m in cap_re.finditer(src)]
caps.append(("__END__", len(src)))
def ds(q):
    m = re.search(r'\bfetch\s+([a-zA-Z0-9_.]+)', q)
    if m: return "fetch " + m.group(1)
    m = re.search(r'=\s*\w+\(([a-zA-Z0-9_.]+)\)', q)
    if m: return "metric " + m.group(1)
    return q[:40]
for i in range(len(caps)-1):
    name, start = caps[i]; end = caps[i+1][1]; block = src[start:end]
    print(f"\n=== {name} ===")
    for cm in re.finditer(r'id:\s*"([a-z0-9]+)",\s*label:\s*"([^"]+)"', block):
        after = block[cm.end():cm.end()+800]
        qm = re.search(r'query:\s*["\']([^"\']+)', after)
        print(f"  {cm.group(1)}: {ds(qm.group(1)) if qm else '?'}")
PY
```
