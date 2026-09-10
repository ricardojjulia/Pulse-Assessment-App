# CoPilot Skills Resource

## Overview
Davis CoPilot skills provide AI-powered assistance capabilities in Dynatrace.

## List CoPilot Skills
```bash
dtctl get copilot-skills -o json --plain
```

## JSON Schema

Each CoPilot skill object contains:

```json
{
  "Name": "string (skill name)"
}
```

## Key Fields

- **Name**: Skill identifier (e.g., "conversation", "operator", "nl2dql", "dql2nl", "documentSearch")

## Common Operations

### List all CoPilot skills
```bash
dtctl get copilot-skills
```

### Search by name
```bash
dtctl get copilot-skills -o json --plain | jq -r '.[] | select(.Name | test("dql"; "i")) | "\(.Name)"'
```

## Available Skills

Common CoPilot skills include:
- **conversation** - Conversational AI interactions
- **operator** - Operational assistance
- **nl2dql** - Natural language to DQL translation
- **dql2nl** - DQL to natural language translation
- **documentSearch** - Documentation search

## Important Notes

- Skills are identified by name only (minimal schema)
- Skills enable various Davis CoPilot capabilities
- Use this to discover available AI assistance features
