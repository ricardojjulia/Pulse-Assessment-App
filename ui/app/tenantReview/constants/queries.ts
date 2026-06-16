/**
 * Centralized DQL query strings used by review areas.
 * Each query is designed to run against Grail and return summary-level data.
 */

export const DQL_QUERIES = {
  // Monitoring Configuration
  hostCount: "fetch dt.entity.host | summarize count()",
  hostsByAgentVersion:
    "fetch dt.entity.host | fieldsAdd agentVersion = installerVersion | summarize hostCount = count(), by:{agentVersion}",
  hostsByMonitoringMode:
    "fetch dt.entity.host | summarize hostCount = count(), by:{monitoringMode}",
  processGroupCount: "fetch dt.entity.process_group | summarize count()",
  serviceCount: "fetch dt.entity.service | summarize count()",

  // Data Storage & Grail
  logVolumeByLevel:
    "fetch logs, from:now()-24h | summarize logCount = count(), by:{loglevel} | sort logCount desc | limit 20",
  eventCount: "fetch events, from:now()-7d | summarize count()",
  grailBuckets: "fetch dt.system.buckets | fieldsKeep name, records, retention_days",

  // Alerting
  recentProblems:
    "fetch events, from:now()-7d | filter event.kind == \"DAVIS_PROBLEM\" | summarize count()",
  problemsByStatus:
    "fetch events, from:now()-7d | filter event.kind == \"DAVIS_PROBLEM\" | summarize count(), by:{event.status}",

  // Synthetic
  syntheticTestCount: "fetch dt.entity.synthetic_test | summarize count()",
  httpCheckCount: "fetch dt.entity.http_check | summarize count()",

  // RUM
  applicationCount: "fetch dt.entity.application | summarize count()",

  // Log Monitoring
  logSourceTypes:
    "fetch logs, from:now()-24h | summarize logCount = count(), by:{log.source} | sort logCount desc | limit 20",

  // Security (uses Grail events instead of the Security Problems API which may be disabled)
  securityEvents:
    "fetch events, from:now()-30d | filter event.kind == \"SECURITY_EVENT\" | summarize total = count(), critical = countIf(dt.security.risk.level == \"CRITICAL\"), high = countIf(dt.security.risk.level == \"HIGH\"), medium = countIf(dt.security.risk.level == \"MEDIUM\"), low = countIf(dt.security.risk.level == \"LOW\")",

  // Grail Documents / Files
  lookupTableCount:
    "fetch dt.system.files | filter type == \"tabular/lookup\" | summarize count()",

  // SLOs
  sloCount: "fetch dt.entity.service_level_objective | summarize count()",
  sloDetails:
    "fetch dt.entity.service_level_objective | fieldsAdd entity.name | limit 100",

  // Business Events (key Gen3/Grail adoption signal)
  bizEventVolume:
    "fetch bizevents, from:now()-24h | summarize total = count()",
  bizEventsByType:
    "fetch bizevents, from:now()-24h | summarize eventCount = count(), by:{event.type} | sort eventCount desc | limit 20",

  // Audit Logs (audit events live in dt.system.events with event.kind == "AUDIT_EVENT")
  auditLogVolume:
    "fetch dt.system.events, from:now()-7d | filter event.kind == \"AUDIT_EVENT\" | summarize total = count()",
  auditLogByCategory:
    "fetch dt.system.events, from:now()-7d | filter event.kind == \"AUDIT_EVENT\" | summarize eventCount = count(), by:{event.type} | sort eventCount desc | limit 20",

  // Synthetic on Grail (Gen3 synthetic execution data)
  syntheticGrailEvents:
    "fetch dt.synthetic.events, from:now()-7d | summarize total = count()",
  syntheticGrailByType:
    "fetch dt.synthetic.events, from:now()-7d | summarize eventCount = count(), by:{event.type} | sort eventCount desc | limit 10",

  // Kubernetes
  k8sClusterCount:
    "fetch dt.entity.kubernetes_cluster | summarize count()",
  k8sWorkloadCount:
    "fetch dt.entity.cloud_application | summarize count()",
  k8sNamespaceCount:
    "fetch dt.entity.cloud_application_namespace | summarize count()",

  // OpenTelemetry Traces (Gen3 distributed tracing in Grail)
  spanCount:
    "fetch spans, from:now()-24h | summarize total = count()",

  // Davis Events flowing to Grail (Gen3 alerting path active)
  davisEvents:
    "fetch events, from:now()-7d | filter event.kind == \"DAVIS_EVENT\" | summarize total = count()",

  // --- Tier 1 Inventory queries (from reference dashboards + original tenant review) ---

  // Kubernetes nodes
  k8sNodeCount:
    "fetch dt.entity.kubernetes_node | summarize count()",

  // Mobile apps
  mobileAppCount:
    "fetch dt.entity.device_application | summarize count()",

  // Custom services (service type breakdown)
  servicesByType:
    "fetch dt.entity.service | summarize serviceCount = count(), by:{serviceType} | sort serviceCount desc",

  // Monitoring candidates (unmonitored hosts)
  monitoringCandidates:
    "fetch dt.entity.host | filter isMonitoringCandidate == true | summarize count()",

  // EC2 instances
  ec2Count:
    "fetch dt.entity.ec2_instance | summarize count()",

  // Host group count
  hostGroupCount:
    "fetch dt.entity.host_group | summarize count()",

  // ActiveGate count and details (via SFM metrics — no entity type exists)
  activeGateCount:
    "timeseries avg(dt.sfm.active_gate.system.cpu_usage), by:{dt.active_gate.id} | summarize agCount = count()",
  activeGateDetails:
    "timeseries avg(dt.sfm.active_gate.system.cpu_usage), by:{dt.active_gate.id, dt.active_gate.group.name, host.name, dt.network_zone.id} | fieldsAdd avgCpu = arrayAvg(`avg(dt.sfm.active_gate.system.cpu_usage)`) | fields dt.active_gate.id, dt.active_gate.group.name, host.name, dt.network_zone.id, avgCpu",

  // DPS billing (via metrics — requires storage:metrics:read)
  dpsBillingUsage:
    "timeseries sum(dt.billing.full_stack_monitoring.usage), interval:1h | fieldsAdd totalGiB = arraySum(`sum(dt.billing.full_stack_monitoring.usage)`) | fields totalGiB",

  // AWS resource counts (from Classic AWS overview dashboard)
  awsLambdaCount: "fetch dt.entity.aws_lambda_function | summarize count()",
  awsRdsCount: "fetch dt.entity.relational_database_service | summarize count()",
  awsElbCount: "fetch dt.entity.elastic_load_balancer | summarize count()",
  awsS3Count: "fetch dt.entity.s3bucket | summarize count()",
  awsCredentialCount: "fetch dt.entity.aws_credentials | summarize count()",
  awsEksCount: "fetch dt.entity.custom_device | filter entity.type == \"cloud:aws:eks:cluster\" | summarize count()",

  // Azure resource counts (from Classic Azure overview dashboard)
  azureVmCount: "fetch dt.entity.azure_vm | summarize count()",
  azureWebAppCount: "fetch dt.entity.azure_web_app | summarize count()",
  azureSqlDbCount: "fetch dt.entity.azure_sql_database | summarize count()",
  azureFunctionCount: "fetch dt.entity.azure_function_app | summarize count()",
  azureAksCount: "fetch dt.entity.custom_device | filter entity.type == \"cloud:azure:containerservice:managedcluster\" | summarize count()",

  // Davis anomaly detector health (from Custom Alerts Health dashboard)
  anomalyDetectorStatus: "fetch dt.system.events, from:now()-24h | filter event.kind == \"ANOMALY_DETECTOR_STATUS_EVENT\" | filter client.internal_service_context == \"dt.davis.anomaly-detector\" | summarize total = count()",

  // Log ingest health (from Log ingest overview dashboard)
  logIngestErrors: "timeseries count(dt.sfm.storage.ingest.errors), filter:{dt.system.bucket == \"dt_system_metrics\" AND table == \"logs\"} | fieldsAdd total = arraySum(`count(dt.sfm.storage.ingest.errors)`) | fields total",
  logBucketStorage: "fetch dt.system.buckets | filter dt.system.table == \"logs\" | summarize totalBytes = sum(estimated_uncompressed_bytes)",

  // Endpoint cardinality (service request count by endpoint — proxy for calculated metrics usage)
  endpointCardinality:
    "fetch dt.entity.service | fieldsAdd entity.name | summarize serviceCount = count()",

  // Smartscape Grail — Gen3 topology (critical adoption signal)
  smartscapeHosts:
    "smartscapeNodes HOST | summarize count()",
  smartscapeServices:
    "smartscapeNodes SERVICE | summarize count()",
  smartscapeProcesses:
    "smartscapeNodes PROCESS | summarize count()",

  // OpenPipeline usage metrics (from reference dashboard)
  openPipelineIngestByConfig:
    "timeseries sum(dt.sfm.openpipeline.ingest_sources_in.records), by:{configuration} | fieldsAdd total = arraySum(`sum(dt.sfm.openpipeline.ingest_sources_in.records)`) | fields configuration, total | sort total desc",
  openPipelineClassicVsPipeline:
    "timeseries sum(dt.sfm.openpipeline.routing.records), by:{route_name, configuration} | fieldsAdd total = arraySum(`sum(dt.sfm.openpipeline.routing.records)`) | fields route_name, configuration, total | sort total desc",
  openPipelineNotStored:
    "timeseries sum(dt.sfm.openpipeline.not_stored.records), by:{configuration} | fieldsAdd total = arraySum(`sum(dt.sfm.openpipeline.not_stored.records)`) | fields configuration, total",

  // From Smartscape Grail dashboard
  hostCloudTypes:
    "fetch dt.entity.host | fields cloudType | filterOut isNull(cloudType) | summarize hostCount = count(), by:{cloudType} | sort hostCount desc",
  hostHypervisors:
    "fetch dt.entity.host | filterOut isNull(hypervisorType) | summarize hostCount = count(), by:{hypervisorType}",
  containerInstanceCount:
    "fetch dt.entity.container_group_instance | summarize count()",
  processInstanceCount:
    "fetch dt.entity.process_group_instance | summarize count()",
  diskCount:
    "fetch dt.entity.disk | summarize count()",
  networkInterfaceCount:
    "fetch dt.entity.network_interface | summarize count()",
  // Best Practices — additional queries
  hostsByHostGroup:
    "fetch dt.entity.host | summarize hostCount = count(), by:{dt.host_group.id} | sort hostCount desc",
  networkZoneAssignments:
    "fetch dt.entity.host | fieldsAdd networkZone | summarize hostCount = count(), by:{networkZone} | sort hostCount desc",
  bucketDetails:
    "fetch dt.system.buckets | fieldsKeep name, records, retention_days, estimated_uncompressed_bytes",
  auditLogRecentActivity:
    "fetch dt.system.events, from:now()-30d | filter event.kind == \"AUDIT_EVENT\" | summarize total = count(), uniqueUsers = countDistinct(user)",
  calculatedServiceMetricCount:
    "fetch dt.entity.custom_metric | filter entity.name LIKE \"calc:service*\" | summarize count()",
  awsIntegrationCount:
    "fetch dt.entity.aws_credentials | summarize count()",

  // Best Practices — workflow & automation
  workflowExecutionHealth:
    "fetch events, from:now()-7d | filter event.type == \"automation.workflow.execution\" | summarize total = count(), success = countIf(success == true) | fieldsAdd successRate = if(total > 0, success * 100.0 / total, else: 0.0)",
  deploymentEvents:
    "fetch events, from:now()-7d | filter event.type == \"CUSTOM_DEPLOYMENT\" | summarize total = count()",

  // Best Practices — data quality
  bizeventsDataQuality:
    "fetch bizevents, from:now()-24h | summarize total = count(), withType = countIf(isNotNull(event.type)), withProvider = countIf(isNotNull(event.provider))",
  spanDataQuality:
    "fetch spans, from:now()-24h | summarize total = count(), withDbSystem = countIf(isNotNull(db.system)), withServiceName = countIf(isNotNull(service.name))",
  debugLogVolume:
    "fetch logs, from:now()-24h | summarize total = count(), debugCount = countIf(loglevel == \"DEBUG\" OR loglevel == \"TRACE\")",

  // Best Practices — synthetic
  syntheticMonitorDetails:
    "fetch dt.entity.synthetic_test | fieldsAdd entity.name, type | summarize testCount = count(), by:{type}",

  // Best Practices — RUM web vitals
  webVitals:
    "fetch dt.rum.action_properties, from:now()-24h | summarize lcpP75 = percentile(largestContentfulPaint, 75), clsP75 = percentile(cumulativeLayoutShift, 75)",

  // Best Practices — reference dashboard coverage gaps
  serviceMethodCount:
    "fetch dt.entity.service_method | summarize count()",
  customServiceCount:
    "fetch dt.entity.service | filter serviceType == \"CUSTOM_SERVICE\" | summarize count()",
  hostsWithoutHostGroup:
    "fetch dt.entity.host | filter isNull(dt.host_group.id) OR dt.host_group.id == \"\" | summarize count()",
} as const;

/** Settings 2.0 schema IDs used for review queries */
export const SETTINGS_SCHEMAS = {
  // Alerting
  alertingProfile: "builtin:alerting.profile",
  problemNotifications: "builtin:problem.notifications",
  metricEvents: "builtin:anomaly-detection.metric-events",
  maintenanceWindow: "builtin:alerting.maintenance-window",

  // Tagging & Organization
  autoTagging: "builtin:tags.auto-tagging",
  managementZones: "builtin:management-zones",
  ownershipTeams: "builtin:ownership.teams",
  ownershipConfig: "builtin:ownership.config",

  // Detection Rules
  processGroupDetection: "builtin:process-group.simple-detection-rule",
  serviceDetection: "builtin:service-detection.full-web-request",

  // Log Monitoring
  logStorageSettings: "builtin:logmonitoring.log-storage-settings",
  logEvents: "builtin:logmonitoring.log-events",
  logProcessingRules: "builtin:logmonitoring.log-events",

  // RUM
  rumWeb: "builtin:rum.web.rum-javascript-updates",
  sessionReplay: "builtin:sessionreplay.web.privacy-preferences",

  // Security
  attackProtection: "builtin:appsec.attack-protection-settings",

  // Cloud
  cloudAws: "builtin:cloud.aws",
  cloudAzure: "builtin:cloud.azure",

  // Network
  networkZones: "builtin:networkzones",

  // OneAgent Updates
  oneAgentUpdates: "builtin:deployment.oneagent.updates",

  // OpenPipeline
  openPipelineLogs: "builtin:openpipeline.logs.pipelines",
  openPipelineMetrics: "builtin:openpipeline.metrics.pipelines",
  // SLO
  sloSettings: "builtin:monitoring.slo",

  // Davis Anomaly Detectors (Gen3 replacement for metric events)
  davisAnomalyDetectors: "builtin:davis.anomaly-detectors",

  // --- Tier 1 Inventory schemas (from original tenant review + reference dashboards) ---

  // Gen3 features
  segments: "builtin:segment",
  declarativeGrouping: "builtin:declarativegrouping",
  issueTracking: "builtin:issue-tracking.integration",
  reliabilityGuardian: "builtin:reliability-guardian",
  frequentIssues: "builtin:anomaly-detection.frequent-issues",

  // Gen2/Neutral features (inventory only)
  osServicesMonitoring: "builtin:os-services-monitoring",
  oneAgentFeatures: "builtin:oneagent.features",
  logCustomAttributes: "builtin:logmonitoring.log-custom-attributes",

  // Security
  runtimeVulnDetection: "builtin:appsec.runtime-vulnerability-detection",
  securityNotifications: "builtin:appsec.notification-integration",

  // Business events
  bizeventsIncoming: "builtin:bizevents.http.incoming",
  bizeventsProcessingRules: "builtin:bizevents-processing-pipelines.rule",
  bizeventsMetricsRules: "builtin:bizevents-processing-metrics.rule",
  bizeventsBucketRules: "builtin:bizevents-processing-buckets.rule",

  // Best Practices
  calculatedMetricsService: "builtin:calculated-metrics-service",
  calculatedMetricsLog: "builtin:calculated-metrics-log",
  bizeventsSecurityContextRules: "builtin:bizevents-security-context-rules",
} as const;
