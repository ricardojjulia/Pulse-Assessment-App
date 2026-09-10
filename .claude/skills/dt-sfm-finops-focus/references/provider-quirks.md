# Provider-Specific Quirks

## Contents
- [Google Cloud: SubAccountName Parsing](#google-cloud-subaccountname-parsing)
- [Google Cloud: No BillingDraft](#google-cloud-no-billingdraft)
- [Google Cloud: fetch events, from: Offset](#google-cloud-fetch-events-from-offset)
- [AWS vs. Microsoft / Google Cloud: Filter Conditions](#aws-vs-microsoft--google-cloud-filter-conditions)
- [Account Lookup Fallback](#account-lookup-fallback)

---

## Google Cloud: SubAccountName Parsing

For Google Cloud billing records where `ChargePeriodStart` or `BillingPeriodStart` is **before March 1st, 2026**, `SubAccountName` is set to "SADA" (the reseller name) and the real Google Cloud project name must be parsed from the `x_Project` JSON field:

```dql-snippet
| fieldsAdd gcp_project = parse(x_Project, "JSON:gcp")
| fieldsAdd SubAccountName = coalesce(gcp_project[name], SubAccountName)
```

> **⚠️ DQL syntax:** `parse()` must be assigned to a variable — `| fieldsAdd gcp_project = parse(x_Project, "JSON:gcp")`. The pattern format is `"JSON:<varname>"`. Using the function without assignment (`| fieldsAdd parse(...)`) causes a PARSE_ERROR. Access parsed fields as `gcp_project[name]`.

### When These Lines Are Needed

1. They must appear **before** any `| filter` on `SubAccountName`
2. Filtering on `SubAccountName` before these steps will only match the reseller row "SADA"

For data from **2026-03-01 onwards**, `SubAccountName` is populated correctly by the ingestion pipeline — omit these two lines entirely.

---

## Google Cloud: No BillingDraft

Google Cloud only provides `BillingFinal`. Never filter for `BillingDraft` with `event.provider == "Google Cloud"`.  
When combining all providers, always include both `BillingDraft` AND `BillingFinal` in the `event.type` filter.

---

## Google Cloud: fetch events, from: Offset

Google Cloud `BillingFinal` events are ingested by Dynatrace in the month *after* the billing period closes. Their Grail `timestamp` (ingestion time) is typically in the following calendar month — for example, February 2026 billing data has a `timestamp` of March 2026 or later.

**This only matters when the timeframe filter uses `BillingPeriodStart` or `BillingPeriodEnd`.** Because Grail scans events by `timestamp`, setting `from:` to the first day of the analysis month will cause Grail to find no Google Cloud records for that month. You must set `from:` **one additional month back**:

| Analysis period | Correct `from:` for Google Cloud (BillingPeriodStart filter) |
|---|---|
| March 2026 | `"2026-02-01T00:00:00.000Z"` |
| February 2026 | `"2026-01-01T00:00:00.000Z"` |
| Last month (`now()-1M`) | `now()-2M` |

**When filtering by `ChargePeriodStart` or `ChargePeriodEnd`, this offset is NOT needed** — charge period timestamps are stored as-is and Grail will scan them at the expected range.

This applies to both Google Cloud only queries and multi-provider queries that include Google Cloud with a `BillingPeriodStart` filter.  
AWS and Microsoft are **not** affected — their events are ingested with near-real-time timestamps.

---

## AWS vs. Microsoft / Google Cloud: Filter Conditions

When combining all providers in a single query, use the `if()` conditional form so each exclusion is scoped to the correct provider:

```dql-snippet
| filterOut if(event.provider == "AWS", (ChargeCategory == "Credit" and (ServiceName == "Amazon Elastic Compute Cloud" or contains(ChargeDescription,"Contractual Credit") ) or ChargeCategory == "Tax" or ChargeCategory == "Refund" or  ChargeCategory == "Adjustment"))
| filterOut if(in(event.provider, { "Microsoft", "Google Cloud" }), in(lower(ChargeCategory), { "credit", "tax", "refund", "adjustment" }))
```

This avoids one provider's exclusion logic accidentally affecting another provider's rows.

---

## Account Lookup Fallback

When a user asks for costs for a specific account and filtering on `SubAccountName` returns no results, retry the query using `SubAccountId` instead:

```dql-snippet
| filter contains(SubAccountId, "<account name or ID fragment>")
```

`SubAccountId` holds the cloud provider's internal account identifier (AWS account number, Azure subscription ID, Google Cloud project ID) and may match cases where `SubAccountName` does not — for example when the account name has changed, contains unexpected characters, or the user provided a partial ID rather than a name.
