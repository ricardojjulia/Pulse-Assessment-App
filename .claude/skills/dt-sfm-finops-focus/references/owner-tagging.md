# Owner Tagging

Cloud resources in the billing data include owner tagging fields that allow filtering and cost attribution by the team responsible for the resource.

## Owner Tagging Fields

| Field | Type | Description |
|---|---|---|
| `dt_ValidTags` | boolean | `true` if the resource has a valid owner tag assigned; `false` otherwise. Use this to report on untagged or incorrectly tagged resources. |
| `dt_OwnerEmail` | string | Email address of the owning team. |
| `dt_OwnerTeam` | string | Team name as entered by the resource owner. Accepts any of the three name variants defined in Dynatrace Teams (display name, internal name, or alias). Less strict — use for exploratory lookups when the exact internal team name is unknown. |
| `dt_OwnedByTeam` | string | Standardized internal team name from Dynatrace Teams. **Preferred field for filtering by team** in queries — it is normalized and consistent across accounts and renames. |

### dt_OwnerTeam vs. dt_OwnedByTeam

`dt_OwnerTeam` accepts any of the three team name variants in Dynatrace Teams and is useful for exploratory lookups. `dt_OwnedByTeam` holds the canonical Internal Team Name and is stable across renames — use this when building dashboards, reports, or notebooks where consistency matters.

---

## Query Examples

### Filter Spend for a Specific Team

```dql-template
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_nonprod",
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_nonprod",
    "custom_sen_critical_events_finops_final_prod"
  })
| filter in(event.provider, {"AWS", "Microsoft", "Google Cloud"})
AND in(event.type, {"BillingDraft", "BillingFinal"})
AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
AND BillingPeriodStart < toTimestamp("<YYYY-MM-02T00:00:00.000Z>")
| filterOut InvoiceIssuerName != PublisherName
| filterOut event.provider == "AWS" AND (ChargeCategory == "Tax" OR ChargeCategory == "Refund" OR ChargeCategory == "Adjustment" OR (ChargeCategory == "Credit" AND (ServiceName == "Amazon Elastic Compute Cloud" OR contains(ChargeDescription, "Contractual Credit"))))
| filterOut in(event.provider, {"Microsoft", "Google Cloud"}) AND in(lower(ChargeCategory), {"tax", "credit", "refund", "adjustment"})
| filter dt_OwnedByTeam == "YourTeamName"
| summarize TotalEffectiveCost = sum(EffectiveCost)
```

### Break Down Spend by Owner Team

```dql-snippet
// Add this after your standard filter/filterOut lines
| summarize TotalEffectiveCost = sum(EffectiveCost), by: {dt_OwnedByTeam}
| sort TotalEffectiveCost desc
```

### Report Spend on Resources with Missing or Invalid Owner Tags

```dql-snippet
// Add this after your standard filter/filterOut lines
| filter dt_ValidTags == false
| summarize TotalEffectiveCost = sum(EffectiveCost), by: {SubAccountName, event.provider}
| sort TotalEffectiveCost desc
```
