/**
 * Remediation actions and Dynatrace documentation links for each criterion.
 * Used in the Comparison page to show actionable next steps for improved/regressed capabilities.
 */
export interface RemediationAction {
  action: string;
  docUrl: string;
  docLabel: string;
}

export const CRITERION_ACTIONS: Record<string, RemediationAction> = {
  // ── Infrastructure Observability ──
  i1:  { action: "Deploy OneAgent on all hosts to collect CPU usage metrics, or ingest via OTel/cloud integration.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host CPU monitoring" },
  i2:  { action: "Verify OneAgent memory metric collection. Enable memory monitoring in host settings.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host memory monitoring" },
  i3:  { action: "Ensure disk monitoring is enabled in OneAgent settings for storage utilization visibility.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host disk monitoring" },
  i4:  { action: "Confirm host availability metrics are being collected. Review host monitoring and SLA settings.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host availability monitoring" },
  i5:  { action: "Enable network monitoring in OneAgent settings for interface-level traffic metrics on hosts.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host network monitoring" },
  i6:  { action: "Enable process-level monitoring in OneAgent to capture per-process CPU usage metrics.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups", docLabel: "Process CPU monitoring" },
  i7:  { action: "Connect Kubernetes clusters using the Dynatrace Operator for full-stack K8s monitoring.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "K8s cluster monitoring" },
  i8:  { action: "Verify disk entities are detected on hosts. Enable disk monitoring in OneAgent settings.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/infrastructure-and-operations/hosts", docLabel: "Host disk entities" },
  i9:  { action: "Verify Davis AI is enabled and anomaly detection settings are configured for infrastructure.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Davis AI problems" },
  i10: { action: "Enable cloud platform integration (AWS, Azure, GCP) to discover cloud-native K8s workloads.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud workload monitoring" },
  i11: { action: "Ensure OneAgent is running on hosts so process groups are auto-detected for topology mapping.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups", docLabel: "Host-process topology" },
  i12: { action: "Verify K8s namespace-level workloads are detected via Dynatrace Operator for workload topology.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "K8s workload mapping" },
  i13: { action: "Enable cloud platform integration and verify host-level logs include cloud.provider metadata.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud host log enrichment" },
  i14: { action: "Configure cloud integration to enrich log records with cloud.provider context via OpenPipeline.", docUrl: "https://docs.dynatrace.com/docs/platform/openpipeline", docLabel: "Cloud log enrichment" },
  i15: { action: "Ensure cloud integration includes cloud.region attribute. Verify multi-region coverage in log data.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud region enrichment" },
  i16: { action: "Enable availability zone metadata in cloud integration for failure domain visibility.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud AZ enrichment" },
  i17: { action: "Configure cloud integration to include cloud.account.id for multi-account governance.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud account enrichment" },
  i18: { action: "Verify cloud.provider context is present in span data via cloud platform integrations.", docUrl: "https://docs.dynatrace.com/docs/ingest-from", docLabel: "Cloud span enrichment" },
  i19: { action: "Ensure Dynatrace Operator is collecting node-level metrics from K8s clusters.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "K8s node monitoring" },
  i20: { action: "Verify K8s namespace-level container metrics are flowing via Dynatrace Operator.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "K8s namespace metrics" },
  i21: { action: "Enable container restart tracking via Dynatrace Operator to detect CrashLoopBackOff and OOMKill.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "Container restart monitoring" },
  i22: { action: "Define CPU/memory resource limits on K8s workloads for cluster stability and governance.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "Container resource limits" },

  // ── Application Observability ──
  a1:  { action: "Deploy OneAgent on application servers or ingest OpenTelemetry traces for service detection.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Service tracing" },
  a2:  { action: "Enable method-level tracing in service settings. Use sensor rules for deeper visibility.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Service method tracing" },
  a3:  { action: "Ensure root spans (incoming requests) are captured. Check OneAgent or OTel instrumentation for ingress points.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/distributed-tracing", docLabel: "Root span tracing" },
  a4:  { action: "Instrument applications with OpenTelemetry SDK or configure OTel Collector to export to Dynatrace.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/opentelemetry", docLabel: "OpenTelemetry integration" },
  a5:  { action: "Confirm service response time metrics (p95) are flowing. Enable response time percentiles in settings.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Response time metrics" },
  a6:  { action: "Enable failure detection rules and verify failure rate metrics are being captured on services.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Failure rate tracking" },
  a7:  { action: "Verify request count and throughput metrics are active. Review service monitoring settings.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Throughput monitoring" },
  a8:  { action: "Ensure database calls are traced. Enable database request capturing in service settings.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Database span monitoring" },
  a9:  { action: "Enable message queue tracing for Kafka, RabbitMQ, SQS and other messaging systems.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Messaging span monitoring" },
  a10: { action: "Ensure distributed traces span 2+ services. Check cross-service correlation and context propagation.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/distributed-tracing", docLabel: "Multi-service tracing" },
  a11: { action: "Verify services have associated process groups for service-to-infrastructure topology mapping.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Service-process mapping" },
  a12: { action: "Assign tags to services for release tracking, ownership mapping, and filtering.", docUrl: "https://docs.dynatrace.com/docs/manage/tags-and-metadata", docLabel: "Service tagging" },
  a13: { action: "Enable deep database call tracing in services. Ensure services connected to multiple DB systems have all db.system attributes tracked.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Database call depth" },
  a14: { action: "Propagate trace context from browser requests into backend spans. Make sure RUM is enabled and trace headers survive proxies/gateways.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/distributed-tracing", docLabel: "Frontend trace correlation" },
  a15: { action: "Add HTTP method and route metadata to spans so trace views are route-aware instead of showing only generic request timings.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Route metadata" },
  a16: { action: "Capture exceptions in spans so failures are visible directly in trace context instead of only in logs.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/distributed-tracing", docLabel: "Exception trace coverage" },
  a17: { action: "Add service version and deployment environment metadata to spans to tie regressions to releases and environments.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Release context" },
  a18: { action: "Emit trace_id and span_id into logs with structured logging or OpenTelemetry enrichment for instant log-to-trace correlation.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Trace-log correlation" },

  // ── Digital Experience ──
  d1:  { action: "Create a web application in Dynatrace and inject the RUM JavaScript snippet for user action tracking.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications", docLabel: "RUM user action setup" },
  d2:  { action: "Enable session tracking in your RUM application configuration to capture user sessions.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications", docLabel: "Session tracking" },
  d3:  { action: "Enable Largest Contentful Paint (LCP) capture in RUM settings. Optimize to target <2.5s.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/analyze-and-use/work-with-key-performance-metrics", docLabel: "Key performance metrics" },
  d4:  { action: "Enable Interaction to Next Paint (INP) tracking in RUM settings. Target <200ms.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/analyze-and-use/work-with-key-performance-metrics", docLabel: "Key performance metrics" },
  d5:  { action: "Enable Cumulative Layout Shift (CLS) tracking in RUM settings. Target CLS <0.1.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications/analyze-and-use/work-with-key-performance-metrics", docLabel: "Key performance metrics" },
  d6:  { action: "Enable JavaScript error tracking in RUM application settings for frontend error visibility.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications", docLabel: "Frontend error tracking" },
  d7:  { action: "Create HTTP monitors in Synthetic Monitoring to check endpoint availability and response times.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic-monitoring/http-monitors-classic", docLabel: "Synthetic HTTP monitors" },
  d8:  { action: "Create browser clickpath monitors to simulate user journeys and catch regressions.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic-monitoring/browser-monitors", docLabel: "Synthetic browser monitors" },
  d9:  { action: "Integrate the Dynatrace Mobile SDK (iOS/Android) into your native apps for mobile RUM.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/mobile-applications", docLabel: "Mobile app monitoring" },
  d10: { action: "Add multiple synthetic locations (public and/or private) for broader geographic coverage.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic-monitoring", docLabel: "Synthetic location diversity" },
  d11: { action: "Create synthetic monitors and verify execution availability metrics are captured.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/synthetic-monitoring", docLabel: "Synthetic availability" },
  d12: { action: "Enable session replay on your most important web apps so teams can replay the exact user path that led to a problem.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/session-replay/enable-session-replay-web", docLabel: "Session replay" },
  d13: { action: "Instrument navigation events and clickpaths to surface funnel drop-offs and key journey breakpoints.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications", docLabel: "Navigation journeys" },
  d14: { action: "Ensure web and mobile apps emit page and view summaries so engagement depth is measurable.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/web-applications", docLabel: "Page/view summaries" },
  d15: { action: "Instrument mobile apps with the Dynatrace Mobile SDK and verify crash / ANR telemetry is flowing for triage.", docUrl: "https://docs.dynatrace.com/docs/observe/digital-experience/mobile-applications", docLabel: "Mobile crash telemetry" },

  // ── Log Analytics ──
  l1:  { action: "Activate log ingestion via OneAgent on hosts. Verify host-level logs are flowing to Grail.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Host log ingestion" },
  l2:  { action: "Verify log data is associated with services. Enable log collection on application hosts.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Service log coverage" },
  l3:  { action: "Ensure trace_id is included in log output. Use OneAgent auto-enrichment or structured logging.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log-trace correlation" },
  l4:  { action: "Enable host entity enrichment (dt.entity.host) via OneAgent log collection or OpenPipeline.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log entity enrichment" },
  l5:  { action: "Enable process group enrichment in log ingestion settings for service-level log analysis.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Process group log correlation" },
  l6:  { action: "Add log sources from multiple layers (app, infra, K8s, cloud). Configure additional log integrations.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log source diversity" },
  l7:  { action: "Ensure services emit ERROR-level logs. Configure log processing rules to capture error severity.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Error log coverage" },
  l8:  { action: "Deploy Dynatrace Operator or Fluent Bit on K8s to capture pod/container logs with K8s metadata.", docUrl: "https://docs.dynatrace.com/docs/ingest-from/setup-on-k8s", docLabel: "K8s log integration" },
  l9:  { action: "Ensure applications emit logs at multiple severity levels (ERROR, WARN, INFO, DEBUG, TRACE).", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log severity diversity" },
  l10: { action: "Configure Grail storage bucket retention policies. Verify log data persists beyond 2h window.", docUrl: "https://docs.dynatrace.com/docs/manage/data-privacy-and-security", docLabel: "Log retention policies" },
  l11: { action: "Create dedicated Grail buckets for different log tiers (security, application, infrastructure). Configure OpenPipeline routing rules.", docUrl: "https://docs.dynatrace.com/docs/platform/grail/organize-data", docLabel: "Dedicated log buckets" },
  l12: { action: "Configure applications to emit structured JSON logs. Use OpenPipeline processing rules to parse unstructured logs.", docUrl: "https://docs.dynatrace.com/docs/platform/openpipeline", docLabel: "Structured logging" },
  l13: { action: "Configure OpenTelemetry auto-instrumentation to inject span_id into logs. For Java use MDC; for .NET use ILogger with Activity context.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Span-log correlation" },
  l14: { action: "Enable multiple log sources per host: application logs via OneAgent, system/syslog, security audit logs, and cloud-native logs.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Multi-source host logging" },
  l15: { action: "Create log-based event rules in Settings → Log Events. Define patterns for critical errors, security, and business-critical entries.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs/lma-log-processing/lma-log-events", docLabel: "Log-based events" },
  l16: { action: "Register custom devices via API and enrich logs with dt.entity.custom_device attribute for domain-specific correlation.", docUrl: "https://docs.dynatrace.com/docs/extend-dynatrace/extensions20", docLabel: "Custom attribute enrichment" },

  // ── Application Security ──
  s1:  { action: "Enable Runtime Application Protection and Vulnerability Analytics in security settings for service coverage.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security", docLabel: "Security service coverage" },
  s2:  { action: "Ensure multiple security event types are detected. Review security event configuration.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security", docLabel: "Security event types" },
  s3:  { action: "Enable Runtime Vulnerability Analytics and confirm vulnerability-related security events are present for services within the last 30 days.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security/vulnerability-analytics", docLabel: "30-day vulnerability baseline" },
  s4:  { action: "Enable database operation tracing for SQL injection detection surface coverage.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Database security tracing" },
  s5:  { action: "Ensure services emit ERROR-level logs for security event correlation and threat detection.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Error log security" },
  s6:  { action: "Configure WARN-level log collection for security context — detect reconnaissance and brute-force patterns.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Warning log security" },
  s7:  { action: "Diversify event kinds monitored (SECURITY_EVENT, DAVIS_PROBLEM, etc.) for comprehensive security alerting.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security", docLabel: "Event kind diversity" },
  s8:  { action: "Enable failed request tracking and configure failure reason classification in service settings.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Failed request tracking" },
  s9:  { action: "Verify Davis AI problem detection covers services with security context enabled.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Davis security problems" },
  s10: { action: "Ensure services have HTTP request tracing with http.request.method attribute for attack surface visibility.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security/application-protection", docLabel: "HTTP request surface" },
  s11: { action: "Enable Runtime Application Protection (RASP) to detect code-level attacks like SQL injection and SSRF.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security/application-protection", docLabel: "Attack detection" },

  // ── Threat Observability ──
  t1:  { action: "Review active Davis problems. Ensure alerting profiles and notification integrations are configured.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Davis problem coverage" },
  t2:  { action: "Verify Davis AI identifies affected entities per problem for root cause analysis.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Root cause analysis" },
  t3:  { action: "Ensure Davis AI detects diverse problem categories (AVAILABILITY, ERROR, SLOWDOWN, RESOURCE).", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Problem category coverage" },
  t4:  { action: "Enable Application Security and verify security events are correlated with services.", docUrl: "https://docs.dynatrace.com/docs/secure/application-security", docLabel: "Security event coverage" },
  t5:  { action: "Ensure hosts emit ERROR-level logs for threat detection and incident investigation.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Error log threat coverage" },
  t6:  { action: "Expand log sources to cover application, infrastructure, cloud, and K8s layers.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log source diversity" },
  t7:  { action: "Enable host entity enrichment on logs for topology-aware threat correlation.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Log entity enrichment" },
  t8:  { action: "Ensure trace_id is present in logs for complete attack path reconstruction capability.", docUrl: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs", docLabel: "Trace-correlated logs" },
  t9:  { action: "Investigate entities causing recurring problems. Prioritize hardening for chronic offenders.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Recurring problem analysis" },
  t10: { action: "Track problem resolution rates. Ensure problems are properly closed for MTTR tracking.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Problem resolution" },
  t11: { action: "Ensure events include affected_entity_ids for topology-aware incident correlation and blast radius analysis.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Event entity correlation" },

  // ── AI Observability ──
  ai1: { action: "Instrument AI/LLM calls with OpenTelemetry gen_ai semantic conventions and export to Dynatrace.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "AI Observability setup" },
  ai2: { action: "Add token usage attributes (gen_ai.usage.input_tokens, gen_ai.usage.output_tokens) to AI spans.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "Token tracking" },
  ai3: { action: "Monitor multiple AI providers. Add gen_ai.system attribute to distinguish vendors.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "AI provider diversity" },
  ai4: { action: "Add gen_ai.agent.name attribute to spans for AI agent invocation tracking.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "Agent monitoring" },
  ai5: { action: "Enable prompt/response capture in AI span attributes for audit and compliance.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "Prompt tracing" },
  ai6: { action: "Capture AI span status for every model call and reserve ERROR status for actual failures/timeouts.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "AI status tracking" },
  ai7: { action: "Implement guardrail monitoring with gen_ai.guardrail attributes for safety compliance.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "Guardrail monitoring" },
  ai8: { action: "Add gen_ai.usage.cost attribute to AI spans for per-request cost tracking.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "AI cost tracking" },
  ai9: { action: "Expand AI span instrumentation to cover more services for broader AI tracing breadth.", docUrl: "https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability", docLabel: "AI tracing breadth" },

  // ── Business Observability ──
  b1:  { action: "Send business events to Dynatrace via the Business Events API or OpenPipeline log extraction.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Business events setup" },
  b2:  { action: "Define multiple event types for different business processes (orders, signups, payments).", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Event type diversity" },
  b3:  { action: "Enrich business events with dt.entity.service for service-level business impact correlation.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Service-event correlation" },
  b4:  { action: "Add event.provider attribute to classify business events by originating system.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Event provider diversity" },
  b5:  { action: "Include revenue/amount/value fields in business events for monetary impact analysis.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Revenue tracking" },
  b6:  { action: "Link business events to RUM sessions by including dt.rum.session_id attribute.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Session-event linking" },
  b7:  { action: "Include trace_id in business events for end-to-end transaction traceability.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Trace-event linking" },
  b8:  { action: "Add dt.cost.costcenter and dt.cost.product attributes for FinOps-business correlation.", docUrl: "https://docs.dynatrace.com/docs/observe/business-observability", docLabel: "Cost center tracking" },

  // ── Software Delivery ──
  sd1:  { action: "Enable deployment event tracking on services. Send CUSTOM_DEPLOYMENT events from CI/CD.", docUrl: "https://docs.dynatrace.com/docs/deliver/release-monitoring", docLabel: "Deployment tracking" },
  sd2:  { action: "Send CUSTOM_DEPLOYMENT events from CI/CD pipelines via the Events API v2 for deployment markers.", docUrl: "https://docs.dynatrace.com/docs/deliver/release-monitoring", docLabel: "Deployment markers" },
  sd3:  { action: "Diversify event kinds (deployments, problems, alerts) from CI/CD through Dynatrace API.", docUrl: "https://docs.dynatrace.com/docs/deliver", docLabel: "Event kind diversity" },
  sd4:  { action: "Enrich deployment events with specific event types for granular pipeline observability.", docUrl: "https://docs.dynatrace.com/docs/deliver", docLabel: "Event type diversity" },
  sd5:  { action: "Verify services have active request throughput as a baseline for quality gate definitions.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Service request baseline" },
  sd6:  { action: "Enable failure rate tracking on services as a baseline for release validation and quality gates.", docUrl: "https://docs.dynatrace.com/docs/observe/application-observability/services", docLabel: "Service failure baseline" },
  sd7:  { action: "Ensure services have associated process groups for deployment target identification.", docUrl: "https://docs.dynatrace.com/docs/observe/infrastructure-observability/process-groups", docLabel: "Process group coverage" },
  sd8:  { action: "Verify Davis AI problem detection covers services for automated quality feedback loops.", docUrl: "https://docs.dynatrace.com/docs/platform/davis-ai", docLabel: "Davis problem detection" },
  sd9:  { action: "Assign tags to process groups for release tracking, version management, and ownership.", docUrl: "https://docs.dynatrace.com/docs/manage/tags-and-metadata", docLabel: "Process group tagging" },
  sd10: { action: "Assign ownership tags to services for team responsibility mapping and incident response.", docUrl: "https://docs.dynatrace.com/docs/manage/tags-and-metadata", docLabel: "Ownership assignment" },
};
