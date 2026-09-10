# Customer Name Search

Find Dynatrace tenant IDs by searching for a customer or company name. This is a reverse lookup: customer name → tenant IDs, clusters, and payment status.

## When to Use

- You have a customer or company name and want to find their tenant IDs
- Reverse lookup: customer name → tenant IDs, Gen2 clusters, payment status
- Customer support scenarios where you need to identify all tenants belonging to an account

## Query

Search for tenants by customer name using a case-insensitive substring match:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter customer_name ~ "Acme"
```

**Key operator — `~` (tilde):** Performs a **case-insensitive substring match**. For example, `customer_name ~ "acme"` matches "Acme Corp", "ACME Industries", and "acme ltd". Do **not** use `==` for name searches — it requires an exact, case-sensitive match and will miss partial names.

**Returns:**

| Field | Type | Description | Example |
| ----- | ---- | ----------- | ------- |
| `tenant` | String | Unique tenant identifier | "aoz61916" |
| `cluster` | String | **Gen2 cluster** name (NOT Gen3). Load a skill covering Dynatrace cluster architecture for naming formats. | "prd-ae8e9ca0-63d7-4133-9f45-5cee130fb006" |
| `customer_name` | String | Human-readable account name | "Acme Corp" |
| `paying` | Boolean | Is customer paying (false = trial/internal) | true |
| `internal` | Boolean | Is Dynatrace-owned tenant | false |

## Template

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter customer_name ~ "<SEARCH_TERM>"
| filter internal == false  // Optional: exclude internal tenants
```

Replace `<SEARCH_TERM>` with the customer or company name (or partial name) you are searching for.

## Example

**Find all tenants for "Acme" customer:**

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, customer_name, paying, internal
| filter customer_name ~ "Acme"
| filter internal == false
```

**Expected output:**

| tenant | cluster | customer_name | paying | internal |
| ------ | ------- | ------------- | ------ | -------- |
| aoz61916 | prd-ae8e9ca0-63d7-4133-9f45-5cee130fb006 | Acme Corp | true | false |
| bxk42301 | prod22-virginia | Acme Corp | true | false |
| cmn98712 | 194921b8-3027-4a54-8853-42649171599e | Acme Industries | true | false |

All tenants whose `customer_name` contains "Acme" (case-insensitive) are returned, excluding internal Dynatrace tenants.

## Tips

- Use `~` for case-insensitive substring match — **not** `==`
- Some internal tenants have an empty `customer_name` field
- Add `| filter internal == false` to exclude internal/Dynatrace-owned tenants
- Data is updated **once per day** from Snowflake — always use `from:-1d` timeframe
- Use `dedup tenant, {timestamp desc}` to ensure you get the latest record per tenant
- The `cluster` field returns the **Gen2 cluster** only; see [gen3-cluster-lookup.md](gen3-cluster-lookup.md) for finding the Gen3/Grail cluster

## Troubleshooting

| Problem | Cause | Solution |
| ------- | ----- | -------- |
| Empty `customer_name` | Common for internal tenants | Check `internal == true` flag — internal tenants often lack a customer name |
| No results returned | Search term too specific or misspelled | Try a broader or shorter search term; check spelling; remember `~` is substring-based |
| Too many results | Search term too generic | Add `| filter internal == false` and/or `| filter paying == true` to narrow results |
| Stale data | Snowflake syncs once daily | Data may be up to 24 hours old; this is expected behavior |
