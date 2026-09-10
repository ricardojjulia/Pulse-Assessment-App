# SLO Resource

## Overview
Service Level Objectives (SLOs) define target performance metrics.

## List SLOs
```bash
dtctl get slos -o json --plain
```

## JSON Schema

Each SLO object contains:

```json
{
  "id": "string (encoded ID)",
  "name": "string",
  "version": "string (version ID)",
  "criteria": [
    {
      "timeframeFrom": "string (relative time)",
      "timeframeTo": "string (relative time)",
      "target": number (percentage)
    }
  ],
  "customSli": {
    "filterSegments": [],
    "indicator": "string (DQL query)"
  },
  "externalId": "string"
}
```

## Key Fields

- **id**: Unique SLO identifier (encoded)
- **name**: Display name
- **criteria**: Array of target criteria with timeframes and target percentages
- **customSli.indicator**: DQL query defining the SLI measurement
- **version**: Version identifier

## Common Operations

### List all SLOs
```bash
dtctl get slos
```

### Get SLO details
```bash
dtctl describe slo <id>
```

### Apply SLO from file
```bash
dtctl apply -f slo.yaml
```

### Search by name
```bash
dtctl get slos -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name)"'
```

## Important Notes

- SLO IDs are encoded strings (not simple UUIDs)
- `customSli.indicator` contains DQL queries for custom SLI definitions
- Criteria can have multiple timeframes with different targets
