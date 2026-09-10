# Settings Schema Resource

## Overview
Settings schemas define the structure and validation rules for settings objects.

## List Settings Schemas
```bash
dtctl get settings-schema -o json --plain
```

## JSON Schema

Each settings schema object contains:

```json
{
  "schemaId": "string (schema identifier)",
  "displayName": "string",
  "version": "string"
}
```

## Key Fields

- **schemaId**: Unique schema identifier (e.g., "builtin:service-detection.full-web-service")
- **displayName**: Human-readable schema name
- **version**: Schema version (often empty for built-in schemas)

## Common Operations

### List all schemas
```bash
dtctl get settings-schema
```

### Search by schema ID or name
```bash
dtctl get settings-schema -o json --plain | jq -r '.[] | select(.schemaId | test("keyword"; "i")) | "\(.schemaId) | \(.displayName)"'
```

### Get schema details
```bash
dtctl describe settings-schema <schemaId>
```

## Common Schema Patterns

**Built-in schemas** start with `builtin:`:
- `builtin:alerting.*` - Alerting configurations
- `builtin:service-detection.*` - Service detection rules
- `builtin:management-zones` - Management zones
- `builtin:tags.*` - Tagging rules
- `builtin:problem.*` - Problem configurations

**Custom schemas** typically use reverse-domain notation

## Important Notes

- Use schema IDs with the `settings` resource (--schema flag)
- Schema IDs are case-sensitive
- Built-in schemas have the `builtin:` prefix
- Use `describe` to see the full schema definition including fields and validation rules
