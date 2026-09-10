# Guardian Setup Guide

Step-by-step guide to creating your first Site Reliability Guardian for
deployment validation.

## Prerequisites

- Dynatrace environment with Grail enabled
- Services instrumented and sending traces/metrics
- Site Reliability Guardian app installed

## Creating a Guardian

### 1. Plan Your Objectives

Before creating, decide what to validate. Start simple — 2-4 objectives:

| Objective | What to Check | Threshold Type |
|-----------|---------------|----------------|
| Error rate | Errors / total requests | Static or auto-adaptive |
| Response time | p90 latency | Static or auto-adaptive |
| Availability | Success rate | Static |
| Problem count | New DAVIS problems | Static (target: 0) |

### 2. Verify Data Availability

Before writing objectives, confirm the DQL queries return data:

```dql
fetch spans
| filter span.kind == "server"
  AND request.is_root_span == true
  AND dt.smartscape.service == toSmartscapeId("<your-service-id>")
| summarize count()
```

If this returns 0 results, the service is not sending traces or the entity ID
is wrong. Fix instrumentation first.

### 3. Create the Guardian

In the Site Reliability Guardian app:

1. Click **Create guardian**
2. Set name: e.g., "Payment Service Deploy Gate"
3. Add tags: e.g., `team:payments`, `gate:deploy`
4. Add variables: `service_id` = your service entity ID
5. Add objectives one by one

### 4. Configure Each Objective

For each objective:

1. **Name**: Clear, descriptive (e.g., "Error Rate < 1%")
2. **Type**: DQL or SLO Reference
3. **DQL Query**: A query that returns a single numeric value
4. **Comparison**: Greater-than-or-equal or less-than-or-equal
5. **Threshold**: Static values or auto-adaptive

**Important:** DQL objectives must return exactly one numeric value. Use
`summarize` to aggregate to a single row and column.

### 5. Test the Guardian

Run a manual validation to confirm:
- All objectives execute without errors
- Values are in expected ranges
- Thresholds produce sensible PASS/WARNING/FAIL results

## Example: Starter Guardian

A minimal guardian for a web service:

**Objective 1 — Error Rate:**
```dql
timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd errorRate = arraySum(failures) * 100.0 / arraySum(requests)
```
- Comparison: LESS_THAN_OR_EQUAL
- Warning: 0.5
- Target: 1.0

**Objective 2 — Response Time (p90):**
```dql
timeseries p90 = percentile(dt.service.request.response_time, 90),
  filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd p90_us = arrayAvg(p90)
```
- Comparison: LESS_THAN_OR_EQUAL
- Warning: 300000 (300ms in microseconds)
- Target: 500000 (500ms)

**Objective 3 — No New Problems:**
```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND timestamp > now() - 30m
| expand affected_entity_ids
| filter affected_entity_ids == "$service_id"
| summarize problemCount = count()
```
- Comparison: LESS_THAN_OR_EQUAL
- Target: 0

**Objective 4 — Throughput Not Dropping:**
```dql
timeseries requests = sum(dt.service.request.count),
  filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd requestCount = arraySum(requests)
```
- Comparison: GREATER_THAN_OR_EQUAL
- Threshold type: Auto-adaptive (DAVIS sets baseline from 30-day history)

## Using Auto-Adaptive Thresholds

For objectives where you don't know the "right" threshold:

1. Set threshold type to **Auto-adaptive**
2. The guardian fetches 30 days of historical data
3. DAVIS analyzes the distribution and sets appropriate thresholds
4. Thresholds adapt as your service behavior changes

Best for: throughput, latency baselines, and metrics where "normal" shifts
over time.

## Using Variables

Variables make guardians reusable across environments:

| Variable | Use Case |
|----------|----------|
| `service_id` | Target service entity ID |
| `host_name` | Target host name |
| `environment` | dev / staging / production |
| `timeframe_minutes` | How far back to query |

Reference variables in DQL with `$variable_name`:

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("$service_id")
```

Override at validation time to reuse the same guardian for different services
or environments.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Objective returns ERROR | DQL query is invalid | Test query independently |
| Value is null | No data for the timeframe | Check entity ID and time range |
| All PASS but deploy broke things | Objectives don't cover the issue | Add objectives for the missed signal |
| Auto-adaptive too lenient | Not enough history or too much variance | Switch to static or tune manually |
