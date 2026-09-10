# IAM Dashboard Index

Quick lookup for existing self-monitoring dashboards across all IAM areas.

---

## IAM Authorization (Authz)

| Dashboard | Purpose | Config ID |
|---|---|---|
| **[PAcMan] Dashboard** | Main authorization monitoring — PRP/PAP service health, SLOs (availability + performance), Level Access Worker, Binding Cleanup Worker, policy framework status | `dashboard-pacman` |
| **[PAcMan] Dashboard PDP** | PDP-specific metrics — resolution decisions, cache health, library-side performance | `dashboard-pacman-pdp` |
| **Policies Framework Status** | Policy framework health — PRP/PAP service metrics, DB health | `dashboard-pfs` |
| **[IAM] Access Approval Overview** | Access Approval workflow monitoring | `access-approval` |

---

## SSO (IDP / IDM)

| Dashboard | Purpose | Config ID |
|---|---|---|
| **SSO IDP Health & Service Monitoring** | IDP service health — login flows, synthetic monitors, error rates, response times, K8s pod status | `sso-idp-health-monitoring` |
| **SSO IDM Health & Service Monitoring** | IDM service health — user/group management, worker status, database health | `sso-idm-health-monitoring` |
| **SSO Troubleshoot** | Troubleshooting view — error logs, failed requests, trace correlation | `sso-troubleshoot-dashboard` |
| **SSO Kubernetes Monitoring** | K8s cluster health — pods, nodes, resource usage for IAM cluster | `sso-k8s-monitoring-dashboard` |
| **SSO Eventbus Monitoring** | Eventbus consumer health — message processing, errors, lag | `sso-eventbus-dashboard` |
| **SSO User Event AudiTT** | User event audit trail — login/logout, MFA, account changes (bizevents) | `auditt-dashboard` |
| **SSO Adoption Statistics** | Platform adoption metrics — user counts, login trends | `sso-adoption-statistics` |
| **SSO Daily Metrics** | Daily aggregated metrics — logins, registrations, key operational KPIs | `sso-daily-metrics` |
| **SSO MFA Adoption** | MFA adoption tracking — MFA-enabled users, verification rates, OTP stats | `sso-mfa-adoption-dashboard` |
| **SSO Dashboards** | Hub/index dashboard linking to all other SSO dashboards | `sso-dashboards` |

---

## Token Service

| Dashboard | Purpose | Config ID |
|---|---|---|
| **Token Service Dashboard** | Main dashboard — service health, token issuance rates, error rates, response times | `dashboard-main` |
| **Token Service OAuth Statistics** | OAuth flow statistics — requests per client, per grant type, success/failure rates | `dashboard-oauth-statistics` |
| **[Token Service] App Metrics** | Application-level metrics — per-service performance, custom service breakdown | `dashboard-app-metrics` |
| **[Token Service] Infrastructure Metrics** | Infrastructure health — CPU, memory, K8s pod status, JVM metrics | `dashboard-infrastructure-metrics` |
| **[Token Service] Library Metrics** | OAuth library metrics — `dynatrace-oauth` / `dynatrace-oauth-reactive` performance in consumer workloads | `dashboard-lib-metrics` |
| **[Token Service] Business Metrics** | Business-level metrics — token volume, client distribution | `dashboard-business-metrics` |
| **OAuth Resolution Libraries Dashboard** | Legacy library dashboard — OAuth resolution library performance | `dashboard-library` |

---

## IAM Notebooks

| Notebook | Purpose | Config ID |
|---|---|---|
| **IAM Authorization Decisions** | Interactive investigation of authorization decisions != ALLOW — DENY statistics by permission, user, level; app-specific resolution failures | `iam-authorization-decisions` |
| **IAM Audit Logs** | Policy management audit logs | `iam-audit-logs` |

---

## Dashboard Selection Guide

| Investigation Need | Start With |
|---|---|
| Overall IAM health quick check | PAcMan Dashboard + SSO IDP Health + Token Service Dashboard |
| Authentication failure investigation | SSO IDP Health & Service Monitoring |
| Token/OAuth issue investigation | Token Service Dashboard + OAuth Statistics |
| Authorization denial investigation | PAcMan Dashboard + IAM Authorization Decisions notebook |
| Policy change audit | IAM Audit Logs notebook |
| User-specific audit trail | SSO User Event AudiTT |
| Infrastructure/K8s issues | SSO Kubernetes Monitoring + Token Service Infrastructure Metrics |
| Library version tracking | Token Service Library Metrics |
| MFA issues | SSO MFA Adoption |
| Performance deep-dive | SSO Performance Monitoring + Token Service App Metrics |
