# HTTP Requests

Analyse HTTP request behaviour for a Dynatrace app — top endpoints, failures, server-side latency, and transfer size/caching.

All queries use bucket: `default_user_events`. Queries that measure latency or size use `samplingRatio:10`.

## Contents

- [URL Normalization](#url-normalization)
- [Scoping to a Single App](#scoping-to-a-single-app)
- [Top Requests by Volume](#top-requests-by-volume)
- [HTTP Failures (4xx / 5xx)](#http-failures-4xx--5xx)
- [Slowest Connections (Server-Side Latency)](#slowest-connections-server-side-latency)
- [Transfer Size and Caching](#transfer-size-and-caching)
- [Notes](#notes)

---

## URL Normalization

All four queries apply the same normalization pipeline to collapse dynamic path segments:

```dql-snippet
| fieldsAdd url.path = replaceString(url.path, "/platform/", "/")
| fieldsAdd url.path = replacePattern(url.path, "UUIDSTRING", "{uuid}")
| fieldsAdd url.path = replacePattern(url.path, "SMARTSCAPEID", "{entity}")
| fieldsAdd url.path = replacePattern(url.path, "'/'[a-zA-Z]{3} [0-9]{5} '/'", "/{tenant}/")
| fieldsAdd url.path = replacePattern(url.path, "('/dynatrace.' | '/my.')[a-zA-Z0-9._-]+", "/{appId}")
| fieldsAdd url.path = replacePattern(url.path, "'/v' (INT '.')(INT '.')(INT)('-' LD)? '/'", "/{appVersion}/")
| fieldsAdd url.path = replacePattern(url.path, "'/ruxitagentjs_' LD '.js'", "/ruxitagentjs_{agentVersion}.js")
```

This groups equivalent paths (e.g. `/api/v1.2.3/abc-123-…/data`) into a single normalized form.

---

## Scoping to a Single App

All queries include `| filter view.url.domain == url.domain` to limit to the app's own domain. To additionally scope by RUM application entity:

```dql-snippet
| filter dt.rum.application.entity == $application_id
```

Add this after the initial `filter` lines. Resolve `$application_id` from `$app` via `references/app-lookup.md`.

---

## Top Requests by Volume

Top 10 URL paths by total HTTP request count, enriched with per-user frequency.

```dql
fetch user.events, bucket:{"default_user_events"}
| filter characteristics.has_request
| filter view.url.domain == url.domain

| fieldsAdd url.path = replaceString(url.path, "/platform/", "/")
| fieldsAdd url.path = replacePattern(url.path, "UUIDSTRING", "{uuid}")
| fieldsAdd url.path = replacePattern(url.path, "SMARTSCAPEID", "{entity}")
| fieldsAdd url.path = replacePattern(url.path, "'/'[a-zA-Z]{3} [0-9]{5} '/'", "/{tenant}/")
| fieldsAdd url.path = replacePattern(url.path, "('/dynatrace.' | '/my.')[a-zA-Z0-9._-]+", "/{appId}")
| fieldsAdd url.path = replacePattern(url.path, "'/v' (INT '.')(INT '.')(INT)('-' LD)? '/'", "/{appVersion}/")
| fieldsAdd url.path = replacePattern(url.path, "'/ruxitagentjs_' LD '.js'", "/ruxitagentjs_{agentVersion}.js")

| makeTimeSeries {
    sessions = countDistinct(dt.rum.instance.id, default:0),
    httpCount = count(default:0)
}, by: {url.path}, bins: 60

| filter arraySum(httpCount) > 10
| sort arraySum(httpCount) desc
| limit 10

| fieldsAdd times = concat("x", round(arraySum(httpCount)/arraySum(sessions), decimals:1), "/user")
| fields timeframe, interval, httpCount, times, url.path
```

---

## HTTP Failures (4xx / 5xx)

Top 10 failing URL paths, grouped by path and status code.

```dql
fetch user.events, bucket:{"default_user_events"}
| filter characteristics.has_request
| filter view.url.domain == url.domain
| filter http.response.status_code >= 400

| fieldsAdd url.path = replaceString(url.path, "/platform/", "/")
| fieldsAdd url.path = replacePattern(url.path, "UUIDSTRING", "{uuid}")
| fieldsAdd url.path = replacePattern(url.path, "SMARTSCAPEID", "{entity}")
| fieldsAdd url.path = replacePattern(url.path, "'/'[a-zA-Z]{3} [0-9]{5} '/'", "/{tenant}/")
| fieldsAdd url.path = replacePattern(url.path, "('/dynatrace.' | '/my.')[a-zA-Z0-9._-]+", "/{appId}")
| fieldsAdd url.path = replacePattern(url.path, "'/v' (INT '.')(INT '.')(INT)('-' LD)? '/'", "/{appVersion}/")
| fieldsAdd url.path = replacePattern(url.path, "'/ruxitagentjs_' LD '.js'", "/ruxitagentjs_{agentVersion}.js")

| makeTimeSeries {
    sessions = countDistinct(dt.rum.instance.id, default:0),
    httpErrors = count(default:0)
}, by: {url.path, http.response.status_code}, bins: 60

| filter arraySum(httpErrors) > 10
| sort arraySum(httpErrors) desc
| limit 10

| fieldsAdd times = concat("x", round(arraySum(httpErrors)/arraySum(sessions), decimals:1), "/user")
| fields timeframe, interval, httpErrors, times, http.response.status_code, url.path
```

---

## Slowest Connections (Server-Side Latency)

Top 10 slowest URL paths by server processing time (`response_start - request_start`) and total duration, at p75.

```dql-template
fetch user.events, bucket:{"default_user_events"}, samplingRatio:10
| filter characteristics.has_request
| filter view.url.domain == url.domain
| filter http.response.status_code > 0 and duration > 0ns

| fieldsAdd url.path = replaceString(url.path, "/platform/", "/")
| fieldsAdd url.path = replacePattern(url.path, "UUIDSTRING", "{uuid}")
| fieldsAdd url.path = replacePattern(url.path, "SMARTSCAPEID", "{entity}")
| fieldsAdd url.path = replacePattern(url.path, "'/'[a-zA-Z]{3} [0-9]{5} '/'", "/{tenant}/")
| fieldsAdd url.path = replacePattern(url.path, "('/dynatrace.' | '/my.')[a-zA-Z0-9._-]+", "/{appId}")
| fieldsAdd url.path = replacePattern(url.path, "'/v' (INT '.')(INT '.')(INT)('-' LD)? '/'", "/{appVersion}/")
| fieldsAdd url.path = replacePattern(url.path, "'/ruxitagentjs_' LD '.js'", "/ruxitagentjs_{agentVersion}.js")

| makeTimeSeries {
    count = count(default: 0),
    serverProcess = percentile(performance.response_start-performance.request_start, $Percentiles:noquote),
    duration = percentile(duration, $Percentiles:noquote)
}, by: {url.path}, bins: 30

| filter arraySum(count) > 10
| sort arraySum(count) desc
| limit 10

| fieldsAdd serverProcessFormatted = concat("Server: ~", round(arrayAvg(serverProcess)/1e+6, decimals:2), "ms")
```

**`$Percentiles`**: use `75` for p75 (standard), `90` for stricter SLO analysis.

**`duration > 0ns`** guard: excludes cached and interrupted requests to focus on real round-trips.

---

## Transfer Size and Caching

Top 10 URL paths by total bytes transferred, with cache hit rate.

```dql
fetch user.events, bucket:{"default_user_events"}, scanLimitGBytes:-1
| filter characteristics.has_request
| filter view.url.domain == url.domain
| filter http.response.status_code > 0

| fieldsAdd url.path = replaceString(url.path, "/platform/", "/")
| fieldsAdd url.path = replacePattern(url.path, "UUIDSTRING", "{uuid}")
| fieldsAdd url.path = replacePattern(url.path, "SMARTSCAPEID", "{entity}")
| fieldsAdd url.path = replacePattern(url.path, "'/'[a-zA-Z]{3} [0-9]{5} '/'", "/{tenant}/")
| fieldsAdd url.path = replacePattern(url.path, "('/dynatrace.' | '/my.')[a-zA-Z0-9._-]+", "/{appId}")
| fieldsAdd url.path = replacePattern(url.path, "'/v' (INT '.')(INT '.')(INT)('-' LD)? '/'", "/{appVersion}/")
| fieldsAdd url.path = replacePattern(url.path, "'/ruxitagentjs_' LD  '.js'", "/ruxitagentjs_{agentVersion}.js")

| makeTimeSeries {
    count = count(default: 0),
    cached = countIf(performance.transfer_size == 0, default:0),
    avgSize = avg(performance.encoded_body_size, default:0),
    size = sum(performance.transfer_size, default:0)
}, by: {url.path}, bins: 30

| filter arraySum(size) > 10
| sort arraySum(size) desc
| limit 10

| fieldsAdd cached = cached[]/count[]
| fieldsAdd cachedFormatted = concat("Cached: ", round(arrayAvg(cached)*100, decimals:2), " %")
| fieldsAdd avgSizeFormatted = concat("Size: ", round(arrayAvg(avgSize)/1000, decimals: 1), " KB")
```

**Cache detection:** `performance.transfer_size == 0` indicates a browser-cached response (no bytes transferred over the network).

---

## Notes

- `characteristics.has_request` — filters to resource/XHR/fetch request events only (not page views or interactions)
- `view.url.domain == url.domain` — limits to same-domain requests (the app's own API calls), excluding third-party resources
- Transfer size query uses `scanLimitGBytes:-1` to avoid scan limits on high-volume apps
- Volume filter (`arraySum(...) > 10`) removes rare one-off paths from the results
