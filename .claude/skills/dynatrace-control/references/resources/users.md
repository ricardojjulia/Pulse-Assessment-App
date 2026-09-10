# Users Resource

## Overview
Users represent Dynatrace user accounts.

## List Users
```bash
dtctl get users -o json --plain
```

## Permissions
Listing users requires appropriate IAM permissions. If you receive a 403 error, your API token lacks the necessary user management scopes.

## Common Operations

### List all users
```bash
dtctl get users
```

### Get user details
```bash
dtctl describe user <id>
```

### Get your own user information
```bash
dtctl auth whoami
dtctl auth whoami --id-only  # Just the UUID
```

## Key Fields

User objects typically contain:
- **id**: User UUID
- **email**: User email address
- **name**: Display name
- **groups**: Group memberships

## Important Notes

- User IDs are UUIDs
- Use `dtctl auth whoami` to get your own user information
- User management operations require elevated permissions
- Check token scopes if you receive 403 errors
