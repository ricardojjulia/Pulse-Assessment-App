---
name: dt-sfm-data-products
description: Query and explore all BDX data products available on the Dynatrace self-monitoring tenant (dre63214). Covers CDH customer data history (60+ product types including tokens, SLOs, billing, agents, extensions, synthetic monitors, problems, security), IEM internal entity models, AppSec data, SoftComp data, account-tenant mapping, and Grail lookup tables (environment, cluster, semantic dictionary, data product meta-catalog). Use when working with or asking about Dynatrace product data, customer configuration snapshots, usage/billing data, CDH tables, or any BDX ecosystem data on the SFM tenant.
---

# BDX Data Products

## Overview

All BDX data products land in Grail on the self-monitoring tenant **dre63214**. Data falls into two categories:

**Log-based data** — customer product configuration snapshots and history, routed into topic-specific buckets:

| Data family | Grail bucket | `bdx.meta.source` prefix |
|---|---|---|
| CDH (general) | `custom_sen_critical_logs_bdx_cdh_prod` | `cdh.*` |
| IEM (internal entity models) | `custom_sen_critical_logs_bdx_iem_prod` | `cdh.*` |
| AppSec | `custom_sen_critical_logs_bdx_appsec_prod` | `cdh.*` |
| SoftComp | `custom_sen_critical_logs_bdx_softcomp_prod` | `cdh.*` |

All log records share `bdx.meta.source` (product type), `bdx.meta.source.stage` (`PROD`/`SPRINT`/`DEV`), and `pdt.tenant_uuid` (the tenant identifier).

**Lookup tables** — reference/dictionary data, loaded with `load` in DQL:

| Table | Grail path |
|---|---|
| Data products | `/lookups/bdx/meta/data_products` |
| Data contracts | `/lookups/bdx/meta/data_contracts` |
| Data sources | `/lookups/bdx/meta/data_sources` |
| Input ports | `/lookups/bdx/meta/data_input_ports` |
| Output ports | `/lookups/bdx/meta/data_output_ports` |
| Semantic models | `/lookups/bdx/meta/semantic_dictionary/models` |
| Semantic fields | `/lookups/bdx/meta/semantic_dictionary/fields` |
| Cluster dictionary | `/lookups/bdx/common/cluster/v1.0.0/prod` |
| Environment dictionary | `/lookups/bdx/common/environment/v1.0.0/prod` |

> Lookup tables require permissions on dre63214 (not accessible from other tenants).

**Environment lookup fields:** `id` (tenant UUID), `cluster_id`, `paying`, `internal`, `active`, `deleted`, `cdh_data_harvest`. Use this for cheap `paying`/`internal` checks without a bizevent scan. It does **not** contain `arr_band`, `vertical`, `company_name`, or `account_uuid` — those remain bizevent-only.

> **Gap:** A full account-tenant lookup table (with `arr_band`, `vertical`, `company_name`, `account_uuid`) does not yet exist. The bizevent is the only source for account-level dimensions and costs ~0.25 GB per query. Raised with team-dati to promote the daily bizevent to a lookup table.

**Bizevents** — account-to-tenant mapping (updated once daily):
- Bucket: `custom_sen_critical_bizevents_snowflake_data`
- Filter: `event.category == "tenant_account_map"`

## Use Case Routing

| You want to... | See |
|---|---|
| List all available data products | [lookup-tables.md](references/lookup-tables.md) |
| Query a specific CDH product (tokens, SLOs, billing, etc.) | [cdh-sources.md](references/cdh-sources.md) |
| Understand the data product meta-catalog schema | [lookup-tables.md](references/lookup-tables.md) |
| Join products with contracts and output ports | [lookup-tables.md](references/lookup-tables.md) |
| Discover what fields a product exposes | [lookup-tables.md](references/lookup-tables.md) |
| Check if a tenant is paying/internal cheaply | `load "/lookups/bdx/common/environment/v1.0.0/prod"` |
| Map a tenant to ARR band, vertical, company | Bizevent `tenant_account_map` (see pattern below) — no lookup table yet |
| Map a tenant ID to customer or cluster | Load `dt-sfm-tenant-analysis` skill |

## Essential Query Patterns

### Fetch CDH log data (any product type)

```dql
fetch logs, from: -24h
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_cdh_prod"
| filter bdx.meta.source == "cdh.token"        // see cdh-sources.md for all values
| filter bdx.meta.source.stage == "PROD"       // PROD | SPRINT | DEV
| fields pdt.tenant_uuid, bdx.meta.source, bdx.meta.job.timestamp
| limit 100
```

`pdt.tenant_uuid` is the tenant identifier in CDH log records. Product-specific data fields use the `pdt.*` prefix.

For IEM: swap bucket to `custom_sen_critical_logs_bdx_iem_prod`.
For AppSec: use `custom_sen_critical_logs_bdx_appsec_prod`.

See [cdh-sources.md](references/cdh-sources.md) for all 60+ `bdx.meta.source` values and which bucket each uses.

### Discover all data products (live lookup table)

```dql
load "/lookups/bdx/meta/data_products"
| fields id, status, owner, tags
| limit 100
```

Lookup tables are always more current than the static YAML files in the bdx-data-product repository.

See [lookup-tables.md](references/lookup-tables.md) for filtering by tag, joining with contracts, and exploring output ports.

### Account-to-tenant mapping

```dql
fetch bizevents, from: -1d, bucket: {"custom_sen_critical_bizevents_snowflake_data"}
| filter event.category == "tenant_account_map"
| dedup tenant, {timestamp desc}
| fields tenant, cluster, account_uuid, company_name, paying, internal, arr_band, vertical
| limit 100
```

Key fields: `tenant` (env ID), `cluster` (Gen2), `company_name` (customer name), `paying`, `internal`, `arr_band` (revenue band), `vertical` (industry). The bizevent is updated once daily — always `dedup tenant, {timestamp desc}` to get the latest record per tenant.

### Cross-join CDH product with account metadata

Use this pattern to segment CDH adoption by ARR band, vertical, or geography. The join key is `pdt.tenant_uuid` (CDH side) → `tenant` (bizevents side) — the field names differ.

```dql
fetch logs, from: -24h, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_cdh_prod"
| filter bdx.meta.source == "cdh.k8s_data_volume"   // substitute any product
| filter bdx.meta.source.stage == "PROD"
| dedup pdt.tenant_uuid                              // collapse to one row per tenant BEFORE joining
| join [
    fetch bizevents, from: -2d, bucket: {"custom_sen_critical_bizevents_snowflake_data"}
    | filter event.category == "tenant_account_map"
    | filter paying == true and internal == false
    | dedup tenant, {timestamp desc}                 // latest record per tenant
    | fields tenant, arr_band, vertical, account_uuid, company_name
  ], on: {left[`pdt.tenant_uuid`] == right[tenant]}, prefix: "acct.", kind: inner
| filter `acct.arr_band` == ">3M"                   // filter AFTER join; backtick-quote prefixed fields
| summarize
    product_tenants  = countDistinct(`pdt.tenant_uuid`),
    product_accounts = countDistinct(`acct.account_uuid`),
    by: {vertical = `acct.vertical`}
| sort product_accounts desc
```

> **Note:** Always `dedup pdt.tenant_uuid` on the CDH side before the join — CDH products emit multiple rows per tenant per snapshot. Skipping this causes a many-to-many join blowup that inflates counts and wastes scan budget.

## Example Questions

### CDH product queries
- "How many tokens are configured across all production tenants in the last 7 days?"
- "Show me the SLO configuration history for tenant `nzv34798` over the past 24 hours"
- "Which tenants have the most synthetic monitors configured? Give me the top 10"
- "Compare the number of active agents across clusters — group by cluster"

### Account / tenant mapping
- "Which account and company name does tenant `nzv34798` belong to? Is it an internal or paying customer?"
- "List all internal (non-paying) tenants currently mapped in the account-tenant bizevents"
- "Show me all tenants associated with account UUID `abc123`"

### Lookup table / catalog exploration
- "List all available BDX data products and their status and owner"
- "What output ports does the `cdh.token` data product expose?"
- "Show me all data products that belong to the `cdh` domain"
- "What fields does the semantic dictionary define for the token product model?"

## Data Product Explorer — Deep Links

The **Data Product Explorer** app is deployed at:

```
https://ylt31247.apps.dynatrace.com/ui/apps/my.data.product.explorer
```

Whenever you reference a specific data product (by its `bdx.meta.source` / product ID), generate a deep link using the slug formula:

```
slug = "bdx-" + product_id.replace(/[._]/g, "-")
```

| Route | URL pattern |
|---|---|
| Product overview | `.../details/{slug}/overview` |
| DQL reference | `.../details/{slug}/reference-dql` |

**Examples:**

| `bdx.meta.source` | Deep link |
|---|---|
| `cdh.token` | [Data Product Explorer – cdh.token](https://ylt31247.apps.dynatrace.com/ui/apps/my.data.product.explorer/details/bdx-cdh-token/overview) |
| `cdh.agent` | [Data Product Explorer – cdh.agent](https://ylt31247.apps.dynatrace.com/ui/apps/my.data.product.explorer/details/bdx-cdh-agent/overview) |
| `cdh.slo` | [Data Product Explorer – cdh.slo](https://ylt31247.apps.dynatrace.com/ui/apps/my.data.product.explorer/details/bdx-cdh-slo/overview) |
| `cdh.billing` | [Data Product Explorer – cdh.billing](https://ylt31247.apps.dynatrace.com/ui/apps/my.data.product.explorer/details/bdx-cdh-billing/overview) |

**Rule:** Whenever a response mentions a specific `bdx.meta.source` product, append its deep link so the user can jump directly to the app for full field documentation, DQL templates, and output-port specs.

## Best Practices

- **Always add `from:`** on log fetches — CDH data is very high volume
- **Filter `bdx.meta.source.stage == "PROD"`** to exclude sprint/dev noise
- **Use `scanLimitGBytes: -1`** to prevent scan-limit errors on large log queries
- **Prefer lookup tables** over static YAML files — they are live and current
- **`dedup pdt.tenant_uuid` before joining** — CDH products emit multiple rows per tenant per snapshot; deduplicate first to avoid many-to-many blowup and inflated counts
- **Count tenants and accounts separately** — one account can have many tenants; always use `countDistinct(pdt.tenant_uuid)` and `countDistinct(acct.account_uuid)` independently for accurate segmentation
- **Plan for scan budget** — a 24h CDH bucket query typically costs 25–30 GB of Grail budget; use the most specific `bdx.meta.source` filter possible and prefer short time windows for exploratory work

## DQL Syntax Gotchas

These patterns have caused errors in practice — avoid them:

| Wrong | Correct | Reason |
|---|---|---|
| `lower()` alias `toLower()` | `lower()` | `toLower()` does not exist in DQL |
| `sort count() desc` | `summarize my_count = count()` → `sort my_count desc` | Bare aggregation calls not allowed in `sort`; must name the aggregation |
| `dedup` after `summarize` | `dedup` before `summarize` | `dedup` cannot follow an aggregation step |
| `sort acct.vertical desc` | ``sort `acct.vertical` desc`` | Prefixed fields from `join` must be backtick-quoted |
