# Intents Resource

## Table of Contents
- [Overview](#overview)
- [List Intents](#list-intents)
- [JSON Schema](#json-schema)
- [Key Fields](#key-fields)
- [Common Operations](#common-operations)
  - [List all intents](#list-all-intents)
  - [List intents for specific app](#list-intents-for-specific-app)
  - [Get intent details](#get-intent-details)
  - [Find intents matching criteria](#find-intents-matching-criteria)
  - [Open intent in browser](#open-intent-in-browser)
  - [Filter by required properties](#filter-by-required-properties)
  - [List intents by property type](#list-intents-by-property-type)
  - [Group intents by app](#group-intents-by-app)
- [Important Notes](#important-notes)
- [Related Commands](#related-commands)

## Overview
Intents enable inter-app communication by defining entry points that apps expose for opening resources with contextual data. Each intent represents a specific action or view that an app provides, along with the required and optional properties needed to invoke it.

Intents enable:
- Deep linking into app-specific views (e.g., view a trace, edit a workflow)
- Inter-app navigation with contextual data
- Discovery of available app entry points
- Dynamic UI integration

## List Intents
```bash
dtctl get intents -o json --plain
```

## JSON Schema

Each intent object contains:

```json
{
  "appId": "string (parent app identifier)",
  "appName": "string (human-readable app name)",
  "intentId": "string (intent identifier within app)",
  "description": "string (intent description)",
  "properties": {
    "property.name": {
      "type": "string|array|object",
      "format": "string (optional, e.g., date-time)",
      "required": true|false
    }
  },
  "fullName": "string (appId/intentId)",
  "requiredProps": ["array of required property names"]
}
```

## Key Fields

- **appId**: Parent app identifier (e.g., "dynatrace.distributedtracing")
- **appName**: Human-readable app name (e.g., "Distributed Tracing")
- **intentId**: Intent identifier within the app (e.g., "view-trace")
- **fullName**: Complete intent reference in format `appId/intentId`
- **description**: Intent description explaining its purpose
- **properties**: Object defining expected properties with their types and requirements
- **requiredProps**: Array of property names that must be provided

## Common Operations

### List all intents
```bash
dtctl get intents
```

### List intents for specific app
```bash
dtctl get intents --app dynatrace.automations
```

### Get intent details
```bash
dtctl describe intent dynatrace.distributedtracing/view-trace
```

### Find intents matching criteria
```bash
# Find intents that can handle specific data
dtctl find intents --data trace.id=abc123

# Find intents for a specific entity type
dtctl find intents --data entity.id=HOST-1234
```

### Open intent in browser
```bash
# Open intent with required properties
dtctl open intent dynatrace.distributedtracing/view-trace --data trace.id=abc123

# Open intent with multiple properties
dtctl open intent dynatrace.automations/view-execution --data execution.id=12345
```

### Filter by required properties
```bash
dtctl get intents -o json --plain | jq -r '.[] | select(.requiredProps | length == 1) | "\(.fullName) | \(.description)"'
```

### List intents by property type
```bash
# Find intents that accept a trace.id
dtctl get intents -o json --plain | jq -r '.[] | select(.properties["trace.id"]) | "\(.fullName) | \(.description)"'
```

### Group intents by app
```bash
dtctl get intents -o json --plain | jq -r 'group_by(.appId) | .[] | "\(.[0].appName) (\(length) intents)"'
```

## Important Notes

- Intent references use format `appId/intentId` (e.g., `dynatrace.distributedtracing/view-trace`)
- Use `dtctl open intent` to open an intent in your browser
- Use `dtctl find intents` to discover which intents can handle specific data
- Check `requiredProps` array to see which properties must be provided
- Property types include: string, array, object, with optional format constraints (e.g., date-time)
- Intents enable deep linking and contextual navigation between apps
- Cross-reference with [apps resource](apps.md) to see which apps provide intents

## Related Commands

- **find intents**: Discover intents that can handle specific data
  ```bash
  dtctl find intents --data key=value
  ```

- **open intent**: Open an intent in the browser with contextual data
  ```bash
  dtctl open intent appId/intentId --data key=value
  ```

See [SKILL.md](../../SKILL.md) for complete documentation of `find` and `open` commands.
