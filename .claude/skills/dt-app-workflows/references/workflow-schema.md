# Workflow Schema Reference

Schema and spec reference for Dynatrace Workflows-as-Code in JSON and YAML formats. All field constraints below are sourced from the official Automation API OpenAPI spec.

**Authoritative spec files (most accurate source of truth):**

- [Automation Public Spec](../assets/workflow_api_public_spec.yaml) — `WorkflowCreate`, `Task`, `Trigger` schemas
- [Automation Reserved Spec](../assets/workflow_api_reserved_spec.yaml) — `expression-preview` for Jinja testing

## Workflow Object (WorkflowCreate schema)

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `id` | UUID string | No | — | Include to update existing workflow. Omit to create new. |
| `title` | string | **Yes** | minLength: 1, maxLength: 200 | Workflow display name |
| `description` | string | No | — | Workflow description |
| `isPrivate` | boolean | No | Default: `true` | If false, visible to all users |
| `isDeployed` | boolean | No | Default: `true` | Undeployed = not billed, triggers disabled |
| `owner` | UUID string | No | — | User or group UUID |
| `ownerType` | enum | No | `USER`, `GROUP` | Owner type |
| `actor` | string | No | maxLength: 36 | User whose permissions execute the workflow |
| `schemaVersion` | integer | No | — | Current version: 4 |
| `type` | enum | No | `STANDARD`, `SIMPLE` | Workflow type |
| `trigger` | object | No | — | Schedule or event trigger configuration |
| `tasks` | object | No | — | Map of task name → task definition |
| `input` | object | No | — | Default workflow input parameters |
| `result` | string | No | Jinja expression | Workflow result expression |
| `hourlyExecutionLimit` | integer | No | min: 1, max: 2147483647. Default: 1000 | Max executions per hour (throttling) |
| `guide` | string | No | maxLength: 10000 | Markdown documentation for the workflow |

## Task Object (Task schema)

Only `action` is required. All other fields are optional.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `name` | string | No | — | Display name (defaults to task key) |
| `action` | string | **Yes** | Pattern: `^.+:.+$` | Action identifier: `<app.id>:<action-name>` |
| `description` | string | No | — | Task description |
| `input` | object | No | — | Action-specific input parameters |
| `active` | boolean or string | No | Default: `true` | Can be Jinja expression string |
| `position` | object | No | See TaskPosition | `{x: int, y: int}` for UI layout |
| `predecessors` | array | No | uniqueItems: true | Task names that must complete first |
| `conditions` | object | No | See TaskConditionOption | Execution conditions |
| `withItems` | string | No | Jinja expression | Expression returning array for iteration |
| `concurrency` | integer or string | No | 1–99 or `{{...}}` | Parallel execution limit for `withItems` |
| `retry` | object | No | See TaskRetryOption | Retry configuration |
| `timeout` | integer or string | No | 1–604800 or `{{...}}`. Default: 3600 | Seconds until task times out |
| `waitBefore` | integer or string | No | 0–86400 or `{{...}}`. Default: 0 | Delay before execution (seconds) |

### TaskPosition

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `x` | integer | **Yes** | min: -1000, max: 1000 |
| `"y"` | integer | **Yes** | min: 1, max: 1000 |

**y=0 is reserved for the trigger node.** Always quote `"y"` in YAML to prevent boolean parsing.

### TaskConditionOption

```yaml
conditions:
  states:
    predecessor_task_1: OK       # SUCCESS, ERROR, ANY, OK, NOK
    predecessor_task_2: ANY
  custom: "{{ result('task_1').records | length > 0 }}"
  else: SKIP                     # SKIP or STOP (what to do when condition is false)
```

**Valid condition states:** `SUCCESS`, `ERROR`, `ANY`, `OK`, `NOK`

**Valid else values:** `SKIP` (skip task), `STOP` (stop workflow)

### TaskRetryOption

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `count` | integer or `{{...}}` | **Yes** | 0–99 |
| `delay` | integer or `{{...}}` | No | 0–3600 (seconds between retries) |
| `failedLoopIterationsOnly` | boolean | No | Default: `true`. For `withItems` tasks. |

```yaml
retry:
  count: 3
  delay: 30
  failedLoopIterationsOnly: false
```

## Trigger Configuration

A workflow has at most one automatic trigger. Set `trigger: {}` for manual/on-demand only.

### Schedule Triggers

The `timezone` field lives on the `schedule` object, NOT inside the inner `trigger`.

#### Cron Trigger

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: cron
      cron: "0 9 * * 1-5"
```

#### Interval Trigger

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "UTC"
    trigger:
      type: interval
      intervalMinutes: 30        # 1–720 (max 12 hours per spec)
```

**intervalMinutes range:** 1–720

Optional fields: `betweenStart`, `betweenEnd` (HH:MM format) to restrict interval to a time window.

#### Time Trigger (Daily at Specific Time)

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "America/New_York"
    trigger:
      type: time
      time: "09:00"              # HH:MM format (not HH:MM:SS)
```

#### Once Trigger (Single Execution)

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "UTC"
    trigger:
      type: once
      at: "2025-12-31T23:59:59"  # ISO 8601 WITHOUT timezone suffix
```

**Note:** The field is `at` (not `dateTime`). Format: `YYYY-MM-DDTHH:MM:SS` with no timezone — timezone is set on the `schedule` object.

#### Schedule with Filter Parameters

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: cron
      cron: "0 9 * * 1-5"
    filterParameters:
      count: 10
      earliestStartTime: "08:00"
      businessCalendar: "854a3452-a6d3-45bd-83e1-e8afa56eabcd"
```

### Event Triggers

#### Davis Event Trigger

```yaml
trigger:
  eventTrigger:
    isActive: true
    triggerConfiguration:
      type: davis-event
      value:
        entityTags: {}
        entityTagsMatch: null
        customFilter: |
          event.status_transition == "CREATED"
          AND event.provider == "KUBERNETES_ANOMALY_DETECTION"
        onProblemClose: false
        maintenanceWindowTriggerBehavior: always
```

#### Davis Problem Trigger

All 7 problem categories from the spec:

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
        analysisReady: false
        severityThreshold: null
        maintenanceWindowTriggerBehavior: always
```

**Davis-problem-specific fields:**
- `analysisReady` (boolean) — wait for first root cause analysis before triggering
- `severityThreshold` (integer 1–5, nullable) — only trigger at this severity or more severe (1 = critical)

#### Custom Event Trigger (DQL Matcher)

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

**CRITICAL:** The `query` field uses **DQL matcher expressions**, NOT full DQL. Do NOT use `fetch`, `|`, or pipe operators. Max length: 1000 characters.

**eventType values:** `events`, `bizevents`, `dt.system.events`, `security.events`

References:
- [Event triggers for workflows](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/trigger/event-trigger)
- [DQL matcher expression](https://docs.dynatrace.com/docs/observe/business-observability/bo-event-processing/bo-events-processing-matcher)

## JSON vs YAML Format Gotchas

### YAML-Specific Issues

| Issue | Wrong | Correct |
|-------|-------|---------|
| `y` key parsed as boolean | `y: 1` | `"y": 1` |
| Colon in strings | `query: fetch logs \| filter a: b` | `query: "fetch logs ..."` |
| Special chars | `title: @myworkflow` | `title: "@myworkflow"` |
| Boolean coercion | `active: on` | `active: true` |
| Multi-line strings | Incorrect indentation | Use `\|` block scalar |

**Always quote:** the `y` key in position objects, strings with `:`, `@`, `#`, `{`, `}`, `[`, `]`, and values like `true`, `false`, `yes`, `no`, `on`, `off`.

### JSON-Specific Issues

| Issue | Wrong | Correct |
|-------|-------|---------|
| Trailing commas | `{"a": 1,}` | `{"a": 1}` |
| Single quotes | `{'key': 'value'}` | `{"key": "value"}` |
| Unescaped quotes | `"query": "filter a == "b""` | `"query": "filter a == \"b\""` |
| Multi-line strings | Literal newlines | Use `\n` escape |

### Multi-line Strings

**YAML (preferred for readability):**
```yaml
input:
  query: |
    fetch logs
    | filter loglevel == "ERROR"
    | limit 100
```

**JSON (escape newlines):**
```json
{
  "input": {
    "query": "fetch logs\n| filter loglevel == \"ERROR\"\n| limit 100"
  }
}
```

## Minimal Valid Workflow Examples

### JSON

```json
{
  "title": "My Workflow",
  "tasks": {
    "query_logs": {
      "action": "dynatrace.automations:execute-dql-query",
      "input": {
        "query": "fetch logs | limit 10"
      },
      "position": {"x": 0, "y": 1}
    }
  }
}
```

### YAML

```yaml
title: My Workflow
tasks:
  query_logs:
    action: dynatrace.automations:execute-dql-query
    input:
      query: fetch logs | limit 10
    position:
      x: 0
      "y": 1
```

## Related References

- [Jinja Expressions](./jinja-expressions.md) — Dynamic values in workflows
- [Triggers Reference](./triggers.md) — Detailed trigger configuration
- [Actions Reference](./actions.md) — Available workflow actions
- [dtctl Commands](./dtctl-workflows.md) — CLI operations
