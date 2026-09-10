# BDX Lookup Tables Reference

Lookup tables provide live, structured catalog data about all BDX data products. Always prefer querying these over reading the static YAML files in the bdx-data-product repository — the lookup tables are updated by the pipeline and reflect the current state.

> **Permission requirement:** Lookup tables are hosted on `dre63214`. Access requires appropriate Grail file permissions on that tenant.

## Table of Contents

- [Available Tables](#available-tables)
- [Discovering Data Products](#discovering-data-products)
- [Joining Products with Contracts and Ports](#joining-products-with-contracts-and-ports)
- [Semantic Dictionary](#semantic-dictionary)
- [Cluster and Environment Dictionaries](#cluster-and-environment-dictionaries)
- [Mapping Log Records to Data Contracts](#mapping-log-records-to-data-contracts)

## Available Tables

| Purpose | DQL expression |
|---|---|
| All data products | `load "/lookups/bdx/meta/data_products"` |
| All data contracts | `load "/lookups/bdx/meta/data_contracts"` |
| All data sources | `load "/lookups/bdx/meta/data_sources"` |
| All input ports | `load "/lookups/bdx/meta/data_input_ports"` |
| All output ports | `load "/lookups/bdx/meta/data_output_ports"` |
| Semantic models (174 models) | `load "/lookups/bdx/meta/semantic_dictionary/models"` |
| Semantic fields (1463 fields) | `load "/lookups/bdx/meta/semantic_dictionary/fields"` |
| Cluster dictionary | `load "/lookups/bdx/common/cluster/v1.0.0/prod"` |
| Environment dictionary | `load "/lookups/bdx/common/environment/v1.0.0/prod"` |

## Discovering Data Products

### List all data products

```dql
load "/lookups/bdx/meta/data_products"
| fields id, status, owner, tags, input_ports, output_ports
| limit 200
```

### Find products by domain/tag

```dql
load "/lookups/bdx/meta/data_products"
| filter contains(tags, "cdh")
| fields id, status, owner, tags
```

### Find a specific product by ID fragment

```dql
load "/lookups/bdx/meta/data_products"
| filter contains(id, "billing")
| fields id, status, owner, tags
```

### List all data contracts

```dql
load "/lookups/bdx/meta/data_contracts"
| fields id, status, models, meta_sources
| limit 200
```

## Joining Products with Contracts and Ports

This is the canonical join pattern — produces a complete data product catalog view:

```dql
load "/lookups/bdx/meta/data_products"
| fieldsAdd {
  meta_sources = parse(meta_sources, "JSON_VALUE:value")
}
| expand input_ports  = parse(input_ports,  "JSON_VALUE:value")
| expand output_ports = parse(output_ports, "JSON_VALUE:value")
// Enrich input ports
| lookup [
    load "/lookups/bdx/meta/data_input_ports"
], lookupField: id, sourceField: input_ports, prefix: "ip."
| lookup [
    load "/lookups/bdx/meta/data_sources"
], lookupField: id, sourceField: ip.source_id, prefix: "src."
// Enrich output ports
| lookup [
    load "/lookups/bdx/meta/data_output_ports"
], lookupField: id, sourceField: output_ports, prefix: "op."
| lookup [
    load "/lookups/bdx/meta/data_contracts"
], lookupField: id, sourceField: op.contract_id, prefix: "dc."
```

## Semantic Dictionary

### List all models

```dql
load "/lookups/bdx/meta/semantic_dictionary/models"
| fields name, title, description, fields
| limit 200
```

### Find which fields are in a data contract

```dql
load "/lookups/bdx/meta/data_contracts"
| expand model = parse(models, "JSON_VALUE:value")
| lookup [
    load "/lookups/bdx/meta/semantic_dictionary/models"
], lookupField: name, sourceField: model, prefix: "model."
| expand model.attribute = parse(model.fields, "JSON_VALUE:v")
| lookup [
    load "/lookups/bdx/meta/semantic_dictionary/fields"
], lookupField: name, sourceField: model.attribute, prefix: "field."
| fields model, model.title, model.attribute, field.type, field.description
```

### Search for a field by name

```dql
load "/lookups/bdx/meta/semantic_dictionary/fields"
| filter contains(name, "tenant")
| fields name, type, description, stability
```

## Cluster and Environment Dictionaries

### Get all clusters

```dql
load "/lookups/bdx/common/cluster/v1.0.0/prod"
| fields id, region, account_id, archived, auto_update, type, version, internal, ui_domain
| limit 200
```

### Get all environments

```dql
load "/lookups/bdx/common/environment/v1.0.0/prod"
| limit 200
```

### Find cluster for a specific tenant

> **Note:** Environment IDs in this table are full UUIDs (e.g. `05920ef5-ef63-42ef-a90b-7bb37506963b`), not short tenant IDs like `aoz61916`. Obtain the UUID from the account-tenant bizevent mapping first.

```dql
load "/lookups/bdx/common/environment/v1.0.0/prod"
| filter contains(id, "05920ef5")   // replace with a UUID fragment for the target tenant
| lookup [
    load "/lookups/bdx/common/cluster/v1.0.0/prod"
], lookupField: id, sourceField: cluster_id, prefix: "cluster."
| fields id, cluster_id, active, paying, internal, cluster.type, cluster.region, cluster.version, cluster.ui_domain
```

## Mapping Log Records to Data Contracts

To find which data contract covers a specific log record, join via `bdx.meta.source`:

> **Scan cost warning:** The IEM bucket is very high volume. This query scanned ~500 GB over 24 h. To control scan cost, narrow the timeframe and keep the bucket scope as specific as possible. Only add `scanLimitGBytes:-1` if you intentionally want to remove the scan cap to avoid scan-limit errors on large queries.

```dql
fetch logs, bucket: {"custom_sen_critical_logs_bdx_iem_prod"}, from: -24h, scanLimitGBytes:-1
| filterOut isNull(bdx.meta.source)
| lookup [
    load "/lookups/bdx/meta/data_contracts"
    | expand bdx.meta.source = parse(meta_sources, """JSON_VALUE:v""")
], lookupField: bdx.meta.source, prefix: "dc."
| fields bdx.meta.source, dc.id, dc.status
| dedup bdx.meta.source
```
