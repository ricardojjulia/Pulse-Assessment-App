# Settings Resource

## Overview
Settings objects configure various Dynatrace features and behaviors.

## List Settings
```bash
# Must specify a schema
dtctl get settings --schema <schemaId> -o json --plain
```

## JSON Schema

Each settings object contains:

```json
{
  "objectId": "string (encoded ID)",
  "schemaId": "string (schema identifier)",
  "scope": "string (scope identifier)",
  "value": {
    // Schema-specific configuration
  }
}
```

## Key Fields

- **objectId**: Unique settings object identifier (encoded)
- **schemaId**: Schema that defines the settings structure (e.g., "builtin:alerting.maintenance-window")
- **scope**: Scope where settings apply (often empty for tenant-wide)
- **value**: Configuration object (structure depends on schema)

## Common Operations

### List settings for a schema
```bash
dtctl get settings --schema builtin:alerting.maintenance-window -o json --plain
```

### Get settings details
```bash
dtctl describe settings <objectId>
```

### Apply settings from file
```bash
dtctl apply -f settings.yaml
```

### Search by value content
```bash
dtctl get settings --schema <schemaId> -o json --plain | jq -r '.[] | select(.value | tostring | test("keyword"))'
```

## Common Schema IDs

- `builtin:alerting.maintenance-window` - Maintenance windows
- `builtin:problem.notifications` - Notification configurations
- `builtin:management-zones` - Management zones
- `builtin:tags.auto-tagging` - Auto-tagging rules

## Important Notes

- Settings MUST be queried by schema (--schema flag required)
- Object IDs are encoded strings (not simple UUIDs)
- The `value` structure varies by schema
- Use `dtctl get settings-schema` to see available schemas
