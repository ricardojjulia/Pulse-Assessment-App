# Database Services/Screen

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: no

## What changes

Database services screen will be removed in Phase 3.

## Tracking queries

List of database services -- will be gone in Phase 3:

```dql
fetch dt.entity.service
| filter serviceType == "DATABASE_SERVICE"
| fieldsadd entity.name, serviceType, id
```
