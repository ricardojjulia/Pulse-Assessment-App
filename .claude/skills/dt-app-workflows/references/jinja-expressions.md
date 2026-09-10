# Jinja Expressions Reference

Dynatrace Workflows use [Jinja2](https://jinja.palletsprojects.com/) templating for dynamic configuration. This reference covers **workflow-specific functions** and patterns.

## Expression Syntax

| Delimiter | Purpose | Example |
|-----------|---------|---------|
| `{{ ... }}` | Output expressions | `{{ result('task_1').records \| length }}` |
| `{% ... %}` | Control structures | `{% if event().get('severity') == 'ERROR' %}...{% endif %}` |

## Core Functions

### `event()`

Access the triggering event payload. Returns `None` if no event triggered the workflow.

```yaml
# Specific attribute (positional shorthand)
input:
  type: "{{ event('type') }}"

# Attribute with dot in name — use bracket notation
input:
  severity: "{{ event()['event.severity'] }}"

# Safe access with default (preferred pattern)
input:
  category: "{{ event().get('category', 'unknown') }}"
```

**Common event fields:** `event.id`, `event.type`, `event.kind`, `event.name`, `event.status`, `event.category`, `event.description`, `timestamp`, `affected_entity_ids`, `affected_entity_types`

### `result(task_name)`

Access output from a predecessor task. The argument is the **task key name only** — no path navigation inside the argument.

```yaml
# Full result
input:
  data: "{{ result('query_logs') }}"

# Nested attribute — chain AFTER the call
input:
  count: "{{ result('query_logs').records | length }}"
  first_record: "{{ result('query_logs').records[0] }}"

# Safe access for keys with dots
input:
  value: "{{ result('my_task').get('key.with.dots', 'default') }}"
```

**DQL query results structure:**
```json
{
  "records": [...],
  "types": [...],
  "metadata": {}
}
```

### `input()`

Access workflow execution input (merged from defaults + runtime params).

```yaml
# Full input object
input:
  params: "{{ input() }}"

# Specific property (positional shorthand)
input:
  environment: "{{ input('environment') }}"

# With default
input:
  timeout: "{{ input().get('timeout', 300) }}"
```

### `execution()`

Access current execution context.

```yaml
input:
  execution_id: "{{ execution().id }}"
  started_at: "{{ execution().started_at }}"
  workflow_title: "{{ execution().workflow.title }}"
```

**Execution object fields:** `id`, `state` (RUNNING, SUCCESS, ERROR, CANCELLED), `started_at`, `ended_at`, `runtime`, `user`, `workflow.id`, `workflow.title`, `workflow.actor`, `link`

### `task(task_name)`

Access task metadata within execution.

```yaml
input:
  task_state: "{{ task('my_task').state }}"
  task_runtime: "{{ task('my_task').runtime }}"
```

**Task object fields:** `id`, `name`, `action`, `state`, `input`, `result`, `runtime`, `started_at`, `ended_at`, `position`

### `environment()`

Access environment information.

```yaml
input:
  env_id: "{{ environment().id }}"
  env_url: "{{ environment().url }}"
```

### `connection(schema, name)`

Get a connection settings object.

```yaml
input:
  connectionId: "{{ connection('app:dynatrace.slack:connection', 'My Slack') }}"
  token: "{{ connection('app:dynatrace.vault:connection', 'api-token').token }}"
```

### `now(timezone)`

Current timestamp as datetime object.

```yaml
input:
  timestamp: "{{ now().strftime('%Y-%m-%dT%H:%M:%SZ') }}"
  local_time: "{{ now('Europe/Vienna').strftime('%H:%M') }}"
```

### `timedelta(**kwargs)`

Create time duration for calculations.

```yaml
input:
  yesterday: "{{ (now() - timedelta(days=1)).strftime('%Y-%m-%d') }}"
  next_hour: "{{ (now() + timedelta(hours=1)).strftime('%H:%M') }}"
```

**Parameters:** `days`, `hours`, `minutes`, `seconds`, `weeks`, `milliseconds`, `microseconds`

## Scheduling Functions

### `calendars(id)`

```yaml
input:
  calendar: "{{ calendars('854a3452-a6d3-45bd-83e1-e8afa56eabcd') }}"
```

### `scheduling_rules(id)`

```yaml
input:
  rule: "{{ scheduling_rules('a941f679-a6ee-4f33-9914-b15ea32eb326') }}"
```

### `scheduling_rules_includes(rule_id, date)`

```yaml
conditions:
  custom: "{{ scheduling_rules_includes('d6882cd1-...', now().strftime('%Y-%m-%d')) }}"
```

### `scheduling_rules_preview(rule_id, **kwargs)`

```yaml
input:
  next_dates: "{{ scheduling_rules_preview('d6882cd1-...', count=5) }}"
```

### `seconds_before(clock_time, timezone)`

```yaml
input:
  wait: "{{ seconds_before('14:00:00', 'America/New_York') }}"
```

## Execution Access Functions

### `executions(id, **kwargs)`

```yaml
input:
  exec: "{{ executions('00c27c88-d066-4424-bc44-f49a75536e37') }}"
  recent: "{{ executions(workflow='81a7fbb5-...', limit=5, order='-created_at') }}"
```

### `workflows(id, **kwargs)`

```yaml
input:
  workflow: "{{ workflows('ef1f1ca4-1d6b-4c7d-b964-5f09096d77cd') }}"
```

## Jinja Filters

| Filter | Example | Description |
|--------|---------|-------------|
| `default` | `{{ x \| default('N/A') }}` | Fallback for undefined |
| `length` | `{{ list \| length }}` | Count items |
| `first`, `last` | `{{ list \| first }}` | First/last item |
| `join` | `{{ list \| join(', ') }}` | Concatenate |
| `replace` | `{{ s \| replace(' ', '_') }}` | String replace |
| `lower`, `upper` | `{{ s \| lower }}` | Case conversion |
| `tojson` | `{{ obj \| tojson }}` | JSON serialize |
| `int`, `float` | `{{ s \| int }}` | Type conversion |
| `selectattr` | `{{ list \| selectattr('active') }}` | Filter objects |
| `map` | `{{ list \| map(attribute='name') }}` | Extract attribute |

## Control Structures

### Conditionals in DQL Queries

```yaml
input:
  query: |
    fetch logs
    | filter {% if event().get('severity') == 'ERROR' %}loglevel == "ERROR"{% else %}true{% endif %}
    | limit 100
```

### Safe Attribute Access

```yaml
input:
  filter: |
    {% if 'k8s.cluster.name' in event() %}
    k8s.cluster.name == "{{ event()['k8s.cluster.name'] }}"
    {% else %}
    true
    {% endif %}
```

### Iteration

```yaml
# In string
input:
  message: |
    Found hosts:
    {% for host in result('get_hosts').records %}
    - {{ host.get('name', 'unknown') }}
    {% endfor %}
```

## Testing Expressions

### Workflows App Expression Tester

1. Open Workflows app → Edit any task input field
2. Maximize input field → use the "Preview" button to test

### Expression Preview API

**POST** `/platform/automation/v1.4/expression-preview`

```json
{
  "expression": "{{ result('task_1').records | length }}",
  "task": "task_2",
  "workflow": {
    "title": "Test",
    "tasks": {
      "task_1": {
        "action": "dynatrace.automations:execute-dql-query",
        "input": {"query": "fetch logs | limit 10"}
      },
      "task_2": {
        "action": "dynatrace.automations:run-javascript",
        "predecessors": ["task_1"]
      }
    }
  },
  "params": {
    "event": {"type": "test", "severity": "ERROR"}
  }
}
```

Swagger UI: Open `{env}/platform/swagger-ui/index.html?apiType=Reserved&urls.primaryName=Automation+Reserved` → expression-preview section. See [Automation Reserved Spec](../assets/workflow_api_reserved_spec.yaml).

## Common Patterns

### Safe Event Field Access

```yaml
# Preferred: get() with default
input:
  cluster: "{{ event().get('k8s.cluster.name', 'unknown') }}"

# Inline conditional
input:
  cluster: "{{ event()['k8s.cluster.name'] if 'k8s.cluster.name' in event() else 'unknown' }}"
```

### Conditional Task Execution

```yaml
conditions:
  custom: "{{ result('query_data').records | length > 0 }}"
  states:
    query_data: OK
```

### Dynamic DQL Filters

```yaml
input:
  query: |
    fetch logs, from: now()-{{ input().get('timerange', '1h') }}
    | filter {% if event().get('host') %}host.name == "{{ event().get('host', '') }}"{% else %}true{% endif %}
    | limit {{ input().get('limit', 100) }}
```

### Format Timestamps

```yaml
input:
  date: "{{ now().strftime('%Y-%m-%d') }}"
  time: "{{ now('Europe/Vienna').strftime('%H:%M:%S') }}"
  iso: "{{ now().strftime('%Y-%m-%dT%H:%M:%SZ') }}"
```

## Pitfalls

| Issue | Wrong | Correct |
|-------|-------|---------|
| Dot in attribute name | `{{ event().event.id }}` | `{{ event().get('event.id', '') }}` |
| Missing quotes in YAML | `filter: {{ x }}` | `filter: "{{ x }}"` |
| Undefined variable | `{{ event().missing }}` | `{{ event().get('missing', '') }}` |
| JSON in Jinja | `{{ {"a": 1} }}` | `{{ {'a': 1} \| tojson }}` |
| Path in result() | `{{ result('task.records[0]') }}` | `{{ result('task').records[0] }}` |

**General rule:** Always prefer `get()` with a default value and single quotes around keys containing dots.

## Related References

- [Workflow Schema](./workflow-schema.md) — Complete field reference
- [Actions Reference](./actions.md) — Available workflow actions
- [dtctl Commands](./dtctl-workflows.md) — Deploy and test workflows
