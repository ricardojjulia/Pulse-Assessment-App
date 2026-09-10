---
name: dt-proc-critical-incident
description: Critical incident response process workflow. Use when analyzing critical incidents, performing initial assessments, health checks, or providing incident status updates. Guides systematic investigation from initial triage through root cause identification.
license: Apache-2.0
---

# Critical Incident Response Process

Systematic workflow for analyzing and responding to critical production incidents.

## Before You Start

**IMPORTANT**: Before starting any investigation, read and complete the [Incident Response Checklist](references/incident-checklist.md). This verifies you have all required information and assesses whether data is available for the incident timeframe.

Do not skip the checklist. Investigating without confirming data availability wastes time — especially for incidents older than 24 hours.

## Core Principles

- **Business impact first** — Always assess and communicate user and revenue impact before diving into technical details
- **Timeframe matters** — The age of an incident determines your investigation approach. Recent incidents have full telemetry; older incidents may have gaps due to data retention limits
- **Timestamps must be complete** — Every timestamp MUST include **date, time, and timezone/location**. NEVER assume or default any part. If the user provides an incomplete timestamp, ask for the missing parts before proceeding
- **Analysis is mandatory** — Never conclude without performing a detailed investigation. Verify findings against the incident description
- **Know when to stop** — If queries return no data, verify data availability before continuing. Do not keep querying if telemetry is outside the retention window
- **Communicate clearly** — Technical details for engineers, summaries for executives

## Data Freshness Warning

Not all telemetry data is available indefinitely. Dynatrace data retention varies by signal type (logs, metrics, traces, events). When investigating incidents that are not recent:

- **Always verify data exists** before running complex queries — a simple `fetch logs | filter timestamp >= <incident_time> | limit 1` confirms data availability
- **If queries return 0 results**, stop and check: Is the data outside the retention window? Is the entity name correct? Is the time range right?
- **For old incidents (7+ days)**, pivot to available artifacts: dashboards, screenshots, existing documentation, incident reports

## Common Pitfalls

Avoid these frequent mistakes during incident response:

- **Jumping to conclusions** — Do not skip the health check and assume a root cause based on the incident title alone. Complete the full initial assessment before forming hypotheses
- **Ignoring data availability** — Investigating historical incidents without first checking whether telemetry data is still within the retention window leads to wasted queries and misleading "no results" conclusions
- **Assuming uniform retention** — Different signal types (logs, metrics, traces, events) have different retention periods. Logs may expire days before metrics do. Always verify per signal type
- **Skipping the incident checklist** — The checklist exists to prevent missing critical context such as affected environment, timeframe, and customer impact. Skipping it leads to incomplete investigations
- **Not verifying findings** — Always cross-reference your analysis against the original incident description. Confirm that what you found actually explains the reported symptoms
- **Tunnel vision on one component** — A failing service may be a symptom, not the cause. Use the global health check to identify upstream or cross-cutting issues before narrowing scope

## Process Workflows

### Initial Assessment

When starting a new incident investigation with all prerequisites met:

- Read [initial-assessment.md](references/initial-assessment.md) for the complete initial assessment workflow
- This process identifies affected components, analyzes impact, and determines customer impact

### Incident Status Update

When providing ongoing updates during an active incident:

- Read [incident-info.md](references/incident-info.md) for the incident information update workflow
- This process compares current vs previous health status and generates delta reports

### Health Check Procedures

The initial assessment and status updates reference these health check procedures:

- **Component Health Check**: [component-health-check.md](references/component-health-check.md) — Analyze a specific system component
- **Global Health Check**: [global-health-check.md](references/global-health-check.md) — Comprehensive cross-system analysis

## Escalation Guidelines

Not every incident can or should be resolved by the initial responder. Escalate when:

- **Customer impact is confirmed and growing** — If active users are affected and the blast radius is expanding, escalate immediately rather than continuing to diagnose
- **Root cause is not identifiable** — If the initial assessment and health checks do not reveal a clear root cause within a reasonable timeframe, bring in domain experts rather than guessing
- **Multiple independent systems are affected** — Cross-system failures often indicate infrastructure-level issues (networking, DNS, cloud provider) that require platform team involvement
- **The incident exceeds your access or expertise** — If investigation requires access to systems or knowledge you do not have, escalate early to avoid delays

When escalating, include: current findings, what has been ruled out, affected timeframe, and confirmed customer impact.

## Workflow Selection

| User Request | Workflow |
|-------------|----------|
| "Investigate incident X" | [Initial Assessment](references/initial-assessment.md) |
| "What's the current status?" | [Incident Status Update](references/incident-info.md) |
| "Check health of component Y" | [Component Health Check](references/component-health-check.md) |
| "Check overall system health" | [Global Health Check](references/global-health-check.md) |
