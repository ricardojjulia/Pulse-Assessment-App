# CDH Data Sources Reference

All CDH, IEM, AppSec, and SoftComp data records use `bdx.meta.source` to identify the product type. The bucket determines which pipeline ingested the data; within a bucket, use `bdx.meta.source` to filter to a specific product.

## Contents

- [Routing: Source → Bucket](#routing-source--bucket)
- [Common Fields on All CDH Log Records](#common-fields-on-all-cdh-log-records)
- [Examples](#example-query-slos-for-a-specific-tenant)

## Routing: Source → Bucket

| `bdx.meta.source` | Grail bucket |
|---|---|
| `cdh.active_gate_api` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.active_gate_update_status` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.agent` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.agent_health_metric` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.alerting_profile` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.api_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.api_user_agent_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.application` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.appsec_monitored_host_by_functionality` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.appsec_setting` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.attack_candidate` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.automation_workflow` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_app_property` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_app_real_user_monitoring_property` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_app_session` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_app_session_by_app` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_synthetic_action` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.billing_synthetic_action_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.capping_information` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.cf_foundation` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.cloud_application` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.cloud_application_instance` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.cloud_event` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.cloud_network_service` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.cluster` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.cluster_network_zone` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.code_level_vulnerability_finding_event` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.competitor_js_framework_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.completeness_by_cluster` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.completeness_by_environment` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.container_group` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.credential_vault_entry` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ctc_load` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.custom_metric_classic_by_metric` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.custom_session_application_technology_billing_type` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.custom_traces_classic_usage_by_span_type` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ddu_by_metric` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ddu_serverless_by_description` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ddu_serverless_by_entity` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ddu_traces_otel_by_description` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ended_session` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.environment_metrics_metadata` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.extended_tenant_config` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.extension` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.extension_distinct_device` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.external_data_point` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.external_data_point_by_execution_environment` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.fdi_event` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.feature_flag` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.host` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.integration` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.issue_tracker` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.js_agent_version` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.k8s_data_volume` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.key_request` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.kubernetes_cluster` | `custom_sen_critical_logs_bdx_iem_prod` |
| `cdh.log_1click_activation` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.log_ingest_advanced_setting` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.log_monitoring` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.log_monitoring_configuration` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.log_monitoring_metric` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.mainframe_msu` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.maintenance_window` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.maintenance_window_filter` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.metric_query` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.mobile_agent_version_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.mobile_os_version_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.mobile_session_count_by_agent_technology` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.mobile_session_replay` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.notification_setting` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.odin_agent` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.ownership_coverage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.pgi_process_count` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.plugin_host_detail` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.plugin_metric` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.preference_setting` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.problem` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.release` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.request_attribute` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.rum_billing_period_web_application_hybrid_visit` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.security_problem` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.serverless_functions_classic_usage_by_entity` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.serverless_functions_classic_usage_by_function` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.session_storage_tenant_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.session_storage_usage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.setting` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.slo` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.software_component` | `custom_sen_critical_logs_bdx_softcomp_prod` |
| `cdh.software_component_detail` | `custom_sen_critical_logs_bdx_softcomp_prod` |
| `cdh.synthetic_api_call` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.synthetic_monitor` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.tenant_network_zone` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.token` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.versioned_module` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.virtualization` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.visit_storage` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.vulnerability_matching_metadata` | `custom_sen_critical_logs_bdx_appsec_prod` |
| `cdh.web_app_call_by_browser` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.workflow_by_trigger_type` | `custom_sen_critical_logs_bdx_cdh_prod` |
| `cdh.workflow_task_execution` | `custom_sen_critical_logs_bdx_cdh_prod` |

Account-to-tenant mapping uses bizevents, not logs — see SKILL.md.

## Common Fields on All CDH Log Records

| Field | Description | Example |
|---|---|---|
| `bdx.meta.source` | Product type identifier | `cdh.token` |
| `bdx.meta.source.stage` | Data environment stage | `PROD` / `SPRINT` / `DEV` |
| `bdx.meta.job.id` | Ingest job identifier | UUID |
| `bdx.meta.job.type` | Job type | `ingest` |
| `bdx.meta.job.timestamp` | When data was ingested | ISO timestamp |
| `bdx.meta.product` | Full product URN | `urn:bdx:dp:cdh:token:v1.0.0` |
| `dt.security_context` | Security context | `bdx.cdh` |
| `pdt.tenant_uuid` | Dynatrace environment/tenant ID | `uio20862` |
| `pdt.cluster_uuid` | Cluster the tenant is on | `prod41-ireland` |
| `pdt.cluster_type` | Cluster type | `SAAS` |
| `pdt.cluster_version` | Cluster software version | `1.333.57.20260306-011137` |
| `pdt.snapshot_id` | Snapshot batch identifier | `570651` |
| `observed_timestamp` | Original snapshot timestamp | ISO timestamp |

Product-specific data fields use the `pdt.*` prefix (e.g., `pdt.token.total_tokens`).

## Example: Query SLOs for a specific tenant

Replace `aoz61916` with the target tenant ID used in `pdt.tenant_uuid`.

```dql
fetch logs, from: -24h, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_cdh_prod"
| filter bdx.meta.source == "cdh.slo"
| filter bdx.meta.source.stage == "PROD"
| filter pdt.tenant_uuid == "aoz61916"   // replace with target tenant
| fields pdt.tenant_uuid, pdt.cluster_uuid, bdx.meta.job.timestamp
| limit 100
```

## Example: Query tokens, latest snapshot per tenant

```dql
fetch logs, from: -24h, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_cdh_prod"
| filter bdx.meta.source == "cdh.token"
| filter bdx.meta.source.stage == "PROD"
| dedup pdt.tenant_uuid, {bdx.meta.job.timestamp desc}
| fields pdt.tenant_uuid, pdt.cluster_uuid, bdx.meta.job.timestamp
| limit 100
```

## Example: Security problems (AppSec bucket)

> **Cost note**: AppSec bucket scans are expensive. Use `-24h` for routine queries; add `scanLimitGBytes: -1` to prevent runaway scans.

```dql
fetch logs, from: -24h, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_appsec_prod"
| filter bdx.meta.source == "cdh.security_problem"
| filter bdx.meta.source.stage == "PROD"
| fields pdt.tenant_uuid, bdx.meta.source, bdx.meta.job.timestamp
| limit 100
```

## Example: Count distinct tenants reporting each product type

```dql
fetch logs, from: -24h, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_critical_logs_bdx_cdh_prod"
| filter bdx.meta.source.stage == "PROD"
| summarize tenant_count = countDistinct(pdt.tenant_uuid), by: {bdx.meta.source}
| sort tenant_count desc
```
