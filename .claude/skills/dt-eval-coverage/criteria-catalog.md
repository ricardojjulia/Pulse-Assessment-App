# Criteria Catalog — All 111 Checks

Source of truth: `ui/app/queries.ts` (DQL) + `ui/app/data/criterionTiers.ts` (tier).
Version: v2.5.15 · Tenant Review App.

Tier codes: **F** = Foundation · **BP** = Best Practice · **E** = Excellence

Pass threshold is `≥1%` unless stated otherwise — the assessment rewards *any* adoption;
tier weighting (not threshold) drives the utilization story.

---

## 1. Infrastructure Observability — 22 checks (F:3 · BP:11 · E:8)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| i1 | F | Host CPU coverage | Hosts reporting CPU metrics (any source) | ≥1% |
| i2 | F | Host memory coverage | Hosts reporting memory metrics | ≥1% |
| i4 | F | Host availability coverage | Hosts with availability metrics (SLA basis) | ≥1% |
| i3 | BP | Host disk coverage | Hosts reporting disk utilisation | ≥1% |
| i5 | BP | Host network coverage | Hosts with network interface entities | ≥1% |
| i6 | BP | Process CPU coverage | Process groups with CPU metrics | ≥1% |
| i9 | BP | Davis problem coverage | Hosts covered by Davis AI problem detection | ≥1% |
| i11 | BP | Host-process topology | Hosts with detected process groups | ≥1% |
| i13 | BP | Cloud host log enrichment | Hosts whose logs carry cloud-provider context | ≥1% |
| i14 | BP | Cloud log enrichment | Log records enriched with cloud provider | ≥1% |
| i17 | BP | Cloud account enrichment | Cloud logs carrying account ID | ≥1% |
| i19 | BP | K8s node monitoring depth | Node-to-cluster ratio (node-level compute) | ≥1% |
| i20 | BP | Cloud namespace metric coverage | K8s namespaces with container metrics | ≥1% |
| i21 | BP | Container restart monitoring | K8s namespaces tracking container restarts | ≥1% |
| i7 | E | K8s cluster coverage | Clusters with active workload monitoring | ≥1% |
| i8 | E | Host disk entity coverage | Hosts with disk entities detected | ≥1% |
| i10 | E | Cloud workload coverage | K8s namespaces running cloud-native workloads | ≥1% |
| i12 | E | K8s workload mapping | Clusters mapped to a cloud namespace | ≥1% |
| i15 | E | Cloud region enrichment | Cloud logs carrying region metadata | ≥1% |
| i16 | E | Cloud AZ enrichment | Cloud logs carrying availability-zone metadata | ≥1% |
| i18 | E | Cloud span enrichment | Services with cloud context in spans | ≥1% |
| i22 | E | Container resource limits | K8s namespaces with defined resource limits | ≥1% |

---

## 2. Application Observability — 13 checks (F:3 · BP:4 · E:6)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| a1 | F | Service tracing coverage | Services with active span data | ≥1% |
| a3 | F | Root span coverage | Services with incoming-request root spans | ≥1% |
| a5 | F | Response time coverage | Services with p95 response-time metrics | ≥1% |
| a2 | BP | Service method coverage | Services with method-level tracing | ≥1% |
| a6 | BP | Failure tracking coverage | Services with failure-rate metrics | ≥1% |
| a7 | BP | Throughput coverage | Services with request-count metrics | ≥1% |
| a11 | BP | Service-process mapping | Services linked to process groups | ≥1% |
| a4 | E | OTel instrumentation coverage | Services with OpenTelemetry spans | ≥1% |
| a8 | E | Database span coverage | Services with database operation spans | ≥1% |
| a9 | E | Messaging span coverage | Services with messaging spans (Kafka/RabbitMQ/SQS) | ≥1% |
| a10 | E | Multi-service trace depth | Traces spanning 2+ services | ≥1% |
| a12 | E | Service tagging utilization | Services with at least one tag | ≥1% |
| a13 | E | Database call depth | DB services touching 2+ database systems | ≥1% |

---

## 3. Digital Experience — 11 checks (F:3 · BP:5 · E:3)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| d1 | F | RUM action coverage | Web apps with user-action metrics | ≥1% |
| d2 | F | Session tracking coverage | Web apps with session tracking | ≥1% |
| d3 | F | LCP coverage | Web apps with Largest Contentful Paint | ≥1% |
| d4 | BP | INP coverage | Web apps with Interaction to Next Paint | ≥1% |
| d5 | BP | CLS coverage | Web apps with Cumulative Layout Shift | ≥1% |
| d6 | BP | Frontend error coverage | Web apps with error tracking | ≥1% |
| d7 | BP | Synthetic HTTP coverage | Web apps covered by HTTP synthetic monitors | ≥1% |
| d11 | BP | Synthetic availability coverage | Synthetic-monitor-to-web-app ratio | ≥1% |
| d8 | E | Synthetic browser coverage | Web apps covered by browser synthetics | ≥1% |
| d9 | E | Mobile app coverage | Apps with mobile monitoring | ≥1% |
| d10 | E | Synthetic location diversity | Location-to-monitor ratio | ≥1% |

---

## 4. Log Analytics — 16 checks (F:4 · BP:7 · E:5)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| l1 | F | Host log coverage | Hosts sending log data | ≥1% |
| l2 | F | Service log coverage | Services with associated logs | ≥1% |
| l3 | F | Log source diversity | Distinct log sources vs hosts | ≥10% |
| l4 | F | Dedicated buckets usage | Grail buckets used for logs (≥2 = healthy) | ≥50% |
| l5 | BP | Trace-correlated logs | Logs carrying trace_id | ≥1% |
| l6 | BP | Entity-enriched logs | Logs with host entity context | ≥1% |
| l7 | BP | Error log coverage | Services with ERROR-level logs | ≥1% |
| l8 | BP | Log severity diversity | Severity levels ingested (of 5) | ≥40% |
| l9 | BP | Structured logging | Logs with structured JSON | ≥1% |
| l10 | BP | Multi-source host logging | Hosts logging from 2+ sources | ≥1% |
| l11 | BP | Custom attribute enrichment | Logs with custom entity enrichment | ≥1% |
| l12 | E | Process group log correlation | Logs with process-group context | ≥1% |
| l13 | E | K8s log coverage | K8s namespaces with logs | ≥1% |
| l14 | E | Log retention validation | Sources active 24h vs 2h | ≥1% |
| l15 | E | Span-correlated logs | Logs carrying span_id | ≥1% |
| l16 | E | Log-based events | Events generated from log data | ≥50% |

---

## 5. Application Security — 11 checks (F:4 · BP:4 · E:3)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| s1 | F | Service security coverage | Services covered by security-event detection | ≥1% |
| s2 | F | Runtime vulnerability baseline | Services with process groups (RVA prerequisite) | ≥1% |
| s3 | F | Database interaction security | Services with DB tracing (SQLi surface) | ≥1% |
| s8 | F | HTTP request surface coverage | Services with HTTP request tracing | ≥1% |
| s7 | BP | Security event type coverage | Security event types vs expected categories | ≥20% |
| s5 | BP | Error log security coverage | Services with ERROR-level logs | ≥1% |
| s6 | BP | Warn log security coverage | Services with WARN-level logs | ≥1% |
| s4 | BP | Attack detection coverage | Services with attack events detected | ≥1% |
| s10 | E | Event kind diversity | Event kinds monitored (of 5) | ≥40% |
| s11 | E | Failed request coverage | Services tracking failed requests | ≥1% |
| s9 | E | Davis security problem coverage | Services covered by Davis AI | ≥1% |

---

## 6. Threat Observability — 11 checks (F:3 · BP:5 · E:3)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| t1 | F | Davis problem entity coverage | Hosts touched by Davis problems | ≥1% |
| t4 | F | Security event service coverage | Services with security events | ≥1% |
| t5 | F | Error log threat coverage | Hosts with ERROR-level logs | ≥1% |
| t2 | BP | Problem entity correlation | Davis problems with affected entities | ≥1% |
| t3 | BP | Problem category coverage | Problem categories detected (of 4) | ≥25% |
| t8 | BP | Log source threat coverage | Distinct log sources vs hosts | ≥10% |
| t6 | BP | Log entity enrichment | Logs with host entity context | ≥1% |
| t7 | BP | Event entity correlation | Events carrying affected entity IDs | ≥1% |
| t9 | E | Trace-correlated threat logs | Logs with trace_id for attack paths | ≥1% |
| t10 | E | Recurring affected entity detection | Entities appearing in multiple problems | ≥1% |
| t11 | E | Problem resolution coverage | Problems that reached CLOSED | ≥1% |

---

## 7. AI Observability — 9 checks (F:3 · BP:2 · E:4)

> **Critical window**: All AI Observability checks use `from:now()-72h` (not 2h).
> GenAI workloads are bursty — a 2h window returns zero on real tenants with active AI usage.
> Do **not** narrow this window.

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| ai1 | F | AI span service coverage | Services with AI/LLM spans | ≥1% |
| ai2 | F | Token tracking coverage | AI spans tracking token usage | ≥1% |
| ai3 | F | AI error tracking coverage | AI spans with error-status tracking | ≥1% |
| ai4 | BP | AI provider diversity | Known AI providers detected (of 5) | ≥20% |
| ai5 | BP | Agent invocation coverage | AI spans with agent-invocation tracing | ≥1% |
| ai6 | E | Prompt/response tracing coverage | AI spans capturing prompt or response | ≥1% |
| ai7 | E | Guardrail coverage | AI spans with guardrail monitoring | ≥1% |
| ai8 | E | Cost tracking coverage | AI spans with cost tracking | ≥1% |
| ai9 | E | AI tracing service breadth | AI-related share of total spans | ≥1% |

---

## 8. Business Observability — 8 checks (F:3 · BP:2 · E:3)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| b1 | F | Service bizevent coverage | Services with business events | ≥1% |
| b2 | F | Bizevent type diversity | Expected event types detected (of 10) | ≥30% |
| b3 | F | Events with service context | Business events linked to services | ≥1% |
| b4 | BP | Bizevent provider diversity | Expected providers detected (of 5) | ≥20% |
| b5 | BP | Revenue data coverage | Events with revenue/monetary value | ≥1% |
| b6 | E | Session-linked events | Events linked to RUM sessions | ≥1% |
| b7 | E | Trace-linked events | Events correlated with traces | ≥1% |
| b8 | E | Cost center coverage | Events with cost-center / product data | ≥1% |

---

## 9. Software Delivery — 10 checks (F:3 · BP:4 · E:3)

| ID | Tier | Check | What it validates | Pass |
|---|---|---|---|---|
| sd1 | F | Service deployment coverage | Services with deployment events (24h) | ≥1% |
| sd5 | F | Service request baseline | Services with active throughput | ≥1% |
| sd9 | F | Process group coverage | Services linked to process groups | ≥1% |
| sd2 | BP | Custom deployment coverage | Services with CI/CD deployment markers | ≥1% |
| sd3 | BP | Event kind diversity | Event kinds present (of 5) | ≥40% |
| sd6 | BP | Service failure baseline | Services tracking failure rate | ≥1% |
| sd10 | BP | Process group tagging | Process groups with ≥1 tag | ≥1% |
| sd4 | E | Event type diversity | Delivery event types detected (of 10) | ≥30% |
| sd8 | E | Davis problem detection | Services covered by Davis AI | ≥1% |
| sd7 | E | Ownership assignment | Services with ownership tags | ≥1% |

---

## Summary

| Capability | Checks | F | BP | E |
|---|---|---|---|---|
| Infrastructure Observability | 22 | 3 | 11 | 8 |
| Application Observability | 13 | 3 | 4 | 6 |
| Digital Experience | 11 | 3 | 5 | 3 |
| Log Analytics | 16 | 4 | 7 | 5 |
| Application Security | 11 | 4 | 4 | 3 |
| Threat Observability | 11 | 3 | 5 | 3 |
| AI Observability | 9 | 3 | 2 | 4 |
| Business Observability | 8 | 3 | 2 | 3 |
| Software Delivery | 10 | 3 | 4 | 3 |
| **Total** | **111** | **29** | **44** | **38** |

> The app labels this "~94 unique criteria" because several checks share denominator queries (deduplicated at execution). The 111 above counts every scored check row.

---

## How to add a new criterion

1. Add the criterion definition to `ui/app/queries.ts` — the source of truth for `id`, `label`, `query`, `queryB`, `thresholds`, `denominatorConstant`.
2. Classify the tier in `ui/app/data/criterionTiers.ts` — add `"<id>": "Foundation" | "BestPractice" | "Excellence"`.
3. Add importance text to `ui/app/data/criterionImportance.ts`.
4. Add remediation text to `ui/app/data/criterionRemediation.ts` (or `ui/app/remediationActions.ts`).
5. Update `docs/CRITERIA-SUMMARY.md` and `docs/DATA-SOURCES.md` to keep docs in sync.

When adding a capability, also add an entry in `ui/app/data/capSummaries.ts` and `ui/app/data/appCapabilityMap.ts`.
