# Workflows Resource

## Overview
Workflows automate tasks and processes in Dynatrace.

## List Workflows
```bash
dtctl get workflows -o json --plain
dtctl get workflows --mine  # Filter to your workflows
```

## JSON Schema

Each workflow object contains:

```json
{
  "id": "string (UUID)",
  "title": "string",
  "owner": "string (user UUID)",
  "ownerType": "USER",
  "description": "string",
  "isPrivate": boolean,
  "isDeployed": boolean,
  "tasks": {
    "task-name": {
      "action": "string (action identifier)",
      "active": boolean,
      "description": "string",
      "input": {},
      "name": "string",
      "position": {"x": number, "y": number},
      "predecessors": ["array of task names"],
      "conditions": {}
    }
  },
  "trigger": {
    "schedule": {},
    "event": {}
  }
}
```

## Key Fields

- **id**: Unique workflow identifier (UUID)
- **title**: Display name (NOT "name")
- **owner**: User UUID who owns the workflow
- **isPrivate**: Whether workflow is private to owner
- **isDeployed**: Whether workflow is active
- **tasks**: Object containing task definitions
- **trigger**: Defines what triggers the workflow (schedule, event, etc.)

## Common Operations

### Search by title
```bash
dtctl get workflows -o json --plain | jq -r '.[] | select(.title | test("keyword"; "i")) | "\(.id) | \(.title)"'
```

### Get workflow details
```bash
dtctl describe workflow <id>
```

### Execute workflow
```bash
dtctl exec workflow <id>
```

### Filter by owner
```bash
ME=$(dtctl auth whoami --id-only)
dtctl get workflows -o json --plain | jq -r --arg me "$ME" '.[] | select(.owner==$me)'
```
