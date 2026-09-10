---
name: dt-platform-data-management
description: "Analyze and optimize Dynatrace Grail bucket partitioning strategy. Assess bucket inventory and ingest sizing. Fix DQL query timeouts and scan limit errors caused by oversized buckets. Reduce DQL scan volume and cost through Grail partitioning. Control which team can see which log data by isolating logs into team-specific Grail buckets. Allocate storage costs per department. Define retention settings and naming conventions for custom Grail buckets."
---

# dt-platform-data-management
Consult [references/grail-partitioning.md](references/grail-partitioning.md) for the full assessment workflow, decision framework, and naming conventions.

## Prerequisites

- **Grail-enabled environment** — the tenant must use Grail-based storage (not Classic)
- **`dt.system.buckets` read access** — permission to query the system table for bucket metadata and ingest estimates (`storage:system:read` scope)
- **Bucket/record read permissions** — access to the record types being assessed (logs, spans, events, bizevents)
- **Data model awareness** — each record can only reside in one bucket; data cannot be moved after ingestion


## Instructions

### Step 1: Discover buckets and assess ingest volume

Query `dt.system.buckets` to get the full inventory of buckets with sizing data in one step. The query returns bucket names, record types, retention settings, and computes `est_avgDailyIngest` and `est_scan_7d_GB`. Run for each relevant record type: `logs`, `spans`, `events`, `bizevents`. This replaces a separate `dtctl get buckets` call — all fields needed for this workflow are available in `dt.system.buckets`.

### Step 2: Identify buckets needing attention

Flag buckets where estimated average daily ingest exceeds ~2 TB/day. The key metric is each bucket's fill rate relative to how it is queried — a 12 TB/day bucket queried over months will cause timeouts; the same bucket queried over 1 hour may be fine.

### Step 3: Investigate high-volume buckets

For each flagged bucket, determine what data it contains and identify natural split criteria (e.g., `primary_tags.virtualization`, cloud account, business unit). Good criteria produce 2–10 groups with meaningful volume each. Avoid criteria that create many sparse buckets.

### Step 4: Check default bucket leakage

Query default buckets (`default_logs`, `default_spans`, etc.) to surface data that should have been routed to a custom bucket. Anything found signals a misconfigured or missing OpenPipeline routing rule.

### Step 5: Present findings and recommendations

Report as a structured summary:
1. **Current state** — number of custom buckets, record types, total estimated daily ingest
2. **High-volume buckets** — buckets exceeding ~2 TB/day with estimated volumes
3. **Default bucket leakage** — unrouted data found in default buckets
4. **Recommendations** — specific bucket splits, naming suggestions per the `{recordtype}_{costcenter}_{retention}_{qualifier}` convention, retention adjustments


## Examples

### Example 1: Large enterprise with 250 TB/day ingest

**Situation:** A customer observing thousands of applications with ~250 TB/day total ingest needed a partitioning strategy that kept query performance acceptable without creating thousands of sparse buckets.

**Approach:**
1. Ran the ingest assessment (Step 1) across `logs`, `spans`, and `events`
2. Identified ~50 Business Units as the primary split axis — high-level enough to avoid bucket explosion, meaningful enough for cost allocation
3. Created one bucket per Business Unit per record type (e.g., `logs_delivery`, `logs_accounting`, `spans_delivery`)
4. For individual applications within a BU that individually exceeded the ~2 TB/day threshold, created dedicated application-level buckets (e.g., `logs_delivery_appx`)
5. Configured OpenPipeline routing rules to send data to BU buckets, with per-app overrides where needed

**Result:** Query performance stayed within acceptable bounds, cost allocation was accurate at the BU level, and the total bucket count remained well within the 80-bucket default limit.

**Key takeaway:** Use higher-level groupings (business unit, department, domain) as the primary split. Only add per-application buckets when individual volumes justify it.

## Limitations

- **Read-only analysis** — this skill assesses and recommends; it does not create, modify, or delete buckets
- **No OpenPipeline configuration** — routing rules are recommended but not implemented by this skill
- **No Classic storage support** — applies to Grail-based environments only
- **No DQL syntax guidance** — for DQL language help, use `dt-dql-essentials`
- **No `dtctl` required for analysis** — all read operations use DQL (`dt.system.buckets`); `dtctl` is not needed for the analysis workflow

## References
- Detailed guide: `references/grail-partitioning.md`
