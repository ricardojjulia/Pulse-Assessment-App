# Cluster Tenant Listing

Find all tenants running on a specific cluster. Works for **both Gen2 and Gen3** clusters using different data sources and queries.

## When to Use

- You have a cluster name and want to find all tenants running on it
- Cluster capacity analysis (how many tenants/paying customers on a cluster)
- Identifying which customers share a cluster
- Works for BOTH Gen2 and Gen3 clusters (different queries for each)

## Gen2 Cluster Query

Query Snowflake bizevents data to find all tenants on a Gen2 cluster. This data is synced daily from Snowflake into the `custom_sen_critical_bizevents_snowflake_data` bucket.

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter cluster == "prod61-virginia"
```

**Data source:** Snowflake bizevents (updated once per day, use `from:-1d`)

**Returns:** `tenant`, `cluster`, `customer_name`, `paying`, `internal` for every tenant on the specified Gen2 cluster.

## Gen3/Grail Cluster Query

Query real-time query frontend logs to find all tenants on a Gen3/Grail cluster. Tenants query approximately every hour, so a 2-hour window captures most active tenants.

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter dt.host_group.id == "dtp-prod11-grail"
| fields tenant, dt.host_group.id
| dedup tenant
```

**Data source:** Query frontend DQL logs (real-time, use 2-hour window)

**Returns:** `tenant` and `dt.host_group.id` for every tenant that queried on the specified Grail cluster within the time window.

## Templates

### Gen2 Cluster Template

Replace `<GEN2_CLUSTER_NAME>` with the target cluster (load a skill covering Dynatrace cluster architecture for Gen2 naming formats):

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name
| filter cluster == "<GEN2_CLUSTER_NAME>"
```

### Gen3/Grail Cluster Template

Replace `<GRAIL_CLUSTER_NAME>` with the target cluster (e.g., `dtp-prod11-grail`):

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter dt.host_group.id == "<GRAIL_CLUSTER_NAME>"
| fields tenant, dt.host_group.id
| dedup tenant
```

## Example: Count Paying Customers per Gen2 Cluster

This query counts paying external customers on each Gen2 cluster, useful for capacity analysis:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| filter internal == false
| filter paying == true
| summarize tenants = count(), by: {cluster}
| sort tenants desc
```

**Expected output:**

| cluster | tenants |
| --- | --- |
| prd-ae8e9ca0-63d7-4133-9f45-5cee130fb006 | 342 |
| prod23-ireland | 289 |
| 194921b8-3027-4a54-8853-42649171599e | 156 |
| ... | ... |

## Common Pattern: Cluster Capacity Analysis

To analyze the capacity and tenant composition of a specific cluster:

1. **Query by cluster name** using the appropriate query (Gen2 or Gen3)
2. **Filter by paying status** to focus on paying customers: `| filter paying == true`
3. **Count tenants**: `| summarize count = count()`

This pattern helps answer questions like "How many paying customers are on prod61-virginia?" or "What's the tenant load on dtp-prod11-grail?"

## Tips

- Load a skill covering Dynatrace cluster architecture for cluster naming conventions and formats (Gen2 and Gen3)
- Use the **correct query type** for your cluster — Gen2 queries won't find Gen3 clusters and vice versa
- Gen3 Grail cluster name can infer the platform cluster: replace `-grail` with `-plsrv`
- Gen2 data is **daily** (Snowflake sync); Gen3 data is **real-time** (logs)
- Always include `dedup` to get unique tenants with latest data
