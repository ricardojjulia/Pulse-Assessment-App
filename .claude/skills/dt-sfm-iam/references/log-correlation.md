# IAM Log Correlation

Canonical reference for IAM log browsing and consumer→IAM error correlation.

## Contents

- [Log Bucket Map](#log-bucket-map)
- [Browsing IAM Logs by Component](#browsing-iam-logs-by-component)
- [Consumer → IAM Correlation](#consumer--iam-correlation)
- [Audit & Policy Change Logs](#audit--policy-change-logs)

---

## Log Bucket Map

**CRITICAL**: IAM logs are spread across multiple Grail buckets. ALWAYS filter by `dt.system.bucket` to avoid scanning irrelevant data.

| Bucket | Content | Components | Typical Use |
|---|---|---|---|
| `custom_sen_low_logs_platform_services_access_control_shared` | IAM central backend application logs | PRP, PAP, IDP, IDM, Token Service | Authorization policy service errors, authentication failures, login errors, session issues |
| `custom_sen_low_sso_idp_bizevents` | SSO business events | IDP | Login/logout events, MFA events, user audit trail |
| `custom_sen_low_logs_lima_shared` | Account management audit logs | IDM (account API) | User-account assignment/unassignment audit |

---

## Browsing IAM Logs by Component

### IAM Policy Service (PRP/PAP) Logs

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.cluster.name == "iam-prod"
| filter k8s.namespace.name == "prod"
| fields timestamp, status, content, k8s.pod.name
| sort timestamp desc
| limit 200
```

### SSO IDP Logs

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.cluster.name == "iam-prod"
| filter k8s.namespace.name == "sso"
| filter startsWith(k8s.pod.name, "sso-idp")
| fields timestamp, status, content, k8s.pod.name
| sort timestamp desc
| limit 200
```

### SSO IDM Logs

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.cluster.name == "iam-prod"
| filter k8s.namespace.name == "sso"
| filter startsWith(k8s.pod.name, "sso-idm")
| fields timestamp, status, content, k8s.pod.name
| sort timestamp desc
| limit 200
```

### Token Service Logs

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.cluster.name == "iam-prod"
| filter k8s.namespace.name == "token-service"
| fields timestamp, status, content, k8s.pod.name
| sort timestamp desc
| limit 200
```

### SSO Eventbus Logs

```dql
fetch logs, scanLimitGBytes: -1, samplingRatio: 10
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.container.name == "sso-eventbus-consumer-app"
| filter k8s.cluster.name == "iam-prod"
| fields timestamp, content
| sort timestamp desc
| limit 50
```

---

## Consumer → IAM Correlation

### Pattern: Consumer 403 → PDP Authorization Decision

**Step 1: Find consumer spans with non-ALLOW PDP decisions**

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision != "ALLOW"
| fields timestamp, trace.id, principal, permission, token_valid, decision, dt.smartscape.service
| fieldsAdd getNodeName(dt.smartscape.service)
| sort timestamp desc
| limit 100
```

**Step 2: Drill into specific trace** (replace `<TRACE_ID>`):

```dql
fetch spans, scanLimitGBytes: -1
| filter trace.id == toUid("<TRACE_ID>")
| fields timestamp, span.name, duration, status.code, dt.smartscape.service,
  `request_attribute.IAM PDP resolution context`,
  `request_attribute.IAM PDP resolution`,
  `request_attribute.IAM PDP permission`,
  `request_attribute.IAM PDP principal`
| fieldsAdd getNodeName(dt.smartscape.service)
| sort timestamp asc
```

### Pattern: Consumer 401 → Token Service Issue

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true
| filter status.code == 2 OR http.response.status_code == 401
| filter isNotNull(`request_attribute.OAuth-Resolution-Reactive-Version`)
| fields timestamp, trace.id, span.name, http.response.status_code,
  `request_attribute.OAuth-Resolution-Reactive-Version`,
  dt.smartscape.service
| fieldsAdd getNodeName(dt.smartscape.service)
| sort timestamp desc
| limit 100
```

For app-specific and per-permission blast radius queries, see [impact-assessment.md](impact-assessment.md).

### Pattern: Permissions with Most DENY Decisions (from spans)

**NOTE**: PDP library runs inside consumer workloads (ApiGateway, Platform Services, Grail). Span request attributes capture PDP decisions across all platform clusters, unlike logs which are bucket-specific.

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
    count = count(),
    userCount = countDistinctApprox(principal),
    levelCount = countDistinctApprox(`http.request.header.dt-tenant`),
    levels = collectDistinct(`http.request.header.dt-tenant`)
  }, by: {permission}
| sort count desc
```

### Pattern: DENY Decisions Over Time for Specific Permission

Replace `<PERMISSION>` (e.g., `app-engine:apps:run`):

```dql
fetch spans, scanLimitGBytes: -1
| filter request.is_root_span == true AND isNotNull(endpoint.name)
| filter iAny(isNotNull(toArray(`request_attribute.IAM PDP resolution context`)[]))
| expand `request_attribute.IAM PDP resolution context`
| parse `request_attribute.IAM PDP resolution context`, """
'Principal: ' (UUIDSTRING | '<unknown user uuid>'):principal ', permission: ' LD:permission (', token: '| ', tokenScope: ') LD:token_valid ', decision: ' string:decision
"""
| filter decision == "DENY"
| filter permission == "<PERMISSION>"
| makeTimeseries DENY = count()
```

---

## Audit & Policy Change Logs

### Policy Management Audit Logs

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter matchesValue(k8s.namespace.name, "prod") and matchesPhrase(content, "AUDIT") and matchesValue(k8s.container.name, "iam-policy-service")
| parse content, """TIMESTAMP('yyyy-MM-dd HH:mm:ss.S',tz='UTC'):f_0 ' 'LD:log_level ' ' LD:logger_name 'dt.trace_id=' DATA:trace_id ' ' DATA:f_8 ' dt.entity.process_group_instance=' LD:pgi '- ' LD{1,65536}:audit_log"""
| fields timestamp, audit_log
| sort timestamp desc
```

Append `| filter matchesPhrase(audit_log, "<policy-name>")` to filter by policy name.

### SSO User Events (Business Events Audit)

```dql
fetch bizevents
| filter matchesValue(dt.system.bucket, "custom_sen_low_sso_idp_bizevents")
| filter matchesValue(user_uuid, "<USER_UUID>")
| sort timestamp desc
| limit 100
```

### Account Management Audit (Lima)

```dql
fetch logs, scanLimitGBytes: -1
| filter matchesValue(dt.system.bucket, "custom_sen_low_logs_lima_shared")
| filter matchesPhrase(content, "<USER_EMAIL_OR_ACCOUNT_UUID>")
| fields timestamp, status, content
| sort timestamp desc
```
