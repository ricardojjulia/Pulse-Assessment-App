# EdgeConnect Resource

## Overview
EdgeConnect manages edge computing connections in Dynatrace.

## List EdgeConnect
```bash
dtctl get edgeconnect -o json --plain
```

## JSON Schema

Each EdgeConnect object contains:

```json
{
  "id": "string (UUID)",
  "name": "string",
  "modificationInfo": {
    "lastModifiedBy": "string (user UUID)",
    "lastModifiedTime": "ISO 8601 timestamp"
  },
  "metadata": {}
}
```

## Key Fields

- **id**: Unique EdgeConnect identifier (UUID)
- **name**: Display name
- **modificationInfo**: Last modification metadata
  - **lastModifiedBy**: User UUID who last modified
  - **lastModifiedTime**: ISO 8601 timestamp of last modification
- **metadata**: Additional metadata (structure varies)

## Common Operations

### List all EdgeConnect instances
```bash
dtctl get edgeconnect
```

### Get EdgeConnect details
```bash
dtctl describe edgeconnect <id>
```

### Search by name
```bash
dtctl get edgeconnect -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name)"'
```

## Important Notes

- EdgeConnect IDs are UUIDs
- Name field may be empty for some instances
- Check `modificationInfo` for last update information
