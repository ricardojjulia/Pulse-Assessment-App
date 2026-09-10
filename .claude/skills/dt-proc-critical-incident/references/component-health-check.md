---
description: "Analyze health status of a specific component using dashboards and knowledge base documents"
argument-hint: "[component-name] [timestamp/timeframe]"
---

# Component Health Check

Perform a detailed health analysis for a specific system component at a given timestamp or timeframe.

## Prerequisites

- A reference timestamp or timeframe including **date, time, and timezone/location**. Do not assume any part of the timestamp — if incomplete, ask the user before proceeding.
- The component that should be analyzed

## Steps

1. Determine monitoring artifacts for the component. Search for health dashboards and read all health-related documents in the knowledge base
2. Follow the instructions in the found documents that describe how to analyze health for the component
3. Analyze all relevant dashboards and focus on health-related tiles within the dashboard
4. IMPORTANT: Verify your findings to ensure that you analyze the correct timeframe. Compare the data with a larger timeframe to ensure that something is really unhealthy and not a "normal" condition
5. Generate a compact summary of your findings. Focus on important points and provide references to used documents and dashboards. Users should be able to verify your conclusions

## Success Criteria

- Health status clearly identified for the specified component
- Analysis performed for the correct timestamp/timeframe
- Findings verified against baseline (normal conditions)
- Summary includes references to dashboards and documents used
