# Function Execution

## Table of Contents
- [Two Execution Modes](#two-execution-modes)
  - [1. App Function Execution](#1-app-function-execution)
  - [2. Ad-hoc JavaScript Execution](#2-ad-hoc-javascript-execution)
- [Function Discovery](#function-discovery)
- [SDK Versions](#sdk-versions)
- [Important Notes](#important-notes)

Execute serverless functions from installed apps or run ad-hoc JavaScript code using `dtctl exec function`.

## Two Execution Modes

### 1. App Function Execution

Execute functions exposed by installed apps.

```bash
# Execute function with GET (default)
dtctl exec function dynatrace.automations/execute-dql-query

# Execute with POST and JSON payload
dtctl exec function myapp/myfunction --method POST --payload '{"key":"value"}'

# Execute with payload from file
dtctl exec function myapp/myfunction --method POST --data @payload.json

# Read payload from stdin
cat payload.json | dtctl exec function myapp/myfunction --method POST --data -

# Defer execution (async, for resumable functions)
dtctl exec function myapp/resumable-function --defer
```

**Key flags:**
- `--method` - HTTP method (GET, POST, PUT, PATCH, DELETE) - default: GET
- `--payload` - JSON payload as string
- `--data` - Read payload from file (`@filename`) or stdin (`-`)
- `--defer` - Async/deferred execution (only for resumable functions)

**App function examples:**
```bash
# Execute DQL query via workflow function
dtctl exec function dynatrace.automations/execute-dql-query \
  --method POST \
  --payload '{"query": "fetch logs | limit 10"}'

# Run workflow
dtctl exec function dynatrace.automations/run-workflow \
  --method POST \
  --payload '{"workflowId": "workflow-123"}'

# HTTP request function
dtctl exec function dynatrace.automations/http-function \
  --method POST \
  --payload '{"url": "https://api.example.com", "method": "GET"}'
```

### 2. Ad-hoc JavaScript Execution

Execute custom JavaScript code without deploying an app.

```bash
# Execute inline JavaScript
dtctl exec function --code 'export default async function() { return "hello" }'

# Execute JavaScript from file
dtctl exec function -f script.js

# Execute with input payload
dtctl exec function -f script.js --payload '{"input":"data"}'

# Execute with payload from file
dtctl exec function -f script.js --data @input.json
```

**Key flags:**
- `--code` - Inline JavaScript code (must export default async function)
- `-f` - Read JavaScript from file

**Ad-hoc examples:**
```bash
# Simple hello world
dtctl exec function --code 'export default async function() { 
  return { message: "Hello from dtctl" }
}'

# Access payload
dtctl exec function --code 'export default async function(event) {
  return { received: event.payload }
}' --payload '{"test": "data"}'

# Use environment and return data
dtctl exec function --code 'export default async function(event) {
  console.log("Environment:", event.environmentId);
  return { timestamp: new Date().toISOString() }
}'

# Execute multi-line script from file
cat > script.js << 'EOFJS'
export default async function(event) {
  const { payload } = event;
  // Your logic here
  return {
    result: "processed",
    input: payload
  };
}
EOFJS
dtctl exec function -f script.js --payload '{"key":"value"}'
```

## Function Discovery

Find available functions to execute:

```bash
# List all functions across all apps
dtctl get functions

# List functions for specific app
dtctl get functions --app dynatrace.automations

# Get function details
dtctl describe function dynatrace.automations/execute-dql-query

# Find resumable functions (can use --defer)
dtctl get functions -o json --plain | jq -r '.[] | select(.resumable==true) | .fullName'
```

## SDK Versions

Ad-hoc JavaScript execution uses SDK versions that determine available APIs and Node.js runtime:

```bash
# List available SDK versions
dtctl get sdk-versions

# Check runtime version
dtctl exec function --code 'export default async function() { 
  return { nodeVersion: process.version }
}'
```

See [sdk-versions resource documentation](resources/sdk-versions.md) for details.

## Important Notes

- **App functions**: Use format `appId/functionName` (e.g., `dynatrace.automations/execute-dql-query`)
- **Resumable functions**: Check `resumable` field before using `--defer` flag
- **Ad-hoc code**: Must export default async function
- **Payload formats**: Both modes accept `--payload` (inline) or `--data` (from file/stdin)
- **HTTP methods**: Only relevant for app functions (ad-hoc code doesn't use HTTP methods)
- **SDK runtime**: Ad-hoc code runs in controlled sandbox with specific Node.js version
