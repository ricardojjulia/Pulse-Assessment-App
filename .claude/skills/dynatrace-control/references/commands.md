# dtctl Commands Reference

Complete reference for all dtctl command patterns and usage examples.

**Contents:** [Core Resource Operations](#core-resource-operations) · [Document Operations](#document-operations) · [Query Operations](#query-operations) · [Wait Conditions](#wait-conditions) · [Execution Commands](#execution-commands) · [Sharing & Collaboration](#sharing--collaboration) · [Comparison & Diff](#comparison--diff) · [Discovery Commands](#discovery-commands) · [Logs](#logs) · [Authentication & Permissions](#authentication--permissions)

## Core Resource Operations

### get - List Resources

```bash
# List all resources (works for workflows, dashboards, slos, notebooks, etc.)
dtctl get workflows -o json --plain

# Filter to your resources only
dtctl get workflows --mine -o json --plain

# Filter by schema (settings only)
dtctl get settings --schema builtin:openpipeline.logs.pipelines -o json --plain

# Filter by app (functions only)
dtctl get functions --app dynatrace.automations -o json --plain

# Filter by type (trash only)
dtctl get trash --type dashboard --deleted-after 2024-01-01 -o json --plain
```

### describe - Show Resource Details

```bash
# Get resource metadata (by ID or unique name)
dtctl describe workflow <id> -o json --plain
dtctl describe workflow "My Workflow" -o json --plain
```

### edit - Edit Resource

```bash
# Edit resource interactively (opens $EDITOR)
dtctl edit workflow <id>
dtctl edit workflow <id> --format=json
```

**Note for AI agents:** `edit` opens an interactive editor. Prefer `get` + modify + `apply` workflow instead.

### apply - Create/Update from File

```bash
dtctl apply -f workflow.yaml --plain              # Apply single file
dtctl apply -f ./configs/ --plain                  # Apply directory
dtctl apply -f workflow.yaml --set environment=prod --set owner=team-a --plain  # With variables
dtctl apply -f workflow.yaml --dry-run --plain     # Dry run (preview only)
dtctl apply -f workflow.yaml --show-diff --plain   # Show diff when updating
```

### delete - Delete Resource

```bash
# Delete by ID or unique name
dtctl delete workflow <id> --plain
dtctl delete workflow "My Workflow" --plain
```

## Document Operations

### history / restore

```bash
# Show all versions (works for dashboard, notebook, workflow)
dtctl history dashboard <id> -o json --plain

# Restore to specific version
dtctl restore dashboard <id> --version 3 --plain
```

## Query Operations

### query - Execute DQL

```bash
dtctl query "fetch logs | limit 10" -o json --plain          # Inline query
dtctl query -f query.dql -o json --plain                      # From file
dtctl query -f query.dql --set host=h-123 --set timerange=2h -o json --plain  # With variables
dtctl query "timeseries avg(dt.host.cpu.usage)" -o chart --plain  # Chart output (also: sparkline, barchart)
dtctl query --include-contributions --metadata=contributions -o json "fetch logs | limit 100" # Use contributions field in result metadata to learn about buckets contributing to refine a query with better bucket filters 
```

**Template syntax in .dql files:**
```dql-template
fetch logs
| filter host.name == "{{.host}}"
| filter timestamp > now() - {{.timerange | default "1h"}}
| filter status == "{{.status | default "ERROR"}}"
```

## Wait Conditions

### wait query - Wait for Query Results

```bash
dtctl wait query "fetch logs | filter status='ERROR'" --for=any --timeout 5m
dtctl wait query "fetch errors" --for=none --timeout 10m
dtctl wait query "fetch spans | filter test_id='test-123'" --for=count=1 --timeout 5m
dtctl wait query "fetch logs" --for=count-gte=100 --timeout 2m
```

**Wait conditions:** `--for=any` (results exist), `--for=none` (no results), `--for=count=N` (exact), `--for=count-gte=N` (>=), `--for=count-gt=N` (>), `--for=count-lte=N` (<=), `--for=count-lt=N` (<)

## Execution Commands

### exec workflow - Execute Workflow

```bash
dtctl exec workflow <id> --plain                              # Execute
dtctl exec workflow <id> --wait --timeout 10m --plain         # Execute and wait
dtctl exec workflow <id> --payload '{"key":"value"}' --plain  # With input
```

### exec function - Execute Function

See [references/functions.md](functions.md) for complete guide.

```bash
dtctl exec function dynatrace.automations/execute-dql-query --method POST --payload '{"query":"fetch logs"}' --plain
dtctl exec function --code 'export default async function() { return "hello" }' --plain
```

### exec copilot - Davis CoPilot

See [references/copilot.md](copilot.md) for complete guide.

```bash
dtctl exec copilot "What caused the CPU spike on host-123?" --plain
dtctl exec copilot nl2dql "show error logs from last hour" --plain   # Generate DQL
dtctl exec copilot dql2nl "fetch logs | filter status='ERROR'" --plain  # Explain DQL
```

### exec analyzer - Execute Analyzer

See [references/analyzers-usage.md](analyzers-usage.md) for complete guide.

```bash
dtctl exec analyzer dt.statistics.GenericForecastAnalyzer \
  --query "timeseries avg(dt.host.cpu.usage)" \
  -o chart --plain
```

### exec slo - Execute SLO Evaluation

```bash
dtctl exec slo <id> -o json --plain
```

## Sharing & Collaboration

### share / unshare - Manage Document Access

```bash
# Share with user or group (access: read-only, read-write)
dtctl share dashboard <id> --user user@example.com --access read-write --plain
dtctl share dashboard <id> --group <group-id> --access read-only --plain

# Remove access
dtctl unshare dashboard <id> --user user@example.com --plain
dtctl unshare dashboard <id> --group <group-id> --plain
dtctl unshare dashboard <id> --all --plain
```

## Comparison & Diff

### diff - Compare Resources

```bash
dtctl diff -f workflow.yaml --plain                            # Local vs server
dtctl diff workflow prod-workflow staging-workflow --plain      # Two remote resources
dtctl diff -f file1.yaml -f file2.yaml --plain                 # Two local files
dtctl diff -f dashboard.json --format=side-by-side --plain     # Side-by-side
dtctl diff -f workflow.yaml --semantic --plain                  # Semantic diff
dtctl diff -f workflow.yaml --semantic --ignore-metadata --plain  # Ignore metadata
dtctl diff -f config.yaml --format=json-patch --plain          # JSON patch output
dtctl diff -f workflow.yaml --quiet                             # Exit code only (0=same, 1=different, 2=error)
```

## Discovery Commands

### find intents / open intent

```bash
# Find intents that can handle specific data
dtctl find intents --data trace.id=abc123 -o json --plain

# Open intent in browser
dtctl open intent dynatrace.distributedtracing/view-trace --data trace.id=abc123
dtctl open intent dynatrace.automations/view-execution --data execution.id=12345 --browser
```

## Logs

### logs workflow-execution - Print Workflow Logs

```bash
dtctl logs workflow-execution <execution-id> --plain            # Print logs
dtctl logs workflow-execution <execution-id> --follow --plain   # Follow/stream logs
```

## Authentication & Permissions

### auth whoami / auth can-i

```bash
dtctl auth whoami --plain              # Show authenticated user
dtctl auth whoami --id-only --plain    # Show only user ID

# Check permissions (exit code 0=allowed, 1=denied)
dtctl auth can-i create workflows
dtctl auth can-i delete dashboards
```
