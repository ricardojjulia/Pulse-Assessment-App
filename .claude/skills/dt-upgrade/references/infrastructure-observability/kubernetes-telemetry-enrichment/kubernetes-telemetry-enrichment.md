# Kubernetes Telemetry Enrichment

<!-- Jira: PRODUCT-15457 -->

**Gen3 replacement**: Central settings for enrichment and primary Grail tags

**Phase 2 required**: no

## What changes

Customers can use a central place in Dynatrace to manage which metadata to be put on all telemetry data across all data sources. The central configuration enables use-cases around primary tags, domain tags and enrichment of special fields.

Central enrichment has the following prerequisites: Operator 1.10.x, ActiveGate 34+.

## Customer actions

- Recreate K8s telemetry enrichment rules (K8s cluster-by-cluster), assisted with a forward migration
- A dashboard should show how many K8s cluster connections have been migrated to the new central config

## Tracking queries

A boolean flag (`useCentralTaggingConfig`) in the K8s cluster connection settings (`builtin:cloud.kubernetes`) controls if a connection uses the old enrichment config (`builtin:kubernetes.generic.metadata.enrichment`) or the new enrichment config (`builtin:ingest.enrichment.config`).
