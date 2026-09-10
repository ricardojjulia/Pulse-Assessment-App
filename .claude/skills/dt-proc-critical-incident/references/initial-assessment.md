---
description: "Perform initial assessment of a critical incident to identify affected components and customers"
argument-hint: "[incident-time] [incident-description]"
---

# Initial Assessment

Perform the first assessment of a critical incident to identify affected components, analyze impact, and determine customer impact.

## Prerequisites

- An incident time or at least an estimated time. This MUST include **date, time, and timezone/location** — never assume any part of the timestamp. If incomplete, ask the user before proceeding.
- A description of the incident describing what is wrong in the system

## Steps

1. Read the description carefully and do a first high-level analysis of which services, clusters, and systems are affected. If it is not possible to determine this based on the initial message, do a [GlobalHealth](global-health-check.md). If the components can be identified, do a [ComponentHealthCheck](component-health-check.md) for the identified components.
   IMPORTANT: The health check MUST be done with the proper incident timestamp in mind.

2. Read the health check result and validate it against the incident description. Double-check if the health result explains the incident description. Do not jump to conclusions, but ask the user if there are any inconsistencies.

3. Once the components that cause a problem are identified, do an impact analysis. The goal is to determine which customers are affected. Search the knowledge base for documents on how to do that. It is important to do this precisely. If you are not sure how to determine the customers, ask the user for help.

4. Create a first assessment by combining all this data and present a compact summary of your findings.

## Success Criteria

- Affected components clearly identified through health check
- Health check validated against incident description
- Customer impact determined with high precision
- Summary provides actionable insights for incident response
