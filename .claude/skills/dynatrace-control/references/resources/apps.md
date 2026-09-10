# Apps Resource

## Overview
Apps extend Dynatrace functionality with custom integrations and actions.

## List Apps
```bash
dtctl get apps -o json --plain
```

## JSON Schema

Each app object contains:

```json
{
  "id": "string (app identifier)",
  "name": "string",
  "version": "string (semver)",
  "description": "string",
  "resourceStatus": {
    "status": "string (OK|ERROR|etc)"
  },
  "signatureInfo": {},
  "manifest": {
    "actions": [
      {
        "description": "string",
        "name": "string",
        "title": "string"
      }
    ],
    "app-bundle-version": "string",
    "dependencies": []
  }
}
```

## Key Fields

- **id**: Unique app identifier (e.g., "dynatrace.abuseipdb")
- **name**: App display name
- **version**: Semantic version number
- **description**: App description
- **resourceStatus.status**: Current status (OK, ERROR, etc.)
- **manifest.actions**: Available actions the app provides
- **manifest.dependencies**: Required platform APIs

## Common Operations

### List all apps
```bash
dtctl get apps
```

### Get app details
```bash
dtctl describe app <id>
```

### Search by name
```bash
dtctl get apps -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name) | v\(.version)"'
```

### Filter by status
```bash
dtctl get apps -o json --plain | jq -r '.[] | select(.resourceStatus.status=="OK")'
```

## Important Notes

- App IDs are typically namespaced (e.g., "dynatrace.appname")
- Check `resourceStatus.status` for app health
- `manifest.actions` lists available app actions
