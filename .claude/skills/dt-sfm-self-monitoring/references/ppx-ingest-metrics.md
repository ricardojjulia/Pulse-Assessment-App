# PPX / OpenPipeline Ingest Metrics

The PPX (OpenPipeline) ingest pipeline processes all data flowing into Grail. Self-monitoring metrics use the `remote_isfm.pipeline.*` prefix.

## Key Metrics

| Metric | Description |
|---|---|
| `remote_isfm.pipeline.execution.input.count` | Records entering the pipeline |
| `remote_isfm.pipeline.execution.output_bytes.count` | Bytes written to Grail |
| `remote_isfm.pipeline.execution.input_bytes.count` | Bytes entering the pipeline |
| `remote_isfm.pipeline.persistence.client.forwarded_records.count` | Records forwarded to Grail storage |
| `remote_isfm.pipeline.persistence.client.dropped_records.count` | Records dropped (errors, killswitch) |
| `remote_isfm.pipeline.queue.backpressure.count` | Backpressure events |
| `remote_isfm.pipeline.queue.bytes_per_grail_cluster` | Queue size per Grail cluster |
| `remote_isfm.pipeline.rule.execution.matches.count` | Pipeline rule matches |
| `remote_isfm.pipeline.rule.execution.errors.count` | Pipeline rule execution errors |
| `remote_isfm.pipeline.persistence.client.errors.count` | Storage write errors |
| `remote_isfm.pipeline.persistence.client.retries.count` | Storage write retries |
| `remote_isfm.pipeline.disabled_pipeline_rejected_batches.count` | Batches rejected by disabled pipelines |

## Key Dimensions

| Dimension | Description | Example values |
|---|---|---|
| `dt.pipeline.config_scope_id` | Pipeline / data type identifier | `logs`, `spans`, `metrics`, `user.events`, `user.replays`, `usersessions`, `bizevents`, `events`, `davis.events`, `security.events.internal` |
| `dt.pipeline.processing_unit` | Processing unit grouping | `logs`, `spans`, `metrics` |
| `grail_cluster` | Target Grail cluster | Cluster identifiers |
| `dt.host_group.id` | Source host group | `dtp-prod107-grail` |
| `table` | Target Grail table | Used with forwarded/dropped record metrics |

## Examples

**Ingest volume by pipeline (last 24h):**
```dql
timeseries {
  records = sum(remote_isfm.pipeline.execution.input.count),
  output_mb = sum(remote_isfm.pipeline.execution.output_bytes.count)
}, from: now() - 24h, by: {dt.pipeline.config_scope_id}
| fieldsAdd total_records = arraySum(records), total_mb = arraySum(output_mb) / 1048576
| fields dt.pipeline.config_scope_id, total_records, total_mb
| sort total_records desc
```

**Replay ingest traffic:**
```dql
timeseries input = sum(remote_isfm.pipeline.execution.input.count),
  from: now() - 24h,
  by: {dt.pipeline.config_scope_id},
  filter: {dt.pipeline.config_scope_id == "user.replays"}
| fieldsAdd total_records = arraySum(input)
```

**Backpressure and dropped records:**
```dql
timeseries {
  backpressure = sum(remote_isfm.pipeline.queue.backpressure.count),
  dropped = sum(remote_isfm.pipeline.persistence.client.dropped_records.count)
}, from: now() - 1h, by: {dt.pipeline.config_scope_id, grail_cluster}
| filter arraySum(backpressure) > 0 or arraySum(dropped) > 0
```
