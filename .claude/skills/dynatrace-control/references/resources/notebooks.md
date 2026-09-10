# Notebooks Resource

## Overview
Notebooks provide interactive documentation and analysis in Dynatrace.

## List Notebooks
```bash
dtctl get notebooks -o json --plain
```

## JSON Schema

Each notebook object contains:

```json
{
  "id": "string (UUID)",
  "name": "string",
  "type": "notebook",
  "owner": "string (user UUID)",
  "isPrivate": boolean,
  "version": number,
  "modificationInfo": {
    "createdBy": "string",
    "createdTime": "ISO 8601 timestamp",
    "lastModifiedBy": "string",
    "lastModifiedTime": "ISO 8601 timestamp"
  }
}
```

## Key Fields

- **id**: Unique notebook identifier (UUID)
- **name**: Display name
- **type**: Always "notebook"
- **owner**: User UUID who owns the notebook
- **isPrivate**: Whether notebook is private to owner
- **version**: Version number
- **modificationInfo**: Creation and modification metadata

## Common Operations

### Search by name
```bash
dtctl get notebooks -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name)"'
```

### Get notebook details (metadata only)
```bash
dtctl describe notebook <id>
```

### Get full notebook content (sections)
```bash
dtctl get notebook <id> -o json --plain
```

### Filter by owner
```bash
ME=$(dtctl auth whoami --id-only)
dtctl get notebooks -o json --plain | jq -r --arg me "$ME" '.[] | select(.owner==$me)'
```
