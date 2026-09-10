# Query Templates

## Contents
- [Essential Template](#essential-template)
- [Amortized Cost Queries](#amortized-cost-queries)
- [List Price Queries](#list-price-queries)

---

## Essential Template

```dql-template
// Set from: to the start of the requested timeframe as an absolute ISO 8601 timestamp.
// Always use scanLimitGBytes:-1 for complete results — billing data is large.
// ⚠️ Google Cloud + BillingPeriodStart/BillingPeriodEnd: set from: one month BEFORE the billing period
//    you want to analyze — Google Cloud BillingFinal events are ingested in the following month.
//    This is NOT needed when filtering by ChargePeriodStart or ChargePeriodEnd.
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1

// select the relevant bucket(s)
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_nonprod",
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_nonprod",
    "custom_sen_critical_events_finops_final_prod"
  })

// choose cloud providers: "AWS", "Microsoft", "Google Cloud"
| filter in(event.provider, {"AWS", "Microsoft", "Google Cloud"})

// choose event types: BillingDraft (AWS+Microsoft only), BillingFinal (all three)
AND in(event.type, {"BillingDraft", "BillingFinal"})

// for specific days or day ranges — use ChargePeriodStart
AND ChargePeriodStart >= toTimestamp("YYYY-MM-DDT00:00:00.000Z")
AND ChargePeriodStart <= toTimestamp("YYYY-MM-DDT23:59:59.999Z")

// for full calendar months — use BillingPeriodStart with a range filter (works for all providers)
// ⚠️ Never use an exact-match timestamp for Google Cloud — the UTC offset shifts with US DST (T08:00Z in
//    winter/PST, T07:00Z in summer/PDT). The range below safely covers all providers and seasons:
AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
AND BillingPeriodStart <  toTimestamp("<YYYY-MM-02T00:00:00.000Z>")

// NEVER use the `timestamp` field — it reflects ingestion time, not cost incurrence time

// exclude the most recent 2 days to avoid future-dated savings plan commits
AND ChargePeriodStart <= now()-2d

// exclude marketplace/third-party charges ONLY for production buckets, with provider-specific rules
// AWS production: allow AI publishers (Bedrock, Anthropic, Cohere) while filtering other marketplace
| filterOut in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_prod"
  }) AND event.provider == "AWS"
    AND NOT (InvoiceIssuerName == PublisherName OR in(PublisherName, {"Anthropic, PBC", "CohereAI", "CanonicalGroupLimited"}) OR contains(ResourceId, "Bedrock"))
// Microsoft + Google Cloud production: filter all marketplace (their AI is first-party billed)
| filterOut in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_prod"
  }) AND in(event.provider, {"Microsoft", "Google Cloud"})
    AND InvoiceIssuerName != PublisherName

// exclude tax, credits, refunds, adjustments — omit only if user explicitly wants these
| filterOut event.provider == "AWS" AND (ChargeCategory == "Tax" OR ChargeCategory == "Refund" OR ChargeCategory == "Adjustment" OR (ChargeCategory == "Credit" AND (ServiceName == "Amazon Elastic Compute Cloud" OR contains(ChargeDescription, "Contractual Credit"))))
| filterOut in(event.provider, {"Microsoft", "Google Cloud"}) AND in(lower(ChargeCategory), {"tax", "credit", "refund", "adjustment"})

// optional: filter by account name
| filter SubAccountName == "<AccountName>"

// aggregate using EffectiveCost (amortized) by default
| summarize {EffectiveCost = sum(EffectiveCost)}, by: {Hyperscaler = event.provider, SubAccountName}

| sort EffectiveCost desc
```

> **Important:** Always apply the filter `ChargePeriodStart <= now()-2d` when querying recent data to avoid inflated numbers from future-dated savings plan or reservation commits.

---

## Amortized Cost Queries

Amortized cost = `EffectiveCost`. Always filter out Credits, Tax, Refunds, and Adjustments per provider.

### AWS — Amortized Cost

```dql
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter dt.system.bucket == "custom_sen_critical_events_finops_draft_nonprod"
| filter event.provider == "AWS"
AND event.type == "BillingDraft"
AND ChargePeriodStart >= now()-7d
AND ChargePeriodStart <= now()-2d

// AWS-specific exclusions for amortized cost
| filterOut (
    ChargeCategory == "Credit"
    AND (
      ServiceName == "Amazon Elastic Compute Cloud"
      OR contains(ChargeDescription, "Contractual Credit")
    )
    OR ChargeCategory == "Tax"
    OR ChargeCategory == "Refund"
    OR ChargeCategory == "Adjustment"
  )

| summarize {EffectiveCost = sum(EffectiveCost)}, by: {SubAccountName}
| sort EffectiveCost desc
```

### Microsoft — Amortized Cost

```dql
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter dt.system.bucket == "custom_sen_critical_events_finops_draft_nonprod"
| filter event.provider == "Microsoft"
AND event.type == "BillingDraft"
AND ChargePeriodStart >= now()-7d
AND ChargePeriodStart <= now()-2d

// Microsoft specific exclusions for amortized cost
| filterOut in(lower(ChargeCategory), {"credit", "tax", "refund", "adjustment"})

| summarize {EffectiveCost = sum(EffectiveCost)}, by: {SubAccountName}
| sort EffectiveCost desc
```

### Google Cloud — Amortized Cost

> **Google Cloud quirk (data before 2026-03-01 only):** For Google Cloud billing records where `ChargePeriodStart` or `BillingPeriodStart` is **before March 1st, 2026**, `SubAccountName` defaults to "SADA" (the reseller) and the real project name must be parsed from the `x_Project` JSON field. This parsing step **must happen before** any `filter` on `SubAccountName`. For data from 2026-03-01 onwards, `SubAccountName` is populated correctly and these two lines can be omitted.

```dql
// ⚠️ Google Cloud + BillingPeriodStart/BillingPeriodEnd only: set from: one month BEFORE the billing period.
// This example uses ChargePeriodStart — no from: offset needed here.
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter dt.system.bucket == "custom_sen_critical_events_finops_final_nonprod"
| filter event.provider == "Google Cloud"
AND event.type == "BillingFinal"
AND ChargePeriodStart >= now()-7d
AND ChargePeriodStart <= now()-2d

// Google Cloud specific exclusions for amortized cost
| filterOut in(lower(ChargeCategory), {"credit", "tax", "refund", "adjustment"})

// only needed when querying data where ChargePeriodStart or BillingPeriodStart < 2026-03-01
// for data from 2026-03-01 onwards, SubAccountName is already set correctly — omit these two lines
| fieldsAdd gcp_project = parse(x_Project, "JSON:gcp")
| fieldsAdd SubAccountName = coalesce(gcp_project[name], SubAccountName)

| summarize {EffectiveCost = sum(EffectiveCost)}, by: {SubAccountName}
| sort EffectiveCost desc
```

### All Cloud Providers Combined — Amortized Cost

```dql-template
// ⚠️ Google Cloud + BillingPeriodStart/BillingPeriodEnd only: set from: one month BEFORE the billing period.
// This example uses ChargePeriodStart — no from: offset needed here.
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
// both draft (AWS+Microsoft) and final (Google Cloud) buckets are needed
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_nonprod",
    "custom_sen_critical_events_finops_final_nonprod"
  })
| filter in(event.provider, {"AWS", "Microsoft", "Google Cloud"})
AND in(event.type, {"BillingDraft", "BillingFinal"})
AND ChargePeriodStart >= now()-7d
AND ChargePeriodStart <= now()-2d

// for full calendar months, replace the ChargePeriodStart lines above with a BillingPeriodStart range:
// ⚠️ Never use an exact-match timestamp for Google Cloud — its UTC offset shifts with US DST.
// The range below works for all providers (AWS T00:00Z, Google Cloud T07:00Z or T08:00Z depending on season):
// AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
// AND BillingPeriodStart <  toTimestamp("<YYYY-MM-02T00:00:00.000Z>")

// provider-scoped exclusions for amortized cost
| filterOut if(event.provider == "AWS", (ChargeCategory == "Credit" and (ServiceName == "Amazon Elastic Compute Cloud" or contains(ChargeDescription,"Contractual Credit") ) or ChargeCategory == "Tax" or ChargeCategory == "Refund" or  ChargeCategory == "Adjustment"))
| filterOut if(in(event.provider, { "Microsoft", "Google Cloud" }), in(lower(ChargeCategory), { "credit", "tax", "refund", "adjustment" }))

// Google Cloud: only needed when querying data where ChargePeriodStart or BillingPeriodStart < 2026-03-01
// for data from 2026-03-01 onwards, SubAccountName is already set correctly — omit these two lines
| fieldsAdd gcp_project = parse(x_Project, "JSON:gcp")
| fieldsAdd SubAccountName = coalesce(gcp_project[name], SubAccountName)

| summarize {EffectiveCost = sum(EffectiveCost)},
    by: {CloudProvider = event.provider, SubAccountName, dt.system.bucket}
| sort EffectiveCost desc
```

---

## List Price Queries

Use the same amortized query templates from the **Amortized Cost Queries** section above, with two changes:
1. Replace `sum(EffectiveCost)` with `sum(ListCost)`
2. Remove all `filterOut` credit/tax/refund/adjustment lines — list price is pre-discount and these exclusions are not needed

The same GCP `x_Project` parsing rule applies (required for data before 2026-03-01).

---

## Organization Data Enrichment

Enrich billing cost results with organizational metadata (owner team, Jira project, capability, data classification) by joining on `SubAccountName`.

**Pattern:** Both billing events and organization metadata live in `fetch events` — just different buckets. Add the org bucket to the main filter, then use `summarize` with `if(event.type == "OrganizationData", ...)` conditionals to extract org fields. No `join`, `lookup`, or `append` is needed.

```dql-template
fetch events, from: "YYYY-MM-DDT00:00:00.000Z", scanLimitGBytes:-1
| filter in(dt.system.bucket, {
    "custom_sen_critical_events_finops_final_nonprod",
    "custom_sen_critical_events_finops_final_prod",
    "custom_sen_critical_events_finops_organization_data"
  })
// select billing rows for the requested period, OR org data rows (no time restriction)
| filter (
    in(dt.system.bucket, {
        "custom_sen_critical_events_finops_final_nonprod",
        "custom_sen_critical_events_finops_final_prod"
      })
    AND in(event.provider, {"AWS", "Microsoft", "Google Cloud"})
    AND event.type == "BillingFinal"
    AND BillingPeriodStart >= toTimestamp("<YYYY-MM-01T00:00:00.000Z>")
    AND BillingPeriodStart <  toTimestamp("<YYYY-MM-02T00:00:00.000Z>")
    AND ChargePeriodStart <= now()-2d
  ) OR (
    dt.system.bucket == "custom_sen_critical_events_finops_organization_data"
    AND event.type == "OrganizationData"
  )
// scope marketplace filter to production billing rows only — org rows have null cost fields, nonprod rows shouldn't be filtered
| filterOut in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_prod"
  }) AND event.provider == "AWS"
    AND NOT (InvoiceIssuerName == PublisherName OR in(PublisherName, {"Anthropic, PBC", "CohereAI", "CanonicalGroupLimited"}) OR contains(ResourceId, "Bedrock"))
| filterOut in(dt.system.bucket, {
    "custom_sen_critical_events_finops_draft_prod",
    "custom_sen_critical_events_finops_final_prod"
  }) AND in(event.provider, {"Microsoft", "Google Cloud"})
    AND InvoiceIssuerName != PublisherName
// scope cost-exclusion filters to billing rows (safe: ChargeCategory is null in org rows)
| filterOut if(event.provider == "AWS", (ChargeCategory == "Credit" AND (ServiceName == "Amazon Elastic Compute Cloud" OR contains(ChargeDescription,"Contractual Credit")) OR ChargeCategory == "Tax" OR ChargeCategory == "Refund" OR ChargeCategory == "Adjustment"))
| filterOut if(in(event.provider, {"Microsoft", "Google Cloud"}), in(lower(ChargeCategory), {"credit", "tax", "refund", "adjustment"}))
// merge billing row + org row per SubAccountName
| summarize {
    EffectiveCost      = sum(if(event.type != "OrganizationData", EffectiveCost)),
    CloudProvider      = takeAny(if(event.type != "OrganizationData", event.provider)),
    dt_OwnedByTeam     = takeAny(if(event.type == "OrganizationData", dt_OwnedByTeam)),
    JiraProjectKey     = takeAny(if(event.type == "OrganizationData", JiraProjectKey)),
    dt_Capability      = takeAny(if(event.type == "OrganizationData", dt_Capability)),
    DataClassification = takeAny(if(event.type == "OrganizationData", DataClassification))
  }, by: { SubAccountName }
| filterOut isNull(EffectiveCost)   // inner-join: drop accounts with no billing match
| sort EffectiveCost desc
```
