# Gate Decision Workflow

Step-by-step procedure for running an evidence-based gate decision using
Dynatrace data. Use this reference when evaluating whether a change should
pass a design, delivery, or runtime gate.

## Pre-Gate Checklist

Before running any gate, confirm:

- [ ] **Change scope is documented** — what is changing and why
- [ ] **Risk tier is assigned** — Tier 0 / Tier 1 / Tier 2
- [ ] **Affected services are identified** — entity IDs or service names
- [ ] **Timeframe is clear** — when the change was deployed or will be deployed
- [ ] **Baseline exists** — pre-change metrics are collected

If any item is missing, collect it before proceeding. Do not run a gate without
a baseline.

## Design Gate Procedure

Run before implementation begins.

### Step 1: Collect Current Baseline

Query the current service state for each affected service:

```dql
timeseries {
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    p50_ms = arrayAvg(p50) / 1000,
    p90_ms = arrayAvg(p90) / 1000,
    p99_ms = arrayAvg(p99) / 1000,
    throughput = arraySum(requests),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests)
```

Record the results. This is the baseline the delivery gate will compare against.

### Step 2: Map Dependencies

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("<service-id>")
| summarize calls = count(), by: { peer.service }
| sort calls desc
```

### Step 3: Check for Active Problems

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND event.status == "ACTIVE"
| expand affected_entity_ids
| filter affected_entity_ids == "<service-id>"
| fields timestamp, display_id, title
```

### Step 4: Evaluate

| Condition | Verdict |
|-----------|---------|
| Baseline collected, dependencies known, no active problems, observability plan defined | **PASS** |
| Baseline collected but observability plan is incomplete or dependencies have minor issues | **PASS WITH GUARDRAILS** |
| No baseline, unknown dependencies, or active problems on the target service | **FAIL** |

## Delivery Gate Procedure

Run after implementation, before production deployment.

### Step 1: Verify Tests and Static Checks

Confirm that tests pass and static analysis is clean. This is outside Dynatrace
scope — verify via CI/CD.

### Step 2: Compare Against Design-Time Baseline

If a staging or pre-prod environment exists with Dynatrace monitoring, compare:

```dql
timeseries {
  p90 = percentile(dt.service.request.response_time, 90),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("<staging-service-id>") }
| fieldsAdd
    p90_ms = arrayAvg(p90) / 1000,
    errorRate = arraySum(failures) * 100.0 / arraySum(requests),
    throughput = arraySum(requests)
```

Compare p90 and error rate against the design-time baseline.

### Step 3: Check SLO Compliance

Use two evidence lanes for SLO compliance:

- Lane A (authoritative): configured SLO object state via Dynatrace SLO API.
- Lane B (runtime): DQL SLI proxies for availability, error rate, and latency.

For Lane A, check SLO status for `<service-id>` via Dynatrace SLO UI or SLO API
and capture `name`, `status`, and `error_budget_remaining`.

Validation commands:

```dtctl
dtctl get slos --plain
dtctl describe slo <slo-id> --plain
```

For Lane B, run a service-scoped runtime proxy query:

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

### Step 4: Evaluate

| Condition | Verdict |
|-----------|---------|
| No regression, SLOs compliant, observability verified | **PASS** |
| Minor known issues documented, no regression on critical paths | **PASS WITH NOTES** |
| Regression detected or SLO violation | **FAIL** |
| Fundamental regression requiring architecture change | **FAIL AND RE-DESIGN** |

## Runtime Gate Procedure

Run after production deployment.

### Step 1: Compare Pre vs Post Deployment

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

### Step 2: Check for New Problems

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND timestamp > now() - 1h
| fields timestamp, display_id, title, status,
         affected_entity_ids, root_cause_entity_id
| sort timestamp desc
```

### Step 3: Classify and Route

If issues are detected, classify them:

```
Is the issue resource/infrastructure related?
  → CPU saturation, memory pressure, pod eviction, network
  → LANE A — scale, resize, or rebalance

Is the issue correlated with the recent deployment?
  → Error spike, latency regression, new exception types
  → LANE B — fix the code change or rollback

Is the issue persistent and not tied to a single change?
  → Chronic degradation, architectural bottleneck
  → LANE C — redesign required
```

### Step 4: Evaluate

| Condition | Verdict |
|-----------|---------|
| Metrics within baseline, no new problems | **HEALTHY** |
| Regression confirmed, rollback criteria met | **ROLLBACK** |
| Infrastructure root cause identified | **LANE A** |
| Code-level root cause identified | **LANE B** |
| Architectural root cause identified | **LANE C** |
