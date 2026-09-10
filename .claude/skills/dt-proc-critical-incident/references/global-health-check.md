---
description: Perform a comprehensive health check across all system components
argument-hint: [timestamp/timeframe]
---

# Global Health Check

Perform a comprehensive health analysis across all available system components for a given timestamp or timeframe.

## Prerequisites

- A reference timestamp or timeframe including **date, time, and timezone/location**. Do not assume any part of the timestamp — if incomplete, ask the user before proceeding.

## Steps

1. First, determine all components that are available in the system. Do this by using the knowledge base. Search for documents that help you find all the system components
2. For each element in the list, execute the steps in [HealthCheck](component-health-check.md)
3. Combine the summaries of all health checks into a comprehensive overview

## Success Criteria

- All system components identified and checked
- Health status determined for each component
- Comprehensive overview with clear summary of healthy vs unhealthy components