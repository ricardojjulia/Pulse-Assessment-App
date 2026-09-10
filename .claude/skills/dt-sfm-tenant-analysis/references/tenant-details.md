# Tenant Details Lookup

## When to Use

Use this reference when you have a **tenant ID** and want to find:

- **Customer name** — human-readable account name
- **Payment status** — paying customer vs trial/internal
- **Gen2 cluster** — legacy runtime cluster location
- **Internal flag** — whether the tenant is Dynatrace-owned

## Query

Look up tenant metadata from the Snowflake bizevents data on dre63214:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter tenant == "aoz61916"
```

### Returned Fields

| Field | Type | Description | Example |
| ----- | ---- | ----------- | ------- |
| `tenant` | String | Unique tenant identifier | `"aoz61916"` |
| `cluster` | String | **Gen2 cluster** name (NOT Gen3/Grail). Load a skill covering Dynatrace cluster architecture for naming formats. | `"prd-5a39a141-58ef-464c-bc61-3e1f7caead04"` |
| `customer_name` | String | Human-readable account name | `"Acme Corp"` |
| `paying` | Boolean | Is customer paying (`false` = trial or internal) | `true` |
| `internal` | Boolean | Is Dynatrace-owned tenant | `false` |

**⚠️ Important:**

- The `cluster` field returns the **Gen2 cluster only**, not the Gen3/Grail cluster.
- Snowflake data is updated **once per day** — always use `from:-1d` timeframe.
- The dataset contains ~50k rows unfiltered — **always filter by tenant**.
- Use `dedup tenant, {timestamp desc}` to get the latest record (tenants may have historical entries).

## Template

Replace `<TENANT_ID>` with the actual tenant identifier:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter tenant == "<TENANT_ID>"
```

## Example

### Complete Tenant Investigation

A full tenant investigation typically requires two steps: (1) get metadata from Snowflake, and (2) find the Gen3/Grail cluster from logs.

**Step 1: Get tenant metadata from Snowflake**

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter tenant == "aoz61916"
```

Expected output:

| tenant | cluster | customer_name | paying | internal |
| ------ | ------- | ------------- | ------ | -------- |
| aoz61916 | prd-5a39a141-58ef-464c-bc61-3e1f7caead04 | Acme Corp | true | false |

**Step 2: Find Gen3/Grail cluster from logs**

```dql
fetch logs, scanLimitGBytes:-1, from:now()@h-2h, to:now()@h-1h
| filter dt.system.bucket == "custom_sen_low_query_frontend_dql_logs"
| filter tenant == "aoz61916"
| fields dt.host_group.id, tenant
| dedup tenant
```

Expected output:

| dt.host_group.id | tenant |
| ----------------- | ------ |
| dtp-prod11-grail | aoz61916 |

**Combined result:** Tenant `aoz61916` belongs to **Acme Corp** (paying, external), runs on Gen2 cluster **prd-5a39a141-58ef-464c-bc61-3e1f7caead04** and Gen3/Grail cluster **dtp-prod11-grail**.

## Common Pattern: Full Tenant Investigation

Most tenant lookups follow a 2-step process:

1. **Get metadata from Snowflake** (this reference) — returns customer name, payment status, Gen2 cluster, and internal flag.
2. **Get Gen3/Grail cluster from logs** — returns the modern platform cluster location.

The Snowflake bizevents only contain the Gen2 cluster. To get the complete picture including the Gen3/Grail cluster, you must also run the log query from [gen3-cluster-lookup.md](gen3-cluster-lookup.md).

## Troubleshooting

### No results for tenant query

- Check tenant ID spelling — bizevents are not case-sensitive, but verify the ID is correct.
- Try a broader search to verify the tenant exists.
- Check if data is delayed — Snowflake updates once daily, so very new tenants may not appear yet.

### Multiple results for same tenant

- Ensure `dedup tenant, {timestamp desc}` is in the query to get only the latest record.
- A tenant may have migrated clusters, so historical entries are preserved in the data.

### Empty customer_name

- Common for **internal tenants** — check the `internal` flag.
- Some tenants may not have customer names assigned in the Snowflake data.
