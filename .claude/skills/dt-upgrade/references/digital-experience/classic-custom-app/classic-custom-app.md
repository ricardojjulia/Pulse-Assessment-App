# Classic Custom App (RUM)

<!-- Jira: none -->

**Gen3 replacement**: RUM on the latest Dynatrace

**Phase 2 required**: yes (no custom app support)

## What changes

Custom apps are not supported on Grail. Monitoring custom apps means the tenant cannot be upgraded to gen3 only. Dynatrace is working on open RUM ingest to offer a migration path.

## Customer actions

- Stay in classic, move to new SDK/migration path once available
- Affects approximately 170 tenants

## Tracking queries

Check Experience Vitals app and filter for "custom apps" -- the list shows custom apps which are monitored (on classic) and a link to the classic frontend. If none show up, the customer can migrate.
