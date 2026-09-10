# dtctl Workflows Commands Reference

Reference for managing Dynatrace Workflows via dtctl CLI. For full dtctl reference, consult the dtctl skill.

## Prerequisites

```dtctl
# Check current context
dtctl config current-context

# Check authentication
dtctl auth whoami --plain

# If not logged in
dtctl auth login --safety-level readwrite-mine
```

## Command Reference

### List Workflows

```dtctl
# List only your workflows (table view)
dtctl get workflows --mine

# Full JSON output
dtctl get workflows --mine -o json --plain

# Full YAML output
dtctl get workflows --mine -o yaml --plain
```

### Get Single Workflow

```bash
# Get as JSON
dtctl get workflow <workflow-id> -o json --plain

# Get as YAML (for editing/storing)
dtctl get workflow <workflow-id> -o yaml --plain

# Save to file
dtctl get workflow <id> -o yaml --plain > my-workflow.yaml
```

### Describe Workflow

```dtctl
# Human-readable details
dtctl describe workflow <workflow-id>

# Machine-readable
dtctl describe workflow <workflow-id> -o json --plain
```

### Create / Update Workflow

```dtctl
# Dry-run (validate without applying)
dtctl apply -f workflow.yaml --dry-run

# Apply (create new, or update if "id" field is present and matches existing)
dtctl apply -f workflow.yaml --plain
```

**Update existing workflow in-place:**

1. List workflows and find the target ID: `dtctl get workflows --mine`
2. Ensure the `id` field in your JSON/YAML file matches the existing workflow ID
3. Apply: `dtctl apply -f workflow.yaml --plain`

If no `id` field is present, `dtctl apply` creates a new workflow.

### Delete Workflow

Always ask the user for explicit confirmation before deleting. Never delete without being asked.

```dtctl
# Delete with confirmation prompt
dtctl delete workflow <workflow-id>

# Delete without confirmation
dtctl delete workflow <workflow-id> -y
```

### Execute Workflow

```dtctl
# Execute immediately
dtctl exec workflow <workflow-id>

# Execute and wait for completion
dtctl exec workflow <workflow-id> --wait

# Execute with input parameters
dtctl exec workflow <workflow-id> --params environment=staging --params debug=true

# Execute with timeout
dtctl exec workflow <workflow-id> --wait --timeout 10m
```

### Workflow Executions

```dtctl
# List recent executions
dtctl get workflow-execution -o json --plain

# Executions for specific workflow
dtctl get workflow-execution -w <workflow-id> -o json --plain

# View execution logs
dtctl logs workflow-execution <execution-id>
```

## Typical Workflows

### Export Existing Workflow

```bash
# Find workflow ID
dtctl get workflows --mine -o json --plain | jq -r '.[] | "\(.id) | \(.title)"'

# Export to YAML
dtctl get workflow <id> -o yaml --plain > workflow.yaml
```

### Validate Before Deploy

```bash
# Local validation
node scripts/validate_workflow.js workflow.yaml --strict

# API dry-run
dtctl apply -f workflow.yaml --dry-run
```

### Deploy Workflow

```bash
# Using deploy script (validates + dry-runs + applies)
./scripts/deploy_workflow.sh workflow.yaml

# Or manually
dtctl apply -f workflow.yaml --plain
```

### Test Workflow

```bash
# Execute with wait
dtctl exec workflow <id> --wait --timeout 5m

# Check execution status
dtctl get workflow-execution -w <id> -o json --plain | jq '.[0]'

# View logs if failed
dtctl logs workflow-execution <execution-id>
```

### Iterate on Workflow

```bash
# Edit file
# Validate
node scripts/validate_workflow.js workflow.yaml
dtctl apply -f workflow.yaml --dry-run

# Apply changes
dtctl apply -f workflow.yaml --plain

# Test
dtctl exec workflow <id> --wait
```

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid cron expression` | Malformed cron | Verify 5-field cron syntax |
| `task not found` | Missing predecessor | Check task names in predecessors |
| `invalid action` | Unknown action ID | Verify `<app.id>:<action-name>` pattern |
| `permission denied` | Insufficient scopes | Run `dtctl auth whoami --plain`, check scopes |
| `workflow not found` | Wrong ID or deleted | Re-list with `dtctl get workflows --mine` |

## Batch Operations

```bash
# Deploy multiple workflows
for f in workflows/*.yaml; do
  echo "Deploying $f..."
  dtctl apply -f "$f" --plain
done

# Export all your workflows
dtctl get workflows --mine -o json --plain | jq -r '.[].id' | while read id; do
  title=$(dtctl get workflow "$id" -o json --plain | jq -r '.title' | tr ' ' '_')
  dtctl get workflow "$id" -o yaml --plain > "exports/${title}.yaml"
done
```

## Output Formats

| Flag | Format | Use Case |
|------|--------|----------|
| `-o json` | JSON | Scripting, jq processing |
| `-o yaml` | YAML | Human editing, git storage |
| `-o table` | Table | Quick human review |
| `--plain` | No colors | Scripts, piping |

**Always use `--plain` for scripted operations.**

## Safety Best Practices

1. **Verify context** — `dtctl config current-context` before operations
2. **Use `--dry-run` before apply** — catch errors without making changes
3. **Backup before delete** — export workflow first
4. **Use `--mine` when listing** — avoid modifying others' workflows
5. **Use safety-level readwrite-mine** — prevents accidental modifications to shared resources

## Related References

- [Workflow Schema](./workflow-schema.md) — YAML/JSON structure
- [Triggers Reference](./triggers.md) — Trigger configuration
- [Jinja Expressions](./jinja-expressions.md) — Dynamic expressions
- [Actions Reference](./actions.md) — Available workflow actions
