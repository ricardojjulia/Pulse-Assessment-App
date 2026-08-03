export interface NotebookReference {
  series: string;
  title: string;
  focus: string;
  url: string;
}

export interface BestPracticeNotebookGuidance {
  summary: string;
  references: NotebookReference[];
}

const REPO_BASE = "https://github.com/ricardojjulia/Best-Practice-Notebooks/tree/main";

export const BEST_PRACTICE_NOTEBOOK_GUIDANCE: Record<string, BestPracticeNotebookGuidance> = {
  "platform-architecture": {
    summary: "Use the onboarding, Kubernetes, cloud, and migration material to validate the target deployment model and Gen3 migration path.",
    references: [
      {
        series: "ONBRD",
        title: "Dynatrace Onboarding",
        focus: "Tenant foundation, onboarding sequence, deployment prerequisites",
        url: `${REPO_BASE}/ONBRD%20-%20Dynatrace%20Onboarding`,
      },
      {
        series: "K8S",
        title: "Kubernetes Monitoring",
        focus: "Cloud Native FullStack, DynaKube deployment, node and workload coverage",
        url: `${REPO_BASE}/K8S%20-%20Kubernetes%20Monitoring`,
      },
      {
        series: "CLOUD",
        title: "Cloud Provider Integrations",
        focus: "AWS/Azure/GCP integrations, topology, metrics, logs, and events",
        url: `${REPO_BASE}/CLOUD%20-%20Cloud%20Provider%20Integrations`,
      },
    ],
  },
  "dynakube-config": {
    summary: "Use the Kubernetes and onboarding notebooks to harden DynaKube settings, host groups, feature flags, and rollout posture.",
    references: [
      {
        series: "K8S",
        title: "Kubernetes Monitoring",
        focus: "DynaKube configuration, operator deployment, node and workload observability",
        url: `${REPO_BASE}/K8S%20-%20Kubernetes%20Monitoring`,
      },
      {
        series: "FAQ",
        title: "Host Group Naming Strategy",
        focus: "Host group strategy, access boundaries, alerting, and tenant maintainability",
        url: `${REPO_BASE}/FAQ%20-%20Frequently%20Asked%20Questions`,
      },
    ],
  },
  "activegate-sizing": {
    summary: "Use the onboarding and FAQ material to validate ActiveGate capacity, update strategy, routing, and high availability.",
    references: [
      {
        series: "ONBRD",
        title: "Dynatrace Onboarding",
        focus: "ActiveGate planning and foundational deployment choices",
        url: `${REPO_BASE}/ONBRD%20-%20Dynatrace%20Onboarding`,
      },
      {
        series: "FAQ",
        title: "Managing ActiveGate Updates on SaaS",
        focus: "ActiveGate update decisions, sequencing, and operational pitfalls",
        url: `${REPO_BASE}/FAQ%20-%20Frequently%20Asked%20Questions`,
      },
    ],
  },
  "network-zones": {
    summary: "Use the onboarding and Kubernetes material to validate routing, zone placement, and failover assumptions.",
    references: [
      {
        series: "ONBRD",
        title: "Dynatrace Onboarding",
        focus: "Network architecture and ActiveGate routing foundations",
        url: `${REPO_BASE}/ONBRD%20-%20Dynatrace%20Onboarding`,
      },
      {
        series: "K8S",
        title: "Kubernetes Monitoring",
        focus: "Cluster routing and network-aware observability patterns",
        url: `${REPO_BASE}/K8S%20-%20Kubernetes%20Monitoring`,
      },
    ],
  },
  "oneagent-lifecycle": {
    summary: "Use the OneAgent lifecycle notes to mature update governance, version drift monitoring, and rollout hygiene.",
    references: [
      {
        series: "FAQ",
        title: "Managing OneAgent Updates on SaaS",
        focus: "OneAgent update modes, precedence, validation, rollback, and pitfalls",
        url: `${REPO_BASE}/FAQ%20-%20Frequently%20Asked%20Questions`,
      },
      {
        series: "ONBRD",
        title: "Dynatrace Onboarding",
        focus: "Agent deployment and foundational monitoring readiness",
        url: `${REPO_BASE}/ONBRD%20-%20Dynatrace%20Onboarding`,
      },
    ],
  },
  "k8s-labels-tagging": {
    summary: "Use the organization, Kubernetes, and management-zone migration notebooks to shift from legacy scoping to source-owned tags and segments.",
    references: [
      {
        series: "ORGNZ",
        title: "Organize Data: Buckets, Segments, Security",
        focus: "Primary tags, segments, ownership, buckets, and security_context",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
      {
        series: "MZ2POL",
        title: "Management Zone to Policy Migration",
        focus: "Moving from management zones to Gen3 IAM and policy patterns",
        url: `${REPO_BASE}/MZ2POL%20-%20Management%20Zone%20to%20Policy%20Migration`,
      },
      {
        series: "FAQ",
        title: "Tagging Sources, Standards, Strategy",
        focus: "Tag source priority, standards, and governance approach",
        url: `${REPO_BASE}/FAQ%20-%20Frequently%20Asked%20Questions`,
      },
    ],
  },
  "grail-buckets": {
    summary: "Use the organization notebooks to turn bucket findings into retention, access, and cost decisions.",
    references: [
      {
        series: "ORGNZ",
        title: "Buckets and Bucket Strategy",
        focus: "Purpose-built buckets, retention tiers, bucket-level access control",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
      {
        series: "FINOPS",
        title: "Cost Management & FinOps",
        focus: "DPS cost awareness, data volume governance, and retention tradeoffs",
        url: `${REPO_BASE}/FINOPS%20-%20Cost%20Management%20%26%20FinOps`,
      },
    ],
  },
  openpipeline: {
    summary: "Use the OpenPipeline notebooks to mature routing, processing stages, metric extraction, and migration posture.",
    references: [
      {
        series: "OPLOGS",
        title: "OpenPipeline Logs",
        focus: "Log routing, bucket targeting, processors, and source-type migration",
        url: `${REPO_BASE}/OPLOGS%20-%20OpenPipeline%20Logs`,
      },
      {
        series: "OPIPE",
        title: "OpenPipeline Beyond Logs",
        focus: "Processing metrics, events, spans, and business events through OpenPipeline",
        url: `${REPO_BASE}/OPIPE%20-%20OpenPipeline%20Beyond%20Logs`,
      },
      {
        series: "OPMIG",
        title: "OpenPipeline Migration",
        focus: "Classic Logs to OpenPipeline migration planning and validation",
        url: `${REPO_BASE}/OPMIG%20-%20OpenPipeline%20Migration`,
      },
    ],
  },
  segments: {
    summary: "Use the organization and IAM notebooks to design segments as operational and access boundaries.",
    references: [
      {
        series: "ORGNZ",
        title: "Segments and Security Context",
        focus: "Segment strategy, scan reduction, team boundaries, and security_context",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
      {
        series: "IAM",
        title: "IAM Administration",
        focus: "Policy boundaries, parameterized assignments, and access design",
        url: `${REPO_BASE}/IAM%20-%20IAM%20Administration`,
      },
    ],
  },
  "iam-policies": {
    summary: "Use the IAM notebooks for policy authoring, boundary design, SSO/group architecture, and parameterized assignments.",
    references: [
      {
        series: "IAM",
        title: "IAM Administration",
        focus: "Policies, groups, boundaries, SSO, and parameterized access",
        url: `${REPO_BASE}/IAM%20-%20IAM%20Administration`,
      },
      {
        series: "ORGNZ",
        title: "Security Context",
        focus: "The universal scope field that IAM boundaries depend on",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
    ],
  },
  "tokens-oauth": {
    summary: "Use the IAM and automation material to move token governance toward OAuth, least privilege, and managed automation identities.",
    references: [
      {
        series: "IAM",
        title: "IAM Administration",
        focus: "Token governance, OAuth, policies, groups, and secure access patterns",
        url: `${REPO_BASE}/IAM%20-%20IAM%20Administration`,
      },
      {
        series: "AUTOM",
        title: "Dynatrace Automation",
        focus: "Automation identities, SDKs, Settings API, and CI/CD usage",
        url: `${REPO_BASE}/AUTOM%20-%20Dynatrace%20Automation`,
      },
    ],
  },
  "terraform-config": {
    summary: "Use the automation notebooks to move manual verification into configuration-as-code and CI policy checks.",
    references: [
      {
        series: "AUTOM",
        title: "Terraform and GitOps Setup Recipe",
        focus: "Terraform provider, repo layout, state backends, validation, and CI/CD",
        url: `${REPO_BASE}/AUTOM%20-%20Dynatrace%20Automation`,
      },
    ],
  },
  "argocd-gitops": {
    summary: "Use the automation notebooks to shape GitOps readiness, promotion flow, and policy-as-code controls.",
    references: [
      {
        series: "AUTOM",
        title: "CI/CD and GitOps Automation",
        focus: "GitOps workflow, CI/CD validation, SDKs, and migration automation",
        url: `${REPO_BASE}/AUTOM%20-%20Dynatrace%20Automation`,
      },
    ],
  },
  "monitoring-monitoring": {
    summary: "Use the AIOps, dashboard, and workflow series to operationalize Davis, SLOs, guardians, dashboards, and self-monitoring.",
    references: [
      {
        series: "AIOPS",
        title: "Dynatrace Intelligence",
        focus: "Davis anomaly detection, problems, RCA, and investigative workflows",
        url: `${REPO_BASE}/AIOPS%20-%20Dynatrace%20Intelligence`,
      },
      {
        series: "DASH",
        title: "Dashboard Design & Building",
        focus: "Dashboard hierarchy, role-specific views, variables, filters, and sharing",
        url: `${REPO_BASE}/DASH%20-%20Dashboard%20Design%20%26%20Building`,
      },
      {
        series: "WFLOW",
        title: "Workflows and Alert Notifications",
        focus: "Alert routing, incident integration, governance, and automation",
        url: `${REPO_BASE}/WFLOW%20-%20Workflows%20and%20Alert%20Notifications`,
      },
    ],
  },
  "governance-audit": {
    summary: "Use the IAM, automation, and adoption notebooks to turn audit cadence into an operating model.",
    references: [
      {
        series: "IAM",
        title: "IAM Administration",
        focus: "Access review, policy governance, groups, and boundaries",
        url: `${REPO_BASE}/IAM%20-%20IAM%20Administration`,
      },
      {
        series: "ADOPT",
        title: "Observability Adoption & Maturity",
        focus: "Operating model maturity, governance cadence, and adoption planning",
        url: `${REPO_BASE}/ADOPT%20-%20Observability%20Adoption%20%26%20Maturity`,
      },
      {
        series: "AUTOM",
        title: "Dynatrace Automation",
        focus: "Settings API, Monaco, Terraform, SDKs, and repeatable governance",
        url: `${REPO_BASE}/AUTOM%20-%20Dynatrace%20Automation`,
      },
    ],
  },
  "workflows-automation": {
    summary: "Use the workflow and automation notebooks to mature triggers, routing, failure handling, and deployment event automation.",
    references: [
      {
        series: "WFLOW",
        title: "Workflows and Alert Notifications",
        focus: "Workflow triggers, notification routing, incident integration, and governance",
        url: `${REPO_BASE}/WFLOW%20-%20Workflows%20and%20Alert%20Notifications`,
      },
      {
        series: "AUTOM",
        title: "Dynatrace Automation",
        focus: "Workflows-as-code, SDKs, CI/CD, and migration automation",
        url: `${REPO_BASE}/AUTOM%20-%20Dynatrace%20Automation`,
      },
    ],
  },
  "distributed-tracing": {
    summary: "Use the spans and OpenTelemetry notebooks to improve trace completeness, metadata quality, and service dependency analysis.",
    references: [
      {
        series: "SPANS",
        title: "Distributed Tracing and Spans",
        focus: "Span ingestion, span attributes, trace analysis, and service dependencies",
        url: `${REPO_BASE}/SPANS%20-%20Distributed%20Tracing%20and%20Spans`,
      },
      {
        series: "OTEL",
        title: "OpenTelemetry Integration",
        focus: "Vendor-neutral instrumentation, semantic conventions, and SDK setup",
        url: `${REPO_BASE}/OTEL%20-%20OpenTelemetry%20Integration`,
      },
    ],
  },
  "business-events": {
    summary: "Use the business event notebooks to mature BizOps data quality, funnel analysis, revenue/value fields, and service correlation.",
    references: [
      {
        series: "BIZEV",
        title: "Business Events & Funnel Analysis",
        focus: "Business event fundamentals, funnel analysis, dashboards, and executive reporting",
        url: `${REPO_BASE}/BIZEV%20-%20Business%20Events%20%26%20Funnel%20Analysis`,
      },
      {
        series: "ORGNZ",
        title: "Security Context",
        focus: "Business event scoping and access boundaries through security_context",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
    ],
  },
  "log-processing": {
    summary: "Use the OpenPipeline logs and organization notebooks to reduce noisy logs, route data to the right buckets, and enrich security context.",
    references: [
      {
        series: "OPLOGS",
        title: "OpenPipeline Logs",
        focus: "Log routing, filtering, processor usage, buckets, and migration from classic log practices",
        url: `${REPO_BASE}/OPLOGS%20-%20OpenPipeline%20Logs`,
      },
      {
        series: "ORGNZ",
        title: "Buckets and Security Context",
        focus: "Bucket strategy, retention, access control, and security_context enrichment",
        url: `${REPO_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security`,
      },
    ],
  },
  "synthetic-monitoring": {
    summary: "Use the synthetic notebooks to mature endpoint coverage, browser journeys, SSL checks, frequency, and location strategy.",
    references: [
      {
        series: "SYNTH",
        title: "Synthetic Monitoring",
        focus: "HTTP monitors, browser journeys, SSL, locations, frequency, and availability strategy",
        url: `${REPO_BASE}/SYNTH%20-%20Synthetic%20Monitoring`,
      },
      {
        series: "DASH",
        title: "Dashboard Design & Building",
        focus: "Synthetic availability and performance reporting for operations and leadership",
        url: `${REPO_BASE}/DASH%20-%20Dashboard%20Design%20%26%20Building`,
      },
    ],
  },
  rum: {
    summary: "Use the Web RUM notebooks to mature Core Web Vitals, session replay, user action naming, privacy, and frontend error observability.",
    references: [
      {
        series: "WEBRUM",
        title: "Web Real User Monitoring",
        focus: "Core Web Vitals, user actions, session replay, privacy, and frontend errors",
        url: `${REPO_BASE}/WEBRUM%20-%20Web%20Real%20User%20Monitoring`,
      },
      {
        series: "DASH",
        title: "Dashboard Design & Building",
        focus: "Frontend experience dashboards and stakeholder-specific reporting",
        url: `${REPO_BASE}/DASH%20-%20Dashboard%20Design%20%26%20Building`,
      },
    ],
  },
};
