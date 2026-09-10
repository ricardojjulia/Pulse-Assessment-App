# SDv1 Global Failure Detection Rules

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: yes

## What changes

Global failure detection rules that use Management Zones, PG Tags, or Service Tags need to be reworked.

## Customer actions

- Rework rules that use Management Zones
- Rework rules that use PG Tags (non-primary_tags)
- Rework rules that use Service Tags

## Tracking queries

Code section for Dashboard -- returns affected settings:

```typescript
import { settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

const SCHEMA_IDS = [
  "builtin:failure-detection.environment.parameters",
  "builtin:failure-detection.environment.rules"
].join(",");

const FIELDS = [
  "modified",
  "modifiedBy",
  "schemaId",
  "value"
].join(",");

export default async function () {
  const items = await fetchSettings();
  return items
    // can ignore disabled rules (only rules schema has enabled field; parameters are always relevant)
    .filter(item => item.value.enabled !== false)
    // find any items that use a management zone, a PG tag not starting with primary_tag, or any service tag
    .filter(item => {
      const conditions = item.value.conditions ?? [];
      return (
        hasManagementZoneCondition(conditions) ||
        hasInvalidPGTagCondition(conditions) ||
        hasServiceTagCondition(conditions)
      );
    });
}

function hasManagementZoneCondition(conditions): boolean {
  return conditions.some(
    condition => condition.attribute === "SERVICE_MANAGEMENT_ZONE"
  );
}

function hasInvalidPGTagCondition(conditions): boolean {
  return conditions
    .filter(condition => condition.attribute === "PG_TAG")
    .some(condition => {
      const predicate = condition.predicate ?? {};
      const tagMatches = (predicate.tags ?? []).some(
        (tag: string) => !tag.startsWith("primary_tags.")
      );
      const tagKeyMatches = (predicate.tagKeys ?? []).some(
        (key: string) => !key.startsWith("primary_tags.")
      );
      const textMatches = (predicate.textValues ?? []).some(
        (value: string) => !value.startsWith("primary_tags.")
      );
      return tagMatches || tagKeyMatches || textMatches;
    });
}

function hasServiceTagCondition(conditions): boolean {
  return conditions.some(
    condition => condition.attribute === "SERVICE_TAG"
  );
}

// supports pagination to collect all existing settings
async function fetchSettings() {
  var settings = await settingsObjectsClient.getSettingsObjects({
    schemaIds: SCHEMA_IDS,
    fields: FIELDS
  });
  var items = settings.items;
  while (settings.nextPageKey != undefined) {
    settings = await settingsObjectsClient.getSettingsObjects({
      nextPageKey: settings.nextPageKey
    });
    items = [].concat(items, settings.items);
  }
  return items;
}
```
