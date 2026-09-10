---
name: dt-sdlc-evidence-gates
description: Evidence-based delivery gates using Dynatrace runtime data. Validate design, delivery, and release decisions with DQL queries against real baselines, error budgets, SLOs, and deployment health — replacing assumption-based approvals with grounded verdicts.
license: Apache-2.0
---

# Evidence-Based Delivery Gates

Use Dynatrace runtime data to make grounded delivery decisions at every stage of
the software delivery lifecycle — from design through release and post-deploy
verification.

## When to Use This Skill

- Validating whether a change is safe to ship based on runtime evidence
- Establishing baselines before making design or rollout decisions
- Creating release gates that use DQL queries instead of manual checklists
- Assessing post-deploy health against pre-deploy baselines
- Classifying production issues to route them correctly (infra vs code vs design)

> **Starting out?** If you want a single automated quality gate for your
> deployments, start with a skill that focuses on Site Reliability Guardian
> setup and post-deploy validation first. This skill covers the full
> multi-phase gate framework.

## Core Concepts

### Evidence Over Assumptions

Every delivery decision should be backed by at least one of these evidence
sources:

| Evidence Source | Examples |
|----------------|----------|
| **Runtime telemetry** | Latency baselines, error rates, throughput, saturation |
| **Tests and benchmarks** | Load test results, integration test outcomes |
| **Deployment state** | Feature flag status, canary percentage, rollout phase |
| **SLOs and error budgets** | Remaining budget, burn rate, compliance status |
| **Incident and anomaly history** | Recent problems, active anomalies, change correlation |

### Gate Types

The delivery lifecycle has three gate types, each with a specific verdict set.

#### Design Gate

Validates that a change is well-understood before implementation begins.

**Verdicts:**
- **PASS** — Baseline is known, dependencies are mapped, observability plan exists
- **PASS WITH GUARDRAILS** — May proceed with constraints (reduced scope, extra monitoring)
- **FAIL** — Critical context is missing (no baseline, unknown blast radius, no rollback plan)

#### Delivery Gate

Validates that implementation is safe to ship.

**Verdicts:**
- **PASS** — Tests pass, no regression against baseline, observability is in place
- **PASS WITH NOTES** — May ship with documented known issues or follow-up items
- **FAIL** — Regression detected, SLO violation, or missing verification
- **FAIL AND RE-DESIGN** — Fundamental approach needs rethinking

#### Runtime Gate

Validates post-deploy health and classifies issues.

**Verdicts:**
- **HEALTHY** — Metrics within baseline, no anomalies
- **ROLLBACK** — Regression confirmed, rollback required
- **LANE A** — Infrastructure issue (scaling, resource, networking)
- **LANE B** — Code issue (bug, regression, configuration error)
- **LANE C** — Design issue (architecture rethink needed)

## Baseline Discovery

Before any gate decision, establish the current baseline. These queries collect
the evidence that gates evaluate against.

### Service Latency Baseline

```dql
timeseries {
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.smartscape.service}
| fieldsAdd
    p50_ms = arrayAvg(p50) / 1000,
    p90_ms = arrayAvg(p90) / 1000,
    p99_ms = arrayAvg(p99) / 1000,
    requestCount = arraySum(requests),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests)
| sort errorRate desc
```

### Error Budget Status

Use a two-part validation approach:

1. Validate configured SLO objects (authoritative status).
2. Validate runtime SLI proxies via DQL (request/error/latency behavior).

Configured SLO object validation (Dynatrace SLO API via `dtctl`):

- `slo.name`
- `slo.status`
- `slo.error_budget_remaining`

Validation commands:

```dtctl
dtctl get slos --plain
dtctl describe slo <slo-id> --plain
```

Runtime SLI proxy validation (DQL, service-scoped):

```dql
timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count),
  p90 = percentile(dt.service.request.response_time, 90)
},
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    availability = (arraySum(requests) - arraySum(failures)) * 100.0 / arraySum(requests),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests),
    p90_us = arrayAvg(p90),
    requestCount = arraySum(requests)
```

Use these DQL results as runtime evidence and compare them against the configured
SLO targets/error-budget policy.

### Recent Deployment Events

```dql
fetch events
| filter event.type == "CUSTOM_DEPLOYMENT"
| fields timestamp, event.name, dt.smartscape.service,
         affected_entity_ids, deployment.version
| sort timestamp desc
| limit 20
```

### Saturation and Capacity

```dql
timeseries {
  avgCpu = avg(dt.host.cpu.usage),
  maxCpu = max(dt.host.cpu.usage)
},
from: now()-2h,
filter: { host.name == "<target-host>" }
```

```dql
timeseries {
  avgMem = avg(dt.host.memory.usage),
  maxMem = max(dt.host.memory.usage)
},
from: now()-2h,
filter: { host.name == "<target-host>" }
```

## Risk Tiers

Not every change needs the full gate sequence. Use risk tiers to match lifecycle
depth to change risk.

| Tier | Change Type | Required Gates |
|------|-------------|----------------|
| **Tier 0** | Docs, naming, refactors with no behavior change | Local validation only |
| **Tier 1** | Non-hot-path changes, low-risk automation | Design enrichment + delivery gate |
| **Tier 2** | Hot-path changes, dependency upgrades, timeout/retry changes | Full lifecycle with runtime gate |

### Tier Assessment Checklist

Ask these questions to determine the tier:

1. Does the change affect a hot path (high traffic, low latency requirement)? → Tier 2
2. Does it change external dependencies or their configuration? → Tier 2
3. Does it modify timeout, retry, circuit-breaker, or rate-limit settings? → Tier 2
4. Does it change only non-behavioral aspects (docs, names, formatting)? → Tier 0
5. Everything else → Tier 1

## Post-Deploy Verification

After deployment, verify health against the pre-deploy baseline.

### Rollout Assertion with `dtctl wait`

When running post-deploy gates in a pipeline or agent context, use
`dtctl wait query` to turn telemetry presence into an assertion:

```dtctl
# Wait until traces from the new deployment appear (up to 3 minutes)
dtctl wait query \
  "fetch spans | filter dt.smartscape.service == \"SERVICE-<id>\" AND timestamp > now() - 5m" \
  --for=any --timeout 3m

# Verify no problems opened since deploy
dtctl wait query \
  "fetch events | filter event.type == \"DAVIS_PROBLEM\" AND timestamp > now() - 30m | limit 1" \
  --for=none --timeout 5m
```

Always run `dtctl verify query "<DQL>"` before `dtctl query` or `dtctl wait query`
to catch syntax errors before consuming execution quota.

### Compare Pre vs Post Latency

```dql
timeseries recent_p90 = percentile(dt.service.request.response_time, 90),
  from: now()-1h,
  filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd recent_p90_ms = arrayAvg(recent_p90) / 1000
| append [
  timeseries baseline_p90 = percentile(dt.service.request.response_time, 90),
    filter: { dt.smartscape.service == toSmartscapeId("<service-id>") },
    shift: -1h
  | fieldsAdd baseline_p90_ms = arrayAvg(baseline_p90) / 1000
]
| fieldsAdd degradation_pct = (recent_p90_ms - baseline_p90_ms) * 100.0 / baseline_p90_ms
```

### Check for New Problems After Deploy

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND timestamp > now() - 1h
| fields timestamp, display_id, title, status,
         affected_entity_ids, root_cause_entity_id
| sort timestamp desc
```

### Verify Feature Flag State

When using progressive rollout, confirm the rollout control state:

```dql
fetch events
| filter event.type == "CUSTOM_INFO"
  AND event.name == "Feature flag change"
| fields timestamp, event.name, dt.smartscape.service
| sort timestamp desc
| limit 10
```

## Triage Classification

When a runtime gate detects an issue, classify it to determine the correct
response path.

| Signal | Lane | Action |
|--------|------|--------|
| CPU/memory saturation, pod eviction, node pressure | **Lane A** (infra) | Scale, resize, rebalance |
| Error spike correlated with recent deployment | **Lane B** (code) | Fix, patch, or rollback the change |
| Persistent performance degradation not tied to a single change | **Lane C** (design) | Architecture review, redesign |
| SLO burn rate accelerating but no single root cause | **Lane C** (design) | Review service boundaries and dependencies |

## Detailed Procedures

- [Gate Decision Workflow](references/gate-decision-workflow.md) — Step-by-step procedure for design, delivery, and runtime gates
- [Risk Tier Assessment](references/risk-tier-assessment.md) — Decision tree for determining change risk tier

## Related Capabilities

- Load a skill for observability-first design when you need baseline collection,
  blast-radius mapping, and rollback criteria before implementation.
- Load a skill for production-readiness assessment when you need a final
  go/no-go verdict across ownership, telemetry, dependencies, and rollout
  safety.
- Load a skill for DQL query authoring when you need help composing or debugging
  the queries used in these gates.
- Load a skill for distributed tracing analysis when a gate failure requires
  deeper request-path investigation.
- Load a skill for problem investigation when you need Davis problem context and
  correlation during runtime triage.
