# Readiness Assessment Checklist

Pre-flight checklist for production readiness assessments. Complete all items
before producing a verdict. Do not skip sections — incomplete assessments
produce unreliable verdicts.

## Required Context

Before starting, confirm:

- [ ] **Service or change identified** — entity name, entity ID, or repository
- [ ] **Assessment scope** — new service, major change, or periodic review
- [ ] **Environment** — production, staging, or both
- [ ] **Timeframe** — when the change will be or was deployed

If any item is missing, ask before proceeding.

## Assessment Dimensions

### 1. Ownership and Governance

- [ ] Service owner is identified (team or individual)
- [ ] Approval path for production changes is clear
- [ ] On-call or escalation contact exists
- [ ] CODEOWNERS or equivalent ownership file is present
- [ ] Service is registered in a catalog (Juno, Backstage, or equivalent)

**Evidence required:** Owner name, approval process, escalation contact.

### 2. Observability Coverage

- [ ] Request traces are present with root spans
- [ ] Error classification is available (HTTP status, exception types)
- [ ] Latency metrics cover p50, p90, p99
- [ ] Logs are structured and include trace context
- [ ] Deployment events are emitted
- [ ] Health check endpoint exists (if applicable)
- [ ] Custom business metrics exist (if applicable)

**Evidence required:** DQL query results confirming each signal type.

Verification queries:

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>") AND span.kind == "server"
| summarize spanCount = count(), by: { endpoint.name }
| sort spanCount desc
```

```dql
fetch logs
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
| summarize logCount = count(), by: { loglevel }
```

```dql
timeseries totalRequests = sum(dt.service.request.count),
from: now()-2h,
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
```

### 3. Baseline and SLO Readiness

- [ ] Latency baseline is collected and documented
- [ ] Error rate baseline is collected and documented
- [ ] Throughput baseline is collected and documented
- [ ] SLOs are defined (availability, latency, error rate)
- [ ] Error budget status is known
- [ ] Baseline is recent (< 7 days old for critical services)

**Evidence required:** Baseline values, SLO definitions, error budget status.

### 4. Dependency Health

- [ ] All critical dependencies are identified
- [ ] Dependency error rates are within normal range
- [ ] No active problems on critical dependencies
- [ ] Timeout and retry configuration is explicit
- [ ] Circuit breaker or fallback exists for critical paths
- [ ] Database and messaging dependencies are mapped

**Evidence required:** Dependency list with health status.

### 5. Rollout and Rollback Safety

- [ ] Rollout strategy is defined (canary, blue-green, rolling)
- [ ] Rollback mechanism is tested or documented
- [ ] Rollback criteria are specific and measurable
- [ ] Feature flags are available for risk mitigation (if applicable)
- [ ] Post-deploy verification queries are defined
- [ ] Post-deploy ownership is clear (who monitors after deploy)

**Evidence required:** Rollout plan, rollback criteria, verification queries.

## Verdict Decision

Based on the completed checklist:

| All 5 dimensions satisfied | → **PASS** |
|:---------------------------|:-----------|
| Minor gaps with clear constraints | → **PASS WITH GUARDRAILS** |
| Critical gaps in any dimension | → **FAIL** |

### Critical Gaps (auto-FAIL)

Any of these conditions means the verdict is **FAIL**:

- No owner identified
- No baseline exists
- No traces or metrics for the service
- No rollback mechanism
- Active critical problems on the service or its dependencies

### Guardrail Conditions

These gaps allow **PASS WITH GUARDRAILS**:

- SLOs not yet defined (but baseline exists)
- Structured logs missing (but traces are present)
- Canary not configured (but rollback is fast and tested)
- Some dependency health unknown (but critical path covered)

Always list the specific guardrails required when issuing this verdict.
