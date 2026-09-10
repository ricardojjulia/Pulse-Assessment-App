---
name: dt-upgrade
description: >
  Guide users through Dynatrace upgrade from classic/2nd-gen to 3rd-gen.
  Assess tenant readiness, run tracking queries, identify migration actions
  for dashboards, entity queries, IAM, management zones, OpenPipeline,
  service detection, SLOs, logs, K8s, RUM, synthetic, alerting, and more.
  Includes full cloud connection migration (AWS, Azure, GCP) from classic
  to new (Smartscape on Grail): connection discovery, dependency assessment,
  metric/entity key mapping, dashboard/alert/SLO remediation, and cutover.
  Keywords: upgrade, migrate, classic, gen3, phase2, phase3, readiness,
  cloud integration, AWS, Azure, GCP, classic connection, new connection,
  Smartscape on Grail, fleet management.
license: Apache-2.0
---

# Dynatrace Upgrade Skill

Help users assess and execute their Dynatrace upgrade from classic/2nd-generation to 3rd-generation platform concepts.

## Overview

The Dynatrace upgrade transitions tenants from classic (2nd-gen) features to 3rd-generation equivalents. The upgrade happens in phases:

- **Phase 2** -- Dual mode. Both classic and gen3 features coexist. Customers prepare by migrating configurations and adopting gen3 alternatives.
- **Phase 3** -- Gen3 only. Classic features are removed. All configurations must be migrated before this phase.

## Data Types

When assessing upgrade readiness, tracking data falls into these categories:

- **Classic Usage** -- Tracks individual usage events of legacy features (views, queries, API calls)
- **Classic Configuration** -- Lists classic config objects that may need migration
- **Readiness Status** -- Per-item pass/fail compatibility check for Phase 3
- **New Usage** -- Tracks adoption of gen3 replacements

## Workflow

1. Ask the user which upgrade area(s) they want to assess, or offer a full scan across all areas.
2. Load the appropriate reference file(s) for the area.
3. Run the tracking queries from the reference against the user's tenant.
4. Report findings: what classic features are in use, what needs migration, and the recommended customer actions.
5. Provide links to relevant documentation and best practices.

## Reference Index

### General

| File | Description |
|---|---|
| [overview.md](references/overview.md) | Upgrade phases, data types, general prerequisites and planning checklist |

### Platform

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Dashboards Classic, Data Explorer, Metrics, Reports | Dashboards, Notebooks | [dashboards-classic.md](references/platform/dashboards-classic/dashboards-classic.md)        |
| 2nd gen entity queries | Smartscape / raw data enrichment | [entity-queries.md](references/platform/entity-queries/entity-queries.md) |
| Automation engine API use | Part of API migration | [automation-engine-api.md](references/platform/automation-engine-api/automation-engine-api.md)  |
| IAM 2nd gen roles | IAM default policies | [iam-2nd-gen-roles.md](references/platform/iam-2nd-gen-roles/iam-2nd-gen-roles.md)          |
| Classic Apps | Native Apps | [classic-apps.md](references/platform/classic-apps/classic-apps.md)                    |
| Management Zones | Segments / IAM policies / Spaces | [management-zones.md](references/platform/management-zones/management-zones.md)            |
| Autotagging | Static tagging at source | [autotagging.md](references/platform/autotagging/autotagging.md)                      |
| Custom devices (entity API) | Smartscape API | [custom-devices.md](references/platform/custom-devices/custom-devices.md)                |
| Classic alerting and problem notifications (metric events, disk rules, AWS anomaly detection, process availability, alerting profiles, notification integrations) | DQL-based anomaly detectors, edge-side detectors, Workflow notifications | [alerting-and-problem-notifications.md](references/platform/alerting-and-problem-notifications/alerting-and-problem-notifications.md) |
| Settings 2.0 | N/A (pages removed) | [settings-2-0.md](references/platform/settings-2-0/settings-2-0.md)                    |

### Edge Data Platform

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Ingest processing | OpenPipeline | [ingest-processing.md](references/edge-data-platform/ingest-processing/ingest-processing.md) |
| OpenPipeline config API | Settings API | [openpipeline-config-api.md](references/edge-data-platform/openpipeline-config-api/openpipeline-config-api.md) |
| Extension gen2 entity extraction | Extension OpenPipeline entity extraction | [extension-entity-extraction.md](references/edge-data-platform/extension-entity-extraction/extension-entity-extraction.md) |
| Classic cloud integrations (AWS/Azure/GCP) | Fleet Management App | [classic-cloud-integrations.md](references/edge-data-platform/classic-cloud-integrations/classic-cloud-integrations.md) |
| Multi-environment ActiveGate | Environment AG (single tenant) | [multi-environment-activegate.md](references/edge-data-platform/multi-environment-activegate/multi-environment-activegate.md) |
| Network-zones enforcement / Auth token enforcement | -- | [network-zones.md](references/edge-data-platform/network-zones/network-zones.md) |

### Application Observability

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Service-Level Objectives Classic | Service-Level Objectives | [service-level-objectives-classic.md](references/application-observability/service-level-objectives-classic/service-level-objectives-classic.md) |
| Log v2 | Logs on Grail | [log-v2.md](references/application-observability/log-v2/log-v2.md) |
| Classic Full Service Detection (SDv1) Rules | -- | [classic-service-detection-rules.md](references/application-observability/classic-service-detection-rules/classic-service-detection-rules.md) |
| SDv1 Global Failure Detection Rules | -- | [global-failure-detection-rules.md](references/application-observability/global-failure-detection-rules/global-failure-detection-rules.md) |
| Request Attributes | -- | [request-attributes.md](references/application-observability/request-attributes/request-attributes.md) |
| Global Request Naming Rules | -- | [global-request-naming-rules.md](references/application-observability/global-request-naming-rules/global-request-naming-rules.md) |
| Calculated Service Metrics | -- | [calculated-service-metrics.md](references/application-observability/calculated-service-metrics/calculated-service-metrics.md) |
| Cross Environment Tracing | -- | [cross-environment-tracing.md](references/application-observability/cross-environment-tracing/cross-environment-tracing.md) |
| Multi Dimensional Analysis | -- | [multi-dimensional-analysis.md](references/application-observability/multi-dimensional-analysis/multi-dimensional-analysis.md) |
| External/Opaque Services | -- | [external-opaque-services.md](references/application-observability/external-opaque-services/external-opaque-services.md) |
| Database Services/Screen | -- | [database-services.md](references/application-observability/database-services/database-services.md) |
| Messaging/Queues and Screens | -- | [messaging-queues.md](references/application-observability/messaging-queues/messaging-queues.md) |
| Attribute Masking Configs (OTEL ingest pipeline) | -- | [attribute-masking-configs.md](references/application-observability/attribute-masking-configs/attribute-masking-configs.md) |
| Key Requests | -- | [key-requests.md](references/application-observability/key-requests/key-requests.md) |
| Profiling/Memory Dumps/Process Crashes | -- | [profiling-memory-dumps.md](references/application-observability/profiling-memory-dumps/profiling-memory-dumps.md) |
| Enhanced Endpoints for SDv1 | -- | [enhanced-endpoints-sdv1.md](references/application-observability/enhanced-endpoints-sdv1/enhanced-endpoints-sdv1.md) |
| Memory Dump on ActiveGate | OAuth-based AG endpoint | [memory-dump-on-activegate.md](references/application-observability/memory-dump-on-activegate/memory-dump-on-activegate.md) |

### Infrastructure Observability

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Classic disk anomaly detection | Disk Edge | [classic-disk-anomaly-detection.md](references/infrastructure-observability/classic-disk-anomaly-detection/classic-disk-anomaly-detection.md) |
| VMware ActiveGate integration | VMware Extension | [vmware-activegate-integration.md](references/infrastructure-observability/vmware-activegate-integration/vmware-activegate-integration.md) |
| CloudFoundry ActiveGate integration | CloudFoundry Extension | [cloudfoundry-activegate-integration.md](references/infrastructure-observability/cloudfoundry-activegate-integration/cloudfoundry-activegate-integration.md) |
| Classic Maintenance Windows | Gen3 Maintenance Windows | [classic-maintenance-windows.md](references/infrastructure-observability/classic-maintenance-windows/classic-maintenance-windows.md) |
| Classic K8s monitoring | K8s Observability | [classic-k8s-monitoring.md](references/infrastructure-observability/classic-k8s-monitoring/classic-k8s-monitoring.md) |
| Classic Database monitoring | Database Observability | [classic-database-monitoring.md](references/infrastructure-observability/classic-database-monitoring/classic-database-monitoring.md) |
| Database Insights | Database Observability | [database-insights.md](references/infrastructure-observability/database-insights/database-insights.md) |
| Classic Network monitoring | Infrastructure Observability extensions | [classic-network-monitoring.md](references/infrastructure-observability/classic-network-monitoring/classic-network-monitoring.md) |
| Classic Windows Service monitoring | OS Services monitoring | [classic-windows-service-monitoring.md](references/infrastructure-observability/classic-windows-service-monitoring/classic-windows-service-monitoring.md) |
| OneAgent | OneAgent (Smartscape2) | [oneagent.md](references/infrastructure-observability/oneagent/oneagent.md) |
| Classic OneAgent process connection monitoring | OneAgent network connection monitoring | [classic-process-connection-monitoring.md](references/infrastructure-observability/classic-process-connection-monitoring/classic-process-connection-monitoring.md) |
| Host naming rules | Naming at source | [host-naming-rules.md](references/infrastructure-observability/host-naming-rules/host-naming-rules.md) |
| Process (group) naming rules | None | [process-naming-rules.md](references/infrastructure-observability/process-naming-rules/process-naming-rules.md) |
| Kubernetes Telemetry Enrichment | Central enrichment config | [kubernetes-telemetry-enrichment.md](references/infrastructure-observability/kubernetes-telemetry-enrichment/kubernetes-telemetry-enrichment.md) |

### Cloud Automations

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Releases classic | Release monitoring dashboard | [releases-classic.md](references/cloud-automations/releases-classic/releases-classic.md) |
| Configuration-as-Code (Terraform/Monaco) | Configuration-as-Code (updated APIs) | [configuration-as-code.md](references/cloud-automations/configuration-as-code/configuration-as-code.md) |
| SRG with classic SLO reference | SRG with DQL objectives | [srg-classic-slo.md](references/cloud-automations/srg-classic-slo/srg-classic-slo.md) |

### Application Security

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| Vulnerabilities App | Updated vulnerability monitoring | [vulnerabilities-app.md](references/application-security/vulnerabilities-app/vulnerabilities-app.md) |

### Digital Experience

| Upgrade from | Upgrade to | Reference                                                             |
|---|---|-----------------------------------------------------------------------|
| Classic Concept | Gen3 Replacement |                                                                       |
| RUM Classic Web Frontend Monitoring | RUM on the latest Dynatrace (Experience Vitals, Error Inspector, Users & Sessions) | [classic-web-frontend-monitoring.md](references/digital-experience/classic-web-frontend-monitoring/classic-web-frontend-monitoring.md) |
| RUM Classic Mobile Monitoring | RUM on the latest Dynatrace | [classic-mobile-monitoring.md](references/digital-experience/classic-mobile-monitoring/classic-mobile-monitoring.md) |
| RUM Classic Custom App (RUM) | RUM on the latest Dynatrace | [classic-custom-app.md](references/digital-experience/classic-custom-app/classic-custom-app.md) |
| Classic Session Segmentation | Users & Sessions app | [classic-session-segmentation.md](references/digital-experience/classic-session-segmentation/classic-session-segmentation.md) |
| Query User Sessions (USQL) | DQL | [query-user-sessions-usql.md](references/digital-experience/query-user-sessions-usql/query-user-sessions-usql.md) |
| Classic Session Replay | Session Replay in Users & Sessions app | [classic-session-replay.md](references/digital-experience/classic-session-replay/classic-session-replay.md) |
| Classic Synthetic app | Synthetic app | [classic-synthetic-app.md](references/digital-experience/classic-synthetic-app/classic-synthetic-app.md) |
| Classic action and session property capturing | Event and session property capturing | [classic-action-session-properties.md](references/digital-experience/classic-action-session-properties/classic-action-session-properties.md) |
| User tag | User tag (API/SDK) | [user-tag.md](references/digital-experience/user-tag/user-tag.md) |
| RUM Anomaly detection | Frontend health alerts | [rum-anomaly-detection.md](references/digital-experience/rum-anomaly-detection/rum-anomaly-detection.md) |
| Data Privacy & Masking | Privacy configuration in settings | [data-privacy-masking.md](references/digital-experience/data-privacy-masking/data-privacy-masking.md) |
| Apdex Rating and UXScore | Grail Apdex / Experience score | [apdex-rating-uxscore.md](references/digital-experience/apdex-rating-uxscore/apdex-rating-uxscore.md) |
| Rage Clicks, Taps, Scrolls, & Tabs | Annoyances ready-made | [rage-clicks-taps-scrolls.md](references/digital-experience/rage-clicks-taps-scrolls/rage-clicks-taps-scrolls.md) |
| Converted sessions, conversion goals | RUM custom metrics / DQL | [converted-sessions-conversion-goals.md](references/digital-experience/converted-sessions-conversion-goals/converted-sessions-conversion-goals.md) |
| User View Analysis | User View in Users & Sessions app | [user-view-analysis.md](references/digital-experience/user-view-analysis/user-view-analysis.md) |
| Multidimensional Analysis (RUM) | Experience Vitals / Notebooks/Dashboards | [multidimensional-analysis-rum.md](references/digital-experience/multidimensional-analysis-rum/multidimensional-analysis-rum.md) |
| Live Sessions | Recent Session in Users & Sessions app | [live-sessions.md](references/digital-experience/live-sessions/live-sessions.md) |
| User Recurrence (new, returning) | -- | [user-recurrence.md](references/digital-experience/user-recurrence/user-recurrence.md) |
| entry/exit actions | Grail user actions & interactions | [entry-exit-actions.md](references/digital-experience/entry-exit-actions/entry-exit-actions.md) |
| Geolocation | Complete geolocation enrichment in RUM | [geolocation.md](references/digital-experience/geolocation/geolocation.md) |
| Classic User Sessions definition | Sessions on Grail | [classic-user-sessions-definition.md](references/digital-experience/classic-user-sessions-definition/classic-user-sessions-definition.md) |
| User Actions (Load, XHR, Custom) | User Actions, Core web vitals | [user-actions.md](references/digital-experience/user-actions/user-actions.md) |
| Naming rules (RUM) | OpenPipeline event naming | [naming-rules-rum.md](references/digital-experience/naming-rules-rum/naming-rules-rum.md) |
| Symbol file management | New unified upload API | [symbol-file-management.md](references/digital-experience/symbol-file-management/symbol-file-management.md) |
