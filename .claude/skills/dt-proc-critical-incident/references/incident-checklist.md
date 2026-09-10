---
description: Pre-flight checklist for critical incident response. Verify all required information before starting any investigation workflow.
---

# Incident Response Checklist

Run through this checklist before starting any investigation workflow. Do not proceed until all required items are confirmed.

## Required Information

- [ ] **Incident Identifier** — Unique ID for tracking (e.g., CI-326, INC-12345)
- [ ] **Incident Reporter** — Person or system that created the incident (name or email)
- [ ] **Title and Description** — Clear summary of what is wrong
- [ ] **Incident Timestamp** — Full timestamp including **date, time, and timezone/location** (e.g., `2026-03-05 14:30 UTC`, `2026-03-05 15:30 Europe/Vienna`). **NEVER assume or default any part of the timestamp.** If the user provides an incomplete timestamp (missing date, time, or timezone), ask for the missing parts before proceeding.

If any of these are missing, ask the user before proceeding. Do NOT guess or infer defaults — especially for the timestamp.

## Timeframe Assessment

The incident timestamp determines your investigation approach. Check how old the incident is:

| Incident Age | Data Availability | Action |
|-------------|-------------------|--------|
| **< 4 hours** | Data is fresh and available | Proceed directly with investigation |
| **4-24 hours** | Data likely available | Verify data exists before deep investigation |
| **1-7 days** | Data may be outside retention for some signals | Warn user: "Some telemetry may no longer be available. I'll verify data availability before investigating." |
| **> 7 days** | Data likely unavailable for most signals | Warn user: "This incident is older than typical data retention periods. Investigation may be limited to available artifacts (dashboards, reports, documentation)." |

**IMPORTANT**: For incidents older than 24 hours, always run a quick data availability check before starting full investigation. A simple `fetch logs | filter timestamp >= <incident_time> | limit 1` can confirm whether data exists for the timeframe.

## Scope Identification

- [ ] **Affected components** — Which services, clusters, or systems are involved? (If unknown, the initial assessment workflow will determine this via health checks)
- [ ] **Known impact** — Any initial understanding of user/customer impact?

## Ready to Proceed

Once the checklist is complete, select the appropriate workflow from the skill's workflow selection table.
