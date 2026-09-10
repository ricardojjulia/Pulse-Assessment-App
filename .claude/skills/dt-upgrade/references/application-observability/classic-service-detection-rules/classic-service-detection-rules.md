# Classic Full Service Detection (SDv1) Rules

<!-- Jira: none -->

**Gen3 replacement**: --

**Phase 2 required**: yes

## What changes

Classic service detection rules that use Management Zones or PG Tags (not starting with `primary_tags.`) need to be reworked.

## Customer actions

- Rework rules that use Management Zones
- Rework rules that use PG Tags (non-primary_tags)

## Tracking queries

Code section for Dashboard -- returns affected settings:

```typescript
import { settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

const SCHEMA_IDS = ["builtin:service-detection.full-web-request", 
                   "builtin:service-detection.full-web-service"
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
    // can ignore disabled rules
    .filter(item => item.value.enabled)
    // find any rules that either use ManagementZones or PG tags that are not primary_tag
    .filter(item => {
        return item.value.managementZones.length > 0 || hasInvalidPGTagCondition(item.value.conditions);
    });
}

function hasInvalidPGTagCondition(conditions) {
  const c = conditions
    .filter(condition => condition.attribute == "PG_Tag") 
    .filter(condition => {
      if (condition.compareOperationType == "TagEquals") {
         return condition.tagValues
          .filter(value => !value.startsWith("primary_tags."))
          .length > 0;
      } else {
        // TagKeyEquals
        return condition.textValues
          .filter(value => !value.startsWith("primary_tags."))
          .length > 0;
      }
    });
  return c.length > 0;
}
  
// supports pagination to collect all existing settings
async function fetchSettings() {
  var settings = await settingsObjectsClient.getSettingsObjects({
    schemaIds: SCHEMA_IDS,
    fields: FIELDS
  });
  
  var items = settings.items;

  while(settings.nextPageKey != undefined) {
      settings = await settingsObjectsClient.getSettingsObjects({
        nextPageKey: settings.nextPageKey
      });
      
      items = [].concat(items, settings.items);
  }
  
  return items;
}
```
