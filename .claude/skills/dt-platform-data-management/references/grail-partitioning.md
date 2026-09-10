# Grail Bucket Partitioning Strategy

Optimize Dynatrace Grail bucket partitioning for retention, cost allocation, query performance, and access control.

## Contents

- [Agent Workflow: Assess Current Partitioning](#agent-workflow-assess-current-partitioning)
  - [Step 1: Discover buckets and assess ingest volume](#step-1-discover-buckets-and-assess-ingest-volume)
  - [Step 2: Identify buckets needing attention](#step-2-identify-buckets-needing-attention)
  - [Step 3: Investigate high-volume buckets](#step-3-investigate-high-volume-buckets)
  - [Step 4: Check what lands in default buckets](#step-4-check-what-lands-in-default-buckets)
  - [Step 5: Present findings and recommendations](#step-5-present-findings-and-recommendations)
- [Partitioning Decision Framework](#partitioning-decision-framework)
- [Naming Convention](#naming-convention)
- [Bucket Limits](#bucket-limits)
- [Access Control Guidance](#access-control-guidance)
- [Query Performance: Key Thresholds](#query-performance-key-thresholds)
- [Alternative Performance Optimizations](#alternative-performance-optimizations)
- [Migration Considerations (from Splunk, Elastic, etc.)](#migration-considerations-from-splunk-elastic-etc)
- [Successful Pattern: Large Enterprise](#successful-pattern-large-enterprise)
- [Periodic Review](#periodic-review)

## Agent Workflow: Assess Current Partitioning

Follow these steps in order to analyze and recommend optimizations.

### Step 1: Discover buckets and assess ingest volume

A single query returns the full bucket inventory with sizing data. Run for each relevant record type (`logs`, `spans`, `events`, `bizevents`).

```dql
fetch dt.system.buckets
| filter dt.system.table == "logs"
| fieldsAdd est_avgDailyIngest = estimated_uncompressed_bytes / retention_days
| fieldsAdd est_scan_7d_GB = (estimated_uncompressed_bytes / retention_days * 7) / 1000000000
| fields name, retention_days, records, est_avgDailyIngest, est_scan_7d_GB
| sort est_avgDailyIngest desc
```

Repeat with `dt.system.table == "spans"`, `"events"`, `"bizevents"`, etc.

All fields needed for this workflow — bucket name, record type, retention, and ingest estimates — are available in `dt.system.buckets`.

### Step 2: Identify buckets needing attention

Flag buckets where **estimated average daily ingest exceeds ~2 TB**. This is a rule of thumb — for buckets queried with long timeframes (weeks/months), the threshold is lower; for narrow time windows or infrequent queries, higher volumes in a single bucket can be acceptable.

The key metric is **not the number of buckets** but each bucket's **fill rate relative to how it's queried**. A bucket with 12 TB/day queried over a 1-year timeframe will cause timeouts. The same bucket queried over 1 hour may perform fine.

### Step 3: Investigate high-volume buckets

For each **flagged** bucket, determine what data it contains and identify natural split criteria.

Example — check whether a field like `primary_tags.virtualization` is a good split candidate:

```dql
fetch logs, scanLimitGBytes: -1, bucket: {"logs_infra"}, from: -1d
| fieldsAdd contentLength = stringLength(content)
| summarize length = sum(contentLength), by: {primary_tags.virtualization}
| sort length desc
```

> **Note:** Use `from: -1d` (not `-7d`) for buckets exceeding the ~2 TB/day threshold. A 7-day scan on a large bucket will hit Grail's 5-minute scan limit before returning results.

Good split criteria produce a **small number of groups** (2–10) with **meaningful volume each**. Avoid criteria that create many sparse buckets.

### Step 4: Check what lands in default buckets

If data appears in `default_logs`, `default_spans`, etc., it means either routing is misconfigured or new data sources aren't covered by OpenPipeline rules.

```dql
fetch logs, scanLimitGBytes: -1, bucket: {"default_logs"}, from: -1d
| summarize cnt = count(), by: {dt.source_entity, dt.entity.host}
| sort cnt desc
| limit 20
```

### Step 5: Present findings and recommendations

Report findings as a structured summary:

1. **Current state** — number of custom buckets, record types in use, total estimated daily ingest
2. **High-volume buckets** — buckets exceeding ~2 TB/day with their estimated volumes
3. **Default bucket leakage** — data landing in default buckets that should be routed
4. **Recommendations** — specific bucket splits, naming suggestions, retention adjustments

## Partitioning Decision Framework

Use this framework when recommending whether and how to split buckets.

### When to split

| Condition | Action |
|-----------|--------|
| Bucket daily ingest > ~2 TB and queries use wide timeframes | Split by a natural grouping field |
| Different retention requirements for subsets of data | Create retention-specific buckets |
| Cost allocation required per department/team/product | Create cost-center-specific buckets |
| DENY-based access control needed on a data subset | Route sensitive data to a dedicated bucket |

### When NOT to split

| Condition | Reason |
|-----------|--------|
| Low data volume (default setup handles it) | Unnecessary complexity |
| Split would create many sparse buckets | More scanned buckets per query = worse performance |
| Access control can be solved with record-level IAM | Buckets are not the primary access control tool |
| Migrating from another tool and tempted to replicate its structure | Grail has different constraints; don't copy Splunk indexes 1:1 |

### Natural split criteria

Evaluate fields commonly used in queries that scan high byte volumes:

- Kubernetes clusters (but only the largest; group smaller ones together)
- Cloud account IDs
- Business units / departments
- Applications (only if individually high-volume)
- Environment type (production vs. non-production)

**Key rule:** split so that most queries only need to scan 1–3 buckets. Distributing data evenly is less important than aligning buckets with query boundaries.

## Naming Convention

Use a consistent naming scheme.

If none is recognizable, you can note it and ask whether the user wants recommendations (unless the user specified to not be asked).
If so, give the following example:

`{recordtype}_{costcenter}_{retention}_{qualifier}`

| Example | Meaning |
|---------|---------|
| `logs_shared` | Shared logs bucket, default retention |
| `logs_delivery` | Delivery department logs |
| `logs_delivery_90d` | Delivery logs with 90-day retention |
| `logs_delivery_90d_teambravo` | Further split of delivery 90d logs |
| `logs_infra_cloud` | Infrastructure logs, cloud subset |
| `logs_sensitive` | Sensitive logs requiring DENY-based access control |
| `spans_shared` | Shared spans bucket |

- Avoid `_default` suffix — too easy to confuse with `default_logs`
- Name should encode: record type, cost center (if applicable), retention (if non-standard), qualifier (if performance-split)

## Bucket Limits

- Default limit: **80 custom buckets** (built-in default buckets don't count)
- Limit increase: request **1 additional bucket per 20 GB of daily ingest**
  - Example: 16,000 GB/day ingest → up to 800 buckets
- Creating hundreds of buckets manually is error-prone — use APIs and automation with a well-defined naming convention

## Access Control Guidance

### Preferred: record-level and field-level IAM permissions

For most access control needs, use Grail record-level permissions (and field-level permissions for finer granularity). These are more flexible than bucket-based partitioning.

### When buckets are required for access control

Buckets are needed when enforcing **DENY** rules on specific data subsets. Conditional DENY on Grail table permissions is **not supported**:

```
# NOT SUPPORTED — WHERE clause is ignored on DENY for table permissions
DENY storage:logs:read WHERE storage:dt.security_context="sensitive"
```

**Solution:** route sensitive data to a dedicated bucket and DENY at the bucket level:

```
DENY storage:buckets:read WHERE storage:bucket-name="logs_sensitive"
```

Bucket-level DENY also improves query performance — Grail excludes denied buckets entirely, whereas record-level permissions still cause the bucket to be scanned. Note: spans from a single trace can reside in different buckets; if a user lacks access to any of them, the entire trace becomes invisible.

## Query Performance: Key Thresholds

| Scenario | Guidance |
|----------|----------|
| Single bucket < ~2 TB/day, narrow time windows | Default setup likely sufficient |
| Single bucket > ~2 TB/day, broad time windows | Partition for performance |
| Single bucket 12+ TB/day, queried over months/year | Dashboards will time out — split is essential |
| Up to 15 TB/day in one bucket, narrow time windows only | Can work without splitting |
| Query timeout: Apps/dashboards/notebooks/workflows | ~5 minutes |

**Frequently queried data** benefits more from dedicated buckets — even at lower volumes, high query frequency adds up in total cost.

## Alternative Performance Optimizations

Before adding more buckets, consider: **extracting metrics** from logs/events/spans for frequently aggregated data (metrics queries are cheaper), and applying **DQL best practices** — filter early, use narrow timeframes, always specify a bucket in `fetch logs`.

## Migration Considerations (from Splunk, Elastic, etc.)

- Don't replicate Splunk indexes or Elastic indices 1:1 as Grail buckets
- Each record can only reside in **one bucket** — data cannot be moved after ingestion
- Use migration as an opportunity to design a clean partitioning strategy
- Partition by natural query boundaries, not by source tool structure

## Successful Pattern: Large Enterprise

A customer observing thousands of applications (250 TB/day ingest) used this approach:

1. Created buckets per **Business Unit** (~50 BUs) — not per application
2. For individual applications exceeding the recommended daily ingest volume, created **dedicated application-specific buckets**
3. This avoided thousands of sparse per-application buckets while keeping query performance optimal

**Takeaway:** use higher-level groupings (business unit, department, domain) as the primary split. Only create per-application buckets when individual volumes justify it.


## Periodic Review

Partitioning strategies should evolve with your environment. Periodically re-run Step 1 to check for new high-volume buckets, verify default buckets are empty (no routing gaps), and review whether existing splits are still justified or retention times need adjusting.
