# Calculated Service Metrics

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: yes

## What changes

Calculated service metrics will need to be assessed for Phase 3 compatibility.

## Tracking queries

Number of currently written calculated service metrics:

```dql
fetch metric.series
| filter startsWith(metric.key, "service.")
| dedup metric.key
| summarize count()
```
