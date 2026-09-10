# Observability Coverage Audit

How to systematically verify that a service has adequate observability for
production operation. Use this when evaluating observability coverage as part of
a production readiness assessment.

## Coverage Levels

| Level | Description | Verdict Impact |
|-------|-------------|----------------|
| **Full** | All signal types present, structured, and correlated | Supports PASS |
| **Partial** | Traces and metrics present, logs missing or unstructured | Supports PASS WITH GUARDRAILS |
| **Minimal** | Only basic metrics (request count, error count) | FAIL unless Tier 0 |
| **None** | No Dynatrace telemetry for this service | FAIL |

## Audit Procedure

### Step 1: Check Trace Coverage

Verify that the service emits server spans with root span markers:

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND span.kind == "server"
  AND request.is_root_span == true
| summarize
    endpoints = countDistinct(endpoint.name),
    totalSpans = count(),
    errorSpans = countIf(request.is_failed == true)
```

**Expected:** `endpoints > 0` and `totalSpans > 0`.

If zero results, the service is not emitting traces — this blocks production
readiness.

### Step 2: Check Endpoint Coverage

Verify that all known endpoints are instrumented:

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND span.kind == "server"
  AND request.is_root_span == true
| summarize requests = count(), by: { endpoint.name }
| sort requests desc
```

Compare the endpoint list against known API routes. Missing endpoints indicate
instrumentation gaps.

### Step 3: Check Client Span Coverage

Verify that outbound calls are traced:

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND span.kind == "client"
| summarize calls = count(), by: { peer.service }
| sort calls desc
```

If the service makes outbound calls but has no client spans, dependency
monitoring is blind.

### Step 4: Check Log Coverage

```dql
fetch logs
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
| summarize logCount = count(), by: { loglevel }
| sort logCount desc
```

**Expected:** At least ERROR and WARN levels present. INFO is recommended.

Check for trace context in logs:

```dql
fetch logs
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND trace_id != ""
| limit 1
```

If zero results, logs are not correlated with traces.

### Step 5: Check Metric Coverage

```dql
timeseries totalRequests = sum(dt.service.request.count),
from: now()-2h,
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
```

```dql
timeseries totalFailures = sum(dt.service.request.failure_count),
from: now()-2h,
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
```

### Step 6: Check for SLOs

Validate SLO coverage in two ways:

- Configured SLO objects (authoritative status).
- Runtime SLI proxy query (service request behavior).

For configured SLO objects, check SLOs for `<service-id>` in Dynatrace SLO UI
or via SLO API and record `slo.name`, `slo.status`, and
`slo.error_budget_remaining`.

Validation commands:

```dtctl
dtctl get slos --plain
dtctl describe slo <slo-id> --plain
```

For runtime SLI proxy, run:

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

### Step 7: Check for Dashboards and Notebooks

Look for existing monitoring assets:

```dql
fetch events
| filter event.type == "CUSTOM_INFO"
  AND dt.smartscape.service == toSmartscapeId("<service-id>")
| fields timestamp, event.name
| sort timestamp desc
| limit 20
```

## Coverage Report Template

```markdown
## Observability Coverage — [Service Name]

**Audit Date:** [date]
**Service Entity:** [entity ID]

### Signal Coverage

| Signal | Status | Details |
|--------|--------|---------|
| Server traces | ✅/❌ | [endpoint count, span count] |
| Client traces | ✅/❌ | [dependency count] |
| Logs (structured) | ✅/❌ | [log levels present] |
| Log-trace correlation | ✅/❌ | [trace_id present in logs] |
| Request metrics | ✅/❌ | [request count] |
| Error metrics | ✅/❌ | [failure count] |
| SLOs defined | ✅/❌ | [SLO names and status] |
| Deployment events | ✅/❌ | [recent events] |

### Coverage Level
[Full / Partial / Minimal / None]

### Gaps
1. [Gap description and remediation]

### Verdict Impact
[How this coverage level affects the readiness verdict]
```
