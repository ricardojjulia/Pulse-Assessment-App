# Groups Resource

## Overview
Groups organize users and control access permissions in Dynatrace.

## List Groups
```bash
dtctl get groups -o json --plain
```

## Permissions
Listing groups requires appropriate IAM permissions. If you receive a 403 error, your API token lacks the necessary group management scopes.

## Common Operations

### List all groups
```bash
dtctl get groups
```

### Get group details
```bash
dtctl describe group <id>
```

## Key Fields

Group objects typically contain:
- **id**: Group UUID
- **name**: Group name
- **description**: Group description
- **permissions**: Associated permissions
- **members**: User members

## Important Notes

- Group IDs are UUIDs
- Group management operations require elevated permissions
- Check token scopes if you receive 403 errors
- Groups control access to resources and features
