# Data Structure

## Contents
- [BillingDraft vs. BillingFinal](#billingdraft-vs-billingfinal)
- [Production vs. Non-Production Buckets](#production-vs-non-production-buckets)
- [Cost Department Filtering](#cost-department-filtering)
- [Organization Data](#organization-data)

---

## BillingDraft vs. BillingFinal

Cloud cost data is stored as events with two `event.type` values:

| `event.type`    | Description |
|-----------------|-------------|
| `BillingDraft`  | Ingested daily. Most recent data, still subject to change until the billing period closes. Available for **AWS** and **Microsoft** only. |
| `BillingFinal`  | Ingested once per month after the cloud provider finalises billing. Stable and authoritative. Available for **AWS**, **Microsoft**, and **Google Cloud**. Google Cloud provides **only** BillingFinal — never BillingDraft. |

**Finalisation schedule:**
- AWS: final data arrives on the **5th of each month**
- Microsoft: final data arrives on the **7th of each month**
- Google Cloud: only provides final data (no draft)

---

## Production vs. Non-Production Buckets

Cost data is split by whether the cloud account belongs to production infrastructure:

| Bucket Name | Description |
|---|---|
| `custom_sen_critical_events_finops_draft_nonprod` | Draft billing data — non-production cloud accounts |
| `custom_sen_critical_events_finops_draft_prod` | Draft billing data — production cloud accounts |
| `custom_sen_critical_events_finops_final_nonprod` | Final billing data — non-production cloud accounts |
| `custom_sen_critical_events_finops_final_prod` | Final billing data — production cloud accounts |

**Production** accounts = cloud accounts assigned to cost center **"Infrastructure/Net Ops : I/NO Dynatrace"**.  
All other cost centers → **non-production** buckets.

The cost center assignment for individual cloud accounts can be looked up in the **Organization Data** section of the Basic Cloud Cost Queries Notebook.

---

## Cost Department Filtering

Cost data includes the `dt_CostDepartmentName` field, which identifies the Dynatrace cost department a cloud account belongs to. Use this field to scope queries to a specific business unit or team.

### Known Cost Department Mappings

| Common name / alias | `dt_CostDepartmentName` filter to use | Bucket scope |
|---|---|---|
| COGS | `dt_CostDepartmentName == "Infrastructure/Net Ops : I/NO Dynatrace"` | **production** buckets (`*_prod`) |
| OPEX | `dt_CostDepartmentName != "Infrastructure/Net Ops : I/NO Dynatrace"` | **non-production** buckets (`*_nonprod`) |
| RnD, R&D, Engineering | **Data until March 2026:** `contains(dt_CostDepartmentName, "Dev")` — covers multiple Dev departments. **Data from April 2026 onwards:** `startsWith(dt_CostDepartmentName, "R&D")` — new cost center structure. When a query spans both periods, apply the correct filter per time range. | non-production |
| D1, Dynatrace One | `dt_CostDepartmentName == "Dynatrace ONE"` | non-production |
| Marketing | `dt_CostDepartmentName == "Marketing"` | non-production |
| Sales | `dt_CostDepartmentName == "Sales"` | non-production |
| Dynatrace University, DTU | `dt_CostDepartmentName == "DTU"` | non-production |

> **COGS vs. OPEX bucket alignment:** COGS maps to the `*_prod` buckets and OPEX maps to the `*_nonprod` buckets — this is consistent with the Production vs. Non-Production bucket split described above. When a user asks for COGS, query only the `*_prod` buckets and filter `dt_CostDepartmentName == "Infrastructure/Net Ops : I/NO Dynatrace"`. When a user asks for OPEX, query only the `*_nonprod` buckets.

### Disambiguating Departments

If a user asks for costs of a specific department and it is unclear which `dt_CostDepartmentName` values to include, first run the following query to list all available cost departments, show the result to the user, and ask them to confirm which to include:

```dql-template
// Replace YYYY-MM with a recent closed month to get a representative list.
// Set from: one month earlier to ensure Google Cloud BillingFinal events are included.
// NOTE: This query will show department names as they existed in the selected month.
// Before April 2026, R&D departments appear as "Dev*"; after April 2026, they appear as "R&D*".
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_nonprod",
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_nonprod",
    "custom_sen_critical_events_finops_final_prod"
  })
| filter in(event.type, {"BillingDraft", "BillingFinal"})
AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
AND BillingPeriodStart <  toTimestamp("<YYYY-MM-02T00:00:00.000Z>")
| summarize count(), by: {dt_CostDepartmentName}
| fields dt_CostDepartmentName
| sort dt_CostDepartmentName asc
```

---

## Organization Data

Organizational metadata about cloud accounts is stored separately in a dedicated bucket and can be joined with billing data using `SubAccountName` as the common key.

**Bucket:** `custom_sen_critical_events_finops_organization_data`  
**Event type:** `OrganizationData`

### Key Fields

| Field | Description |
|---|---|
| `SubAccountName` | Cloud account name — use this to join with billing data |
| `dt_CostDepartmentId` | Internal cost department identifier |
| `dt_CostDepartmentName` | Cost department name (matches the field in billing data) |
| `AccountCategory` | Category of the cloud account |
| `dt_OwnerEmail` | Email address of the owning team |
| `dt_Capability` | Capability the account belongs to |
| `DataClassification` | Data classification of the account |
| `dt_OwnedByTeam` | Standardized internal team name (from Dynatrace Teams) |
| `dt_ValidTags` | Whether the account has valid owner tags assigned. This field is present in both billing events (indicates whether the resource has all required tags) and organization data (indicates whether the account record is fully tagged). The semantics are analogous but the scope differs. |
| `JiraProjectKey` | Associated Jira project key |

### Query Example

The following query retrieves organizational metadata for a specific cloud provider. Adjust `event.provider` to `"Microsoft"`, `"Google Cloud"`, or `"AWS"` as needed:

```dql-template
fetch events, from: now()-1d, scanLimitGBytes:-1
| filter dt.system.bucket == "custom_sen_critical_events_finops_organization_data"
| filter event.provider == "<provider>" and event.type == "OrganizationData"
```

**Example:** To fetch AWS organization data, use `event.provider == "AWS"`. For Microsoft, use `event.provider == "Microsoft"`. For Google Cloud, use `event.provider == "Google Cloud"`.

> **Joining with billing data:** Both billing and organization data are stored as `events` — just in different buckets. Add `custom_sen_critical_events_finops_organization_data` to the bucket filter alongside the billing buckets, then use `summarize` with `if(event.type == "OrganizationData", field)` conditionals to extract org metadata alongside billing costs on `SubAccountName`. No `join`, `lookup`, or `append` is needed.

### Example: Enrich billing costs with organization data

```dql
fetch events, from: "2026-04-01T00:00:00.000Z", scanLimitGBytes:-1
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_final_nonprod",
    "custom_sen_critical_events_finops_organization_data"
  })
// select billing rows for April, OR org data (no time restriction)
| filter (
    dt.system.bucket == "custom_sen_critical_events_finops_final_nonprod"
    AND event.type == "BillingFinal"
    AND event.provider == "AWS"
    AND BillingPeriodStart >= toTimestamp("2026-04-01T00:00:00.000Z")
    AND BillingPeriodStart <  toTimestamp("2026-05-01T00:00:00.000Z")
  ) OR (
    dt.system.bucket == "custom_sen_critical_events_finops_organization_data"
    AND event.type == "OrganizationData"
    AND event.provider == "AWS"
  )
| filterOut ChargeCategory == "Tax" OR ChargeCategory == "Refund" OR ChargeCategory == "Adjustment" OR (ChargeCategory == "Credit" AND (ServiceName == "Amazon Elastic Compute Cloud" OR contains(ChargeDescription, "Contractual Credit")))
| summarize {
    EffectiveCost      = sum(if(event.type != "OrganizationData", EffectiveCost)),
    dt_OwnedByTeam     = takeAny(if(event.type == "OrganizationData", dt_OwnedByTeam)),
    JiraProjectKey     = takeAny(if(event.type == "OrganizationData", JiraProjectKey)),
    dt_Capability      = takeAny(if(event.type == "OrganizationData", dt_Capability))
  }, by: { SubAccountName }
| filterOut isNull(EffectiveCost)
| sort EffectiveCost desc
```
