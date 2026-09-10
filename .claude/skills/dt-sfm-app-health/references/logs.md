# App Logs

Detailed log drill-down for Dynatrace apps — browse error, warning, and info logs line-by-line, inspect error page causes (HTTP vs JS), and review Grail DQL query execution details.

Covers two data sources:
- **Frontend client logs** — bucket: `custom_sen_low_frontend_clientlogger_ui_logs`
- **DQL query execution logs** — bucket: `custom_sen_low_query_frontend_dql_logs`

---

## Use Case Routing

| You want to… | Query |
|---|---|
| Browse individual error log lines with full context | [Error Logs (Detail)](#error-logs-detail) |
| See top error messages over time | [Error Logs (Chart)](#error-logs-chart) |
| Browse individual warning log lines | [Warning Logs (Detail)](#warning-logs-detail) |
| See top warning messages over time | [Warning Logs (Chart)](#warning-logs-chart) |
| Browse individual info log lines | [Info Logs (Detail)](#info-logs-detail) |
| See top info messages over time | [Info Logs (Chart)](#info-logs-chart) |
| Inspect HTTP error pages (4xx/5xx) that users saw | [HTTP Error Pages](#http-error-pages) |
| Inspect JS error pages that users saw | [JS Error Pages](#js-error-pages) |
| See sampled log examples across levels with dedup | [Example Logs (Deduplicated)](#example-logs-deduplicated) |
| Group logs by dimension (app, tenant, user, etc.) | [Group-By Analysis](#group-by-analysis) |
| Review failed Grail DQL queries with error details | [Grail Query Failures (Detail)](#grail-query-failures-detail) |
| See Grail failure types over time | [Grail Query Failures (Chart)](#grail-query-failures-chart) |
| Review successful Grail DQL queries with cost data | [Grail Successful Queries (Detail)](#grail-successful-queries-detail) |
| See successful query sources over time | [Grail Successful Queries (Chart)](#grail-successful-queries-chart) |

---

## Common Variables

| Variable | Description | Example |
|---|---|---|
| `$SearchAll` | Free-text search across log content (case-insensitive) | `"TypeError"` |
| `$LogLevels` | Set of log levels to include | `{"ERROR", "WARN", "INFO"}` |
| `$GroupBy` | Dimension to group by (used with `:noquote`) | `App`, `Tenant`, `User`, `LoggerName` |
| `$ThrottleInterval` | Dedup time window (nanoseconds) for example logs | Computed as `(to - from) / 24 / 12` |

To scope to a specific app, add `| filter appshell.appId == $app` for frontend logs or `| filter app == $app` for DQL logs.

---

## Frontend Client Logs

## Key Fields in Frontend Logs

| Field | Description |
|---|---|
| `appshell.loggerName` | Logger that emitted the entry (e.g. `TrackErrorView`, custom logger names) |
| `appshell.message` | Human-readable log message |
| `appshell[cause]` | Array of error causes; `[0]` is the primary cause |
| `appshell[cause][0][type]` | `"JS Error"` or `"Http Error"` |
| `appshell[cause][0][status]` | HTTP status code (for HTTP errors) |
| `appshell[cause][0][traceId]` | Distributed trace ID for correlating with backend spans |
| `appshell.context.id` | Source app/package that produced the log |
| `appshell.appId` | App ID where the log was generated |
| `appshell.userId` | User who triggered the log |
| `dt.tenant.uuid` | Tenant where the log was captured |

## Notes

- **`$SearchAll`** — pass an empty string `""` to match all logs, or a term like `"TypeError"` to filter
- **`$LogLevels`** — use `{"ERROR", "WARN"}` for triage, or `{"ERROR", "WARN", "INFO"}` for full picture
- **Dedup in example logs** — the `$ThrottleInterval` prevents flooding; remove the `dedup` line to see all raw entries
- **`AppUrl`** — reconstructed deep link into the Dynatrace UI at the exact page where the log was emitted
- **`trace.id`** — present on HTTP error pages; use it to drill into Distributed Tracing for backend root cause
- Frontend log queries generally don't need `scanLimitGBytes:-1` (manageable volume), but Grail DQL log queries do

### App Logs (Detail)

Individual error log entries with logger name, message, error cause details, source app/version, and user context.
Add filter by `status` to validate severity of the log (e.g. `| filter status == "ERROR"`).

```dql-template
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD LF JSON:appshell"

| fields 
  timestamp,
  Logger = appshell.loggerName,
  Message = appshell.message,
  Details = arrayConcat(
    iCollectArray(concat(appshell[cause][][name], ": ", appshell[cause][][message])),
    toArray(appshell[details])
  ),
  Source = concat(appshell.context.id, " v", coalesce(appshell.context.version, appshell.appVersion)),
  AppUrl=concat(
    "/ui",
    if(appshell.appId == "dynatrace.appshell", "", else:concat("/apps/", appshell.appId)),
    replaceString(appshell[appLocation][pathname], "/ui", ""),
      appshell[appLocation][search],
      appshell[appLocation][hash]
  ),
  Tenant=dt.tenant.uuid,
  User=appshell.userId,
  FullLog=appshell, 
  content,
  loglevel,
  appshell=toString(appshell)

| sort timestamp desc
| limit 1000
```

### App Logs (Chart)

Top 10 error messages by logger name over time. Add filter by `status` to validate severity of the log (e.g. `| filter status == "ERROR"`).

```dql-template
fetch logs, bucket:{ "custom_sen_low_frontend_clientlogger_ui_logs"}
| filter contains(content, $SearchAll, caseSensitive:false)

| fields
  timestamp,
  LoggerName = appshell.loggerName,
  Message = appshell.message

| makeTimeseries { Count = count(default:0) }, by:{ LoggerName, Message }

| sort arraySum(Count) desc
| limit 10
| sort arraySum(Count) asc
```

---

## Error Pages

### HTTP Error Pages

Error pages triggered by HTTP failures (4xx/5xx). Filters out JS errors. Includes API URL, HTTP status, trace ID for distributed tracing.

```dql-template
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD LF JSON:appshell"

| fieldsAdd cause = appshell[cause][0]
| fieldsAdd causeAppId = coalesce(cause[details][appId], appshell[details][appId])
| fieldsFlatten cause, prefix:"cause."

| filter cause.type != "JS Error"

| fields 
    timestamp,
    Status = cause.status, 
    Message = cause.message,
    Details = arrayRemoveNulls(arrayConcat(
      toArray(cause[details][body][error][message]),
      iCollectArray(
        if(cause.message != appshell[cause][][message],
          concat(appshell[cause][][name], ": ", appshell[cause][][message])
        )
      ),
      toArray(appshell[details])
    )),
    AppUrl=concat(
      "/ui",
      if(appshell.appId == "dynatrace.appshell", "", else:concat("/apps/", appshell.appId)),
      replaceString(appshell[appLocation][pathname], "/ui", ""),
        appshell[appLocation][search],
        appshell[appLocation][hash]
    ),
    ApiUrl = cause.details[url],
    App = causeAppId,
    trace.id=cause.traceId,
    Tenant = dt.tenant.uuid,
    User = appshell.userId,
    cause,
    FullLog=appshell, 
    content

| sort timestamp desc
| limit 1000
```

**HTTP Error Pages — Chart** (top statuses/causes over time):

```dql-template
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD LF JSON:appshell"
| fieldsAdd cause = appshell[cause][0]
| fieldsAdd causeAppId = coalesce(cause[details][appId], appshell[details][appId])
| fieldsFlatten cause, prefix:"cause."

| filter cause.type != "JS Error"

| fields 
    timestamp,
    Status = cause.status, 
    DetailCause = cause[details][body][error][message],
    Message = appshell.message, 
    Cause = cause.message

| makeTimeseries { Count = count(default:0) }, by:{ Status, Type = coalesce(DetailCause, Cause) }
| sort arraySum(Count) desc
| limit 10
| sort arraySum(Count) asc
```

---

### JS Error Pages

Error pages triggered by JavaScript errors. Filters to `cause.type == "JS Error"` only.

```dql-template
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD LF JSON:appshell"

| fieldsAdd cause = appshell[cause][0]
| fieldsAdd causeAppId = coalesce(cause[details][appId], appshell[details][appId])
| fieldsFlatten cause, prefix:"cause."

| filter cause.type == "JS Error"

| fields 
    timestamp,
    Message = cause.message,
    Details = arrayRemoveNulls(arrayConcat(
      iCollectArray(
        if(
          cause.message != appshell[cause][][message],
          concat(appshell[cause][][name], ": ", appshell[cause][][message])
        )
      ),
      toArray(appshell[details])
    )),
    AppUrl=concat(
      "/ui",
      if(appshell.appId == "dynatrace.appshell", "", else:concat("/apps/", appshell.appId)),
      replaceString(appshell[appLocation][pathname], "/ui", ""),
        appshell[appLocation][search],
        appshell[appLocation][hash]
    ),
    App = causeAppId,
    Tenant = dt.tenant.uuid,
    User = appshell.userId,
    cause,
    FullLog=appshell,
    content,
    loglevel,
    appshell=concat("", appshell)

| sort timestamp desc
| limit 1000
```

**JS Error Pages — Chart** (top JS error messages over time):

```dql-template
fetch logs, bucket: { "custom_sen_low_frontend_clientlogger_ui_logs" }
| filter appshell.loggerName == "TrackErrorView"
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD LF JSON:appshell"
| fieldsAdd cause = appshell[cause][0]
| fieldsAdd causeAppId = coalesce(cause[details][appId], appshell[details][appId])
| fieldsFlatten cause, prefix:"cause."

| filter cause.type == "JS Error"

| makeTimeseries { Count = count(default:0) }, by:{ Name = cause.message }
| sort arraySum(Count) desc
| limit 10
| sort arraySum(Count) asc
```

---

## Grail DQL Query Logs

### Grail Query Failures (Detail)

Individual failed DQL queries with error details, DQL statement, source, trace ID, and request token.

```dql-template
fetch logs, bucket:{"custom_sen_low_query_frontend_dql_logs"}
| filter isNotNull(app)
| filter state != "succeeded"
| filter contains(content, $SearchAll, caseSensitive:false)

| parse content, "LD JSON:GrailLog"
| parse GrailLog[client.client_context], "JSON:JsonClientContext"

| fieldsAdd Source = coalesce(
    GrailLog[client.function_context],
    GrailLog[client.internal_service_context],
    JsonClientContext[source],
    JsonClientContext[package],
    GrailLog[client.client_context],
    GrailLog[client.application_context]
)

| fields
  timestamp,
  TimeSpent = toLong(duration),
  Source = Source,
  error = GrailLog[error],
  Dql = dql,
  Details = arrayConcat(
    toArray(concat("State: ", GrailLog[state])),
    toArray(concat(GrailLog[failure_reason], ": ", GrailLog[error])),
    toArray(concat("Observations: ", GrailLog[observations])),
    toArray(concat("Error Params: ", GrailLog[error_params])),
    toArray(concat("Request Token: ", GrailLog[request_token])),
    if(GrailLog[requested_filter_segment_ids], toArray(concat("Segment: ", GrailLog[requested_filter_segment_ids])))
  ),
  QueryId = id,
  App = app,
  AppUrl=client_source,
  Tenant=tenant,
  User=GrailLog[user],
  trace_id = trace_id,
  id,
  content
| sort timestamp desc
| limit 1000
```

### Grail Query Failures (Chart)

Top 20 error types over time for failed DQL queries.

```dql-template
fetch logs, bucket:{"custom_sen_low_query_frontend_dql_logs"}, scanLimitGBytes:-1
| filter isNotNull(app)
| filter state != "succeeded"
| filter contains(content, $SearchAll, caseSensitive:false)

| fieldsAdd error = jsonField(content, "error", seek:true)
| filter isNotNull(error)

| makeTimeseries { Count = count(default:0) }, by:{ error }

| sort arraySum(Count) desc
| limit 20
| sort arraySum(Count) asc
```

---

### Grail Successful Queries (Detail)

Individual successful DQL queries with duration, scanned/billed bytes, DQL statement, and source.

```dql-template
fetch logs, bucket:{"custom_sen_low_query_frontend_dql_logs"}
| filter isNotNull(app)
| filter state == "succeeded"
| filter contains(content, $SearchAll, caseSensitive:false)

| sort timestamp desc
| limit 1000

| parse content, "LD JSON:GrailLog"
| parse GrailLog[client.client_context], "JSON:JsonClientContext"

| fieldsAdd Source = coalesce(
    GrailLog[client.function_context],
    GrailLog[client.internal_service_context],
    JsonClientContext[source],
    JsonClientContext[package],
    GrailLog[client.client_context],
    GrailLog[client.application_context]
)

| fields
  timestamp,
  TimeSpent = toLong(duration),
  Source = Source,
  Scanned = scanned_bytes,
  Billed = billable_bytes,
  Dql = dql,
  Details = arrayConcat(
    toArray(concat("Request Token: ", GrailLog[request_token])),
    if(GrailLog[requested_filter_segment_ids], toArray(concat("Segment: ", GrailLog[requested_filter_segment_ids])))
  ),
  QueryId = id,
  App = app,
  AppUrl=client_source,
  Tenant=tenant,
  User=GrailLog[user],
  trace_id = trace_id,
  id,
  content
```

### Grail Successful Queries (Chart)

Top 20 query sources over time for successful DQL queries.

```dql-template
fetch logs, bucket:{"custom_sen_low_query_frontend_dql_logs"}
| filter isNotNull(app)
| filter state == "succeeded"
| filter contains(content, $SearchAll, caseSensitive:false)

| fieldsAdd shortenClientContext = substring(client_context, from: 0, to: 15)

| parse content, "LD JSON:GrailLog"
| parse GrailLog[client.client_context], "JSON:JsonClientContext"

| fieldsAdd Source = coalesce(
    GrailLog[client.function_context],
    GrailLog[client.internal_service_context],
    JsonClientContext[source],
    JsonClientContext[package],
    GrailLog[client.client_context],
    GrailLog[client.application_context]
)

| makeTimeSeries {
  Count = count()
}, by: {Source}

| sort arraySum(Count) desc
| limit 20
| sort arraySum(Count) asc
```