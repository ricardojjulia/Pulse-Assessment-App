# SLO Templates Resource

## Overview
SLO templates provide pre-built Service Level Objective definitions that can be applied to services.

## List SLO Templates
```bash
dtctl get slo-templates -o json --plain
```

## JSON Schema

Each SLO template object contains:

```json
{
  "id": "string (encoded ID)",
  "name": "string",
  "description": "string",
  "builtIn": boolean,
  "applicableScope": "string (SERVICE|HOST|etc)",
  "indicator": "string (DQL query)",
  "variables": [
    {
      "name": "string",
      "scope": "string"
    }
  ]
}
```

## Key Fields

- **id**: Unique template identifier (encoded)
- **name**: Template display name (e.g., "Service availability")
- **description**: What the SLO measures
- **builtIn**: Whether template is built-in or custom
- **applicableScope**: Entity type the template applies to (SERVICE, HOST, etc.)
- **indicator**: DQL query that defines the SLI calculation
- **variables**: Required input variables for the template

## Common Operations

### List all SLO templates
```bash
dtctl get slo-templates
```

### Filter by scope
```bash
dtctl get slo-templates -o json --plain | jq -r '.[] | select(.applicableScope=="SERVICE") | "\(.id) | \(.name)"'
```

### Search by name
```bash
dtctl get slo-templates -o json --plain | jq -r '.[] | select(.name | test("availability"; "i")) | "\(.name) | \(.description)"'
```

### View built-in templates
```bash
dtctl get slo-templates -o json --plain | jq -r '.[] | select(.builtIn==true)'
```

## Important Notes

- Templates are pre-configured SLO definitions you can apply
- The `indicator` field contains the DQL query for SLI calculation
- Variables define required inputs when applying the template
- Built-in templates are provided by Dynatrace
- Use templates to quickly create SLOs without writing DQL from scratch
