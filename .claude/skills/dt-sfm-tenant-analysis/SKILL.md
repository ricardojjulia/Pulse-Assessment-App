---
name: dt-sfm-tenant-analysis
description: Map Dynatrace tenant IDs to customer accounts, clusters, and payment status using Snowflake bizevents on dre63214. See references/ for query templates and workflows.
---

# Dynatrace Production Tenant Analysis

## Overview

This skill provides tenant analysis for the Dynatrace production environment (dre63214). It queries Snowflake bizevents and query frontend logs to look up tenant metadata, map tenants to clusters, find customer names, and check account status.

**Use cases:**

- Look up a tenant's customer name, payment status, and cluster
- Find which Gen3/Grail cluster a tenant runs on
- Search tenants by customer name (reverse lookup)
- List all tenants on a specific Gen2 or Gen3 cluster
- Filter paying, internal, or trial accounts

## Use Case Routing

| You want to... | Read |
|---|---|
| Look up a tenant's metadata (customer name, payment, cluster) | [tenant-details.md](references/tenant-details.md) |
| Find which Gen3/Grail cluster a tenant runs on | [gen3-cluster-lookup.md](references/gen3-cluster-lookup.md) |
| Search tenants by customer name | [customer-search.md](references/customer-search.md) |
| List all tenants on a specific cluster | [cluster-tenants.md](references/cluster-tenants.md) |
| Filter paying/internal/trial accounts | [account-filtering.md](references/account-filtering.md) |
| Understand cluster architecture, naming, types | Load a skill covering Dynatrace cluster architecture and naming conventions |

## Tenant Metadata Fields

All Snowflake bizevents queries return these fields:

| Field | Type | Description | Example |
|---|---|---|---|
| `tenant` | String | Unique tenant identifier | "aoz61916" |
| `cluster` | String | **Gen2 cluster** (NOT Gen3) | "prd-ae8e9ca0-63d7-4133-9f45-5cee130fb006" |
| `customer_name` | String | Human-readable account name | "Acme Corp" |
| `paying` | Boolean | Is customer paying (false = trial/internal) | true |
| `internal` | Boolean | Is Dynatrace-owned tenant | false |

## Cluster Fields in Queries

Dynatrace runs two cluster generations (Gen2 and Gen3). This skill's queries return cluster identifiers from two different sources:

- **Snowflake bizevents** → the `cluster` field contains the **Gen2 cluster only**
- **Query frontend logs** → `dt.host_group.id` contains the **Gen3/Grail cluster**

**Critical:** The Snowflake `cluster` field is **Gen2 only**. To find a tenant's Gen3 cluster, you must query logs — see [gen3-cluster-lookup.md](references/gen3-cluster-lookup.md).

For cluster architecture details, naming conventions, and deployment families, load a skill covering Dynatrace cluster architecture.

## Data Sources and Freshness

### Snowflake Bizevents

- **Freshness:** Updated once per day
- **Timeframe:** Always use `from:-1d`
- **Bucket:** `custom_sen_critical_bizevents_snowflake_data`
- **Dedup:** Use `dedup tenant, {timestamp desc}` for latest record
- **Volume:** ~50k+ tenant rows — always apply filters

### Query Frontend Logs

- **Freshness:** Real-time
- **Timeframe:** Use `from:now()@h-2h, to:now()@h-1h` (2-hour window)
- **Bucket:** `custom_sen_low_query_frontend_dql_logs`
- **Coverage:** Tenants query roughly hourly; 2h window catches most
- **Scan limit:** Always set `scanLimitGBytes:-1`

## Best Practices

### Performance

- Always filter by `tenant`, `cluster`, or `customer_name` — unfiltered queries return 50k+ rows
- Use `dedup tenant, {timestamp desc}` to get the latest record per tenant
- Set `scanLimitGBytes:-1` on all log queries

### Timeframes

- Bizevents: `from:-1d` (daily updates — longer timeframes waste resources)
- Logs: `from:now()@h-2h, to:now()@h-1h` (2h window for hourly query cadence)

### Cluster Identification

- Snowflake bizevents → Gen2 cluster (the `cluster` field)
- Query frontend logs → Gen3/Grail cluster (`dt.host_group.id`)
- Never assume the `cluster` field refers to Gen3
- For cluster naming formats and deployment families, load a skill covering Dynatrace cluster architecture

### Data Accuracy

- Snowflake data is up to 1 day old — not real-time
- Cross-reference with log queries for current Gen3 cluster location
- Empty `customer_name` is normal for internal tenants
