# Messaging/Queues and Screens

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: no

## What changes

Messaging/queue screens will be removed in Phase 3.

## Tracking queries

List of queue managed entities -- will be gone in Phase 3:

```dql
fetch dt.entity.queue
| fieldsadd entity.name, queueVendorName, id
```
