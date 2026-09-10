# Lookups Resource

## Table of Contents
- [Overview](#overview)
- [Creating Lookups](#creating-lookups)
- [List Lookups](#list-lookups)
- [JSON Schema](#json-schema)
- [Key Fields](#key-fields)
- [Common Operations](#common-operations)
  - [List all lookups](#list-all-lookups)
  - [Get lookup details](#get-lookup-details)
  - [Get lookup data as CSV](#get-lookup-data-as-csv)
  - [Search by path](#search-by-path)
  - [Filter by size](#filter-by-size)
- [Using Lookups in DQL Queries](#using-lookups-in-dql-queries)
- [Important Notes](#important-notes)

## Overview
Lookups provide reference data tables for enriching queries and analysis.

## Creating Lookups

```bash
# Create lookup from CSV file
dtctl create lookup -f data.csv --path /lookups/grail/pm/errors --lookup-field code

# Create lookup from JSON
dtctl create lookup -f data.json --path /lookups/grail/users --lookup-field user_id
```

**Requirements:**
- Data file: CSV or JSON format
- `--path`: Full path for the lookup (e.g., `/lookups/category/name`)
- `--lookup-field`: Field to use as lookup key

## List Lookups
```bash
dtctl get lookups -o json --plain
```

## JSON Schema

Each lookup object contains:

```json
{
  "path": "string (lookup path)",
  "fileSize": number (bytes),
  "records": number,
  "modified": "string (date YYYY-MM-DD)"
}
```

## Key Fields

- **path**: Unique lookup identifier (path format, e.g., "/lookups/appsec/secla/tenants")
- **fileSize**: Size of lookup data in bytes
- **records**: Number of records in the lookup table
- **modified**: Last modification date

## Common Operations

### List all lookups
```bash
dtctl get lookups
```

### Get lookup details
```bash
dtctl describe lookup <path>
```

### Get lookup data as CSV
```bash
dtctl get lookup /lookups/grail/pm/errors -o csv > backup.csv
```

### Search by path
```bash
dtctl get lookups -o json --plain | jq -r '.[] | select(.path | test("keyword"; "i")) | "\(.path) | \(.records) records"'
```

### Filter by size
```bash
dtctl get lookups -o json --plain | jq -r '.[] | select(.fileSize > 10000)'
```

## Using Lookups in DQL Queries

Once created, use lookups to enrich query results:

```bash
# Basic lookup join
dtctl query "fetch logs | lookup [load '/lookups/grail/pm/errors'], lookupField:status_code"

# Lookup with specific fields
dtctl query "fetch logs | lookup [load '/lookups/grail/users'], lookupField:user_id, fields: {name, email}"

# Multiple lookups
dtctl query "fetch logs 
| lookup [load '/lookups/grail/errors'], lookupField:error_code
| lookup [load '/lookups/grail/users'], lookupField:user_id"
```

**Lookup syntax in DQL:**
- `lookup [load '<path>']` - Load lookup table
- `lookupField:<field>` - Field to join on
- `fields: {field1, field2}` - Specific fields to include (optional)

## Important Notes

- Use full `path` as the identifier (not a simple ID)
- Paths follow a hierarchical structure (e.g., /lookups/category/name)
- File size is in bytes
- Modified date is in YYYY-MM-DD format
- Lookup data persists and can be reused across queries
