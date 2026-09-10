# Cost Overview Queries

## Total Cloud Spend

Returns total spend across all services for the selected period, broken down into effective, billed, contracted, and list cost.

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}
```

---

## Discover Available Services (Run First)

Before filtering by service category or service name, show the user what exists in their data:

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize records=count(), by: {focus.ServiceCategory, focus.ServiceName}
| sort focus.ServiceCategory, focus.ServiceName asc
```

---

## Cost by Service Category

### Known Service Category Values

`AI and Machine Learning` | `Analytics` | `Business Applications` | `Compute` | `Databases` | `Developer Tools` | `Multicloud` | `Identity` | `Integration` | `Internet of Things` | `Management and Governance` | `Media` | `Migration` | `Mobile` | `Networking` | `Security` | `Storage` | `Web` | `Other`

### Query: Cost for a Specific Category

Replace `<CATEGORY>` with a value from the list above (e.g., `Compute`):

```dql-template
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter focus.ServiceCategory == "<CATEGORY>"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}
```

### Query: Cost Breakdown Across All Service Categories

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:focus.ServiceCategory
| sort EffectiveCost desc
```
