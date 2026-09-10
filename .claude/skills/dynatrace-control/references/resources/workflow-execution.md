# Workflow Execution Resource

## Overview
Workflow executions track individual runs of workflows.

## List Workflow Executions
```bash
dtctl get workflow-execution -o json --plain
```

## JSON Schema

Each workflow execution object contains:

```json
{
  "id": "string (UUID)",
  "workflow": "string (workflow UUID)",
  "title": "string (workflow title)",
  "state": "string (SUCCESS|FAILED|RUNNING|etc)",
  "startedAt": "ISO 8601 timestamp",
  "endedAt": "ISO 8601 timestamp",
  "runtime": number (seconds),
  "trigger": "string (trigger description)",
  "triggerType": "string (Schedule|Event|Manual|etc)",
  "actor": "string (user UUID)",
  "input": {},
  "params": {}
}
```

## Key Fields

- **id**: Unique execution identifier (UUID)
- **workflow**: UUID of the workflow that was executed
- **title**: Title of the workflow
- **state**: Execution state (SUCCESS, FAILED, RUNNING, CANCELLED, etc.)
- **startedAt**: Execution start timestamp
- **endedAt**: Execution end timestamp
- **runtime**: Execution duration in seconds
- **trigger**: Description of what triggered the execution
- **triggerType**: Type of trigger (Schedule, Event, Manual, etc.)
- **actor**: User UUID who triggered/owns the execution
- **input**: Input data provided to the execution
- **params**: Parameters used in the execution

## Common Operations

### List recent executions
```bash
dtctl get workflow-execution
```

### Get execution details
```bash
dtctl describe workflow-execution <id>
```

### Filter by state
```bash
dtctl get workflow-execution -o json --plain | jq -r '.[] | select(.state=="FAILED") | "\(.id) | \(.title) | \(.state)"'
```

### Filter by workflow
```bash
dtctl get workflow-execution -o json --plain | jq -r --arg wfId "<workflow-id>" '.[] | select(.workflow==$wfId)'
```

### Find long-running executions
```bash
dtctl get workflow-execution -o json --plain | jq -r '.[] | select(.runtime > 60) | "\(.id) | \(.title) | \(.runtime)s"'
```

## Execution States

- **SUCCESS**: Completed successfully
- **FAILED**: Failed with error
- **RUNNING**: Currently executing
- **CANCELLED**: Manually cancelled
- **TIMEOUT**: Exceeded time limit

## Important Notes

- Execution IDs are UUIDs
- Runtime is measured in seconds
- Use workflow UUID to correlate executions with workflows
- Check `state` to determine execution outcome
