# Gen3/Grail Cluster Lookup

## When to Use

- You have a tenant ID and need to find which Gen3/Grail cluster it runs on
- You need the Grail cluster name (NOT the Gen2 cluster from Snowflake)

## Query

Find the Gen3/Grail cluster for a tenant by querying query frontend logs:

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter tenant == "aoz61916"
| fields dt.host_group.id, tenant
| dedup tenant
```

**Returns:** `dt.host_group.id` — the Grail cluster identifier (e.g., `dtp-prod11-grail`).

**What is `dt.host_group.id`?** The Grail cluster identifier for the tenant. Load a skill covering Dynatrace cluster architecture for details on cluster naming and deployment families.

## Template

Replace `<TENANT_ID>` with the target tenant:

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter tenant == "<TENANT_ID>"
| fields dt.host_group.id, tenant
| dedup tenant
```

## Naming Convention

Gen3/Grail cluster names use `dtp-<deployment>-grail` format (e.g., `dtp-prod11-grail`). Load a skill covering Dynatrace cluster architecture for full naming conventions and deployment families.

## Example

Complete Gen3 cluster lookup for tenant `aoz61916`:

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter tenant == "aoz61916"
| fields dt.host_group.id, tenant
| dedup tenant
```

**Expected output:**

| dt.host_group.id | tenant |
| --- | --- |
| dtp-prod11-grail | aoz61916 |

From this result:
- **Gen3/Grail cluster:** `dtp-prod11-grail`
- **Inferred platform cluster:** `dtp-prod11-plsrv`

## Notes

- Use a **2h lookback window** — tenants query approximately once per hour, so a 2-hour window catches most active tenants
- This uses **real-time log data** (NOT the daily Snowflake sync used for Gen2 clusters)
- Bucket: `custom_sen_low_query_frontend_dql_logs`

## Troubleshooting

**No results returned:**
- The tenant may not have issued any DQL queries in the last 2 hours
- Try a wider time window (e.g., `from:now()@h-4h`) to catch less-active tenants
- Verify the tenant ID spelling — tenant IDs are case-sensitive in log queries

**Gen2 vs Gen3 confusion:**
- This query returns **Gen3/Grail clusters only** (format: `dtp-<deployment>-grail`)
- For the Gen2 cluster, use the Snowflake bizevents query from [tenant-details.md](tenant-details.md) instead
- See a skill covering Dynatrace cluster architecture for cluster naming conventions and architecture details
