# Upgrade Overview

## Upgrade Phases

### Phase 2 -- Dual Mode

Both classic (2nd-gen) and 3rd-gen features coexist in the tenant. Customers use this phase to:

- Assess which classic features are in use
- Migrate configurations to gen3 equivalents
- Adopt gen3 apps and workflows
- Validate that gen3 replacements meet their needs

### Phase 3 -- Gen3 Only

Classic features are removed. The tenant operates exclusively on 3rd-generation concepts. All configurations must be migrated before entering this phase.

## Data Types for Readiness Assessment

When evaluating upgrade readiness, tracking data falls into these categories:

- **Classic Usage** -- Tracks individual usage events of legacy features. Examples: dashboard views, classic API calls, USQL queries. Helps quantify how much a tenant depends on classic features.
- **Classic Configuration** -- Lists classic config objects that may need migration. Examples: management zone definitions, metric event alert rules, classic SLO definitions. Helps identify the migration workload.
- **Readiness Status** -- Per-item pass/fail compatibility check for Phase 3. Examples: OneAgent version >= 1.337, ActiveGate version >= 1.327. Helps determine blockers.
- **New Usage** -- Tracks adoption of gen3 replacements. Examples: new dashboard views, OpenPipeline processed events, gen3 SLO definitions. Helps measure migration progress.

## General Prerequisites

Before starting the upgrade assessment:

1. Identify which upgrade areas are relevant to the tenant (not all tenants use all features)
2. Ensure you have appropriate permissions to run DQL queries and read settings
3. Plan the assessment area by area -- each area has its own tracking queries and migration actions
4. Prioritize items marked as "Phase 2 required" -- these must be addressed before entering Phase 2

## Upgrade Areas

The upgrade items are organized by team ownership:

1. **Platform** -- Dashboards, entity queries, IAM, management zones, autotagging, alerting, settings
2. **Edge Data Platform** -- OpenPipeline, extensions, cloud integrations, ActiveGate
3. **Application Observability** -- SLOs, logs, service detection, request attributes, calculated metrics, services
4. **Infrastructure Observability** -- Disk alerts, VMware, K8s, databases, network, OneAgent, naming rules
5. **Cloud Automations** -- Releases, config-as-code, SRG
6. **Application Security** -- Vulnerability monitoring
7. **Digital Experience** -- Web/mobile RUM, sessions, synthetic, properties, privacy, alerting, actions
