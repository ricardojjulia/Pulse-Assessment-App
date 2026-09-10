# Health Dashboards

Dashboard catalog for Dynatrace platform self-monitoring on dre63214.
Find the right dashboard by domain — dashboards are self-explanatory once opened.

## Grail Ingest

| Dashboard | ID | Description |
|---|---|---|
| [Grail][Ingest][Storage] Health Check | `monaco-ff976869-dc77-3bb4-8e11-47cd946b0e5a` | Storage health, capacity, ingest pipeline status |
| [Grail][Team IVIE] PM Health Check | `monaco-528ebf16-3a97-3337-8531-709da67f6e51` | Partition manager health and allocation status |
| [Grail][Team IVIE] 2nd Gen Ingest Metrics | `monaco-27be4c0b-e4d7-3e12-8c27-faba05cc8686` | Backpressure, rejections, forwarding errors, validation |
| [Grail][Ingest Endpoint] Service Audit | `monaco-d168630b-6aa6-32ed-bb56-dd51077629d7` | API endpoint RPS, P90 latency, error rates |
| [Grail][Team IVIE] Ingest Lag Monitoring | `monaco-6c36376e-c576-3cba-bf55-0664f53dea02` | Data freshness and ingest lag tracking |

## Grail Query

| Dashboard | ID | Description |
|---|---|---|
| [SRE][Grail][Query Frontend] TSG | `monaco-d795ef2b-7549-30b1-8235-3a595c4cd5eb` | On-call troubleshooting: SLOs, query lifecycle, latency |
| [Support][Grail] Query Health | `monaco-f10c8a3c-5d5d-327f-a9ec-ee128c454ae2` | Support-focused customer-facing query health |
| [Grail][Query] Query Engine Overview | `monaco-78d033fa-058d-38c1-b2ff-0ea64fe02a5e` | Query engine task execution and resource usage |

## PPX / OpenPipeline

| Dashboard | ID | Description |
|---|---|---|
| [OpenPipeline][ppx-service] Health Dashboard | `monaco-6185d13f-9ed1-342d-9850-77ee6d7bfd29` | PPX service health, errors, availability |
| [OpenPipeline][dps-ingest] App Health | `monaco-31ed4d26-d68c-395a-8cb1-14417cff0f2c` | DPS ingest app health and resource usage |
| [OpenPipeline] PPX Ingest Pipeline | `monaco-67130e4b-9b4f-3b65-83c7-88be01f9f639` | Pipeline queues, dropped records, killswitch status |

## Data Intelligence (DI)

| Dashboard | ID | Description |
|---|---|---|
| [TSG][DI] Anomaly detection - Write alerting | `di-write-alerting-tsg` | Write-path anomaly detection alerting |
| [TSG][DI] Anomaly detection - Read alerting | `di-read-alerting-tsg` | Read-path anomaly detection alerting |
| [TSG][DI] Anomaly detection - Baselining alerting | `di-baselining-alerting-tsg` | Baselining anomaly detection alerting |
| [TSG][DI] DAS - Davis-Native | `di-das-davis-native-tsg` | Davis-native analyzer service |
| [TSG][DI] DAS - Analyzer Execution | `di-das-analyzer-execution-tsg` | DAS analyzer execution monitoring |
| [TSG][DI] DAS - Task Execution | `di-das-task-execution-tsg` | DAS task execution monitoring |
| [TSG][DI] DAS - GRAIL Query Cost | `di-das-grail-query-cost-tsg` | DAS Grail query cost tracking |

## Cross-Component

| Dashboard | ID | Description |
|---|---|---|
| [Grail] CUJ SLO Overview | `monaco-ee02efc8-19f2-3d41-8779-663118676d57` | Critical user journey SLOs across all components |
