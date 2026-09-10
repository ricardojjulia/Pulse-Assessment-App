# Baseline Collection Guide

How to collect and document service baselines using Dynatrace DQL before making
changes. A baseline is the foundation for every gate decision.

## When to Collect Baselines

- **Before any Tier 1 or Tier 2 change** — collect for all affected services
- **During service onboarding** — establish initial production baseline
- **After significant traffic changes** — seasonal shifts, marketing campaigns
- **Periodically** — baselines drift; refresh at least monthly for critical services

## What to Collect

A complete baseline covers four signal categories.

### 1. Latency Baseline

```dql
timeseries {
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99),
  requests = sum(dt.service.request.count)
},
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    p50_ms = arrayAvg(p50) / 1000,
    p90_ms = arrayAvg(p90) / 1000,
    p99_ms = arrayAvg(p99) / 1000,
    throughput = arraySum(requests)
```

**By endpoint** (for hot-path identification):

```dql
timeseries {
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  requests = sum(dt.service.request.count)
},
by: {dt.smartscape.service, endpoint.name},
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    p50_ms = arrayAvg(p50) / 1000,
    p90_ms = arrayAvg(p90) / 1000,
    requestCount = arraySum(requests)
| sort requestCount desc
```

### 2. Error Baseline

```dql
timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    total = arraySum(requests),
    failed = arraySum(failures),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests)
```

**By error type:**

```dql
timeseries failures = sum(dt.service.request.failure_count),
  by: {dt.smartscape.service, http.response.status_code},
  filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd errorCount = arraySum(failures)
| filter errorCount > 0
| sort errorCount desc
```

### 3. Throughput Baseline

```dql
timeseries requestsPerMinute = sum(dt.service.request.count),
  filter: { dt.smartscape.service == toSmartscapeId("<service-id>") },
  interval: 1m
```

### 4. Saturation / Infrastructure Baseline

**CPU:**

```dql
timeseries {
  avgCpu = avg(dt.host.cpu.usage),
  maxCpu = max(dt.host.cpu.usage)
},
from: now()-2h,
filter: { host.name == "<host>" }
```

**Memory:**

```dql
timeseries {
  avgMem = avg(dt.host.memory.usage),
  maxMem = max(dt.host.memory.usage)
},
from: now()-2h,
filter: { host.name == "<host>" }
```

## Baseline Documentation Template

Record baselines using this format so gate decisions can reference them.

```markdown
## Baseline — [Service Name]

**Collected:** [date and time, UTC]
**Timeframe:** [e.g., last 24 hours, last 7 days]
**Environment:** [production / staging]

### Latency
| Percentile | Value |
|------------|-------|
| p50 | |
| p90 | |
| p99 | |

### Error Rate
| Metric | Value |
|--------|-------|
| Total requests | |
| Failed requests | |
| Error rate (%) | |

### Throughput
| Metric | Value |
|--------|-------|
| Requests/min (avg) | |
| Requests/min (peak) | |

### Infrastructure
| Resource | avg | p95 | max |
|----------|-----|-----|-----|
| CPU (%) | | | |
| Memory (%) | | | |

### Top Endpoints
| Endpoint | Requests | p90 Latency |
|----------|----------|-------------|
| | | |
```

## Comparing Against Baseline

After deployment, compare current metrics to the recorded baseline.

**Side-by-side comparison:**

```dql
timeseries {
  recent_p90 = percentile(dt.service.request.response_time, 90),
  recent_requests = sum(dt.service.request.count),
  recent_failures = sum(dt.service.request.failure_count)
},
from: now()-1h,
filter: { dt.smartscape.service == toSmartscapeId("<service-id>") }
| fieldsAdd
    recent_p90_ms = arrayAvg(recent_p90) / 1000,
    recent_errorRate = arraySum(recent_failures) * 100.0 / arraySum(recent_requests),
    recent_throughput = arraySum(recent_requests)
| append [
  timeseries {
    baseline_p90 = percentile(dt.service.request.response_time, 90),
    baseline_requests = sum(dt.service.request.count),
    baseline_failures = sum(dt.service.request.failure_count)
  },
  filter: { dt.smartscape.service == toSmartscapeId("<service-id>") },
  shift: -1h
  | fieldsAdd
      baseline_p90_ms = arrayAvg(baseline_p90) / 1000,
      baseline_errorRate = arraySum(baseline_failures) * 100.0 / arraySum(baseline_requests),
      baseline_throughput = arraySum(baseline_requests)
]
| fieldsAdd degradation_pct = (recent_p90_ms - baseline_p90_ms) * 100.0 / baseline_p90_ms
```

**Regression thresholds** (defaults — adjust per service SLO):

| Metric | Yellow (warning) | Red (regression) |
|--------|-----------------|------------------|
| p90 latency | > 1.2x baseline | > 2x baseline |
| Error rate | > baseline + 0.5% | > baseline + 2% |
| Throughput | < 0.9x baseline | < 0.7x baseline |
