# CI/CD Integration Patterns

How to integrate Dynatrace quality gates into your CI/CD pipeline using
Dynatrace Workflows as the bridge between your pipeline and the Site
Reliability Guardian.

## Architecture

```
CI/CD Pipeline
  │
  ├── 1. Deploy service
  ├── 2. Wait for traffic (warm-up)
  ├── 3. Trigger Dynatrace Workflow → runs Guardian validation
  ├── 4. Poll for result
  └── 5. Pass/Fail pipeline based on result
```

The pipeline does NOT call the guardian directly. It triggers a **Dynatrace
Workflow** that contains the guardian validation action. This gives you:

- Audit trail in Dynatrace
- Workflow-level error handling
- Variable injection from the pipeline
- Result storage as Grail events

## Setting Up the Workflow

### 1. Create a Workflow in Dynatrace

1. Go to **Workflows** in Dynatrace
2. Create a new workflow: e.g., "Deploy Quality Gate"
3. Add trigger: **Event trigger** or **Manual trigger**
4. Add action: **Site Reliability Guardian — Validate**
5. Configure:
   - Guardian: select your guardian by name or ID
   - Timeframe: `now()-15m` to `now()` (adjust to your warm-up period)
   - Variables: pass `service_id` and any other overrides

### 2. Configure Event Trigger

Choose the event type that matches your pipeline instrumentation:

#### Option A: SDLC Event Trigger (Recommended)

Use SDLC events for structured, standardized integration. The Workflow listens
for `deployment finished` SDLC events:

- **Event source type**: `events` (not `bizevents`)
- **Filter**: `event.kind == "SDLC_EVENT" AND event.type == "deployment" AND event.status == "finished"`
- Optionally narrow by stage: `AND cicd.deployment.release_stage == "staging"`

Pass Guardian variables from the incoming SDLC event fields. Variable names
must match the Guardian definition exactly:

| Guardian variable | Workflow expression | Source |
|---|---|---|
| `deployment_name` | `{{event()['cicd.deployment.name']}}` | Service name |
| `service_id` | `{{event()['cicd.deployment.service.id']}}` | Service entity ID |
| `commit_revision` | `{{event()['vcs.ref.base.revision']}}` | Git commit |
| `version` | `{{event()['event.version']}}` | Artifact version |

**Sending SDLC events from CI/CD:**
Dynatrace provides integrations for GitHub Actions, GitLab, Azure DevOps,
and Argo CD that handle event formatting and authentication automatically.
For other tools, send a `POST` to the SDLC events ingest endpoint using an
access token with the `openpipeline.events_sdlc` scope.

**Key SDLC event fields:**

The correct SDLC event fields are described in Dynatrace's semantic dictionary — see the
[SDLC events semantic dictionary](https://docs.dynatrace.com/docs/shortlink/semantic-dictionary-software-development-lifecycle-sdlc-events) and look for the
[`deployment finished task event`](https://docs.dynatrace.com/docs/shortlink/semantic-dictionary-software-development-lifecycle-sdlc-events#sdlc-deployment-finished-task-event).

#### Option B: Custom Deployment Event Trigger

Use a custom deployment event when SDLC event instrumentation is not available:

**Deployment event to send from CI/CD:**

```json
{
  "eventType": "CUSTOM_DEPLOYMENT",
  "title": "Deployment of payment-service v2.3.1",
  "entitySelector": "type(SERVICE),entityId(SERVICE-ABC123)",
  "properties": {
    "deployment.version": "2.3.1",
    "deployment.environment": "production",
    "deployment.pipeline": "jenkins-main"
  }
}
```

The workflow triggers when it sees this event, waits for the warm-up window,
then runs the guardian.

## Pipeline Integration Patterns

### Pattern 1: Event-Driven (Recommended)

Best for: production deployments where you want the quality gate to run
automatically after deploy.

```
Pipeline:
  1. Deploy
  2. Send deployment event to Dynatrace (SDLC or custom)
  3. Continue (or wait and poll)

Dynatrace:
  1. Workflow triggers on deployment event
  2. Waits configured delay (e.g., 5 minutes)
  3. Runs guardian validation
  4. Stores result as SDLC event (stored in Grail)
  5. (Optional) Sends notification back to pipeline
```

### Pattern 2: API-Triggered (Synchronous)

Best for: staging/pre-prod gates where the pipeline needs to wait for the
result before proceeding, or when no event instrumentation is in place.

```
Pipeline:
  1. Deploy
  2. Wait for warm-up (2-5 minutes)
  3. Call Dynatrace Workflow Execution API
  4. Poll execution status until complete
  5. Read guardian result from workflow output
  6. Pass/Fail pipeline
```

### Pattern 3: Polling with Timeout

Best for: environments where webhook callbacks are not available.

```
Pipeline:
  1. Deploy
  2. Trigger workflow
  3. Poll every 30 seconds for result
  4. Timeout after 10 minutes
  5. On timeout → treat as WARNING or FAIL
  6. On result → use overall_status to gate
```

## Querying Validation Results

After a validation run, the Guardian emits a `validation finished` SDLC event.
Use this DQL query to retrieve results:

```dql
fetch events
| filter event.kind == "SDLC_EVENT"
| filter event.provider == "dynatrace.site.reliability.guardian"
| filter event.type == "validation"
| filter event.status == "finished"
| fields timestamp,
    validation.result,
    version = event.version,
    guardian_name = dt.srg.name,
    guardian_id = dt.srg.id,
    objective_results = dt.srg.summary,
    workflow_id = dt.automation_engine.workflow.id
```

Filter by guardian tag to scope to a specific service:
`| filter in("payment-api", dt.srg.tags)`

For individual objective-level results, change the filter to
`event.type == "validation.objective"`.

## Interpreting Results in Your Pipeline

Map guardian results to pipeline actions:

| Guardian Status | Pipeline Action |
|----------------|-----------------|
| `PASSED` | Continue to next stage |
| `WARNING` | Continue but create review ticket |
| `FAILED` | Stop pipeline, notify team |
| `ERROR` | Stop pipeline, check guardian config |

### Validation Result Fields

| Field | Description |
|-------|-------------|
| `guardian_name` | Name of the guardian that ran |
| `overall_status` | PASSED / WARNING / FAILED / ERROR |
| `validation_url` | Link to detailed results in Dynatrace UI |
| `validation_details` | Per-objective results (name, status, value, target) |

## Per-Environment Configuration

Use guardian variables to run the same guardian across environments:

| Environment | `service_id` | Thresholds |
|-------------|-------------|------------|
| Dev | SERVICE-DEV-123 | Relaxed (auto-adaptive) |
| Staging | SERVICE-STG-456 | Moderate (static, wider range) |
| Production | SERVICE-PRD-789 | Strict (static, tight targets) |

Override variables when triggering the workflow from your pipeline.

## Best Practices

### Start Simple
- Begin with 2-3 objectives: error rate, p90 latency, problem count
- Use auto-adaptive thresholds until you understand your baselines
- Run in "observe" mode first (don't block the pipeline until you trust the gate)

### Build Confidence
- Monitor false positives (gate fails but deploy is fine) → tune thresholds
- Monitor false negatives (gate passes but deploy is bad) → add objectives
- Review validation history monthly → adjust targets

### Scale Gradually
- Start with one service in staging
- Promote to production after 2 weeks of reliable results
- Add more services and more objectives over time
- Eventually adopt baseline collection and full evidence gates

## Troubleshooting CI/CD Integration

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Workflow doesn't trigger | Event type mismatch | Verify event filter matches |
| Validation returns all PASS on broken deploy | Wrong timeframe or too early | Increase warm-up wait |
| Timeout waiting for result | Workflow taking too long | Increase poll timeout |
| Variables not substituted | Wrong variable name | Check `$var` matches guardian definition |
| Rate limit errors (429) | Too many concurrent objectives | Reduce objective count or add delays |
