---
name: dt-sdlc-production-readiness
description: Evaluate whether a service or change is ready for production using Dynatrace evidence. Assess ownership, observability coverage, dependency health, rollout safety, SLOs, and rollback readiness — producing a grounded PASS, PASS WITH GUARDRAILS, or FAIL verdict.
license: Apache-2.0
---

# Production Readiness Validation

Systematic assessment of whether a service or change is ready for production,
grounded in Dynatrace runtime evidence rather than assumptions or checklists
alone.

## When to Use This Skill

- A team wants to validate that a service is ready for production rollout
- Before a major release or migration that affects production traffic
- When onboarding a new service and need to confirm observability coverage
- After significant architecture changes that may affect production safety
- When a release owner needs a clear go/no-go verdict with evidence

> **Starting out?** If you just need an automated quality gate after deploy,
> start with a skill that focuses on Site Reliability Guardian setup and
> post-deploy validation first. This skill is for comprehensive readiness
> assessments across all five dimensions.

## Readiness Dimensions

Assess readiness across five dimensions. Each dimension contributes to the
final verdict.

### 1. Ownership and Governance

Verify that ownership and approval paths are clear.

| Check | How to Verify | Evidence |
|-------|---------------|----------|
| Service owner is identified | Check service metadata, CODEOWNERS, or entity tags | Owner name or team |
| Approval path is clear | Confirm who approves production changes | Process documentation |
| On-call or escalation exists | Verify incident response ownership | Rotation schedule or contact |

### 2. Observability Coverage

Verify that the service emits the signals needed for production operation.

**Check trace coverage:**

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND span.kind == "server"
| summarize spanCount = count(), by: { endpoint.name }
| sort spanCount desc
```

**Check log coverage:**

```dql
fetch logs
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
| summarize logCount = count(), by: { loglevel }
| sort logCount desc
```

**Check metric coverage:**

```dql
timeseries totalRequests = sum(dt.service.request.count),
from: now()-2h,
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
```

**Observability coverage checklist:**

| Signal | Required | Status |
|--------|----------|--------|
| Request traces with root spans | Yes | |
| Error classification (HTTP status, exception type) | Yes | |
| Latency metrics (p50, p90, p99) | Yes | |
| Structured logs with trace context | Recommended | |
| Custom business metrics | Depends on service | |
| Deployment events | Recommended | |
| Health check endpoint | Recommended | |

### 3. Baseline and SLO Readiness

Verify that baselines are established and SLOs are defined.

**Current service health baseline:**

Use your standard baseline collection procedure for `<service-id>` and record
p50/p90/p99, throughput, and error rate before issuing a readiness verdict.
If your workflow already includes an observability-design phase, reuse the
baseline gathered there instead of recomputing targets from scratch.

**SLO status (if configured):**

Validate SLO readiness with two checks:

1. Configured SLO object status (authoritative).
2. Runtime SLI proxy from DQL (operational behavior).

For object status, validate in Dynatrace SLO UI or via SLO API for
`<service-id>` and capture `slo.name`, `slo.status`, and
`slo.error_budget_remaining`.

Validation commands:

```dtctl
dtctl get slos --plain
dtctl describe slo <slo-id> --plain
```

For runtime SLI proxy, execute:

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

| Check | Status |
|-------|--------|
| Latency baseline is known | |
| Error rate baseline is known | |
| Throughput baseline is known | |
| SLOs are defined | |
| Error budget is healthy | |

### 4. Dependency Health

Verify that dependencies are healthy and understood.

**Outbound dependency map:**

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("<service-id>")
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize
    calls = count(),
    p90 = percentile(duration, 90),
    errorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { peer.service }
| sort errorRate desc
```

**Recent problems on dependencies:**

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND timestamp > now() - 24h
| expand affected_entity_ids
| filter affected_entity_ids == "<dependency-service-id>"
| fields timestamp, display_id, title, status
| sort timestamp desc
```

| Check | Status |
|-------|--------|
| All critical dependencies identified | |
| Dependency error rates within normal range | |
| No active problems on critical dependencies | |
| Timeout and retry configuration is explicit | |
| Circuit breaker or fallback exists for critical paths | |

### 5. Rollout and Rollback Safety

Verify that the deployment can be safely rolled out and rolled back.

| Check | Status |
|-------|--------|
| Rollout strategy defined (canary, blue-green, rolling) | |
| Rollback mechanism tested or documented | |
| Rollback criteria are specific and measurable | |
| Feature flags available for risk mitigation | |
| Post-deploy verification queries defined | |
| Post-deploy ownership is clear | |

## Verdict Framework

Based on the assessment, produce one of three verdicts.

### PASS

All five dimensions are satisfied:
- Ownership is clear
- Observability coverage is adequate
- Baselines and SLOs are established
- Dependencies are healthy
- Rollout and rollback mechanisms exist

### PASS WITH GUARDRAILS

The service may proceed with explicit constraints:
- Some observability gaps exist but are non-critical
- SLOs are defined but error budget is tight
- Dependencies have minor issues that are monitored
- Rollout must use canary or reduced scope

**Always list the specific guardrails required.**

### FAIL

Critical gaps prevent safe production rollout:
- No baseline exists for the service
- Critical observability signals are missing
- Dependencies have active problems
- No rollback mechanism exists
- Ownership or escalation path is unclear

**Always list the specific blocking gaps.**

## Assessment Output Template

```markdown
## Production Readiness Assessment — [Service/Change Name]

### Assessment Date
[Date]

### Scope
[What is being assessed — service, feature, migration]

### Evidence Summary

#### Ownership and Governance
- Owner: [confirmed/missing]
- Approval path: [confirmed/missing]
- On-call: [confirmed/missing]

#### Observability Coverage
- Traces: [coverage level]
- Logs: [coverage level]
- Metrics: [coverage level]
- Gaps: [list any gaps]

#### Baseline and SLOs
- Latency baseline: [p50/p90/p99 values]
- Error rate: [value]
- Throughput: [value]
- SLO status: [defined/missing, budget status]

#### Dependency Health
- Dependencies mapped: [yes/no, count]
- Active issues: [none/list]

#### Rollout Safety
- Strategy: [canary/rolling/blue-green]
- Rollback: [tested/documented/missing]
- Verification queries: [defined/missing]

### Verdict
[PASS / PASS WITH GUARDRAILS / FAIL]

### Required Actions
1. [Action item]
2. [Action item]
```

## Common Failure Patterns

| Pattern | Why It Fails | Fix |
|---------|-------------|-----|
| "We'll add monitoring later" | No baseline, no verification, blind rollout | Design observability first |
| "It works in staging" | Staging does not reflect production traffic patterns | Collect production baseline |
| "The tests pass" | Tests verify behavior, not production readiness | Add runtime evidence |
| "We can always rollback" | Rollback without criteria is guessing | Define measurable triggers |
| "The dashboard looks fine" | Visual inspection is not a gate | Use DQL for automated checks |

## Query Hygiene

Verify DQL syntax before executing readiness checks:

```dtctl
dtctl verify query "fetch spans | filter dt.smartscape.service == \"SERVICE-<id>\" | ..."
```

This catches syntax errors before consuming execution quota and is safe to run
without an active OAuth session.

## Detailed Procedures

- [Readiness Assessment Checklist](references/readiness-checklist.md) — Pre-flight checklist with auto-FAIL and guardrail conditions
- [Observability Coverage Audit](references/observability-coverage-audit.md) — Systematic signal-by-signal verification procedure

## Related Capabilities

- Load a skill for evidence-based delivery gates when you need to classify a
  change as PASS, PASS WITH GUARDRAILS, or FAIL before or after deployment.
- Load a skill for observability-first design when baseline collection,
  verification queries, and rollback criteria still need to be defined.
- Load a skill for DQL query authoring when you need help building or debugging
  readiness queries.
- Load a skill for service performance analysis when you need deeper service and
  dependency telemetry beyond this checklist.
- Load a skill for problem investigation when active Davis problems must be
  correlated with readiness blockers.
- Load a skill for critical-incident response when readiness concerns escalate
  into live production response.
