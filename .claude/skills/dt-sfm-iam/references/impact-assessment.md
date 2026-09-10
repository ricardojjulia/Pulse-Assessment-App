# IAM Impact Assessment

Blast radius queries and impact classification. For auth vs authz triage, see [SKILL.md](../SKILL.md) "Distinguishing Authentication vs Authorization Issues".

## Contents

- [Affected Users & Environments](#affected-users--environments)
- [Blast Radius: Per-Permission](#blast-radius-per-permission)
- [Blast Radius: Per-App](#blast-radius-per-app)
- [Blast Radius: Token Service](#blast-radius-token-service)
- [Impact Classification](#impact-classification)
- [Database Health Overview](#database-health-overview)
- [Existing Alerting Coverage](#existing-alerting-coverage)
- [Impact Assessment Workflow](#impact-assessment-workflow)

---

## Affected Users & Environments

### Users Affected by Authorization Denials

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision == "DENY"
| summarize {
    deny_count = count(),
    permissions = collectDistinct(permission),
    levels = collectDistinct(`http.request.header.dt-tenant`)
  }, by: {principal}
| sort deny_count desc
```

### Environments (Levels) Affected by Authorization Denials

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision == "DENY"
| summarize {
    deny_count = count(),
    user_count = countDistinctApprox(principal),
    permissions = collectDistinct(permission)
  }, by: {`http.request.header.dt-tenant`}
| sort deny_count desc
```

### Users Affected by Authentication Failures (SSO bizevents)

```dql
fetch bizevents
| filter dt.system.bucket == "custom_sen_low_sso_idp_bizevents"
| filter event.type == "sso.idp.login.failed"
  or event.type == "sso.idp.stepUp.failed"
  or event.type == "sso.idp.mfa.verification.failed"
| summarize {
    failure_count = count(),
    failure_types = collectDistinct(event.type)
  }, by: {user_uuid}
| sort failure_count desc
```

### Authentication Failure Rate Over Time

```dql
fetch bizevents
| filter dt.system.bucket == "custom_sen_low_sso_idp_bizevents"
| filter event.type == "sso.idp.login.failed"
  or event.type == "sso.idp.login.successful"
| summarize {
    total = count(),
    failures = countIf(event.type == "sso.idp.login.failed"),
    successes = countIf(event.type == "sso.idp.login.successful")
  }, by: {bin(timestamp, 5m)}
| fieldsAdd failure_rate_pct = (failures * 100.0) / total
| sort `bin(timestamp, 5m)` desc
```

---

## Blast Radius: Per-Permission

### Which Permissions Are Failing Most

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision != "ALLOW"
| summarize {
    count = count(),
    unique_users = countDistinctApprox(principal),
    decisions = collectDistinct(decision)
  }, by: {permission}
| sort count desc
```

### Per-Permission Impact by App

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter isNotNull(`http.request.header.dt-app-context`)
  and iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision != "ALLOW"
| fields {`http.request.header.dt-app-context`, alias: appId}, permission, trace.id, decision, principal
| summarize {
    trace_count = countDistinct(trace.id),
    user_count = countDistinctApprox(principal),
    permissions = collectDistinct(permission)
  }, by: {appId}
| sort trace_count desc
```

---

## Blast Radius: Per-App

### Apps Most Affected by IAM Failures

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.[ApiGW][ApiGateway] App ID`)[]))
  and iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| expand {`request_attribute.[ApiGW][ApiGateway] App ID`, alias: appId}
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filterOut token_valid == "VALID" AND decision == "ALLOW"
| summarize {
    count = count(),
    permissions = collectDistinct(permission),
    decisions = collectDistinct(decision)
  }, by: {appId}
| sort count desc
```

---

## Blast Radius: Token Service

### Token Request Failures

```dql
timeseries sum(dt.service.request.failure_count), filter: { matchesValue(getNodeField(dt.smartscape.service, "name"), "*OAuth2TokenResource*") }
```

### Token Requests by OAuth Client ID

```dql
timeseries { sum(service.oauth2tokenrequestsbyclientid), 
            value.A = sum(service.oauth2tokenrequestsbyclientid, scalar: true) }, by: { Client_Id }
```

---

## Impact Classification

### Data Unavailability (Grail DAC)

PDP denies data-access permissions → Grail row/field-level access control blocks results.

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision == "DENY" AND contains(permission, "storage")
| summarize count = count(), users = countDistinctApprox(principal), by: {permission}
| sort count desc
```

### API/Feature Unavailability

PDP denies feature-level permissions (e.g., `app-engine:apps:run`, `settings:objects:read`). Use "Per-Permission Impact by App" query above.

### Unauthorized Access (Security)

**CRITICAL**: If suspected, **escalate immediately**. Causes: policy misconfiguration, stale PDP cache. Check:
1. Recent policy changes in audit logs (see [log-correlation.md](log-correlation.md))
2. PRP WebSocket notification health
3. PDP cache version (`request_attribute.IAM PDP modified since`)

### Platform-Wide Outage

All users affected, widespread 401/403 → Token Service or SSO IDP down.

```dql
timeseries {
    total = sum(dt.service.request.count),
    failures = sum(dt.service.request.failure_count)
  }, by: {dt.smartscape.service},
    filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter isNotNull(tags[IAM_PRP]) | fields id]}
| append [
  timeseries {
      total = sum(dt.service.request.count),
      failures = sum(dt.service.request.failure_count)
    }, by: {dt.smartscape.service},
    filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter tags[k8s.namespace.name] == "sso" and tags[k8s.cluster.name] == "iam-prod" and startsWith(name, "SSO") | fields id]}
]
| fieldsAdd error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

---

## Database Health Overview

For database architecture details (SSO Aurora MySQL vs Authz Aurora PostgreSQL), see [iam-components.md](iam-components.md) "IAM Databases (AWS RDS)" section.

### Authz DB: Service-Level RED Metrics (Writer + Readers)

See [iam-components.md](iam-components.md) "Health Check: Authz DB Service Performance (Writer + Readers)".

### Authz DB: Top 10 Slowest Read-Only Queries

Uses calculated metric to identify slow DB queries on the Authz Postgres reader.

```dql
timeseries { sum(service.iamtop10slowestqueriesreadonly_v002), 
        value.A = sum(service.iamtop10slowestqueriesreadonly_v002, scalar: true) 
    }, by: { db.query.text }
```

### Authz DB: Top 10 Most Frequent Read-Only Queries

```dql
timeseries sum(service.iamtop10performedqueriesreadonly_v002), by: { endpoint.name }
```

### SSO DB: List All RDS Instances

See [iam-components.md](iam-components.md) "Health Check: List All SSO RDS Instances (SSO MySQL)".

### Authz DB: List All RDS Instances

See [iam-components.md](iam-components.md) "Health Check: List All IAM RDS Instances (Authz Postgres)".

### Database-Related Events (IAM_DB Tagged Services)

Recent Davis events on IAM database services (response time thresholds, failover, CPU saturation).

```dql
fetch events, from: -7d
| filter contains(toString(entity_tags), "IAM_DB") or contains(toString(entity_tags), "SSO-DB")
| fields timestamp, event.name, event.status, event.kind, event.category, smartscape.affected_entity.ids, entity_tags
| sort timestamp desc
| limit 50
```

### RDS-Level Events (All IAM RDS Instances)

Events on `AWS_RDS_DBINSTANCE` entities (backup, CPU saturation, failover, maintenance).

```dql
fetch events, from: -7d
| filter contains(toString(smartscape.affected_entity.ids), "RELATIONAL_DATABASE_SERVICE")
| filter contains(toString(entity_tags), "IAM") or contains(toString(entity_tags), "SSO")
| fields timestamp, event.name, event.status, event.kind, event.category, entity_tags
| sort timestamp desc
| limit 50
```

---

## Existing Alerting Coverage

Pre-configured alerts. ALWAYS check status before manual investigation.

| Alert | Component | What It Detects |
|---|---|---|
| PRP Response Time SLO | PRP | Response time SLO breach |
| PRP Success Rate SLO | PRP | Success rate SLO breach |
| Level Access Worker calculation time | Authz | Unusually long worker execution |
| PAP/PRP ALB Target 5xx errors | PRP/PAP | Backend 5xx errors via ALB |
| PAP/PRP ALB Target connection errors | PRP/PAP | Backend connection failures via ALB |
| DB response time above threshold | IAM DB | Database latency spike |
| Failover Davis notification | IAM | Failover event triggered |
| PRP throttling | PRP | Request throttling activated |
| Email Error Rate | SSO IDP | Email MFA sending errors |
| Email Quota Exceeded (1h/24h) | SSO IDP | Email quota thresholds (50/75/90/100%) |
| High Failed Login Rate | SSO IDP | Abnormal login failure rate |
| DB Connections Saturation | SSO DB | Connection pool near capacity |
| DB CPU Usage Exceeded | SSO DB | Database CPU overload |
| Pods restarting | IAM K8s | Pod restart loops |
| Pods pending | IAM K8s | Pods stuck pending |
| Recaptcha Enabled | SSO IDP | Attack mitigation activated |

---

## Impact Assessment Workflow

1. **Identify the issue type** — Authentication, Authorization, or Security (see triage table above)
2. **Quantify affected users** — Run user-count queries for the specific issue type
3. **Quantify affected environments** — Run level/environment count queries
4. **Identify affected apps** — Run per-app blast radius queries
5. **Classify impact** — Data unavailability, API/feature blocked, unauthorized access, or platform-wide outage
6. **Check existing alerts** — Review if automated alerts already fired for this issue
7. **Report** — Include: issue type, affected user count, affected environment count, affected apps, impact classification, timeline
