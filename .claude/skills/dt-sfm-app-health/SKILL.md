---
name: dt-sfm-app-health
description: Dynatrace app health observability — user adoption, errors, error pages, Core Web Vitals (FCP, LCP, INP), HTTP request performance, DQL query failures, and billed consumption. Covers any Dynatrace app identified by its app ID (e.g. `dynatrace.notebooks`). For cluster or platform infrastructure monitoring, load a skill covering Dynatrace production self-monitoring instead.
---

# Dynatrace App Health

## Overview

This skill covers frontend observability for Dynatrace apps running on the Dynatrace platform. It provides DQL query templates for measuring user adoption, frontend errors, Core Web Vitals, HTTP request performance, and DQL execution costs — all scoped to a specific app via its app ID.

All queries require `$app` (the app ID, e.g. `dynatrace.notebooks`) as an input. Many also require `$application_id` (the RUM entity ID, e.g. `APPLICATION-ABC123`), which can be resolved from `$app` — see `references/app-lookup.md`. If the app ID is unknown, `references/app-lookup.md` also provides a query to discover all known app IDs.

## Use Case Routing

| You want to… | Read |
|---|---|
| Discover known app IDs or resolve a RUM application entity | references/app-lookup.md |
| Check if an app has the required SDKs and RUM configured | references/prerequisites.md |
| Track user adoption (daily active users, sessions) | references/users.md |
| Investigate frontend errors, warnings, or error pages | references/errors.md |
| Drill into detailed app logs (error, warn, info, error pages) | references/logs.md |
| Measure Core Web Vitals (FCP, LCP, INP) | references/web-vitals.md |
| Analyse HTTP requests — failures, latency, transfer size | references/requests.md |
| Investigate DQL query failures or billed consumption | references/dql-queries.md |
| Open the ready-made App Health or App Logs dashboard | references/dashboards.md |

## Essential Concepts

### `$app` vs `$application_id`

| Variable | Type | Description | Example |
|---|---|---|---|
| `$app` | App ID | Logical app identifier used in bizevents, logs, and adoption data | `dynatrace.notebooks` |
| `$application_id` | RUM entity ID | Dynatrace entity ID for the RUM application | `APPLICATION-51F555A161380642` |

Most queries use `$app`. Queries that touch RUM metrics (`user.events`, `dt.frontend.*`) require `$application_id`. Use the lookup in `references/app-lookup.md` to resolve one from the other.

### Filtering to a Single App

Queries are **not auto-scoped** — you must supply `$app` (and `$application_id` where needed). Without a filter, queries span all apps and return large result sets.

### URL Normalization

HTTP request queries normalise URL paths to collapse dynamic segments:

| Pattern | Replacement |
|---|---|
| UUID strings | `{uuid}` |
| Smartscape entity IDs | `{entity}` |
| Tenant path segment (`/abc 12345/`) | `/{tenant}/` |
| App IDs (`/dynatrace.*`, `/my.*`) | `/{appId}` |
| Versioned paths (`/v1.2.3/`) | `/{appVersion}/` |
| RUM agent JS files | `/ruxitagentjs_{agentVersion}.js` |

## Data Sources

| Bucket / Source | Signal type | Freshness | Used for |
|---|---|---|---|
| `strato_ui_events` | Events | Real-time | User adoption |
| `custom_sen_low_frontend_clientlogger_ui_logs` | Logs | Real-time | Errors, warnings, error pages |
| `custom_sen_low_bizevents_frontend_adoptiondata_ui_statistics` | Bizevents | Real-time | Error page % (denominator) |
| `custom_sen_low_query_frontend_dql_logs` | Logs | Real-time | DQL query failures, consumption, Grail query details |
| `default_user_events` | RUM user events | Real-time | HTTP requests, Web Vitals |

## Best Practices

- **Always supply `$app`** — unfiltered queries return data across all apps
- **Set `scanLimitGBytes:-1`** on DQL log queries to avoid scan-limit errors
- **Use `samplingRatio:10`** on `user.events` queries (already included in templates) — raw queries at full fidelity are expensive
- **`$Percentiles`** in Web Vitals and request queries defaults to `75` (p75) — adjust as needed
