# Cost Attribution Queries

Attribute cloud costs to teams, accounts, or individual resource owners using sub-account IDs or resource tags.

---

## Attribution by Sub-Account

AWS accounts map to `focus.SubAccountId` and `focus.SubAccountName`. Use this for department-level chargeback and showback.

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:{focus.SubAccountId, focus.SubAccountName}
| sort EffectiveCost desc
```

---

## Attribution by Tag

Resource tags are stored as a JSON string in `focus.Tags`. Use a two-step approach: first enumerate available tag names, then drill into values for a specific tag.

### Step 1: Enumerate Tag Names (Show Available Tags)

Run this first to show the user what tag names exist and their associated spend:

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filterout focus.Tags == "{}"
| fieldsAdd tags = replaceString(`focus.Tags`, "\"\"", "\"")
| parse tags, "'{' ARRAY{ DQS:name ':' DQS:value ','? }{1,}:tagKeys '}'"
| expand tagKeys
| summarize {`Usage count`=count(), `Associated costs`=sum(focus.EffectiveCost)}, by:tagKeys[name]
| sort `Usage count` desc
```

### Step 2: Break Down Costs by a Specific Tag Value

Once the user has identified a tag name (e.g., `dt_owner_email`), replace it in this query:

```dql-template
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| filter focus.ChargeCategory == "Usage"
| filter contains(focus.Tags, "<TAG_NAME>")
| parse focus.Tags, "JSON:tags"
| fieldsAdd `<TAG_NAME>` = coalesce(tags[`<TAG_NAME>`], "Missing value")
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:`<TAG_NAME>`
| sort EffectiveCost desc
```

**Example** — costs broken down by `dt_owner_email`:

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| filter focus.ChargeCategory == "Usage"
| filter contains(focus.Tags, "dt_owner_email")
| parse focus.Tags, "JSON:tags"
| fieldsAdd `dt_owner_email` = coalesce(tags[`dt_owner_email`], "Missing value")
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:`dt_owner_email`
| sort EffectiveCost desc
```

> **Note on missing tags**: Resources without the requested tag are grouped as `"Missing value"` by the `coalesce()` call. This preserves total spend visibility rather than silently dropping untagged resources.
