# Settings 2.0

<!-- Jira: none -->

**Gen3 replacement**: N/A (settings pages removed)

**Phase 2 required**: yes

## What changes

A number of Settings 2.0 pages will be removed in Phase 3. These pages relate to other removed features that might need migration steps.

## Customer actions

- Stop accessing related settings via REST API
- Migrate configurations managed through deprecated settings schemas

## Tracking queries

Audit events for access to deprecated settings schemas (example schema list -- take the full list from `phases.settings.defaults.yaml`):

```dql
fetch dt.system.events, from: -30d
| filter event.kind == "AUDIT_EVENT"
| filter startsWith(resource, "/api/v2/settings/schemas/builtin:anomaly-detection.metric-events")
    or startsWith(resource, "/api/v2/settings/schemas/builtin:management-zones")
    or startsWith(resource, "/api/v2/settings/schemas/builtin:alerting.profile")
| parse resource, "LD '/schemas/' LD:schemaId"
| summarize calls = count(), by: {schemaId, authentication.token, event.provider}
| sort calls desc
```
