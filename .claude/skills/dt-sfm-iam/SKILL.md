---
name: dt-sfm-iam
description: Dynatrace IAM self-monitoring — authentication (SSO IDP/IDM), token management (Token Service), and authorization (Authz PDP/PRP/PAP). Investigate IAM-related issues from consumer perspective, correlate platform workload errors with IAM component health, assess blast radius and impact on users/environments.
---

# IAM Self-Monitoring Skill

Investigate IAM issues from the **consumer perspective** — platform workloads (ApiGateway, Platform Services, Grail) depending on IAM.

## IAM Architecture

### Central Backend Components (dedicated K8s cluster)

| Component | Role | Criticality | K8s Namespace   |
|---|---|---|-----------------|
| **SSO IDP** | Identity Provider — password login, SAML, OpenID, Single Sign-On/Logout | **Critical** — if down, no user authentication | `sso`           |
| **SSO IDM** | Identity Management — users, groups, accounts, OAuth clients, platform tokens | High — management operations fail | `sso`           |
| **Token Service** | Issue/refresh/exchange OAuth tokens, resolve platform tokens, UserInfo endpoint | **Critical** — if down, no token operations platform-wide | `token-service` |
| **IAM PRP** | Policy Retrieval Point — serves authorization policies to PDP, WebSocket notifications | **Critical** — if down, PDP caches go stale | `prod`          |
| **IAM PAP** | Policy Administration Point — policy CRUD operations | High — policy management fails | `prod`          |

### Libraries (embedded in platform workloads)

| Library | Role | Embedded In |
|---|---|---|
| `dynatrace-oauth` / `dynatrace-oauth-reactive` | Token resolution caching layer for Token Service APIs | ApiGateway, Platform Services, Grail |
| `iam-pdp` | Policy Decision Point — evaluates authorization decisions | ApiGateway, Platform Services, Grail |
| `iam-pep` | Policy Enforcement Point — enforces PDP decisions | ApiGateway, Platform Services, Grail |

**PDP library deployment**: The `iam-pdp` library runs inside consumer workloads deployed on platform K8s clusters (`dtp-<deployment>-apigw`, `dtp-<deployment>-plsrv`, `dtp-<deployment>-grail`). Each library import creates a separate "IAM PDP Service" entity in Dynatrace — expect multiple PDP service instances across clusters. PDP library logs go to the log bucket of the hosting workload, **not** the IAM-dedicated bucket. For PDP authorization decisions, **prefer querying spans** (via `request_attribute.IAM PDP resolution context`) over logs — spans capture decisions across all platform workloads regardless of log bucket.

### How IAM Serves the Platform

```
End User → ApiGateway (OpenID flow → Token Service → OAuth/Access tokens)
                ↓
         Platform Services (dynatrace-oauth resolves token → iam-pdp evaluates policies from PRP cache)
                ↓
         Grail (PDP resolution result → row/field level data access control)
```

**CRITICAL**: IAM libraries run *inside* consumer workloads. Consumer errors may originate from IAM backend or library failures.

## Use Case Routing

| You want to... | Read |
|---|---|
| Check health of specific IAM component (SSO, Token Service, PRP/PAP) | [iam-components.md](references/iam-components.md) |
| Correlate consumer errors with IAM logs | [log-correlation.md](references/log-correlation.md) |
| Determine affected users/environments/impact | [impact-assessment.md](references/impact-assessment.md) |
| Find an existing IAM dashboard | [dashboards.md](references/dashboards.md) |

## Key Identifiers

### K8s Clusters

| Environment | Cluster Name |
|---|---|
| Production | `iam-prod` |
| Hardening | `iam-hardening` |
| Development | `iam-dev` |
| Sandbox | `iam-sandbox` |

### Self-Monitoring Tenants

| Tenant | Environment | Usage |
|---|---|---|
| `dre63214` | Production (primary) | Main self-monitoring tenant |
| `ntd44713` | Production (legacy) | Legacy prod monitoring |
| `gmg80500` | deve2e | Dev/E2E self-monitoring (`gmg80500.dev.apps.dynatracelabs.com`) |

### Environment-Specific Values

When targeting deve2e, substitute values from the table below. SSO and Token Service namespaces are the same across environments.

| Value | Production (`dre63214`) | deve2e (`gmg80500`) |
|---|---|---|
| K8s cluster | `iam-prod` | `iam-dev` |
| Authz namespace | `prod` | `dev` |
| SSO namespace | `sso` | `sso` |
| Token Service namespace | `token-service` | `token-service` |

### Auto-Tags for Filtering

| Tag | Targets |
|---|---|
| `IAM_PRP` | PRP services |
| `IAM_PAP` | PAP services |
| `IAM_AA` | Access Approval services |
| `IAM_DB` | IAM databases |
| `IAM_READER_DB` | IAM read-replica databases |
| `IAM_RP` | IAM RP services |
| `IAM` | All IAM processes |

### Log Buckets

See [log-correlation.md](references/log-correlation.md) for full bucket map with components and usage patterns.

| Bucket | Content                                 |
|---|-----------------------------------------|
| `custom_sen_low_logs_platform_services_access_control_shared` | PRP/PAP central services, SSO IDP/IDM, Token Service |
| `custom_sen_low_sso_idp_bizevents` | SSO bizevents (logins, MFA)             |
| `custom_sen_low_logs_lima_shared` | Account management audit                |

**NOTE**: PDP library logs are **not only** in the IAM-dedicated bucket. PDP runs inside consumer workloads — its logs are stored in the bucket of the hosting platform workload.

### Request Attributes for Consumer Correlation

| Request Attribute | What It Captures |
|---|---|
| `IAM PDP resolution context` | Full PDP decision: principal, permission, token validity, decision (ALLOW/DENY/CONDITIONAL) |
| `IAM PDP resolution` | PDP resolution result |
| `IAM PDP permission` | Permission being evaluated |
| `IAM PDP principal` | User principal (UUID) |
| `IAM PDP modified since` | If-Modified-Since header for PDP cache |
| `IAM PDP Iam version` | IAM library version |
| `IAM PRP WebSocket event` | PRP WebSocket notification events |
| `IAM PDP WebSocket event` | PDP WebSocket notification events |
| `OAuth-Resolution-Reactive-Version` | dynatrace-oauth-reactive library version |
| `OAuth-Resolution-Version` | dynatrace-oauth (non-reactive) library version |
| `Oauth2Token ClientId` | OAuth2 client ID in token requests |
| `Oauth2Token GrantType` | OAuth2 grant type (auth_code, client_credentials, refresh, exchange) |

### SLOs

| SLO | Target | Metric |
|---|---|---|
| PRP Availability | 99.98% | Success rate of requests to PRP services (tag: `IAM_PRP`) |
| PRP Performance | 99% | % of requests with response time < 2s |
| PRP Success Rate (legacy) | 99.98% (warning: 99.99%) | Classic SLO on PRP service |
| PRP Response Time (legacy) | 90% (warning: 95%) | Classic SLO on PRP response time |

## Agent Instructions

### Triage Flow

**ALWAYS follow this sequence when investigating IAM-related issues:**

1. **Is this an IAM issue?** — Check if consumer errors correlate with IAM component health
2. **Which component?** — Authentication (SSO/Token Service) or Authorization (PDP/PRP/PAP)?
3. **Central or library?** — Is it the IAM backend that's failing, or the embedded library inside the consumer workload?
4. **Who's affected?** — Which users, environments, accounts, apps?
5. **What's the impact?** — Data unavailable? API blocked? Feature inaccessible? Or data/API leaking (security)?

### Intent Mapping

| User Request | Capability | Reference |
|---|---|---|
| "login failing", "authentication error", "SSO down", "can't sign in" | SSO IDP Health | iam-components.md |
| "token error", "OAuth failure", "token refresh failing", "401 errors" | Token Service Health | iam-components.md |
| "permission denied", "403 error", "authorization failure", "policy issue" | IAM Authorization (PDP/PRP) | iam-components.md + log-correlation.md |
| "which users affected", "blast radius", "customer impact" | Impact Assessment | impact-assessment.md |
| "IAM logs", "PDP logs", "correlate with consumer" | Log Correlation | log-correlation.md |
| "IAM dashboard", "monitoring overview" | Dashboard Index | dashboards.md |
| "PRP SLO", "availability", "performance" | SLO Status | iam-components.md |
| "policy change", "audit", "who modified policy" | Audit Logs | log-correlation.md |

### Query Best Practices

- **ALWAYS set `scanLimitGBytes: -1`** on log queries to avoid scan-limit errors
- **ALWAYS filter by log bucket** — IAM logs are spread across 5+ buckets
- **Use auto-tags** (`IAM_PRP`, `IAM_PAP`, `IAM_DB`, etc.) for IAM authorization service filtering in metric queries
- **Use K8s namespace tags** (`k8s.namespace.name`, `k8s.cluster.name`) in Smartscape node filters for SSO and Token Service filtering — dedicated SSO auto-tags may not be applied in all tenants
- **Use `k8s.cluster.name`** for cluster-level filtering in log queries (e.g., `iam-prod`)
- **Use `k8s.namespace.name`** for namespace-level filtering in log queries (`sso`, `token-service`, `prod`)
- **Parse `request_attribute.IAM PDP resolution context`** to extract principal, permission, token validity, and decision from consumer spans
- **Prefer spans over logs for PDP decisions** — PDP library runs in consumer workloads across platform clusters; span request attributes capture decisions regardless of log bucket
- **Use `http.request.header.dt-tenant`** in span queries as the levelId/environment identifier
- **Timeframes**: Use `2h` for real-time log queries, `7d` for trend analysis, `30d` for authorization decision patterns, `10m` for span queries.
- **deve2e environment**: Substitute `iam-dev` for `iam-prod` and namespace `dev` for `prod` in authorization queries. SSO and Token Service namespaces remain unchanged.

### Distinguishing Authentication vs Authorization Issues

| Symptom | Likely Component | Investigation Path |
|---|---|---|
| Users cannot log in at all | SSO IDP | Check IDP health, synthetic monitors, login flows |
| Token refresh/exchange fails (401) | Token Service | Check Token Service custom services, OAuth grant flows |
| Specific API returns 403 | IAM PDP/PRP | Check PDP resolution context in consumer spans, PRP availability |
| Data missing in Grail queries | IAM PDP → Grail DAC | Check PDP decisions for data-access permissions, level access |
| Policy changes not taking effect | PRP WebSocket | Check WebSocket events, PRP cache staleness |
| User management operations fail | SSO IDM | Check IDM health dashboard, IDM worker status |

## Common Workflows

### Workflow: Is This an IAM Issue?

```
1. Check consumer error details (HTTP status, error message, trace)
2. Look for IAM request attributes in the consumer span (IAM PDP resolution context, OAuth resolution version)
3. If present → IAM is involved. Check resolution decision field.
4. If DENY/error → Read log-correlation.md for detailed investigation
5. If no IAM request attributes → Issue is likely not IAM-related
```

### Workflow: Authentication Failure Investigation

```
1. Check SSO IDP Health dashboard → synthetic monitors status
2. Query IDP service RED metrics (response time, error rate, throughput)
3. Check Token Service health if token-related (refresh, exchange failures)
4. Examine SSO bizevents for login patterns (bucket: custom_sen_low_sso_idp_bizevents)
5. Check K8s pod health for SSO namespace
```

### Workflow: Authorization Failure Investigation

```
1. Parse consumer span for `request_attribute.IAM PDP resolution context`
2. Extract: principal, permission, decision, token validity
3. If decision == DENY → Check if policy exists/is correct (audit logs)
4. If PRP unavailable → Check PRP SLOs, service health, WebSocket events
5. If stale policies → Check PRP cache refresh, WebSocket events
```

## References

- [references/iam-components.md](references/iam-components.md) — Component health checks and DQL queries
- [references/log-correlation.md](references/log-correlation.md) — Log browsing, bucket map, consumer correlation
- [references/impact-assessment.md](references/impact-assessment.md) — Blast radius and impact analysis
- [references/dashboards.md](references/dashboards.md) — Dashboard index
