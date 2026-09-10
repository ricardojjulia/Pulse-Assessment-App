# Prerequisites Check

Verify that an app has the required SDKs installed and RUM configured before expecting data on health dashboards.

---

## When to Use

- An app shows no data in error/adoption/web vitals dashboards
- Onboarding a new app to health monitoring
- Confirming instrumentation is correct

---

## What Is Checked

| ID | Requirement | Pass condition |
|---|---|---|
| `logger` | `@dynatrace-sdk/logger` installed | Package present in bizevents version report |
| `events` | `@dynatrace-sdk/ui-monitoring-events >= 3.4.0` | Version score ≥ 3.4.0; earlier versions send incompatible data |
| `rum` | RUM application configured | `$application_id` resolves to a known entity |
| `rum_grail` | RUM powered by Grail enabled | Time-series data present for `$application_id` |

Status indicators: `🟢` = configured/passing · `🔴` = missing/failing · `❓` = unknown

---

## Query

Replace `$app` with the app ID and `$application_id` with the resolved RUM entity (see `references/app-lookup.md`).

```dql-template
data record(
  id = "logger",
  requirement = "[@dynatrace-sdk/logger](https://backstage.internal.dynatrace.com/docs/dynatrace-sdk/component/dynatrace-sdk_logger/) installed",
  status = "❓",
  notes = "You should remove all `console` usage and only use this logger."
), record(
  id = "events",
  requirement="[@dynatrace-sdk/ui-monitoring-events](https://bitbucket.lab.dynatrace.org/projects/APPFW/repos/dynatrace-sdk/browse/packages/ui-monitoring-events) >= `3.4.0`",
  status = "❓",
  notes = "Previous version sends data incompatible with Grail"
), record(
  id = "rum",
  requirement = concat("RUM application configured"),
  status = if($application_id != "APPLICATION_DOESNT_EXIST", "🟢 configured", else:"🔴 no application"),
  notes = if($application_id != "APPLICATION_DOESNT_EXIST", concat("[", $application_id, "](/ui/apps/dynatrace.classic.frontend/#uemapplications/uemappmetrics;uemapplicationId=", $application_id, ")"), else:concat("Configure RUM application: [Monitor apps by Dynatrace](https://developer.dynatracelabs.com/develop/monitor-apps-by-dynatrace/)"))
), record(
  id = "rum_grail",
  requirement = concat("RUM powered by Grail enabled"),
  status ="🔴 no data",
  notes = concat("Check status on [this page](/ui/apps/dynatrace.experience.vitals/frontends/", $application_id, "/settings/builtin:rum.web.enablement) and enable via Monaco")
)

| join on:{id}, kind:leftOuter, prefix:"logger.", [fetch bizevents
  | filter event.provider == "4b1eddd3-a461-4e9b-9596-6d61a8a2e876"
  | filter in(event.type, "dynatracePackageVersions")
  | filter in(appId, $app)
  | fieldsAdd loggerVersion = replaceString(`packages.@dynatrace-sdk/logger`, "^", "")
  | fieldsAdd loggerVersion =  replaceString(loggerVersion, "~", "")
  | fields id="logger", loggerVersion, status = if (isNotNull(loggerVersion), concat("🟢 version ", loggerVersion) , else: "🔴 not installed")
  | limit 1]

| join on:{id}, kind:leftOuter, prefix:"events.", [fetch bizevents
  | filter event.provider == "4b1eddd3-a461-4e9b-9596-6d61a8a2e876"
  | filter in(event.type, "dynatracePackageVersions")
  | filter in(appId, $app)
  | fieldsAdd eventsVersion = replaceString(`packages.@dynatrace-sdk/ui-monitoring-events`, "^", "")
  | fieldsAdd eventsVersion =  replaceString(eventsVersion, "~", "")
  | parse eventsVersion, "INT:major '.' INT:minor '.' INT:patch"
  | fieldsAdd versionScore =  major*1000000+minor*1000+patch
  | fields id="events", eventsVersion, status = if (versionScore >= 3004000, concat("🟢 version ", eventsVersion), else: concat("🔴 version ", eventsVersion))
  | limit 1]

| join on:{id}, kind:leftOuter, prefix:"rum.", [timeseries timeseries = percentile(dt.frontend.web.page.largest_contentful_paint, 75), filter: dt.rum.application.entity == $application_id
  | fields id="rum_grail", status = "🟢 data present"
  | summarize c=count(), by:{id, status}
  | fieldsRemove c]

| fieldsAdd status = coalesce(logger.status, events.status, rum.status, status)
```

---

## Interpreting Results

| Row `id` | `🔴` meaning | Action |
|---|---|---|
| `logger` | `@dynatrace-sdk/logger` not found in package version report | Install the SDK and remove `console.*` calls |
| `events` | `ui-monitoring-events` missing or below 3.4.0 | Upgrade to >= 3.4.0; older versions send Grail-incompatible data |
| `rum` | No RUM `APPLICATION-*` entity found for this app | Configure a RUM application via [Monitor apps by Dynatrace](https://developer.dynatracelabs.com/develop/monitor-apps-by-dynatrace/) |
| `rum_grail` | No LCP time-series data for the RUM entity | Enable "RUM powered by Grail" in the application settings |

---

## Notes

- Package version data comes from `event.type == "dynatracePackageVersions"` bizevents emitted by the app on load
- The `rum_grail` check uses LCP as a proxy signal — if LCP data is present, Grail RUM is active
- If `$application_id` is unknown, resolve it first via `references/app-lookup.md`
