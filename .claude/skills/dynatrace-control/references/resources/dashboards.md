# Dashboards Resource

## Overview
Dashboards visualize monitoring data in Dynatrace.

## List Dashboards
```bash
dtctl get dashboards -o json --plain
```

## JSON Schema

Each dashboard object contains:

```json
{
  "id": "string",
  "name": "string",
  "type": "dashboard",
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

- **id**: Unique dashboard identifier
- **name**: Display name (field is "name" NOT "title")
- **type**: Always "dashboard"
- **owner**: User UUID who owns the dashboard
- **isPrivate**: Whether dashboard is private to owner
- **version**: Version number
- **modificationInfo**: Creation and modification metadata

## Common Operations

### Search by name (case-insensitive)
```bash
dtctl get dashboards -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name)"'
```

### Get dashboard details
```bash
dtctl describe dashboard <id>
```

### Get full dashboard content (tiles, DQL queries)
```bash
dtctl get dashboard <id> -o json --plain
```

### Share dashboard
```bash
dtctl share dashboard <id> --user <sso-id> --access read-write
```

### Unshare dashboard
```bash
dtctl unshare dashboard <id> --all
```

## Important Notes

- Use `.name` field for dashboard titles (NOT `.title`)
- Always inspect sample output before building complex filters
- `describe` returns metadata only — use `dtctl get dashboard <id> -o json` for full content (tiles, DQL queries)
