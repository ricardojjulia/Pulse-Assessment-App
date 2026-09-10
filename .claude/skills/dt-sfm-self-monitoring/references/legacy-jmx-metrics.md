# Legacy JMX Self-Monitoring Metrics (Gen2)

Gen2 clusters expose JMX-based self-monitoring metrics on dre63214. These are cumulative counters dimensioned by `dt.smartscape.process`.

## Examples

**Session replay storage per Gen2 cluster:**
```dql
timeseries stored = max(`legacy.custom.jmx.dynatrace.selfmonitoring.session-replay.total_size_stored`),
  by: {dt.smartscape.process}
| fieldsAdd delta_gb = (arrayMax(stored) - arrayMin(stored)) / 1024 / 1024 / 1024
| lookup [smartscapeNodes PROCESS
    | fieldsAdd references[belongs_to.host]
    | fields id, references[belongs_to.host]],
  sourceField: dt.smartscape.process, lookupField: id
| fieldsRename host_id = `lookup.references[belongs_to.host]`
| lookup [smartscapeNodes HOST
    | fieldsAdd dt.host_group.id
    | fields id, dt.host_group.id],
  sourceField: host_id, lookupField: id
| summarize total_gb = sum(delta_gb), by: {`lookup.dt.host_group.id`}
| sort total_gb desc
```

## Key Patterns

- Metric keys with hyphens (e.g., `session-replay`) must be wrapped in **backticks** or DQL parses them as subtraction
- These are **cumulative counters** — use `arrayMax() - arrayMin()` to compute the delta over the query timeframe, not the raw value
- Mapping process to cluster requires a chained lookup: process → host (`references[belongs_to.host]`) → `dt.host_group.id` (via `smartscapeNodes HOST`)
- Use `fieldsRename` between chained lookups to avoid `lookup.*` prefix collisions (each `lookup` removes existing `lookup.*` fields)
