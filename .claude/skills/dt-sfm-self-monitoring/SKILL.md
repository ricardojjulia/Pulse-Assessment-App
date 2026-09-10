---
name: dt-sfm-self-monitoring
description: Dynatrace platform self-monitoring on dre63214 — cluster architecture (naming, Gen2 vs Gen3, deployment families like prod10 or eu-west-7-ireland), health dashboards for Grail ingest/query/PPX, and DQL templates for cluster-based queries. For tenant lookups, load a skill covering tenant-to-customer mapping and account lookups.
---

# Dynatrace Production Self-Monitoring

## Overview

This skill covers platform infrastructure monitoring for Dynatrace's self-monitoring tenant **dre63214**. It provides health dashboards for Grail ingest, query, and PPX components, explains cluster architecture and naming conventions, and offers DQL templates for querying clusters across all signal types.

For tenant lookups — customer name, payment status, cluster mapping, or finding paying customers — load a skill covering tenant-to-customer mapping and account lookups instead.

## Use Case Routing

| You want to... | Read |
|---|---|
| Find a health dashboard (Grail ingest, query, PPX, SLOs) | [health-dashboards.md](references/health-dashboards.md) |
| Understand cluster architecture, naming, types | [cluster-architecture.md](references/cluster-architecture.md) |
| Query PPX / OpenPipeline ingest metrics (cluster-level) | [ppx-ingest-metrics.md](references/ppx-ingest-metrics.md) |
| Analyze per-tenant ingest volume (PPX pipeline metrics) | [tenant-pipeline-metrics.md](references/tenant-pipeline-metrics.md) |
| Check DT UI feature usage per tenant (RUM self-monitoring) | [dt-ui-self-monitoring.md](references/dt-ui-self-monitoring.md) |
| Query legacy JMX self-monitoring metrics (Gen2) | [legacy-jmx-metrics.md](references/legacy-jmx-metrics.md) |
| Map accounts/customers to tenants, check payment status | Load a skill covering tenant-to-customer mapping and payment status lookups |

## Essential Concepts

**Canonical cluster identifier:** `dt.host_group.id` appears in all observability signals — metrics, logs, spans, and entities. Always use it for cluster-based filtering.

**Cluster naming format:** `dtp-<deployment>-<type>`

| Type | Example | Role |
|---|---|---|
| `grail` | `dtp-prod107-grail` | Grail ingest, query, PPX |
| `plsrv` | `dtp-prod107-plsrv` | Platform services |
| `apigw` | `dtp-prod107-apigw` | API gateway |
| `apprt` | `dtp-prod107-apprt` | App runtime |
| `dac` | `dtp-prod107-dac` | Data ingest controller |

**Deployment families:** Same deployment number = related cluster family. If a tenant runs on `dtp-prod11-grail`, its platform services are on `dtp-prod11-plsrv`.

**Host groups are independent:** Each host group (cluster) is an isolated deployment with its own infrastructure. The terms "host group" and "cluster" are interchangeable.

See [cluster-architecture.md](references/cluster-architecture.md) for full details on naming, types, Gen2 vs Gen3 differences, and component deployment patterns.

## PPX / OpenPipeline Ingest Metrics

The PPX (OpenPipeline) ingest pipeline processes all data flowing into Grail. Self-monitoring metrics use the `remote_isfm.pipeline.*` prefix. Key dimensions: `dt.pipeline.config_scope_id`, `dt.host_group.id`, `grail_cluster`.

See [ppx-ingest-metrics.md](references/ppx-ingest-metrics.md) for metrics, dimensions, and DQL examples.

## Per-Tenant Pipeline Metrics

Use `platform.ppx_service.isfm.pipeline.execution.*` metrics with `dt.tenant.uuid` dimension for per-tenant ingest volume analysis. Key dimensions: `dt.tenant.uuid`, `dt.pipeline.config_scope_id`, `dt.host_group.id`.

See [tenant-pipeline-metrics.md](references/tenant-pipeline-metrics.md) for metrics, DQL examples, and `config_scope_id` values.

## DT UI Self-Monitoring (RUM on dre63214)

Dynatrace's RUM agent on the DT UI sends `user.events` to dre63214, capturing how customers interact with the UI. Filter by tenant ID in `url.full` to analyze feature adoption and usage patterns.

See [dt-ui-self-monitoring.md](references/dt-ui-self-monitoring.md) for DQL examples and user identity lookups.

## Legacy JMX Self-Monitoring Metrics (Gen2)

Gen2 clusters expose JMX-based cumulative counters on dre63214, dimensioned by `dt.smartscape.process`. Requires chained lookups (process → host → `dt.host_group.id`) and backtick quoting for hyphenated metric keys.

See [legacy-jmx-metrics.md](references/legacy-jmx-metrics.md) for DQL examples and key patterns.

## Best Practices

- **Always filter queries** by tenant or cluster — 50k+ tenants exist in dre63214
- **Set `scanLimitGBytes:-1`** on log queries to avoid scan-limit errors
- **Timeframes:** logs use `2h` lookback for real-time signals
- **Use `dt.host_group.id`** for cluster filtering across all signal types (metrics, logs, spans)
- **Gen2 vs Gen3:** Gen2 clusters use legacy names (e.g., `prod61-virginia`); Gen3 use `dtp-<deployment>-<type>` format
- **Pattern matching:** Use `~` operator for deployment family queries (e.g., `name ~ "prod10"`)
- **Infer related clusters** by swapping the type suffix (e.g., `-grail` → `-plsrv`)
