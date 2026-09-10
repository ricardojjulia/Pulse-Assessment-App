# Classic → native equivalence map (the authority for "what replaces this?")

Two lookup tables that answer, per classic construct, **what replaces it** and **what breaks when it
goes**. Both are transcribed verbatim from the platform's own **Check your upgrade readiness**
dashboard (`dynatrace.upgrade.readiness.migration-status`, shipped by the `dynatrace.upgrade.readiness`
app; `isPrivate: false` — a ready-made public dashboard present in the customer's own tenant), where
they live base64-encoded in the dashboard variables `AppsStatus` and `ApiStatus`. Transcribed
2026-07-31 from a dashboard document created 2026-07-30.

**Why this file exists.** Both `/dt-eval-gen3` and `/dt-eval-mz2seg` must name a *specific* native
successor in every Path forward (gen3 spec §8: WHY + HOW, never a bare pointer). Deriving that
mapping per run invites drift and invention. This is the vendor's own answer, so a report can state
it without hedging — and the customer can open the same dashboard and see the same table.

**Two rules this table settles that we previously had to argue:**

1. **`— none yet` is ⚪, never ⚠️.** Seven classic apps have no successor at the time of transcription.
   Grading a tenant down for still using a classic app that Dynatrace has not yet replaced would be
   scoring the *absence* of a construct as a gap — banned by the Gen3-first rule (CLAUDE.md). Those
   rows are not-assessable and belong in the appendix footnotes, not the body.
2. **`BLOCK` is a break, `HIDE` is a de-listing, `VISIBLE` survives.** A settings schema marked
   `BLOCK` stops answering after the upgrade — that turns "management zones are going away" into
   "these named endpoints your integrations call stop returning 200", which is a sentence a customer
   can act on and a bare capability statement is not.

**Freshness caution.** Both tables are a snapshot of a dashboard that ships with the product and will
change as successors land. Re-transcribe from the customer's own copy of the dashboard when a run's
conclusions depend on a `— none yet` row or a `BLOCK` verdict; do not treat this file as durable
truth past the transcription date above. When a run's copy disagrees with this file, **the tenant's
copy wins** and this file gets updated.

## Reading these tables in a client deliverable

Neutral attribution only (CLAUDE.md rule 1): cite it as *"the Check your upgrade readiness dashboard
in your environment"*, never as an internal artifact and never with a tenant identifier attached. It
is a legitimate customer-reproducible surface — the same class of citation as the GUI validation map
in [verification-queries.md](verification-queries.md).

## Table 1 — classic app → native successor (46 rows, 7 with no successor yet)

Source variable: `AppsStatus`. Join key is `dt.app.id`, which is exactly what **B46** returns — so
a classic-app usage finding can name the successor app per row without a second lookup.

| Classic app (`dt.app.id`) | Classic name | Native successor | Successor app ID |
|---|---|---|---|
| `dynatrace.classic.attacks` | Attacks | Threats & Exploits | `dynatrace.security.threats.exploits` |
| `dynatrace.classic.aws` | AWS Classic | Clouds | `dynatrace.clouds` |
| `dynatrace.classic.azure` | Azure Classic | Clouds | `dynatrace.clouds` |
| `dynatrace.classic.cloudfoundry` | Cloud Foundry | Hub | `dynatrace.hub` |
| `dynatrace.classic.code.vulnerabilities` | Code-Level Vulnerabilities | Vulnerabilities | `dynatrace.security.vulnerabilities` |
| `dynatrace.classic.consumption` | Consumption | **— none yet** | — |
| `dynatrace.classic.containers` | Containers | Infrastructure & Operations | `dynatrace.infraops` |
| `dynatrace.classic.custom.applications` | Custom Applications | Experience Vitals | `dynatrace.experience.vitals` |
| `dynatrace.classic.dashboards` | Dashboards Classic | Dashboards | `dynatrace.dashboards` |
| `dynatrace.classic.data.explorer` | Data Explorer | Notebooks | `dynatrace.notebooks` |
| `dynatrace.classic.databases` | Database Services Classic | Databases | `dynatrace.database.overview` |
| `dynatrace.classic.deploy.activegate` | Deploy ActiveGate | Discovery & Coverage | `dynatrace.discovery.coverage` |
| `dynatrace.classic.deploy.oneagent` | Deploy OneAgent | Discovery & Coverage | `dynatrace.discovery.coverage` |
| `dynatrace.classic.deployment.status` | Deployment Status | Fleet Management | `dynatrace.fleet.management` |
| `dynatrace.classic.distributed.traces` | Distributed Traces Classic | Distributed Tracing | `dynatrace.distributedtracing` |
| `dynatrace.classic.extensions` | Extensions | Extensions | `dynatrace.extensions.manager` |
| `dynatrace.classic.frontend` | Frontend | Experience Vitals | `dynatrace.experience.vitals` |
| `dynatrace.classic.gcp` | GCP Classic | Clouds | `dynatrace.clouds` |
| `dynatrace.classic.network` | Host Networking | Infrastructure & Operations | `dynatrace.infraops` |
| `dynatrace.classic.hosts` | Hosts Classic | Infrastructure & Operations | `dynatrace.infraops` |
| `dynatrace.classic.kubernetes` | Kubernetes Classic | Kubernetes | `dynatrace.kubernetes` |
| `dynatrace.classic.kubernetes.workloads` | Kubernetes Workloads Classic | Kubernetes | `dynatrace.kubernetes` |
| `dynatrace.classic.logs.events` | Logs & Events Classic | Logs | `dynatrace.logs` |
| `dynatrace.classic.queues` | Message Queues | **— none yet** | — |
| `dynatrace.classic.metrics` | Metrics | **— none yet** | — |
| `dynatrace.classic.mobile` | Mobile | Experience Vitals | `dynatrace.experience.vitals` |
| `dynatrace.classic.mda` | Multidimensional Analysis | Notebooks | `dynatrace.notebooks` |
| `dynatrace.classic.one.agent.health` | OneAgent Health | Fleet Management | `dynatrace.fleet.management` |
| `dynatrace.classic.deploy.paas` | PaaS Integration | **— none yet** | — |
| `dynatrace.classic.problems` | Problems Classic | Problems | `dynatrace.davis.problems` |
| `dynatrace.classic.query.user.sessions` | Query User Sessions | Users & Sessions | `dynatrace.users.sessions` |
| `dynatrace.classic.releases` | Releases | **— none yet** | — |
| `dynatrace.classic.reports` | Reports | Notebooks | `dynatrace.notebooks` |
| `dynatrace.classic.security.overview` | Security Overview | Vulnerabilities | `dynatrace.security.vulnerabilities` |
| `dynatrace.classic.slo` | Service-Level Objectives Classic | Service-Level Objectives | `dynatrace.service.level.objectives` |
| `dynatrace.classic.services` | Services Classic | Services | `dynatrace.services` |
| `dynatrace.classic.session.replay` | Session Replay Classic | Users & Sessions | `dynatrace.users.sessions` |
| `dynatrace.classic.session.segmentation` | Session Segmentation | Users & Sessions | `dynatrace.users.sessions` |
| `dynatrace.classic.smartscape` | Smartscape Classic | Smartscape | `dynatrace.smartscape` |
| `dynatrace.classic.synthetic` | Synthetic Classic | Synthetic | `dynatrace.synthetic` |
| `dynatrace.classic.notifications` | System Notifications | **— none yet** | — |
| `dynatrace.classic.technologies` | Technologies & Processes Classic | Infrastructure & Operations | `dynatrace.infraops` |
| `dynatrace.classic.vulnerabilities` | Third-Party Vulnerabilities | Vulnerabilities | `dynatrace.security.vulnerabilities` |
| `dynatrace.classic.user.settings` | User Settings | **— none yet** | — |
| `dynatrace.classic.vmware` | VMware Classic | Hub | `dynatrace.hub` |
| `dynatrace.classic.web` | Web | Experience Vitals | `dynatrace.experience.vitals` |
## Table 2 — post-upgrade API & settings behavior (122 rules: 102 BLOCK · 17 VISIBLE · 3 HIDE)

Source variable: `ApiStatus`. **Rules are priority-ordered and the LOWEST priority number wins** —
this is a longest-match-by-priority ruleset, not a flat list. `/api/config/v1/applications/web`
(priority 10, VISIBLE) survives even though `/api/config/v1` (priority 100, BLOCK) would otherwise
capture it. Evaluate a path against the whole table in priority order; never grep a single row.

Behaviors: **BLOCK** = the endpoint stops serving after the upgrade (the break list) · **HIDE** =
still functional but de-listed from discovery · **VISIBLE** = survives unchanged.

Join key is `resource` from **B43**, after that probe's normalization strips tenant and object IDs —
so a caller-attribution finding can state, per integration, which of its calls land on BLOCK rows.

| Priority | API path / settings schema | Post-upgrade behavior |
|---|---|---|
| 10 | `/api/config/v1/applications/mobile` | **VISIBLE** |
| 10 | `/api/config/v1/applications/symfiles` | **VISIBLE** |
| 10 | `/api/config/v1/applications/web` | **VISIBLE** |
| 10 | `/api/config/v1/aws/privateLink` | **VISIBLE** |
| 10 | `/api/config/v1/calculatedMetrics/mobile` | **VISIBLE** |
| 10 | `/api/config/v1/service/customServices` | **VISIBLE** |
| 10 | `/api/config/v1/service/requestAttributes` | **VISIBLE** |
| 10 | `/api/config/v1/service/requestNaming` | **VISIBLE** |
| 100 | `/api/config/v1` | **BLOCK** |
| 110 | `/api/v1/deployment/image/agent` | **BLOCK** |
| 110 | `/api/v1/deployment/image/gateway` | **BLOCK** |
| 110 | `/api/v1/entity` | **BLOCK** |
| 110 | `/api/v1/events` | **BLOCK** |
| 110 | `/api/v1/maintenance` | **BLOCK** |
| 110 | `/api/v1/problem` | **BLOCK** |
| 110 | `/api/v1/support/alerts` | **BLOCK** |
| 110 | `/api/v1/thresholds` | **BLOCK** |
| 110 | `/api/v1/timeseries` | **BLOCK** |
| 110 | `/api/v1/tokens` | **BLOCK** |
| 200 | `/api/v1` | **VISIBLE** |
| 205 | `/api/bizevents/ingest` | **VISIBLE** |
| 205 | `/api/v2/entities/grail` | **VISIBLE** |
| 205 | `/api/v2/events/ingest` | **VISIBLE** |
| 205 | `/api/v2/logs/ingest` | **VISIBLE** |
| 205 | `/api/v2/metrics/ingest` | **VISIBLE** |
| 205 | `/api/v2/otlp` | **VISIBLE** |
| 210 | `/api/v2/activeGates/tokenEnforcement` | **BLOCK** |
| 210 | `/api/v2/attacks` | **BLOCK** |
| 210 | `/api/v2/auditlogs` | **BLOCK** |
| 210 | `/api/v2/davis/securityAdvices` | **BLOCK** |
| 210 | `/api/v2/entities` | **BLOCK** |
| 210 | `/api/v2/entityTypes` | **BLOCK** |
| 210 | `/api/v2/events` | **BLOCK** |
| 210 | `/api/v2/hub` | **HIDE** |
| 210 | `/api/v2/logs` | **BLOCK** |
| 210 | `/api/v2/metrics` | **BLOCK** |
| 210 | `/api/v2/monitoringstate` | **BLOCK** |
| 210 | `/api/v2/networkZoneSettings` | **BLOCK** |
| 210 | `/api/v2/networkZones` | **HIDE** |
| 210 | `/api/v2/releases` | **HIDE** |
| 210 | `/api/v2/securityProblems` | **BLOCK** |
| 210 | `/api/v2/settings/managementZones` | **BLOCK** |
| 210 | `/api/v2/settings/problemNotifications:sendTestNotification` | **BLOCK** |
| 210 | `/api/v2/slo` | **BLOCK** |
| 210 | `/api/v2/tags` | **BLOCK** |
| 210 | `/api/v2/ua` | **BLOCK** |
| 210 | `/api/v2/units` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:alerting.maintenance-window` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:alerting.profile` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.disk-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.frequent-issues` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.infrastructure-aws` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.infrastructure-disks` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.infrastructure-disks.per-disk-override` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.infrastructure-hosts.high-gc` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.infrastructure-vmware` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.metric-events` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.rum-custom` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:anomaly-detection.rum-custom-crash-rate-increase` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:app-transition.kubernetes` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:audit-log` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:availability.process-group-alerting` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:bizevents-dql-processing-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:bizevents-processing-buckets.rule` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:bizevents-processing-metrics.rule` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:bizevents-processing-pipelines.rule` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:bizevents-security-context-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:cloud-automation.instances` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:cloud.aws` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:cloud.cloudfoundry` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:custom-metrics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:custom-unit` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:dashboards.general` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:dashboards.image.allowlist` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:dashboards.presets` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:histogram-metrics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:internal.audit-log` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:issue-tracking.integration` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.log-buckets-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.log-custom-attributes` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.log-dpp-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.log-events` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.log-security-context-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:logmonitoring.schemaless-log-metric` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:management-zones` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:mobile.notifications` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:monitoredentities.grail.security.context` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:monitoring.slo` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:monitoring.slo.normalization` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:naming.hosts` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:naming.processes-and-containers` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:naming.services` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:os.services.monitoring` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:platform-event-correlation` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:problem.notifications` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:remote.environment` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:rum.web.resource-cleanup-rules` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:rum.web.resource-types` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:security-context` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:settings.calculated-service-metrics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:synthetic.third-party.assigned-applications` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:synthetic.third-party.name` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:tags.auto-tagging` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:tags.manual-tagging` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:unified-services-endpoint-metrics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:usability-analytics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:user-action-custom-metrics` | **BLOCK** |
| 230 | `/api/v2/settings/schemas/builtin:virtualization.vmware` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:activegate-token` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:anomaly-detection.databases` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:attribute-allow-list` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:attribute-block-list` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:attribute-masking` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:attributes-preferences` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:monitoredentities.generic.relation` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:monitoredentities.generic.type` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:networkzones` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:service-detection.external-web-request` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:service-detection.external-web-service` | **BLOCK** |
| 231 | `/api/v2/settings/schemas/builtin:tokens.token-settings` | **BLOCK** |
| 300 | `/api/v2` | **VISIBLE** |
| 9999 | `/api` | **VISIBLE** |
## How the two tables get used

| Consumer | Table | Use |
|---|---|---|
| **B43** / gen3 **E10** | 2 | Classify each observed classic call as BLOCK / HIDE / VISIBLE; the BLOCK share per caller **is** the integration break list. A caller whose traffic is entirely VISIBLE is not migration debt — do not report it as such. |
| **B46** / gen3 **E5, E7** | 1 | Name the successor app per classic app in use. Rows with no successor are ⚪ (appendix footnote), never a gap. |
| **`/dt-eval-mz2seg`** | 2 | `builtin:management-zones`, `builtin:tags.auto-tagging` and `/api/v2/settings/managementZones` are all **BLOCK** — the concrete "what stops working" behind a zone-retirement plan, and the reason the consumer census must include API callers, not just in-product consumers. |
| **Any report's Path forward** | 1, 2 | Turn a capability statement into a named successor plus a named break. |
