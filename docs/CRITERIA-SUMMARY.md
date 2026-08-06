# Pulse Assessment — Evaluation Criteria Summary

A clear, plain-language reference for every check the assessment runs.
94 checks across 9 capabilities. Source of truth: `ui/app/queries.ts`
(labels, descriptions, thresholds) + `ui/app/data/criterionTiers.ts` (tiers).

Version: v2.5.5 · matches the criteria set on the feat/davis-insights branch.

---

## How a check is evaluated

Every check produces a **coverage percentage**:

```
result = (entities/signals WITH the feature) ÷ (total eligible) × 100
```

That percentage is compared to a **pass threshold**. Meeting it marks the
check **passed** (1 point); otherwise **not met** (0 points).

Two independent things then happen:

| | Determined by | Produces |
|---|---|---|
| **Pass / fail** | coverage % vs the pass threshold | 1 or 0 points |
| **Tier** | fixed classification in code (not the value) | Foundation / Best Practice / Excellence |

- **Coverage score** = passed ÷ total × 100 (per capability; simple average).
- **Utilization score** = tier-weighted, progressively gated:
  `Foundation×60% + BestPractice×25% (if Foundation ≥ 80%) + Excellence×15% (if BP ≥ 60%)`.

The three tiers represent an adoption journey:
**Foundation** = "the essentials everyone needs" · **Best Practice** = "deeper,
correct usage" · **Excellence** = "advanced / mature patterns".

> Note on thresholds: most checks pass at **≥1%** — the assessment rewards
> *any* adoption of a signal and lets the tier weighting drive the utilization
> story. A handful use higher bars (e.g. diversity checks at ≥20-50%) where a
> minimum spread is the whole point of the check.

---

## 1. Infrastructure Observability — 22 checks (F:3 · BP:11 · E:8)

Monitoring of hosts, processes, Kubernetes, and cloud platforms.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Host CPU coverage | Hosts reporting CPU metrics (any source) | ≥1% |
| F | Host memory coverage | Hosts reporting memory metrics | ≥1% |
| F | Host availability coverage | Hosts with availability metrics (SLA basis) | ≥1% |
| BP | Host disk coverage | Hosts reporting disk utilisation | ≥1% |
| BP | Host network coverage | Hosts with network interface entities | ≥1% |
| BP | Process CPU coverage | Process groups with CPU metrics | ≥1% |
| BP | Davis problem coverage | Hosts covered by Davis AI problem detection | ≥1% |
| BP | Host-process topology | Hosts with detected process groups | ≥1% |
| BP | Cloud host log enrichment | Hosts whose logs carry cloud-provider context | ≥1% |
| BP | Cloud log enrichment | Log records enriched with cloud provider | ≥1% |
| BP | Cloud account enrichment | Cloud logs carrying account ID | ≥1% |
| BP | K8s node monitoring depth | Node-to-cluster ratio (node-level compute) | ≥1% |
| BP | Cloud namespace metric coverage | K8s namespaces with container metrics | ≥1% |
| BP | Container restart monitoring | K8s namespaces tracking container restarts | ≥1% |
| E | K8s cluster coverage | Clusters with active workload monitoring | ≥1% |
| E | Host disk entity coverage | Hosts with disk entities detected | ≥1% |
| E | Cloud workload coverage | K8s namespaces running cloud-native workloads | ≥1% |
| E | K8s workload mapping | Clusters mapped to a cloud namespace | ≥1% |
| E | Cloud region enrichment | Cloud logs carrying region metadata | ≥1% |
| E | Cloud AZ enrichment | Cloud logs carrying availability-zone metadata | ≥1% |
| E | Cloud span enrichment | Services with cloud context in spans | ≥1% |
| E | Container resource limits | K8s namespaces with defined resource limits | ≥1% |

## 2. Application Observability — 13 checks (F:3 · BP:4 · E:6)

Distributed tracing and service RED metrics.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Service tracing coverage | Services with active span data | ≥1% |
| F | Root span coverage | Services with incoming-request root spans | ≥1% |
| F | Response time coverage | Services with p95 response-time metrics | ≥1% |
| BP | Service method coverage | Services with method-level tracing | ≥1% |
| BP | Failure tracking coverage | Services with failure-rate metrics | ≥1% |
| BP | Throughput coverage | Services with request-count metrics | ≥1% |
| BP | Service-process mapping | Services linked to process groups | ≥1% |
| E | OTel instrumentation coverage | Services with OpenTelemetry spans | ≥1% |
| E | Database span coverage | Services with database operation spans | ≥1% |
| E | Messaging span coverage | Services with messaging spans (Kafka/RabbitMQ/SQS) | ≥1% |
| E | Multi-service trace depth | Traces spanning 2+ services | ≥1% |
| E | Service tagging utilization | Services with at least one tag | ≥1% |
| E | Database call depth | DB services touching 2+ database systems | ≥1% |

## 3. Digital Experience — 11 checks (F:3 · BP:5 · E:3)

Real User Monitoring, Web Vitals, and synthetic monitoring.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | RUM action coverage | Web apps with user-action metrics | ≥1% |
| F | Session tracking coverage | Web apps with session tracking | ≥1% |
| F | LCP coverage | Web apps with Largest Contentful Paint | ≥1% |
| BP | INP coverage | Web apps with Interaction to Next Paint | ≥1% |
| BP | CLS coverage | Web apps with Cumulative Layout Shift | ≥1% |
| BP | Frontend error coverage | Web apps with error tracking | ≥1% |
| BP | Synthetic HTTP coverage | Web apps covered by HTTP synthetic monitors | ≥1% |
| BP | Synthetic availability coverage | Synthetic-monitor-to-web-app ratio | ≥1% |
| E | Synthetic browser coverage | Web apps covered by browser synthetics | ≥1% |
| E | Mobile app coverage | Apps with mobile monitoring | ≥1% |
| E | Synthetic location diversity | Location-to-monitor ratio | ≥1% |

## 4. Log Analytics — 16 checks (F:4 · BP:7 · E:5)

Log ingestion, enrichment, and correlation quality.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Host log coverage | Hosts sending log data | ≥1% |
| F | Service log coverage | Services with associated logs | ≥1% |
| F | Log source diversity | Distinct log sources vs hosts | ≥10% |
| F | Dedicated buckets usage | Grail buckets used for logs (≥2 = healthy) | ≥50% |
| BP | Trace-correlated logs | Logs carrying trace_id | ≥1% |
| BP | Entity-enriched logs | Logs with host entity context | ≥1% |
| BP | Error log coverage | Services with ERROR-level logs | ≥1% |
| BP | Log severity diversity | Severity levels ingested (of 5) | ≥40% |
| BP | Structured logging | Logs with structured JSON | ≥1% |
| BP | Multi-source host logging | Hosts logging from 2+ sources | ≥1% |
| BP | Custom attribute enrichment | Logs with custom entity enrichment | ≥1% |
| E | Process group log correlation | Logs with process-group context | ≥1% |
| E | K8s log coverage | K8s namespaces with logs | ≥1% |
| E | Log retention validation | Sources active 24h vs 2h | ≥1% |
| E | Span-correlated logs | Logs carrying span_id | ≥1% |
| E | Log-based events | Events generated from log data | ≥50% |

## 5. Application Security — 11 checks (F:4 · BP:4 · E:3)

Runtime vulnerability and attack-surface visibility.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Service security coverage | Services covered by security-event detection | ≥1% |
| F | Runtime vulnerability baseline | Services with process groups (RVA prerequisite) | ≥1% |
| F | Database interaction security | Services with DB tracing (SQLi surface) | ≥1% |
| F | HTTP request surface coverage | Services with HTTP request tracing | ≥1% |
| BP | Security event type coverage | Security event types vs expected categories | ≥20% |
| BP | Error log security coverage | Services with ERROR-level logs | ≥1% |
| BP | Warn log security coverage | Services with WARN-level logs | ≥1% |
| BP | Attack detection coverage | Services with attack events detected | ≥1% |
| E | Event kind diversity | Event kinds monitored (of 5) | ≥40% |
| E | Failed request coverage | Services tracking failed requests | ≥1% |
| E | Davis security problem coverage | Services covered by Davis AI | ≥1% |

## 6. Threat Observability — 11 checks (F:3 · BP:5 · E:3)

Davis problem detection and threat-log correlation.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Davis problem entity coverage | Hosts touched by Davis problems | ≥1% |
| F | Security event service coverage | Services with security events | ≥1% |
| F | Error log threat coverage | Hosts with ERROR-level logs | ≥1% |
| BP | Problem entity correlation | Davis problems with affected entities | ≥1% |
| BP | Problem category coverage | Problem categories detected (of 4) | ≥25% |
| BP | Log source threat coverage | Distinct log sources vs hosts | ≥10% |
| BP | Log entity enrichment | Logs with host entity context | ≥1% |
| BP | Event entity correlation | Events carrying affected entity IDs | ≥1% |
| E | Trace-correlated threat logs | Logs with trace_id for attack paths | ≥1% |
| E | Recurring affected entity detection | Entities appearing in multiple problems | ≥1% |
| E | Problem resolution coverage | Problems that reached CLOSED | ≥1% |

## 7. AI Observability — 9 checks (F:3 · BP:2 · E:4)

GenAI / LLM span monitoring (72h window for bursty workloads).

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | AI span service coverage | Services with AI/LLM spans | ≥1% |
| F | Token tracking coverage | AI spans tracking token usage | ≥1% |
| F | AI error tracking coverage | AI spans with error-status tracking | ≥1% |
| BP | AI provider diversity | Known AI providers detected (of 5) | ≥20% |
| BP | Agent invocation coverage | AI spans with agent-invocation tracing | ≥1% |
| E | Prompt/response tracing coverage | AI spans capturing prompt or response | ≥1% |
| E | Guardrail coverage | AI spans with guardrail monitoring | ≥1% |
| E | Cost tracking coverage | AI spans with cost tracking | ≥1% |
| E | AI tracing service breadth | AI-related share of total spans | ≥1% |

## 8. Business Observability — 8 checks (F:3 · BP:2 · E:3)

Business events (bizevents) linking telemetry to outcomes.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Service bizevent coverage | Services with business events | ≥1% |
| F | Bizevent type diversity | Expected event types detected (of 10) | ≥30% |
| F | Events with service context | Business events linked to services | ≥1% |
| BP | Bizevent provider diversity | Expected providers detected (of 5) | ≥20% |
| BP | Revenue data coverage | Events with revenue/monetary value | ≥1% |
| E | Session-linked events | Events linked to RUM sessions | ≥1% |
| E | Trace-linked events | Events correlated with traces | ≥1% |
| E | Cost center coverage | Events with cost-center / product data | ≥1% |

## 9. Software Delivery — 10 checks (F:3 · BP:4 · E:3)

Deployment tracking and release-readiness signals.

| Tier | Check | What it validates | Pass |
|---|---|---|---|
| F | Service deployment coverage | Services with deployment events (24h) | ≥1% |
| F | Service request baseline | Services with active throughput | ≥1% |
| F | Process group coverage | Services linked to process groups | ≥1% |
| BP | Custom deployment coverage | Services with CI/CD deployment markers | ≥1% |
| BP | Event kind diversity | Event kinds present (of 5) | ≥40% |
| BP | Service failure baseline | Services tracking failure rate | ≥1% |
| BP | Process group tagging | Process groups with ≥1 tag | ≥1% |
| E | Event type diversity | Delivery event types detected (of 10) | ≥30% |
| E | Davis problem detection | Services covered by Davis AI | ≥1% |
| E | Ownership assignment | Services with ownership tags | ≥1% |

---

## Totals

| Capability | Checks | Foundation | Best Practice | Excellence |
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

> The app labels this "94 unique criteria" because several checks reuse the
> same denominator query (deduplicated at execution). The **111** above counts
> every scored check row across the 9 capabilities.

---

## Related docs

- `docs/DATA-SOURCES.md` — which Grail source (metrics / logs / spans / events /
  bizevents / entities / Davis) each check queries.
- `docs/SCORING-CALCULATIONS.md` — the full coverage-vs-utilization math with worked
  examples and the progressive-gate rule.

## Regenerate

When `queries.ts` or `criterionTiers.ts` change, re-run the extraction script
embedded in this session's history (parses labels + thresholds + tiers) and
rebuild the tables above.
