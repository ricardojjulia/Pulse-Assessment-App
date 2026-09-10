# Per-Tenant Pipeline Metrics

Use `platform.ppx_service.isfm.pipeline.execution.*` metrics to analyze per-tenant ingest volume. These have a `dt.tenant.uuid` dimension that the `remote_isfm.*` variants lack.

| Metric | What it measures |
|---|---|
| `platform.ppx_service.isfm.pipeline.execution.input` | Records entering a pipeline |
| `platform.ppx_service.isfm.pipeline.execution.input_bytes` | Bytes entering a pipeline |

**Key dimensions:** `dt.tenant.uuid`, `dt.pipeline.config_scope_id`, `dt.host_group.id`

## Examples

**Check what data types a tenant is sending:**
```dql
timeseries input = sum(platform.ppx_service.isfm.pipeline.execution.input),
  from: now() - 24h,
  by: {dt.pipeline.config_scope_id, dt.tenant.uuid},
  filter: {dt.tenant.uuid == "<tenant-id>"}
| fieldsAdd total = arraySum(input)
| sort total desc
```

**Check if a tenant uses session replay:**
```dql
timeseries input = sum(platform.ppx_service.isfm.pipeline.execution.input),
  from: now() - 7d,
  by: {dt.pipeline.config_scope_id, dt.tenant.uuid},
  filter: {dt.tenant.uuid == "<tenant-id>"
    and dt.pipeline.config_scope_id == "user.replays"}
| fieldsAdd total = arraySum(input)
```
If no results, the tenant is not sending session replay data through the Gen3 PPX pipeline.

## Pipeline config_scope_id Values

`logs`, `spans`, `metrics`, `user.events`, `user.replays`, `usersessions`, `virtualextractedrumeventsforusersessions`, `bizevents`, `events`, `davis.events`, `security.events`
