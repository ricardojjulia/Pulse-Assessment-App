# Buckets Resource

## Overview
Buckets store data in Dynatrace Grail (logs, metrics, events, etc.).

## List Buckets
```bash
dtctl get buckets -o json --plain
```

## JSON Schema

Each bucket object contains:

```json
{
  "bucketName": "string",
  "table": "string (logs|metrics|events|spans|etc)",
  "displayName": "string",
  "status": "string (active|archived)",
  "retentionDays": number,
  "version": number,
  "updatable": boolean,
  "records": number
}
```

## Key Fields

- **bucketName**: Unique bucket identifier
- **table**: Data type (logs, metrics, events, spans, etc.)
- **displayName**: Human-readable name
- **status**: Bucket status (active, archived)
- **retentionDays**: Data retention period
- **records**: Number of records in bucket
- **updatable**: Whether bucket can be modified

## Common Operations

### List all buckets
```bash
dtctl get buckets
```

### Get bucket details
```bash
dtctl describe bucket <bucketName>
```

### Filter by table type
```bash
dtctl get buckets -o json --plain | jq -r '.[] | select(.table=="logs") | "\(.bucketName) | \(.displayName)"'
```

### Search by name
```bash
dtctl get buckets -o json --plain | jq -r '.[] | select(.bucketName | test("keyword"; "i"))'
```

## Important Notes

- Use `bucketName` (not `id`) as the identifier
- Table types include: logs, metrics, events, spans, bizevents
- Retention is in days
- Record count shows current data volume
