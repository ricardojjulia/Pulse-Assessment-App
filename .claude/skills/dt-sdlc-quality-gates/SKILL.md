---
name: dt-sdlc-quality-gates
description: Set up and use Dynatrace Site Reliability Guardian quality gates to validate deployments automatically. Create guardians with DQL objectives, configure thresholds, integrate with CI/CD pipelines via Dynatrace Workflows, and interpret validation results — the practical first step for evidence-based delivery.
license: Apache-2.0
---

# Quality Gates with Site Reliability Guardian

Set up automated quality gates that validate deployments using Dynatrace
runtime data. Site Reliability Guardian (SRG) evaluates DQL-based objectives
against configurable thresholds and produces PASS/FAIL verdicts.

This is the recommended starting point for teams adopting evidence-based
delivery with Dynatrace.

## When to Use This Skill

- Setting up your first quality gate for a deployment pipeline
- Creating guardian objectives that validate service health after deploy
- Integrating Dynatrace quality gates into Jenkins, GitHub Actions, or other CI/CD
- Understanding validation results and acting on them
- Moving from manual post-deploy checks to automated evidence-based gates

## Why Start Here

Most teams don't need the full delivery lifecycle on day one. Start with a
single quality gate that runs after your deployment. Once that works, you can
expand to baselines, observability design, and multi-phase gates.

**Progression path:**
1. **Quality gate after deploy** (this skill) — validate service health automatically
2. **Baseline collection** — know your normal before deploying
3. **Observability design** — plan instrumentation before implementation
4. **Full evidence gates** — multi-phase gates across the lifecycle

## Core Concepts

### What Is a Guardian?

A guardian is a collection of objectives (DQL queries with thresholds) that
evaluate whether a service meets defined criteria. When triggered, the guardian
runs all objectives and produces a validation result.

### Guardian Structure

```
Guardian
├── Name and description
├── Tags (for organization)
├── Variables (parameterized DQL)
└── Objectives (1-50)
    ├── DQL Objective (query + threshold)
    └── SLO Reference (existing SLO)
```

### Objective Types

| Type | What It Does | When to Use |
|------|-------------|-------------|
| **DQL Objective** | Runs a DQL query, compares result to threshold | Custom checks — error rates, latency, counts |
| **SLO Reference** | Checks an existing SLO's status | When SLOs already exist for the service |

### Threshold Types

| Type | Behavior | When to Use |
|------|----------|-------------|
| **Static** | Fixed target and warning values you define | Known acceptable ranges |
| **Auto-adaptive** | DAVIS analyzes 30-day history to set thresholds | When you want baselines without manual tuning |
| **Info** | No threshold — just report the value | Monitoring without gating |

### Comparison Operators

- `GREATER_THAN_OR_EQUAL` — value must be ≥ target (e.g., availability ≥ 99.9%)
- `LESS_THAN_OR_EQUAL` — value must be ≤ target (e.g., error rate ≤ 0.1%)

## Setting Up Your First Guardian

### Guardian Types

Use a **Lifecycle Guardian** for deployment validation — it is the type designed
for CI/CD quality gates and SDLC event integration. Business Guardians serve a
different purpose (SLO-based business health monitoring).

When creating a Lifecycle Guardian, Dynatrace provides predefined templates.
**Four Golden Signals** is a good starting point — it covers latency, traffic,
errors, and saturation out of the box and can be customized after creation.

### Step 1: Identify What to Check

Start with the most important signals for your service:

| Signal | DQL Pattern | Comparison |
|--------|------------|------------|
| Error rate | Count errors / total requests | LESS_THAN_OR_EQUAL |
| Response time (p90) | Percentile of request duration | LESS_THAN_OR_EQUAL |
| Availability | Successful requests / total | GREATER_THAN_OR_EQUAL |
| Throughput | Request count (not dropping) | GREATER_THAN_OR_EQUAL |

### Step 2: Write DQL Objectives

**Error rate objective:**

```dql
timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd errorRate = arraySum(failures) * 100.0 / arraySum(requests)
```

- Comparison: `LESS_THAN_OR_EQUAL`
- Target: `1.0` (1% error rate)
- Warning: `0.5`

**Response time objective (p90):**

```dql
timeseries p90 = percentile(dt.service.request.response_time, 90),
  filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd p90_us = arrayAvg(p90)
```

- Comparison: `LESS_THAN_OR_EQUAL`
- Target: `500000` (500ms in microseconds)
- Warning: `300000` (300ms)

**Availability objective:**

```dql
timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd
    availability = (arraySum(requests) - arraySum(failures)) * 100.0 / arraySum(requests)
```

- Comparison: `GREATER_THAN_OR_EQUAL`
- Target: `99.9`
- Warning: `99.5`

**Log error count objective:**

```dql
fetch logs
| filter dt.smartscape.service == toSmartscapeId("$service_id")
  AND loglevel == "ERROR"
| summarize errorCount = count()
```

- Comparison: `LESS_THAN_OR_EQUAL`
- Target: `10`
- Warning: `5`

### Step 3: Use Variables for Reusability

Define `$service_id` as a guardian variable. This lets you reuse the same
guardian for multiple services by overriding variables at validation time.

### Step 4: Choose Thresholds

For your first guardian, use **static thresholds** based on what you know:

- Check current metrics to understand your normal
- Set warned at a level slightly above normal
- Set target at a level that would indicate a real problem

If you don't know your normal, use **auto-adaptive thresholds** — DAVIS will
analyze the last 30 days and set appropriate values.

## Triggering Validations

### From Dynatrace Workflows

Create a workflow that connects deployment signals to the Guardian:

1. **Trigger**: API call, SDLC event, or custom deployment event (see below)
2. **Action**: Site Reliability Guardian — Validate
3. **Input**: Guardian ID or name, timeframe, optional variable overrides

The validation action accepts:

| Parameter | Description |
|-----------|-------------|
| `objectId` | Guardian ID or name |
| `timeframeSelector` / `expressionFrom` + `expressionTo` | Time window to evaluate |
| `variables` | Override DQL variables (e.g., service_id for environment) |

### From CI/CD Pipelines

The pipeline does not call the Guardian directly — it triggers a Dynatrace
Workflow, which runs the Guardian validation. Three integration options are
available:

**Option 1 — Direct API call (most generic):**
Call the Dynatrace Workflows Execution API from your pipeline to trigger the
workflow, then poll for completion and read the result. Works with any CI/CD
tool and requires no event instrumentation.

**Option 2 — SDLC events (recommended for structured integration):**
Your pipeline sends a standardized `deployment finished` SDLC event
(`event.kind == "SDLC_EVENT"`). The Workflow triggers on this event and passes
deployment metadata (service name, commit, version) into the Guardian as
variables. Requires an access token with the `openpipeline.events_sdlc` scope.
Dynatrace provides native integrations for GitHub Actions, GitLab, Azure DevOps,
and Argo CD that handle authentication and event formatting automatically.

**Option 3 — Custom deployment events:**
Send a `CUSTOM_DEPLOYMENT` event to trigger the Workflow. Simpler than SDLC
events but carries less structured metadata.

**General pipeline flow:**
1. Deploy your service
2. Wait for traffic (2-5 minutes depending on service)
3. Trigger workflow (via API call or deployment event)
4. Poll for workflow completion
5. Check guardian result — `PASSED` continues the pipeline, `FAILED` stops it
   (see [Interpreting Results](#interpreting-results) below for `WARNING` and `ERROR` handling)

### Querying Validation Results

After validation, the Guardian emits a `validation finished` SDLC event.
Query it using `event.provider == "dynatrace.site.reliability.guardian"`,
`event.kind == "SDLC_EVENT"`, `event.type == "validation"`, and
`event.status == "finished"`. Key result fields include `dt.srg.name`,
`dt.srg.id`, `dt.srg.summary`, and `validation.result`.

See [CI/CD Integration Patterns](references/cicd-integration-patterns.md) for
the full DQL query and per-objective filtering.

### Interpreting Results

| Overall Status | Meaning | Pipeline Action |
|---------------|---------|-----------------|
| **PASSED** | All objectives met targets | Continue deployment |
| **WARNING** | Some objectives in warning range | Continue with review |
| **FAILED** | One or more objectives failed | Stop and investigate |
| **ERROR** | Query execution failed | Investigate guardian config |

## Common Objective Patterns

### Post-Deploy Health Check

```dql
timeseries {
  p90 = percentile(dt.service.request.response_time, 90),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("$service_id") }
| fieldsAdd
    p90_us = arrayAvg(p90),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests),
    requestCount = arraySum(requests)
```

### Deployment Event Correlation

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND timestamp > now() - 30m
| expand affected_entity_ids
| filter affected_entity_ids == "$service_id"
| summarize problemCount = count()
```

### Dependency Error Check

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("$service_id")
| summarize
    depErrorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { peer.service }
| filter depErrorRate > 5.0
| summarize failingDeps = count()
```

### Resource Saturation

```dql
timeseries {
  cpuP95 = percentile(dt.host.cpu.usage, 95, rollup: avg)
},
from: now()-2h,
filter: { host.name == "$host_name" }
```

## Expanding Beyond Quality Gates

Once your quality gate works reliably, expand:

| Next Step | What It Adds | Capability to Load |
|-----------|-------------|--------------------|
| Collect baselines before deploy | Know your normal, detect regression | A skill for observability-first design |
| Map blast radius | Understand what a change can break | A skill for dependency and blast-radius analysis |
| Run design gates before implementation | Validate understanding before coding | A skill for evidence-based delivery gates |
| Full production readiness review | 5-dimension assessment with verdicts | A skill for production-readiness assessment |

## Query Hygiene

Before executing any DQL objective in a guardian or as a standalone check:

```dtctl
# Validate syntax before execution — no auth cost, catches errors immediately
dtctl verify query "fetch spans | filter span.kind == \"server\" | ..."

# Wait for telemetry evidence during rollout (pipeline-safe)
dtctl wait query "fetch spans | filter dt.smartscape.service == \"SERVICE-<id>\" AND timestamp > now()-5m" \
  --for=any --timeout 3m
```

Use short windows (`now()-30m`) for immediate post-deploy checks and wider
windows (`now()-24h`) for baseline comparisons.

## Detailed Procedures

- [Guardian Setup Guide](references/guardian-setup-guide.md) — Step-by-step guardian creation with examples
- [CI/CD Integration Patterns](references/cicd-integration-patterns.md) — SDLC event integration, custom deployment events, API-triggered patterns, and querying validation results

## Related Capabilities

- Load a skill for evidence-based delivery gates when you need multi-phase
  verdicts beyond a single post-deploy guardian run.
- Load a skill for observability-first design when you need baselines,
  verification queries, and blast-radius mapping before implementation.
- Load a skill for production-readiness assessment when a change needs a broader
  operational go/no-go decision.
- Load a skill for DQL query authoring when you need help composing or debugging
  guardian objectives.
