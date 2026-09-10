# Cost Trend Queries

Time-series cost trends using `makeTimeseries` with daily intervals.

---

## Overall Cost Trend

Shows total effective cost per day for the last 31 days.

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-31d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-31d and toTimestamp(focus.ChargePeriodStart) < now()
| makeTimeseries {EffectiveCost=sum(focus.EffectiveCost)}, time:toTimestamp(focus.ChargePeriodStart), interval:24h
```

---

## Cost Trend by Service Category

Daily cost trend broken down by service category (Compute, Storage, Networking, etc.).

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-31d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-31d and toTimestamp(focus.ChargePeriodStart) < now()
| makeTimeseries {EffectiveCost=sum(focus.EffectiveCost)}, time:toTimestamp(focus.ChargePeriodStart), interval:24h, by:{focus.ServiceCategory}
```

---

## Cost Trend by Account

Daily cost trend broken down by cloud account/subscription.

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-31d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-31d and toTimestamp(focus.ChargePeriodStart) < now()
| makeTimeseries {EffectiveCost=sum(focus.EffectiveCost)}, time:toTimestamp(focus.ChargePeriodStart), interval:24h, by:{focus.SubAccountName}
```

---

## Cost Trend by Service Category for a Specific Account

Use this two-step workflow when the user wants to see service trends for a single account.

### Step 1: List available accounts

Run this query first and present the results to the user. Ask them to choose an account name before proceeding.

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-7d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-7d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize count(), by:{focus.SubAccountName, focus.SubAccountId}
| fieldsRemove `count()`
| sort focus.SubAccountName asc
```

### Step 2: Cost trend by service for the selected account

After the user confirms their account name, substitute it for `<SUBACCOUNTNAME>`:

```dql-template
fetch bizevents, scanLimitGBytes:-1, from:now()-31d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter focus.SubAccountName == "<SUBACCOUNTNAME>"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-31d and toTimestamp(focus.ChargePeriodStart) < now()
| makeTimeseries {EffectiveCost=sum(focus.EffectiveCost)}, time:toTimestamp(focus.ChargePeriodStart), interval:24h, by:{focus.ServiceCategory}
```
