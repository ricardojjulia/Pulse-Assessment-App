# Core Web Vitals

Measure frontend performance of a Dynatrace app using Core Web Vitals — Largest Contentful Paint (LCP), First Contentful Paint (FCP), and Interaction to Next Paint (INP).

All queries use bucket: `default_user_events`, `samplingRatio:10`.

---

## Overview

| Metric | Acronym | Measures | Good threshold (p75) |
|---|---|---|---|
| Largest Contentful Paint | LCP | Perceived load speed — time to render the largest visible element | ≤ 2500 ms |
| First Contentful Paint | FCP | Time until first content is painted | ≤ 1800 ms |
| Interaction to Next Paint | INP | Responsiveness — delay from user interaction to visual response | ≤ 200 ms |

These metrics replicate the Dynatrace platform's built-in `dt.frontend.web.page.*` metrics with additional dimensions.

---

## Initial Load: FCP and LCP

```dql-template
fetch user.events, bucket: { "default_user_events" }, samplingRatio:10
| filter characteristics.has_page_summary
| filter web_vitals.largest_contentful_paint > 0ns and web_vitals.first_contentful_paint > 0ns

| makeTimeseries {
  `LCP` = percentile(web_vitals.largest_contentful_paint, $Percentiles:noquote),
  `FCP` = percentile(web_vitals.first_contentful_paint, $Percentiles:noquote)
}, bins: 60
```

---

## Interactions: INP

```dql-template
fetch user.events, bucket: { "default_user_events" }, samplingRatio:10
| filter characteristics.has_page_summary
| filter web_vitals.interaction_to_next_paint > 0ns

| makeTimeseries {
  `INP` = percentile(web_vitals.interaction_to_next_paint, $Percentiles:noquote)
}, bins: 60
```

---

## Key Parameters

### `$Percentiles`

Controls which percentile is computed. These queries use `:noquote` to pass the value directly as a number literal.

| Value | Meaning |
|---|---|
| `75` | p75 — standard Web Vitals threshold percentile (recommended) |
| `90` | p90 — stricter; useful for SLO definitions |
| `50` | Median — useful for trend analysis |

### `$application_id`

To scope to a specific app's RUM data, add a filter by RUM entity:

```dql-snippet
| filter dt.rum.application.entity == $application_id
```

Add this line **before** `makeTimeseries`. Resolve `$application_id` from `$app` using `references/app-lookup.md`.

---

## Scoped Query Example (LCP + FCP for a specific app)

```dql-template
fetch user.events, bucket: { "default_user_events" }, samplingRatio:10
| filter characteristics.has_page_summary
| filter web_vitals.largest_contentful_paint > 0ns and web_vitals.first_contentful_paint > 0ns
| filter dt.rum.application.entity == $application_id

| makeTimeseries {
  `LCP` = percentile(web_vitals.largest_contentful_paint, 75),
  `FCP` = percentile(web_vitals.first_contentful_paint, 75)
}, bins: 60
```

---

## Notes

- `characteristics.has_page_summary` — filters to page-load summary events (not resource or interaction events)
- `> 0ns` guard — excludes events where the metric was not measured (e.g. cached navigations, back/forward)
- `samplingRatio:10` — queries 10% of events; sufficient for percentile accuracy and reduces scan cost
- Values are in nanoseconds — divide by `1e+6` to convert to milliseconds if displaying raw values
- If no data appears, verify `rum_grail` is enabled via `references/prerequisites.md`
