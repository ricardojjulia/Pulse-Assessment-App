# Ready-Made Dashboards

Pre-built dashboards for app health and log analysis. Use these when you need an interactive visual investigation instead of running individual DQL queries.

Both dashboards are deployed to **Production**, **Hardening**, and **Development** environments.

---

## App Health Dashboard

High-level overview of application health — designed for quick anomaly detection, incident investigation, and cross-persona alignment.

**Core goals:**
- Display app health **status at a glance**
- Serve as an **entry point for incident investigation** (including on-call scenarios)
- Offer a **unified definition of app health** for all personas (leadership, product teams, developers)

**Common use case:** Correlate error spikes or anomalies with application releases by overlaying error trends with version adoption data.

| Environment | Dashboard ID |
|---|---|
| Production, Hardening, Development | `monaco-4223a358-d28c-32ee-8042-dc52edacfe5b` |

**Dashboard link (same on all environments):**
```
/ui/apps/dynatrace.dashboards/dashboard/monaco-4223a358-d28c-32ee-8042-dc52edacfe5b
```

---

## App Logs Dashboard

Detailed log analysis for root-cause investigation — with search, filtering, and grouping capabilities.

**Capabilities:**
- **Narrow scope** — filter investigations to specific phrases, tenants, or users
- **Measure impact** — see affected apps, tenants, clusters, and users
- **Gather details** — inspect individual log lines, error causes, and traces

**Features:**
- **SearchAll** — search across all tiles to find specific log messages, users, or accounts
- **GroupBy** — adjust log visualisation by attributes such as tenant, user, app, or cluster

| Environment | Dashboard ID |
|---|---|
| Production, Hardening, Development | `monaco-10142907-e51a-3926-9230-e59f9874b196` |

**Dashboard link (same on all environments):**
```
/ui/apps/dynatrace.dashboards/dashboard/monaco-10142907-e51a-3926-9230-e59f9874b196
```

---

## How to Use These Dashboards

1. **Apply the "App" segment** — select your app to view relevant data
2. **Combine with additional segments** to refine your analysis:

| Segment | Purpose |
|---|---|
| **App** | View data specific to your application |
| **Tenant** | Narrow the scope to a specific environment |
| **[SRE] DTP-PROD** | Get a broader outlook across the entire cluster |

3. **App Health → App Logs** — start with the health dashboard for a high-level view, then drill into App Logs for detailed investigation

---

## When to Use Dashboards vs DQL Queries

| Scenario | Use |
|---|---|
| Quick visual triage, on-call incident response | **Dashboard** — interactive, pre-built views |
| Automated reports, programmatic analysis, custom filters | **DQL queries** from this skill's reference files |
| Correlating releases with error spikes | **App Health dashboard** — overlay errors with version adoption |
| Searching logs for a specific error message or user | **App Logs dashboard** — use `SearchAll` variable |

---

## Notes

- Dashboard IDs follow the `monaco-*` naming convention from Monaco deployment
- The App Health dashboard header links directly to the App Logs dashboard for easy drill-down
- Both dashboards require the app to have `@dynatrace-sdk/logger` and `@dynatrace-sdk/ui-monitoring-events` installed — check via `references/prerequisites.md`
- Support channel: [#help-internal-app-self-monitoring](https://dynatrace.enterprise.slack.com/archives/C08RYLM0Y8M)
- Documentation: [Developer Portal: App dashboards](https://developer.dynatracelabs.com/develop/apps-by-dynatrace/monitor-dynatrace-apps/dashboards/)
