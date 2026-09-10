---
name: dt-platform
description: "Dynatrace platform operations telemetry — audit trail (API calls, settings changes, authentication), query analytics (DQL execution performance, failure rates, scan volumes), workflow automation (execution tracking, error rates, action performance), GenAI/CoPilot usage (skill invocations, MCP tools, feedback), anomaly detector health, and data management events using dt.system.events."
license: Apache-2.0
---

# dt-platform

Query and analyze Dynatrace platform operations telemetry using DQL. All data
lives in `dt.system.events`, segmented by `event.kind`:

| event.kind | Coverage |
|------------|----------|
| `AUDIT_EVENT` | API calls, auth events, settings changes |
| `QUERY_EXECUTION_EVENT` | DQL query performance, scan volumes, failures |
| `WORKFLOW_EVENT` | Workflow/task/action execution, errors |
| `GENAI_EVENT` | CoPilot skills, MCP tools, user feedback |
| `ANALYZER_EXECUTION_EVENT` | Davis anomaly detector runs |
| `ANOMALY_DETECTOR_STATUS_EVENT` | Detector health status changes |
| `ENRICHMENT_EXECUTION_EVENT` | Security intelligence enrichment |
| `EXTENSIONS_EVENT` | Extensions 2.0 self-monitoring (SFM) |
| `DATA_ACQUISITION_EVENT` | Cloud data acquisition status |

For billing, usage, and cost analysis (`BILLING_USAGE_EVENT`), load
`dt-platform-costs` instead.

## When to Use This Skill

- **Security & Compliance** — API audit trail, authentication monitoring, settings change tracking, token vs. OAuth analysis
- **Query Performance** — DQL failure analysis, slow queries, scan volume by table/pool/user, dashboard query performance
- **Automation Health** — Workflow success/failure rates, slowest workflows, lifecycle tracking, sub-workflow and throttling detection
- **AI Usage** — CoPilot skill invocations, MCP tool usage, user adoption, feedback sentiment
- **Platform Health** — Anomaly detector failures, data enrichment, cloud data acquisition, extension self-monitoring

## Agent Instructions

### Intent Mapping

| User Request | Action | Reference |
|---|---|---|
| "who called this API", "audit trail", "settings changes" | Audit event query | audit-events.md |
| "slow queries", "query failures", "query performance" | Query analytics | query-analytics.md |
| "expensive queries", "scan volume by pool" | Query scan analysis | query-analytics.md |
| "workflow errors", "failed automations" | Workflow execution | automation-events.md |
| "CoPilot usage", "AI adoption", "Dynatrace Assist" | GenAI events | genai-events.md |
| "detector failures", "anomaly detection health" | Analyzer events | anomaly-detector-events.md |
| "enrichment failures", "cloud data issues", "data management" | Data management events | data-management-events.md |
| "extension errors", "extension health", "SFM", "polling failures" | Extension self-monitoring | extensions-events.md |

> **Cost-related queries** — If the user asks about query scan *costs*, detector
> *costs*, workflow *costs*, or billing/usage, load `dt-platform-costs` instead.
> This skill covers operational health and performance, not cost attribution.

## Prerequisites

- Access to a Dynatrace environment
- DQL query permissions on `dt.system.events`
- Load `dt-dql-essentials` before writing queries — covers DQL syntax, type
  handling, and field discovery via `dt.semantic_dictionary.fields`

## Knowledge Base Structure

| # | Reference | Content |
|---|-----------|---------|
| 1 | [query-analytics.md](references/query-analytics.md) | DQL execution telemetry, scan volumes, failure rates, table/pool/user analysis |
| 2 | [audit-events.md](references/audit-events.md) | API audit trail, auth events, settings changes, provider/type catalog |
| 3 | [automation-events.md](references/automation-events.md) | Workflow/task/action execution, error rates, lifecycle events |
| 4 | [genai-events.md](references/genai-events.md) | CoPilot skills, MCP tools, user feedback analysis |
| 5 | [anomaly-detector-events.md](references/anomaly-detector-events.md) | Davis analyzer execution, detector status events |
| 6 | [data-management-events.md](references/data-management-events.md) | Security enrichment, cloud data acquisition events |
| 7 | [extensions-events.md](references/extensions-events.md) | Extensions 2.0 self-monitoring (SFM), connection errors, polling health |

## Key Concepts

### Data Source

All platform operational data lives in `dt.system.events`. Filter by
`event.kind` to isolate specific event types. See the
[Platform Event Kind Overview](#platform-event-kind-overview) query below.

## Quick Start Workflows

### Platform Event Kind Overview

```dql
fetch dt.system.events, from: -7d
| summarize event_count = count(), by: {event.kind}
| sort event_count desc
```

### Recent Failed API Calls

```dql
fetch dt.system.events, from: -24h
| filter event.kind == "AUDIT_EVENT"
| filter NOT in(event.outcome, "200", "201", "204", "success")
| summarize failures = count(), by: {event.provider, event.type, event.outcome}
| sort failures desc
```

### Failed DQL Queries

```dql
fetch dt.system.events, from: -24h
| filter event.kind == "QUERY_EXECUTION_EVENT"
| filter status == "FAILED"
| fields timestamp, table, query_pool, query_string, user.email, execution_duration_ms
| sort timestamp desc
| limit 50
```

For detailed per-event-kind queries, see the reference files in the Knowledge
Base Structure table above.

## Common Mistakes & Best Practices

**Mistakes to avoid:**
1. **Counting automation events without `state.is_final == true`** — Each
   execution emits RUNNING + final state; counting all doubles the numbers.
2. **Querying without `event.kind` filter** — Platform data is high volume;
   always filter by `event.kind` first to narrow scope.

**Best practices:**
3. **Always filter by `event.kind` first** — Narrows scope, avoids scanning
    irrelevant event types.
4. **Automation: duration is nanosecond precision** — Use
    `toDouble(duration) / 1000000000` for fractional seconds.
5. **Audit: filter by `event.provider`** — High volume; provider
    filter narrows scope significantly.
6. **Start with short time ranges** — Platform data is high volume; use 7d first.

## Next Steps

Load reference files above for detailed per-event-kind queries. Combine with
`dt-dql-essentials` for advanced patterns, `dt-platform-costs` for billing and
cost analysis, or `dt-app-dashboards` for operational dashboards.
