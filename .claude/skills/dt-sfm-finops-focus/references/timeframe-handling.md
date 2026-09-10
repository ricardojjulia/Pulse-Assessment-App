# Timeframe Handling

## Contents
- [Clarifying Ambiguous Timeframes](#clarifying-ambiguous-timeframes)
- [Mapping Timeframes to Fields](#mapping-timeframes-to-fields)
- [Google Cloud DST Offset Rules](#google-cloud-dst-offset-rules)
- [fetch events, from: Settings](#fetch-events-from-settings)

---

## Clarifying Ambiguous Timeframes

**If the user has not specified a timeframe, ask before writing the query.** Do not assume a default timeframe.

### "Last Month" Disambiguation

**If the user says "last month"**, always ask for clarification before writing the query:
> "Do you mean the last calendar month (e.g. all of February), or the last 30 days?"

- **Last calendar month** → use `BillingPeriodStart` for the full month (e.g. February 2026)
- **Last 30 days** → use `ChargePeriodStart >= now()-32d AND ChargePeriodStart <= now()-2d`

### Recent Data (Yesterday / Today)

**If the user asks for "yesterday" or "today's" spend**, always respond with the following note before writing the query:
> "Billing data for yesterday is not yet available — BillingDraft data has a minimum delay of approximately 2 days. The most recent available data is from `now()-2d` (two days ago). Note that even this most recent day may still be incomplete depending on when the data is ingested — if the value looks unusually low compared to surrounding days, treat it as partial and recheck the next day."

Then write the query using `ChargePeriodStart == now()-2d` or `ChargePeriodStart >= now()-4d AND ChargePeriodStart <= now()-2d` for a short window.

---

## Mapping Timeframes to Fields

Once the timeframe is known, apply these rules:

| Granularity | Use this field | Example |
|---|---|---|
| Specific days / day ranges | `ChargePeriodStart` | `ChargePeriodStart >= toTimestamp("2026-03-01T00:00:00.000Z") AND ChargePeriodStart <= toTimestamp("2026-03-15T23:59:59.999Z")` |
| Full calendar months for AWS and Microsoft | `BillingPeriodStart` | `BillingPeriodStart == toTimestamp("2026-02-01T00:00:00.000Z")` |
| Full calendar months for Google Cloud | `BillingPeriodStart` | range: `BillingPeriodStart >= toTimestamp("2026-02-01T00:00:00.000Z") AND BillingPeriodStart < toTimestamp("2026-02-02T00:00:00.000Z")` |

### Never Use timestamp Field

**Never use the `timestamp` field** for cost queries. `timestamp` records when the event was *stored in Grail*, not when the cost was incurred — filtering on it will produce incorrect and misleading results.

---

## Google Cloud DST Offset Rules

> **⚠️ Google Cloud BillingPeriodStart DST offset — always use a range filter, never an exact match:** Google Cloud stores `BillingPeriodStart` as **midnight Pacific Time** converted to UTC. Because the US observes Daylight Saving Time, this offset shifts during the year:
> - **Winter (PST, UTC-8):** Nov–Mar → `YYYY-MM-01T08:00:00.000Z`
> - **Summer (PDT, UTC-7):** Apr–Oct → `YYYY-MM-01T07:00:00.000Z`
>
> US DST switches on the **second Sunday of March** (spring forward) and the **first Sunday of November** (fall back). The March 1st billing period starts before the switch → PST; April 1st onwards → PDT.
>
> **Never use an exact-match timestamp for Google Cloud** (`== toTimestamp("YYYY-MM-01T08:00:00.000Z")`) — it will silently return no data for summer months. **Always use a range:**
> ```dql-template
> AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
> AND BillingPeriodStart < toTimestamp("<YYYY-MM-02T00:00:00.000Z>")
> ```
> This safely captures `T07:00:00Z`, `T08:00:00Z`, and any future variation. It also covers AWS and Microsoft (`T00:00:00Z`) in a single expression, making provider-split filters unnecessary.

---

## fetch events, from: Settings

The `fetch events, from:` value at the start of every query must be set to the **start of the requested timeframe** as an absolute ISO 8601 timestamp. Always set `scanLimitGBytes:-1` regardless of timeframe. Examples:
- User asks for March 2026 → `fetch events, from: "2026-03-01T00:00:00.000Z", scanLimitGBytes:-1`
- User asks for January 2026 → `fetch events, from: "2026-01-01T00:00:00.000Z", scanLimitGBytes:-1`
- User asks for last 7 days → `fetch events, from: "2026-03-11T00:00:00.000Z", scanLimitGBytes:-1` (calculate the date 7 days before today)

### Google Cloud: Set from: One Month Earlier

> **⚠️ Google Cloud: set `from:` one month earlier — only when filtering by `BillingPeriodStart` or `BillingPeriodEnd`.** Google Cloud `BillingFinal` events are ingested by Dynatrace in the month *after* the billing period closes — their Grail `timestamp` is in the following month. When the timeframe filter uses `BillingPeriodStart` or `BillingPeriodEnd`, setting `from:` to the first of the analysis month will cause Grail to miss all Google Cloud records. Always set `from:` one additional month back in this case:
> - Analyzing March 2026 Google Cloud data with `BillingPeriodStart` → `fetch events, from: "2026-02-01T00:00:00.000Z", scanLimitGBytes:-1`
> - Analyzing February 2026 Google Cloud data with `BillingPeriodStart` → `fetch events, from: "2026-01-01T00:00:00.000Z", scanLimitGBytes:-1`
> - Querying last month with `now()` and `BillingPeriodStart` → `fetch events, from: now()-2M, scanLimitGBytes:-1`
> 
> **This does NOT apply when filtering by `ChargePeriodStart` or `ChargePeriodEnd`** — charge period timestamps are stored as-is and Grail will find them at the expected scan range.
