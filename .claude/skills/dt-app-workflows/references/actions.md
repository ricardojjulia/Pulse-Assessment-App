# Actions Reference

Workflow actions execute specific operations. This reference covers **core actions** and the **discovery pattern** for all available actions.

## Action Identifier Format

```
<app-id>:<action-name>
```

Must match pattern `^.+:.+$`. Examples:
- `dynatrace.automations:execute-dql-query`
- `dynatrace.automations:run-javascript`
- `dynatrace.automations:http-function`

## Core Actions

### execute-dql-query

Execute DQL queries against Dynatrace Grail data.

**Action ID:** `dynatrace.automations:execute-dql-query`

```yaml
tasks:
  query_logs:
    action: dynatrace.automations:execute-dql-query
    description: "Fetch recent error logs"
    input:
      query: |
        fetch logs
        | filter loglevel == "ERROR"
        | sort timestamp desc
        | limit 100
    position:
      x: 0
      "y": 1
```

**Input Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | DQL query (consult dt-dql-essentials skill) |

**Result Structure:**

```json
{
  "records": [
    {"field1": "value1", "field2": "value2"}
  ],
  "types": [
    {"name": "field1", "type": {"type": "string"}}
  ],
  "metadata": {}
}
```

**Access Results in Successor Tasks:**

```yaml
input:
  count: "{{ result('query_logs').records | length }}"
  first: "{{ result('query_logs').records[0] }}"
```

**With Dynamic Jinja Filters:**

```yaml
input:
  query: |
    fetch logs
    | filter {% if event().get('host') %}host.name == "{{ event().get('host', '') }}"{% else %}true{% endif %}
    | filter loglevel == "{{ input().get('level', 'ERROR') }}"
    | limit {{ input().get('limit', 100) }}
```

**Reference:** [dt-dql-essentials skill] for DQL syntax.

### run-javascript

Execute JavaScript code with access to workflow context and Dynatrace SDKs.

**Action ID:** `dynatrace.automations:run-javascript`

```yaml
tasks:
  transform_data:
    action: dynatrace.automations:run-javascript
    description: "Transform query results"
    input:
      script: |
        import { execution } from '@dynatrace-sdk/automation-utils';

        export default async function() {
          const ex = await execution();
          const result = await ex.result('query_logs');
          const transformed = result.records.map(r => ({
            timestamp: r.timestamp,
            message: r.content,
            severity: r.loglevel
          }));
          return { data: transformed, count: transformed.length };
        }
    position:
      x: 0
      "y": 2
    predecessors:
      - query_logs
```

**Available Imports:**

```javascript
// Core execution context
import { execution } from '@dynatrace-sdk/automation-utils';

// Dynatrace client SDK
import { monitoredEntitiesClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import { automationClient } from '@dynatrace-sdk/client-automation';

// HTTP client
import { httpClient } from '@dynatrace-sdk/http-client';
```

**Execution Context API:**

```javascript
const ex = await execution();

// Get predecessor result
const queryResult = await ex.result('task_name');

// Get workflow input
const params = await ex.params();
const env = params.environment ?? 'production';

// Get event (if triggered by event)
const event = await ex.event();
```

**Return values:**
- Return an object to pass data to successors
- Return primitives (string, number, boolean) directly
- Throw errors to fail the task

**Error Handling:**

```javascript
export default async function() {
  try {
    const result = await riskyOperation();
    return { success: true, data: result };
  } catch (error) {
    console.error('Operation failed:', error.message);
    // Option 1: Return error state (task succeeds, downstream handles)
    return { success: false, error: error.message };
    // Option 2: Throw to fail task (use conditions in downstream)
    // throw new Error(`Failed: ${error.message}`);
  }
}
```

### http-function

Make HTTP requests to external services.

**Action ID:** `dynatrace.automations:http-function`

```yaml
tasks:
  call_api:
    action: dynatrace.automations:http-function
    description: "Call external API"
    input:
      method: POST
      url: "https://api.example.com/webhook"
      headers:
        Content-Type: "application/json"
        Authorization: "Bearer {{ connection('app:dynatrace.vault:connection', 'api-token').token }}"
      body: |
        {
          "event": {{ event() | tojson }},
          "workflow_id": "{{ execution().workflow.id }}"
        }
    position:
      x: 0
      "y": 1
```

**Input Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | GET, POST, PUT, DELETE, PATCH |
| `url` | string | Yes | Target URL |
| `headers` | object | No | Request headers |
| `body` | string | No | Request body (for POST/PUT/PATCH) |
| `timeout` | number | No | Timeout in seconds |

**Result Structure:**

```json
{
  "statusCode": 200,
  "headers": {},
  "body": "..."
}
```

## Action Discovery

### Programmatic Discovery

**AppEngine Registry API (primary method):**

List all actions installed on a tenant:
```
GET https://{env}.apps.dynatrace.com/platform/app-engine/registry/v1/apps:search-actions
```
OAuth scope: `app-engine:apps:run`

SDK:
```javascript
import { appEngineRegistryAppsClient } from '@dynatrace-sdk/client-app-engine-registry';
const result = await appEngineRegistryAppsClient.searchActions();
```

Get full manifest with action schemas:
```
GET /platform/app-engine/registry/v1/apps/dynatrace.automations?addFields=manifest
```

**Sample result assets:**

Some actions ship `src/assets/<action-name>.sample-result.json`. Fetch:
```
GET https://{env}.apps.dynatrace.com/<app-id>/assets/<action-name>.sample-result.json
```

### Manual / UI Discovery

1. **Workflows app** → Edit workflow → **+ Add task** → action picker
2. **Dynatrace Hub** → browse connectors and actions per app
3. **Public docs:** https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/actions

### Common Apps with Actions

| App | Example Actions |
|-----|-----------------|
| `dynatrace.automations` | execute-dql-query, run-javascript, http-function |
| `dynatrace.slack` | send-message, update-message |
| `dynatrace.jira` | create-issue, update-issue, add-comment |
| `dynatrace.servicenow` | snow-create-incident, snow-update-incident |
| `dynatrace.davis.copilot.workflow.actions` | davis-copilot |
| `dynatrace.ownership` | get-ownership |

### Use Unknown Actions

1. Check action docs in Workflows app UI → action catalog
2. Copy from a working example: `dtctl get workflow <id> -o yaml --plain > reference.yaml`
3. Test incrementally: `dtctl apply -f test.yaml --dry-run` → `dtctl apply` → `dtctl exec workflow <id> --wait`

## Task Configuration Patterns

### Task with Predecessors and Conditions

```yaml
tasks:
  step_2:
    action: dynatrace.automations:run-javascript
    predecessors:
      - step_1
    conditions:
      states:
        step_1: OK
      else: SKIP
    position:
      x: 0
      "y": 2
    input:
      script: |
        import { execution } from '@dynatrace-sdk/automation-utils';
        export default async function() {
          const ex = await execution();
          const prev = await ex.result('step_1');
          return { count: prev.records?.length ?? 0 };
        }
```

### WithItems (Loop)

```yaml
tasks:
  process_each:
    action: dynatrace.automations:http-function
    withItems: "{{ result('get_items').records }}"
    concurrency: 5
    input:
      url: "https://api.example.com/item/{{ _.id }}"
      method: GET
    position:
      x: 0
      "y": 2
    predecessors:
      - get_items
```

Access current item with `{{ _ }}` or `{{ _.field }}`.

### Retry

```yaml
retry:
  count: 3       # 0–99
  delay: 30      # 0–3600 seconds
  failedLoopIterationsOnly: true
```

### Error Handling via Conditions

```yaml
tasks:
  handle_error:
    action: dynatrace.automations:run-javascript
    predecessors:
      - risky_task
    conditions:
      states:
        risky_task: ERROR
    input:
      script: |
        import { execution } from '@dynatrace-sdk/automation-utils';
        export default async function() {
          const ex = await execution();
          return { handled: true, note: "risky_task failed" };
        }
    position:
      x: 1
      "y": 3
```

## Related References

- [Workflow Schema](./workflow-schema.md) — Complete field reference
- [Jinja Expressions](./jinja-expressions.md) — Dynamic inputs
- [dtctl Commands](./dtctl-workflows.md) — Deploy and test
