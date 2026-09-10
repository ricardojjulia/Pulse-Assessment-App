# Metric Event Alerts

<!-- Jira: none -->

**Gen3 replacement**: DQL-based Anomaly Detector Alerts

**Phase 2 required**: yes

## What changes

- Info banner and teaser shown in classic app
- Migration wizard offered that leverages the metric transpiler (works only in ~80% of cases due to the metric transpiler)

## Customer actions

- Rework alerting configs that use Management Zones
- Rework alerting configs that use Alerting Rules
- Migrate towards DQL-based alerting configs
- Set up Workflow-based alert notifications

## Tracking queries

Metric for listing all metric events that use metricSelectors:

```dql
timeseries count(dt.sfm.server.anomaly_detection.metric_events.monitored_dimensions), by:{dt.config.id, dt.config.name}
```

## Documentation

- [Upgrade guide: alert notification](https://docs.dynatrace.com/docs/shortlink/upgrade-guide-alert-notification)

## Best practices

- [Upgrade guide: alert notification](https://docs.dynatrace.com/docs/shortlink/upgrade-guide-alert-notification)
