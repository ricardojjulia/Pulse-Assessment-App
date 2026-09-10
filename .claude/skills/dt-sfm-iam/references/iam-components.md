# IAM Component Health Checks

Health DQL queries and custom service references per IAM component. For architecture/criticality see [SKILL.md](../SKILL.md). For alerting coverage see [impact-assessment.md](impact-assessment.md).

## Contents

- [SSO — Identity Provider (IDP)](#sso--identity-provider-idp)
- [SSO — Identity Management (IDM)](#sso--identity-management-idm)
- [Token Service](#token-service)
- [IAM Authorization — Authz (PRP / PAP / PDP)](#iam-authorization--authz-prp--pap--pdp)
- [IAM Databases (AWS RDS)](#iam-databases-aws-rds)

---

## SSO — Identity Provider (IDP)

**K8s**: `iam-prod` / `sso` | **Bucket**: `custom_sen_low_logs_platform_services_access_control_shared`

### Key Custom Services (Java)

| Service | Purpose |
|---|---|
| `SSOSsoSamlServlet` | SAML-based SSO login |
| `SSOFederatedLoginServlet` | Federated login flow |
| `SSOSAMLAssertionConsumerServlet` | SAML assertion consumer |
| `SSOOAuth2AuthorizeServlet` | OAuth2 authorization endpoint |
| `SSOOAuth2LogoutServlet` | OAuth2 logout flow |
| `SSOPasswordChangeServlet` | Password change operations |
| `SSOTenantLoginServlet` | Tenant-specific login |
| `SSOOpenIdAsRpLoginServlet` | OpenID Connect as RP login |
| `SSOLogoutServlet` | Logout operations |
| `SSONotificationServlet` | Notification handling |
| `SSOProfileServlet` | User profile operations |

### Health Check: SSO Service RED Metrics

```dql
timeseries {
  avg_response = avg(dt.service.request.response_time),
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter tags[k8s.namespace.name] == "sso" and tags[k8s.cluster.name] == "iam-prod" and startsWith(name, "SSO") | fields id]}
| fieldsAdd avg_ms = avg_response[] / 1000,
  error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

### Health Check: IDP Logs (Errors)

```dql
fetch logs, scanLimitGBytes: -1
| filter dt.system.bucket == "custom_sen_low_logs_platform_services_access_control_shared"
| filter k8s.cluster.name == "iam-prod"
| filter k8s.namespace.name == "sso"
| filter startsWith(k8s.pod.name, "sso-idp")
| filter status == "ERROR"
| summarize error_count = count(), by: {k8s.container.name, bin(timestamp, 5m)}
| sort `bin(timestamp, 5m)` desc
```

### Health Check: SSO K8s Pod Health

```dql
smartscapeNodes K8S_DEPLOYMENT, K8S_DAEMONSET, K8S_STATEFULSET, K8S_REPLICASET, K8S_REPLICATIONCONTROLLER, K8S_JOB, K8S_DEPLOYMENTCONFIG, from: -2h
| filter contains(name, "sso-idp") or contains(name, "sso-idm") or contains(name, "sso-eventbus")
| fields id, name
| lookup [
    timeseries desired = avg(dt.kubernetes.workload.pods_desired),
    by: {dt.smartscape.k8s_deployment}
  ], sourceField: id, lookupField: dt.smartscape.k8s_deployment, prefix: "desired."
| lookup [
    timeseries ready = avg(dt.kubernetes.workload.pods_ready),
    by: {dt.smartscape.k8s_deployment}
  ], sourceField: id, lookupField: dt.smartscape.k8s_deployment, prefix: "ready."
```

---

## SSO — Identity Management (IDM)

**K8s**: `iam-prod` / `sso` | **Bucket**: `custom_sen_low_logs_platform_services_access_control_shared`

### Key Custom Services

| Service | Purpose |
|---|---|
| `PlatformTokenResource` | Platform token management |
| `PlatformTokenAdminResource` | Admin token operations |
| `SSOSessionInvalidationWorkerService` | Session cleanup |
| `SSOUserDeactivationWorker` | User deactivation processing |
| `SSOUserDeletionWorker` | User deletion processing |
| `SSORemoveExpiredOauthTokensWorker` | OAuth token cleanup |
| `SSORemoveExpiredSessionsWorker` | Session cleanup |
| `SSORemoveExpiredRememberMeTokenWorker` | Remember-me token cleanup |

### Health Check: SSO Worker Status

```dql
timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count),
  avg_time = avg(dt.service.request.response_time)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter tags[k8s.namespace.name] == "sso" and tags[k8s.cluster.name] == "iam-prod" and startsWith(name, "SSO") | fields id]}
| fieldsAdd avg_ms = avg_time[] / 1000,
  error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

### Health Check: SSO Business Events (Login Patterns)

```dql
fetch bizevents
| filter dt.system.bucket == "custom_sen_low_sso_idp_bizevents"
| summarize login_count = count(), by: {event.type, bin(timestamp, 1h)}
| sort `bin(timestamp, 1h)` desc
```

---

## Token Service

**K8s**: `iam-prod` / `token-service` | **Bucket**: `custom_sen_low_logs_platform_services_access_control_shared`

### Key Custom Services (Java)

| Service | OAuth Grant Flow |
|---|---|
| `AuthorizationCodeGrantTokenCreator` | Authorization code → token |
| `AuthorizationCodeGrantProxyTokenCreator` | Authorization code via proxy → token |
| `ClientCredentialsTokenCreator` | Client credentials → token |
| `RefreshTokenGrantCreatorWithFailover` | Token refresh (with failover) |
| `RefreshTokenGrantCreatorWithoutFailover` | Token refresh (without failover) |
| `TokenExchangeTokenCreator` | Token exchange |
| `TokenExchange OAuth Blocking and Reactive Library` | Library-level token exchange |

### Calculated Metrics

| Metric Key | Purpose |
|---|---|
| `Oauth2TokenRequestsByClientId` | Token requests broken down by OAuth client ID |
| `OAuth2TokenResponseTimeByFlow` | Response time per OAuth grant type |

### Request Attributes

| Attribute | Purpose |
|---|---|
| `Oauth2Token ClientId` | OAuth2 client ID in token request |
| `Oauth2Token GrantType` | OAuth grant type (authorization_code, client_credentials, refresh_token, token_exchange) |

### Health Check: Token Service by Grant Flow

```dql
timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count),
  p95 = percentile(dt.service.request.response_time, 95)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter tags[k8s.namespace.name] == "token-service" and tags[k8s.cluster.name] == "iam-prod" | fields id]}
| fieldsAdd p95_ms = p95[] / 1000,
  error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

---

## IAM Authorization — Authz (PRP / PAP / PDP)

**K8s**: `iam-prod` / `prod` | **Tags**: `IAM_PRP`, `IAM_PAP`, `IAM_AA`, `IAM_DB` | **Bucket**: `custom_sen_low_logs_platform_services_access_control_shared`

**NOTE**: This section covers the **central** PRP/PAP services running on the dedicated IAM K8s cluster (`iam-prod`). The PDP *library* runs inside consumer workloads on platform clusters (apigw, plsrv, grail) — it appears as multiple "IAM PDP Service" entities in Dynatrace, one per importing workload. For PDP library health, query consumer spans using `request_attribute.IAM PDP resolution context` (see [log-correlation.md](log-correlation.md)).

### Key Custom Services (Java) — PRP/PAP

| Service | Purpose |
|---|---|
| `IAM PAP public service` | Policy CRUD API |
| `IAM PAP resolution service` | Policy resolution for PAP |
| `IAM PDP service` | PDP resolution (central service side) |
| `IAM Policy DAO` | Policy database operations |
| `IAM Binding DAO` | Policy binding database operations |
| `IAM Level DAO` | Level (environment/account) database operations |
| `IAM Level Access DAO` | Level access database operations |
| `IAM Level Status DAO` | Level status database operations |
| `IAM Level Event Service` | Level event processing |
| `IAM Level Event DAO` | Level event persistence |
| `IAM Effective Permissions DAO` | Effective permissions calculation |
| `IAM Effective Policies Service` | Effective policy evaluation |
| `IAM Policy Boundary DAO` | Policy boundary operations |
| `IAM Service Configuration DAO` | Service config persistence |
| `IAM Service Configuration Service` | Service config management |
| `IAM Scheduler Job` | Scheduled maintenance tasks |
| `IAM Websocket V3 Message Handler Service` | WebSocket message reception |
| `IAM Websocket V3 Message Sender Service` | WebSocket notification dispatch |
| `IAM AA UI Controller` | Access Approval UI |

### Calculated Metrics

| Metric Key | Purpose |
|---|---|
| `service.iamtop10slowestqueriesreadonly_v002` | Top 10 slowest read-only DB queries |
| `service.iamtop10performedqueriesreadonly_v002` | Top 10 most frequently executed read-only DB queries |

Request attributes and SLOs: see [SKILL.md](../SKILL.md) Key Identifiers section.

### Health Check: PRP Availability (SLO formula)

```dql
timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter isNotNull(tags[IAM_PRP]) | fields id]}
| fieldsAdd sli = ((total[] - failures[]) / total[]) * 100
| fieldsAdd getNodeName(dt.smartscape.service)
```

### Health Check: PRP Performance (SLO formula)

```dql
timeseries total = avg(dt.service.request.response_time, default:0),
  by: {dt.smartscape.service},
  filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter isNotNull(tags[IAM_PRP]) | fields id]}
| fieldsAdd high = iCollectArray(if(total[] > (1000 * 2000), total[]))
| fieldsAdd low = iCollectArray(if(total[] <= (1000 * 2000), total[]))
| fieldsAdd highRespTimes = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowRespTimes = iCollectArray(if(isNull(low[]), 0, else: 1))
| fieldsAdd sli = 100 * (lowRespTimes[] / (lowRespTimes[] + highRespTimes[]))
| fieldsAdd getNodeName(dt.smartscape.service)
```

PDP resolution decision queries: see [log-correlation.md](log-correlation.md) Consumer → IAM Correlation section.

---

## IAM Databases (AWS RDS)

IAM uses **two separate Aurora database clusters**, each serving different IAM subsystems.

### Database Architecture

| Database | Engine | Consumers | Data Stored | Owner |
|---|---|---|---|---|
| **SSO Aurora MySQL** | Aurora MySQL | SSO IDP, SSO IDM, Token Service | Users, groups, accounts, OAuth clients, refresh tokens, platform tokens, federation configurations | team-identity-center (primary), team-token-service-team (DTP replicas) |
| **Authz Aurora PostgreSQL** | Aurora PostgreSQL | IAM PAP, IAM PRP, Access Approval | Policies, policy bindings, policy boundaries | team-pacman |

### SSO Aurora MySQL

Primary database for authentication and identity management workloads.

| Instance Pattern | Region | Role |
|---|---|---|
| `sso-aurora-prod-green-1` | us-east-1 | Writer |
| `sso-aurora-prod-green-{2,3}` | us-east-1 | Reader |
| `sso-aurora-rds-dtp-master-prod-green-{1,2,3}` | us-east-1 | DTP Writer |
| `sso-aurora-rds-dtp-read-replica-prod-green-*` | us-east-1, us-west-2, eu-west-1 | DTP Reader |
| `sso-prod-aurora-read-replicas-green-*` | eu-west-1 | EU Reader |

**Entity type**: `dt.smartscape.aws_rds_dbinstance` (`AWS_RDS_DBINSTANCE`) | **DB name**: `sso` | **Engine**: `aurora-mysql`

No dedicated auto-tags exist for SSO DB entities. Filter by entity name pattern `sso-aurora` or `sso-prod-aurora` on `AWS_RDS_DBINSTANCE`.

### Authz Aurora PostgreSQL

Primary database for authorization workloads (PRP, PAP, Access Approval).

| Instance | Region | Role |
|---|---|---|
| `iam-rds-postgresql-prod-blue-1` | us-east-1 | Writer |
| `iam-rds-postgresql-prod-blue-2` | us-east-1 | Reader |
| `iam-rds-postgresql-prod-blue-3` | us-east-1 | Reader |
| `iam-rds-postgresql-prod-blue-4` | us-east-1 | Reader |

**Tags**: `IAM_DB` (all instances), `IAM_READER_DB` (readers only) | **DB name**: `iam`

Authz DB is monitored at **two levels**:
1. **RDS entity level** — `dt.smartscape.aws_rds_dbinstance` (`AWS_RDS_DBINSTANCE`) entities tagged `IAM_DB`
2. **Service level** — Dynatrace service entities named `iam` tagged `IAM_DB` / `IAM_READER_DB` (tagged `AWS_POSTGRES`)

### Health Check: Authz DB Service Performance (Writer + Readers)

```dql
timeseries {
  avg_time = avg(dt.service.request.response_time),
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter isNotNull(tags[IAM_DB]) | fields id]}
| fieldsAdd avg_ms = avg_time[] / 1000,
  error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

### Health Check: Authz DB Reader-Only Performance

```dql
timeseries {
  avg_time = avg(dt.service.request.response_time),
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.smartscape.service},
filter: {dt.smartscape.service in [smartscapeNodes SERVICE | filter isNotNull(tags[IAM_READER_DB]) | fields id]}
| fieldsAdd avg_ms = avg_time[] / 1000,
  error_rate = (failures[] * 100.0) / total[]
| fieldsAdd getNodeName(dt.smartscape.service)
```

### Health Check: List All IAM RDS Instances (Authz Postgres)

```dql
smartscapeNodes AWS_RDS_DBINSTANCE
| fieldsAdd tags, name, rdsDbInstanceClass, rdsDbInstanceIdentifier, rdsDbName
| filter in("IAM_DB", tags) or in("IAM_READER_DB", tags)
```

### Health Check: List All SSO RDS Instances (SSO MySQL)

```dql
smartscapeNodes AWS_RDS_DBINSTANCE
| fieldsAdd tags, name, rdsDbInstanceClass, rdsDbInstanceIdentifier, rdsDbName, rdsEngine
| filter contains(name, "sso-aurora") or contains(name, "sso-prod-aurora")
| filter rdsEngine == "aurora-mysql"
```
