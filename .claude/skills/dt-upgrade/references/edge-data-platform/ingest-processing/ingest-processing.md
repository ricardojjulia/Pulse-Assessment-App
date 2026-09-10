# Ingest Processing

<!-- Jira: PRODUCT-14501 -->

**Gen3 replacement**: OpenPipeline

**Phase 2 required**: no

## What changes

Classic logs pipeline will be deactivated. Customers must migrate classic pipelines to OpenPipeline.

## Customer actions

- Migrate classic pipelines to OpenPipeline

## Tracking queries

Logs pipeline -- classic vs OpenPipeline throughput:

```dql
timeseries {
  classic = sum(platform.ppx_service.isfm.pipeline.execution.input
      ,filter:{dt.pipeline.config_scope_id == "logs" and dt.pipeline.pipeline_id == "default"}
  ),
  opp = sum(platform.ppx_service.isfm.pipeline.execution.input
      ,filter:{dt.pipeline.config_scope_id == "logs" and dt.pipeline.pipeline_id != "default"}
  )
}
```

Bizevents pipeline -- classic vs OpenPipeline throughput:

```dql
timeseries {
  classic = sum(remote_isfm.pipeline.execution.input.count
      ,filter:{dt.pipeline.config_scope_id == "bizevents" and dt.pipeline.pipeline_id == "default"}
  ),
  opp = sum(remote_isfm.pipeline.execution.input.count
      ,filter:{dt.pipeline.config_scope_id == "bizevents" and dt.pipeline.pipeline_id != "default"}
  )
}
```
