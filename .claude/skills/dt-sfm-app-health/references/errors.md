# Errors

Frontend error observability for Dynatrace apps — log-level errors/warnings, error pages shown to users, and root-cause breakdown (JS vs HTTP errors).

All queries use bucket: `custom_sen_low_frontend_clientlogger_ui_logs`.

---

## Use Case Routing

| You want to… | Query |
|---|---|
| Count ERROR / WARN logs over time | [Error and Warning Log Counts](#error-and-warning-log-counts) |
| See log volume split by status level | [Log Volume by Status](#log-volume-by-status) |
| What % of users saw an error page? | [Error Page Percentage](#error-page-percentage) |
| Were errors caused by JS bugs or HTTP failures? | [Error Page Cause Breakdown](#error-page-cause-breakdown) |

---

## Error and Warning Log Counts

Counts ERROR and WARN log entries over time, plus distinct users who produced them.

```dql
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter in(status, {"ERROR", "WARN"})

| makeTimeseries {
    `error logs`=countIf(status=="ERROR", default:0),
    `warn logs`=countIf(status=="WARN", default:0),
    `users with error/warning logs` = countDistinct(appshell.userId, default:0)
}, bins: 240
```

---

## Log Volume by Status

Full log volume split by status level (`ERROR`, `WARN`, `INFO`, etc.).

```dql
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }

| makeTimeseries `number of errors` = count(default:0),
    by:{status}, bins:240
| sort arrayAvg(`number of errors`)
```

---

## Error Page Percentage

Calculates the percentage of active users who encountered an app error page during the selected timeframe. Requires a minimum of 20 active users to avoid noise from low-traffic periods.

```dql
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"

| fieldsAdd error_page_user_id = if(isNotNull(appshell.error_page.appId), appshell.userId)

| makeTimeseries {
  usersWithAppErrors = countDistinct(error_page_user_id, default:0)
}, bins: 30

| append [
  fetch bizevents, bucket: { "custom_sen_low_bizevents_frontend_adoptiondata_ui_statistics" }
  | filter event.type == "adoption.data"
  | makeTimeseries { users = countDistinct(adoption.user, default:0)}, 
    bins: 30
]

| summarize {
    users=takeFirst(users), 
    usersWithAppErrors= takeFirst(usersWithAppErrors)
}, by:{timeframe,interval}

| fieldsAdd percentOfAppUsersAppTriggered =
    if(users[] < 20 or users[] == 0, null, else: (toDouble(usersWithAppErrors[]) / users[]) * 100)

| fields {
  timeframe,
  interval,
  percentOfAppUsersAppTriggered
}
```

**Key logic:**
- `appshell.loggerName == "TrackErrorView"` — fires when an app error page is rendered
- `appshell.error_page.appId` — error page scoped to a specific app; `isNotNull` limits the user count to affected users
- The denominator (total active users) comes from adoption bizevents in a separate `append` branch, then joined by `timeframe`/`interval`
- Result is `null` when fewer than 20 users are active (avoids misleading high percentages)

---

## Error Page Cause Breakdown

Splits error pages by root cause: JavaScript errors vs HTTP errors. Useful for triage — a JS spike suggests a bug, an HTTP spike suggests a backend or API issue.

```dql
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"

| parse content, """LD LF JSON:appshell"""
| fieldsAdd causeType = appshell[cause][0][type]
| fieldsAdd error_page_user_id = if(isNotNull(appshell.error_page.appId), appshell.userId)
| fieldsAdd error_page_cause_type = if(isNotNull(appshell.error_page.appId), causeType)

| makeTimeseries {
  `# of users` = countDistinct(appshell.userId, default:0),
  `caused by js errors` = countIf(error_page_cause_type != "Http Error", default: 0),
  `caused by HTTP errors` = countIf(error_page_cause_type == "Http Error", default: 0),
  `users that saw error page` = countDistinct(error_page_user_id, default:0)
}, bins: 240
| fieldsRemove `# of users`
```

**`causeType` values:**
- `Http Error` — the error page was triggered by a failed HTTP request (4xx/5xx)
- Anything else (e.g. `TypeError`, `SyntaxError`) — JavaScript runtime error

---

## Notes

- All queries use bucket `custom_sen_low_frontend_clientlogger_ui_logs` — this is the App Shell client-side logger stream
- `appshell.userId` is the user identifier in this bucket (not `bhv.user.id` from `strato_ui_events`)
- Log queries do not require `scanLimitGBytes:-1` for frontend logs (volume is manageable), but add it if you hit scan limits
- To scope to a specific app, add `| filter appshell.appId == $app` (or the relevant field for the app's logger context)
