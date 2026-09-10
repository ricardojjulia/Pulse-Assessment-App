# Trash Resource

## Table of Contents
- [Overview](#overview)
- [List Trash](#list-trash)
- [JSON Schema](#json-schema)
- [Key Fields](#key-fields)
- [Common Operations](#common-operations)
  - [List all trashed documents](#list-all-trashed-documents)
  - [List only dashboards](#list-only-dashboards)
  - [List only notebooks](#list-only-notebooks)
  - [Filter by deletion date](#filter-by-deletion-date)
  - [Filter by user](#filter-by-user)
  - [Watch for deletions](#watch-for-deletions)
  - [Find documents nearing permanent deletion](#find-documents-nearing-permanent-deletion)
  - [Group by type](#group-by-type)
  - [Group by deleting user](#group-by-deleting-user)
- [Important Notes](#important-notes)
- [Related Operations](#related-operations)
  - [Viewing original document details](#viewing-original-document-details)
- [Watch Mode Examples](#watch-mode-examples)
  - [Monitor all deletions](#monitor-all-deletions)
  - [Monitor only dashboard deletions](#monitor-only-dashboard-deletions)
  - [Monitor deletions by specific user](#monitor-deletions-by-specific-user)

## Overview
Trash contains soft-deleted documents (dashboards and notebooks) that are kept for 30 days before permanent deletion. This enables recovery of accidentally deleted documents within the retention period.

The trash resource provides:
- View of soft-deleted dashboards and notebooks
- Filtering by document type, deletion date, and deleting user
- 30-day retention period before permanent deletion
- Watch mode for monitoring deletions

## List Trash
```bash
dtctl get trash -o json --plain
```

## JSON Schema

Each trash object contains:

```json
{
  "id": "string (document identifier)",
  "type": "string (dashboard|notebook)",
  "name": "string (document name)",
  "deletedBy": "string (user email or ID who deleted it)",
  "deletedAt": "string (ISO 8601 timestamp)",
  "owner": "string (original document owner)",
  "permanentDeletionDate": "string (ISO 8601 timestamp)"
}
```

## Key Fields

- **id**: Original document identifier
- **type**: Document type (`dashboard` or `notebook`)
- **name**: Document name at time of deletion
- **deletedBy**: User who deleted the document (email or ID)
- **deletedAt**: Timestamp when document was deleted
- **owner**: Original document owner
- **permanentDeletionDate**: When document will be permanently deleted (deletedAt + 30 days)

## Common Operations

### List all trashed documents
```bash
dtctl get trash
```

### List only dashboards
```bash
dtctl get trash --type dashboard
```

### List only notebooks
```bash
dtctl get trash --type notebook
```

### Filter by deletion date
```bash
# Documents deleted after specific date
dtctl get trash --deleted-after 2024-01-01

# Documents deleted before specific date
dtctl get trash --deleted-before 2024-12-31

# Documents deleted in date range
dtctl get trash --deleted-after 2024-01-01 --deleted-before 2024-01-31
```

### Filter by user
```bash
dtctl get trash --deleted-by user@example.com
```

### Watch for deletions
```bash
# Watch for changes (shows initial state + updates)
dtctl get trash --watch

# Watch for changes only (no initial state)
dtctl get trash --watch-only

# Custom polling interval
dtctl get trash --watch --interval 5s
```

### Find documents nearing permanent deletion
```bash
# Find documents deleted more than 25 days ago (less than 5 days until permanent deletion)
dtctl get trash -o json --plain | jq -r --arg cutoff "$(date -d '25 days ago' +%Y-%m-%d)" '.[] | select(.deletedAt < $cutoff) | "\(.id) | \(.name) | deleted \(.deletedAt)"'
```

### Group by type
```bash
dtctl get trash -o json --plain | jq -r 'group_by(.type) | .[] | "\(.[0].type): \(length) documents"'
```

### Group by deleting user
```bash
dtctl get trash -o json --plain | jq -r 'group_by(.deletedBy) | .[] | "\(.[0].deletedBy): \(length) documents"'
```

## Important Notes

- **30-day retention**: Documents are permanently deleted after 30 days
- **Soft delete only**: Only dashboards and notebooks support soft deletion via trash
- **Recovery**: Documents can be restored within 30 days (restoration method depends on API capabilities)
- **Watch mode**: Use `--watch` to monitor deletions in real-time
- **Date format**: Use `YYYY-MM-DD` format for `--deleted-after` and `--deleted-before` flags
- **Minimum interval**: Watch mode polling interval minimum is 1 second
- **Filter combinations**: Multiple filters can be combined (e.g., `--type dashboard --deleted-by user@example.com`)

## Related Operations

### Viewing original document details
```bash
# Note: Trashed documents may not be accessible via describe
# The trash listing provides the key metadata needed
dtctl get trash -o json --plain | jq '.[] | select(.id=="document-id")'
```

## Watch Mode Examples

### Monitor all deletions
```bash
dtctl get trash --watch --plain
```

### Monitor only dashboard deletions
```bash
dtctl get trash --type dashboard --watch-only
```

### Monitor deletions by specific user
```bash
dtctl get trash --deleted-by user@example.com --watch
```
