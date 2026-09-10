# Functions Resource

## Overview
Functions are serverless backend functions exposed by installed apps. Each function can be invoked using `dtctl exec function` to execute app-specific logic.

Functions enable:
- App-specific backend operations (e.g., HTTP requests, DQL queries, AWS operations)
- Integration with external services
- Custom JavaScript execution
- Workflow automation actions

## List Functions
```bash
dtctl get functions -o json --plain
```

## JSON Schema

Each function object contains:

```json
{
  "appId": "string (parent app identifier)",
  "appName": "string (human-readable app name)",
  "functionName": "string (function identifier within app)",
  "title": "string (optional, human-readable title)",
  "description": "string (optional, function description)",
  "resumable": false,
  "stateful": false,
  "fullName": "string (appId/functionName)"
}
```

## Key Fields

- **appId**: Parent app identifier (e.g., "dynatrace.automations")
- **appName**: Human-readable app name (e.g., "Workflows")
- **functionName**: Function identifier within the app (e.g., "execute-dql-query")
- **fullName**: Complete function reference in format `appId/functionName`
- **title**: Optional human-readable function title
- **description**: Optional function description
- **resumable**: Whether function supports resumable/deferred execution
- **stateful**: Whether function maintains state across invocations

## Common Operations

### List all functions
```bash
dtctl get functions
```

### List functions for specific app
```bash
dtctl get functions --app dynatrace.automations
```

### Get function details
```bash
dtctl describe function dynatrace.automations/execute-dql-query
```

### Show resumable functions
```bash
dtctl get functions -o json --plain | jq -r '.[] | select(.resumable==true) | "\(.fullName) | \(.title)"'
```

### Search by title or description
```bash
dtctl get functions -o json --plain | jq -r '.[] | select((.title // .description // "") | test("HTTP"; "i")) | "\(.fullName) | \(.title)"'
```

### List functions by app
```bash
dtctl get functions -o json --plain | jq -r 'group_by(.appId) | .[] | "\(.[0].appId) (\(length) functions)"'
```

### Execute a function
```bash
# Execute app function
dtctl exec function dynatrace.automations/execute-dql-query --payload '{"query": "fetch logs | limit 10"}'

# Execute ad-hoc JavaScript
dtctl exec function --code 'console.log("Hello from dtctl")'

# Execute JavaScript from file
dtctl exec function -f script.js
```

## Important Notes

- Function references use format `appId/functionName` (e.g., `dynatrace.automations/execute-dql-query`)
- Use `dtctl exec function` to invoke functions (see [SKILL.md](../../SKILL.md) for exec function documentation)
- Some functions support resumable execution (`--defer` flag)
- Check `resumable` field to determine if async execution is supported
- Functions without `title` are typically internal/utility functions
- Cross-reference with [apps resource](apps.md) to see which apps provide functions
