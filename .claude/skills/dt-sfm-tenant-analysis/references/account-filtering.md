# Account Filtering

## When to Use

- Filter tenants by payment status, internal flag, or account type
- Get a list of paying external customers
- Identify trials, internal tenants, or specific account segments

## Base Query: Paying External Customers

This query returns all external paying tenants, excluding free trials and Dynatrace-internal tenants:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| filter internal == false
| filter paying == true
| fields tenant, cluster, customer_name
```

**Returns:** All external paying tenants with their Gen2 cluster and customer name.

## Filter Patterns

Append these filters to the base Snowflake bizevents query to segment tenants by account type.

**External Paying Customers:**

```dql-snippet
| filter internal == false
| filter paying == true
```

**Internal Tenants (Dynatrace-owned):**

```dql-snippet
| filter internal == true
```

**External Non-Paying (Trials):**

```dql-snippet
| filter internal == false
| filter paying == false
```

## Scoping to a Cluster

Add a cluster filter to restrict results to a specific Gen2 deployment:

```dql-snippet
| filter cluster == "prod61-virginia"
```

This narrows results to only tenants on that cluster. Replace the cluster name with any valid Gen2 cluster identifier. Load a skill covering Dynatrace cluster architecture for cluster naming conventions.

## Example

Count paying external customers on a specific cluster:

```dql
fetch bizevents, from:-1d
| filter dt.system.bucket == "custom_sen_critical_bizevents_snowflake_data"
| filter event.type == "snowflake_connector"
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| filter internal == false
| filter paying == true
| filter cluster == "prod61-virginia"
| fields tenant, cluster, customer_name
| summarize count()
```

This returns the total number of paying external tenants on the `prod61-virginia` cluster.

## Tips

- Combine account filters with a cluster filter for deployment-specific analysis
- `paying == false` includes both trial accounts and internal tenants — add `internal == false` to isolate trials only
- Use `internal == true` specifically for Dynatrace-owned tenants
- Data is updated daily from Snowflake — always use `from:-1d` timeframe
- Without filters, the query returns ~50k rows — always apply at least one filter
