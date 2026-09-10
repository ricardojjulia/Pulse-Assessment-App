# Automation Engine API Use

<!-- Jira: none -->

**Gen3 replacement**: Part of API migration

**Phase 2 required**: no

## What changes

Workflows that make requests to certain classic APIs/paths need to be identified and updated to use the new API equivalents.

## Customer actions

- Identify workflows calling deprecated API paths
- Update workflow HTTP actions to use the new API endpoints

## Tracking queries

Audit events for workflow requests to specific API paths:

```dql
fetch dt.system.events
| filter event.kind == "AUDIT_EVENT"
| filter event.provider == "API_GATEWAY"
| filter isNotNull(details.dt.automation_engine.workflow.id)
| filter matchesValue(resource, "*ADD YOUR PATH OF INTEREST HERE*")
```

> Note: This query requires SFM (self-monitoring) access.

SFM query to find requests to certain APIs from workflows:

```dql-snippet
fetch spans, from: -30m, samplingRatio: 1, scanLimitGBytes: 500
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter in(dt.entity.service,  classicEntitySelector("type(service), entityname.startsWith(\"ApiGateway Public\")"))
        and isNotNull(`http.request.header.dt-workflow`)
| limit 1000
```
