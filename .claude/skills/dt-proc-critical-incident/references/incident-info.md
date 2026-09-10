---
description: Provide ongoing incident updates by comparing current health status to previous assessments
argument-hint: [incident-time/timeframe]
---

# Incident Information Update

Provide delta reports during an ongoing incident by comparing current health status against previous assessments.

## Prerequisites

- An incident time/timeframe must be known
- A component or a list of components that are affected by the incident is known
- A first assessment was executed and we have a summary of the current incident

## Steps

1. Look into the assessment summary and determine which components are unhealthy and have problems

2. For each affected component do a [ComponentHealthCheck.md](component-health-check.md)

3. Compare the previous health check with the current one and analyze if the situation gets better or worse

4. Create a delta report and focus on changes

## Success Criteria

- Current health status compared against previous assessment
- Clear indication of whether situation is improving or worsening
- Delta report highlights specific changes and trends