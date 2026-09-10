# Triggers Reference

Reference for workflow trigger configuration. All constraints sourced from the official Automation API OpenAPI spec.

## Trigger Types Overview

| Trigger Type | Use Case | Key |
|--------------|----------|-----|
| Manual | On-demand execution only | `trigger: {}` |
| Cron | Complex recurring schedules | `schedule.trigger.type: cron` |
| Interval | Fixed-frequency execution | `schedule.trigger.type: interval` |
| Time | Daily at specific time | `schedule.trigger.type: time` |
| Once | Single scheduled execution | `schedule.trigger.type: once` |
| Davis Event | React to Davis events | `eventTrigger.triggerConfiguration.type: davis-event` |
| Davis Problem | React to problems | `eventTrigger.triggerConfiguration.type: davis-problem` |
| Custom Event | DQL matcher-based event matching | `eventTrigger.triggerConfiguration.type: event` |

## Manual Trigger

```yaml
trigger: {}
```

Workflow executes only via UI "Run" button, `dtctl exec workflow <id>`, API call, or another workflow.

## Schedule Triggers

**Important:** `timezone` is a property of the `schedule` object, not the inner `trigger`.

### Cron Trigger

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: cron
      cron: "0 9 * * 1-5"
```

**Cron Format:** `minute hour day-of-month month day-of-week`

| Field | Values | Special |
|-------|--------|---------|
| Minute | 0-59 | `*` any, `,` list, `-` range, `/` step |
| Hour | 0-23 | |
| Day of Month | 1-31 | |
| Month | 1-12 | |
| Day of Week | 0-6 (0=Sun) or 1-7 (1=Mon) | |

**Common Cron Examples:**

| Schedule | Cron Expression |
|----------|-----------------|
| Every hour | `0 * * * *` |
| Daily at midnight | `0 0 * * *` |
| Weekdays at 9 AM | `0 9 * * 1-5` |
| Every 15 minutes | `*/15 * * * *` |
| First day of month | `0 0 1 * *` |
| Every Monday at 8:30 | `30 8 * * 1` |

### Interval Trigger

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "UTC"
    trigger:
      type: interval
      intervalMinutes: 30
```

**intervalMinutes range:** 1–720 (max 12 hours per spec)

Optional time window restriction:

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: interval
      intervalMinutes: 60
      betweenStart: "08:00"    # HH:MM
      betweenEnd: "18:00"      # HH:MM
```

### Time Trigger

Execute at a specific time every day.

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "America/New_York"
    trigger:
      type: time
      time: "09:00"              # HH:MM format (pattern: ^([0-1]\d|2[0-3]):[0-5]\d$)
```

### Once Trigger

Single execution at a specific datetime.

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "UTC"
    trigger:
      type: once
      at: "2025-12-31T23:59:59"  # ISO 8601 WITHOUT timezone suffix
```

**Note:** The field is `at` (not `dateTime`). Timezone is set on the `schedule` object.

### Schedule with Filter Parameters

```yaml
trigger:
  schedule:
    isActive: true
    timezone: "Europe/Vienna"
    trigger:
      type: cron
      cron: "0 9 * * 1-5"
    filterParameters:
      businessCalendar: "854a3452-a6d3-45bd-83e1-e8afa56eabcd"
      count: 10
      earliestStartTime: "08:00"
```

## Event Triggers

### Davis Event Trigger

React to any Davis event with DQL matcher filtering.

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
          AND dt.openpipeline.source != "classic_rest_api"
        onProblemClose: false
        maintenanceWindowTriggerBehavior: always
```

**Filter by Entity Tags:**

```yaml
value:
  entityTags:
    environment: ["production", "staging"]
    team: ["platform"]
  entityTagsMatch: all
```

**Filter by Event Names:**

```yaml
value:
  names:
    - match: equals     # equals or contains
      name: "CUSTOM_ALERT"
  entityTags: {}
  entityTagsMatch: null
  onProblemClose: false
  maintenanceWindowTriggerBehavior: always
```

**Common customFilter Patterns:**

```text
# New Kubernetes events only
event.status_transition == "CREATED" AND event.provider == "KUBERNETES_ANOMALY_DETECTION"

# Specific namespace
event.status_transition == "CREATED" AND k8s.namespace.name == "production"

# Exclude specific sources
event.provider != "CUSTOM_DEPLOYMENT" AND dt.openpipeline.source != "classic_rest_api"

# Multiple event types
event.type == "AVAILABILITY_EVENT" OR event.type == "ERROR_EVENT"
```

### Davis Problem Trigger

All 7 official problem categories:

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
        maintenanceWindowTriggerBehavior: always
```

**Davis-problem-specific fields:**
- `analysisReady` (boolean, default false) — wait for first root cause analysis before triggering
- `severityThreshold` (integer 1–5, nullable) — only trigger at this severity or more severe (1 = critical, 5 = informational)

### Custom Event Trigger (DQL Matcher)

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

**CRITICAL:** The `query` field uses **DQL matcher expressions**, NOT full DQL syntax. Do NOT use `fetch`, `|` (pipe), or DQL commands. Max length: 1000 characters.

**eventType values (from spec):** `events`, `bizevents`, `dt.system.events`, `security.events`

**Deduplication:**

```yaml
value:
  query: event.provider == "myapp" AND event.kind == "ORDER_CREATED"
  eventType: bizevents
  uniqueExpression: "{{ event()['order.id'] }}"
  lane: default
```

References:
- [Event triggers for workflows](https://docs.dynatrace.com/docs/analyze-explore-automate/workflows/trigger/event-trigger)
- [DQL matcher expression](https://docs.dynatrace.com/docs/observe/business-observability/bo-event-processing/bo-events-processing-matcher)

## Trigger Behavior Options

### Maintenance Window Behavior

| Value | Behavior |
|-------|----------|
| `always` | Trigger regardless of maintenance windows |
| `paused_while_in_window` | Skip triggers during maintenance |

### On Problem Close

When `onProblemClose: true`, the workflow triggers on both problem open and close. Use `{{ event().get('event.status_transition') }}` to detect which.

## Accessing Trigger Data in Tasks

### Schedule Trigger

```yaml
input:
  scheduled_at: "{{ execution().trigger.scheduledExecutionTime }}"
```

### Event Trigger

```yaml
input:
  event_type: "{{ event().get('event.type', '') }}"
  event_id: "{{ event().get('event.id', '') }}"
  cluster: "{{ event().get('k8s.cluster.name', 'unknown') }}"
```

## Trigger Validation

```bash
# Local validation
node scripts/validate_workflow.js workflow.yaml --strict

# API validation
dtctl apply -f workflow.yaml --dry-run
```

## Related References

- [Workflow Schema](./workflow-schema.md) — Complete schema reference
- [Jinja Expressions](./jinja-expressions.md) — Dynamic trigger conditions
- [dtctl Commands](./dtctl-workflows.md) — Deploy and test workflows
