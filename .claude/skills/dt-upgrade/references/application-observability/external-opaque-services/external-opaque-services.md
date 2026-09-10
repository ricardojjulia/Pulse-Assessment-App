# External/Opaque Services

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: no

## What changes

External and opaque services (excluding database services) will be removed in Phase 3.

## Tracking queries

List of external/opaque services (excluding database services) -- will be gone in Phase 3:

```dql
fetch dt.entity.service
| filter isExternalService == true 
| filter serviceType != "DATABASE_SERVICE"
| fieldsadd entity.name, serviceType, id
```
