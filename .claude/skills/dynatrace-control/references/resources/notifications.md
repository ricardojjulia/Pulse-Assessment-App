# Notifications Resource

## Table of Contents
- [Overview](#overview)
- [List Notifications](#list-notifications)
- [JSON Schema](#json-schema)
- [Key Fields](#key-fields)
- [Common Operations](#common-operations)
  - [List all notifications](#list-all-notifications)
  - [Get notification details](#get-notification-details)
  - [Filter by type](#filter-by-type)
  - [Watch for changes](#watch-for-changes)
  - [Find enabled notifications](#find-enabled-notifications)
  - [Find disabled notifications](#find-disabled-notifications)
  - [Group by type](#group-by-type)
  - [Search by name](#search-by-name)
- [Important Notes](#important-notes)
- [Watch Mode Examples](#watch-mode-examples)
  - [Monitor all notification changes](#monitor-all-notification-changes)
  - [Monitor specific notification type](#monitor-specific-notification-type)
  - [Monitor only changes (no initial state)](#monitor-only-changes-no-initial-state)
- [Related Operations](#related-operations)
  - [Apply notification configuration](#apply-notification-configuration)
  - [Delete notification](#delete-notification)
  - [Edit notification](#edit-notification)

## Overview
Notifications represent event notifications in Dynatrace. They enable monitoring and management of notification configurations for various event types.

The notifications resource provides:
- View of configured event notifications
- Filtering by notification type
- Watch mode for monitoring notification changes
- Management of notification configurations

## List Notifications

```bash
dtctl get notifications -o json --plain
```

## JSON Schema

Each notification object contains:

```json
{
  "id": "string (notification identifier)",
  "name": "string (notification name)",
  "type": "string (notification type)",
  "enabled": true,
  "description": "string (optional)",
  "configuration": {
    "type-specific fields": "varies by notification type"
  }
}
```

## Key Fields

- **id**: Unique notification identifier
- **name**: Notification configuration name
- **type**: Notification type (e.g., email, webhook, Slack, PagerDuty)
- **enabled**: Whether notification is active
- **description**: Optional notification description
- **configuration**: Type-specific notification settings

## Common Operations

### List all notifications

```bash
dtctl get notifications
```

### Get notification details

```bash
dtctl describe notification <notification-id>
```

### Filter by type

```bash
dtctl get notifications --type slack
```

### Watch for changes

```bash
# Watch for changes (shows initial state + updates)
dtctl get notifications --watch

# Watch for changes only (no initial state)
dtctl get notifications --watch-only

# Custom polling interval
dtctl get notifications --watch --interval 5s
```

### Find enabled notifications

```bash
dtctl get notifications -o json --plain | jq -r '.[] | select(.enabled==true) | "\(.id) | \(.name) | \(.type)"'
```

### Find disabled notifications

```bash
dtctl get notifications -o json --plain | jq -r '.[] | select(.enabled==false) | "\(.id) | \(.name) | \(.type)"'
```

### Group by type

```bash
dtctl get notifications -o json --plain | jq -r 'group_by(.type) | .[] | "\(.[0].type): \(length) notifications"'
```

### Search by name

```bash
dtctl get notifications -o json --plain | jq -r '.[] | select(.name | test("keyword"; "i")) | "\(.id) | \(.name)"'
```

## Important Notes

- **Notification types**: Common types include email, webhook, Slack, PagerDuty, Jira, etc.
- **Watch mode**: Use `--watch` to monitor notification configuration changes
- **Minimum interval**: Watch mode polling interval minimum is 1 second
- **Type filtering**: Use `--type` flag to filter by specific notification type
- **Configuration varies**: Notification configuration structure depends on the type

## Watch Mode Examples

### Monitor all notification changes

```bash
dtctl get notifications --watch --plain
```

### Monitor specific notification type

```bash
dtctl get notifications --type email --watch
```

### Monitor only changes (no initial state)

```bash
dtctl get notifications --watch-only
```

## Related Operations

### Apply notification configuration

```bash
# Create or update notification from YAML/JSON file
dtctl apply -f notification-config.yaml
```

### Delete notification

```bash
dtctl delete notification <notification-id>
```

### Edit notification

```bash
# Open notification in editor for modification
dtctl edit notification <notification-id>
```
