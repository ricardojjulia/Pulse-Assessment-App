---
name: dt-app-workflows
description: Create, update, and deploy Dynatrace Workflows-as-Code in JSON or YAML. Use when asked to build automation workflows, configure triggers (schedule/event/problem), write DQL queries in workflows, add Jinja expressions, or deploy workflows via dtctl. Supports full workflow lifecycle including validation, format conversion, and deployment.
license: Apache-2.0
---

# Dynatrace Workflows-as-Code

Create and manage Dynatrace Workflows using JSON/YAML files deployed via dtctl.

## When to Use

- Create new automation workflows
- Configure triggers (cron, interval, event, problem)
- Write DQL queries in workflow tasks
- Add dynamic Jinja expressions
- Convert between JSON and YAML formats
- Validate and deploy workflows

## Prerequisites

```dtctl
# Verify dtctl is configured
dtctl auth login --safety-level readwrite-mine
dtctl config current-context
dtctl auth whoami --plain
```

## Recommended Skill Dependencies

Reference the dtctl skill for more information on that CLI tool.

For DQL syntax, consult dt-dql-essentials skill.

If recommended skills are not installed nor discoverable, prompt the user to download the skills. No matter if these skills are installed or not, continue with your Workflow related tasks nonetheless.

## Quick Start

### 1. Create Workflow File

```yaml
# minimal_workflow.yaml
title: "My Automation"
schemaVersion: 4
isPrivate: true
trigger: {}
tasks:
  query_data:
    action: dynatrace.automations:execute-dql-query
    input:
      query: |
        fetch logs
        | filter loglevel == "ERROR"
        | limit 10
    position:
      x: 0
      "y": 1
```

### 2. Validate Workflow

```bash
node scripts/validate_workflow.js my-workflow.yaml --strict
```

### 3. Deploy Workflow

```bash
./scripts/deploy_workflow.sh my-workflow.yaml
# Or manually:
dtctl apply -f my-workflow.yaml --dry-run
dtctl apply -f my-workflow.yaml --plain
```

### 4. Test Workflow

```dtctl
dtctl exec workflow <id> --wait
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Tasks** | Named operations using app actions |
| **Actions** | `<app.id>:<action-name>` format (pattern: `^.+:.+$`) |
| **Triggers** | Schedule (cron/interval/time/once) or Event (davis-event/davis-problem/event) |
| **Expressions** | Jinja2 templating: `{{ result('task').records }}` |
| **Predecessors** | Task dependencies for execution order (uniqueItems) |
| **Conditions** | Control flow based on task states (SUCCESS/ERROR/ANY/OK/NOK) + `else: SKIP/STOP` |

## Authoritative Spec and Schema

All field constraints (types, ranges, patterns, enums) are sourced from the official Automation API OpenAPI spec:

| Reference | Content |
|-----------|---------|
| [workflow_api_public_spec.yaml](./assets/workflow_api_public_spec.yaml) | Official Swagger spec — **most authoritative source** for WorkflowCreate, Task, Trigger schemas |
| [workflow_api_reserved_spec.yaml](./assets/workflow_api_reserved_spec.yaml) | Relevant section for this skill within the reserved spec — `expression-preview` endpoint for Jinja testing |

## Reference Documentation

| Reference | Content |
|-----------|---------|
| [workflow-schema.md](./references/workflow-schema.md) | JSON/YAML schema guide, field definitions, format gotchas |
| [triggers.md](./references/triggers.md) | Schedule and event trigger configuration |
| [actions.md](./references/actions.md) | Core actions (DQL, JavaScript, HTTP) + discovery pattern |
| [jinja-expressions.md](./references/jinja-expressions.md) | Workflow-specific functions: `event()`, `result()`, `input()` |
| [dtctl-workflows.md](./references/dtctl-workflows.md) | dtctl commands for workflow operations |

## Example Assets

| Asset | Content |
|-------|---------|
| [example_workflow.json](./assets/example_workflow.json) | Complete Kubernetes Troubleshooting Agent workflow (IDs redacted) |
| [example_workflow.yaml](./assets/example_workflow.yaml) | Converted YAML version of the example_workflow.json |
| [minimal_workflow.yaml](./assets/minimal_workflow.yaml) | Minimal valid workflow |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/validate_workflow.js` | Strict validation against official WorkflowCreate schema |
| `scripts/deploy_workflow.sh` | Validate + dry-run + deploy with retry on transient failures |
| `scripts/convert_workflow.js` | Convert JSON↔YAML (handles `"y"` quoting, Jinja preservation) |

## Common Patterns

### DQL Query Task

```yaml
tasks:
  get_errors:
    action: dynatrace.automations:execute-dql-query
    input:
      query: |
        fetch logs, from: now()-1h
        | filter loglevel == "ERROR"
        | limit 100
    position:
      x: 0
      "y": 1
```

### Jinja Variable Interpolation

Pass outputs of previous actions as input of subsequent actions:

```yaml
tasks:
  fetch_correlated_log:
    action: dynatrace.automations:execute-dql-query
    description: "Fetch correlated logs using trace ID from previous task"
    input:
      query: |
        fetch logs, from: -48h, scanLimitGBytes: 2000
        | filter trace_id == "{{ result('fetch_correlated_span').records[0].get('trace.id', '') }}"
        | sort timestamp asc
        | limit 100
    predecessors:
      - fetch_correlated_span
    conditions:
      states:
        fetch_correlated_span: OK
    position:
      x: 0
      "y": 2
```

### JavaScript Processing

```yaml
tasks:
  process:
    action: dynatrace.automations:run-javascript
    input:
      script: |
        import { execution } from '@dynatrace-sdk/automation-utils';
        export default async function() {
          const ex = await execution();
          const data = await ex.result('get_errors');
          return { count: data.records.length };
        }
    predecessors:
      - get_errors
    position:
      x: 0
      "y": 2
```

### Event Trigger (Davis Problem)

```yaml
trigger:
  eventTrigger:
    isActive: true
    triggerConfiguration:
      type: davis-problem
      value:
        categories:
          monitoringUnavailable: false
          availability: true
          error: true
          slowdown: true
          resource: true
          custom: true
          info: false
        entityTags: {}
        entityTagsMatch: any
        onProblemClose: false
        maintenanceWindowTriggerBehavior: always
```

### Event Trigger (DQL Matcher)

**CRITICAL:** The `query` field uses DQL matcher expressions, NOT full DQL. No `fetch`, no pipes.

```yaml
trigger:
  eventTrigger:
    isActive: true
    triggerConfiguration:
      type: event
      value:
        query: |
          event.provider == "openpipeline.jenkins"
          AND tree.node.result == "FAILURE"
        eventType: bizevents
```

### Schedule Trigger (Cron)

Timezone lives on `schedule`, not inside the inner `trigger`.

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: cron
      cron: "0 9 * * 1-5"
```

### Dynamic Expressions

```yaml
input:
  query: |
    fetch logs
    | filter host.name == "{{ event().get('host', 'unknown') }}"
    | filter timestamp > now() - {{ input().get('timerange', '1h') }}
```

## dtctl Commands

```dtctl
# List your workflows
dtctl get workflows --mine

# Full JSON output
dtctl get workflows --mine -o json --plain

# Export workflow
dtctl get workflow <id> -o yaml --plain > workflow.yaml

# Validate (dry-run)
dtctl apply -f workflow.yaml --dry-run

# Deploy new workflow
dtctl apply -f workflow.yaml --plain

# Update existing workflow in-place:
# 1. Find the ID: dtctl get workflows --mine
# 2. Ensure "id" field in your file matches the existing workflow ID
# 3. Apply: dtctl apply -f workflow.yaml --plain

# Execute
dtctl exec workflow <id> --wait

# View execution logs
dtctl logs workflow-execution <execution-id>

# Delete (always confirm with user first)
dtctl delete workflow <id> -y
```

## Error Handling

When `dtctl apply` fails:

1. **Validate locally:** `node scripts/validate_workflow.js file.yaml --strict`
2. **Check dry-run:** `dtctl apply -f file.yaml --dry-run`
3. **Review error message** for specific field issues
4. **Verify permissions:** `dtctl auth whoami --plain`
5. **Check references:** consult the reference docs in `./references/`
6. **Check official docs:** use MCPs and related skills for solutions

## Jinja Expression Testing

1. Test in the Workflows app UI (Edit task → Preview button)
2. Use the expression-preview API — see [jinja-expressions.md](./references/jinja-expressions.md)
3. Swagger UI: `{env}/platform/swagger-ui/index.html?apiType=Reserved&urls.primaryName=Automation+Reserved`

## Important Gotchas

**Jinja keys with dots:** The expression engine interprets dots literally. Always use `get()` with single-quoted keys:

```yaml
# Correct — use get() for keys containing dots
filter trace_id == "{{ result('fetch_correlated_span').records[0].get('trace.id', '') }}"

# Also correct — safe even without dots
filter trace_id == "{{ result('fetch_correlated_span').records[0].get('trace_id', '') }}"
```

**Task dependencies:** Always use `predecessors` to define execution order.

**Position:** Always add `position` with `x` and quoted `"y"`. The `y` value must be ≥ 1 (y=0 is reserved for the trigger node).

**Conditions:** Add `conditions.states` referencing predecessors. Valid states: `SUCCESS`, `ERROR`, `ANY`, `OK`, `NOK`. Use `else: SKIP` or `else: STOP` to control behavior when conditions are false.

| Issue | Wrong | Correct |
|-------|-------|---------|
| `y` key parsed as boolean in YAML | `y: 1` | `"y": 1` |
| Position y=0 | `"y": 0` | `"y": 1` (minimum per spec) |
| Strings with colons | `value: http://...` | `value: "http://..."` |
| ON/OFF values | `active: on` | `active: true` |
| Once trigger field | `dateTime: "..."` | `at: "2025-12-31T23:59:59"` |
| Timezone placement | Inside `trigger.schedule.trigger` | On `trigger.schedule` directly |
| Event trigger query | `fetch bizevents \| filter ...` | DQL matcher expression only |
| intervalMinutes max | `intervalMinutes: 1440` | Max is 720 (12 hours) |
