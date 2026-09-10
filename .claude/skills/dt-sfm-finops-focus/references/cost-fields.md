# FOCUS Cost Fields

## Contents
- [Overview](#overview)
- [Cost Field Selection Rules](#cost-field-selection-rules)
- [Query Output & Grouping](#query-output--grouping)
- [Marketplace Transactions](#marketplace-transactions)
- [Tax and Adjustment Filters](#tax-and-adjustment-filters)
- [Troubleshooting](#troubleshooting)

---

## Overview

Data is stored in the [FOCUS format](https://focus.finops.org/), enabling cross-provider queries. The four key cost metrics are:

| Field | FOCUS Name | Description |
|---|---|---|
| `EffectiveCost` | Effective Cost | **Amortized cost.** Cost after applying all negotiated discounts and spreading upfront commitment payments (Reserved Instances, Savings Plans) over the commitment period. This is what usage truly costs during a period. **Has direct P&L impact.** **Default for all queries.** |
| `ListCost` | List Cost | Cost at public list prices — no discounts of any kind applied. Useful to compare against cloud estimator tool outputs. **Only use when explicitly asked.** |
| `ContractedCost` | Contracted Cost | Cost calculated using contracted (negotiated) unit prices, without amortising commitment-based discounts. Represents what you'd pay per unit based on your negotiated contract rate. Useful for savings calculations (compare to `ListCost` to see the value of negotiated discounts). |
| `BilledCost` | Billed Cost | The cost as it appears on the invoice. Differs from `EffectiveCost` when upfront commitment charges are invoiced separately from usage. Includes the full upfront charge in the billing period it was invoiced rather than spreading it. Useful for invoice reconciliation and cash-flow-based analysis. |

---

## Cost Field Selection Rules

1. **Default → always use `EffectiveCost`** (amortised cost). This reflects the true cost of usage and is what appears in reports, forecasts, and budgets 99% of the time.
2. **`ListCost`** → only if the user explicitly asks for "list price" or "public price".
3. **`ContractedCost`** → only if the user explicitly asks for "contracted cost" or "savings from negotiated discounts".
4. **`BilledCost`** → only if the user explicitly asks for "billed cost", "invoiced cost", "invoice reconciliation", or "cash-flow" analysis.

**Special case for `BilledCost` (invoice reconciliation):** When using `BilledCost` for invoice reconciliation, **omit marketplace filtering entirely**. Invoice reconciliation requires all charges to appear exactly as they were invoiced, including any marketplace or third-party charges. Filters that exclude marketplace transactions would misalign the query results with the actual invoice.

---

## Query Output & Grouping

**Default → return a single total.** When a user asks "how much did we spend on X", return a single aggregated `sum(EffectiveCost)` with no `by {}` grouping unless they explicitly ask for a breakdown.

Only add a `by {}` dimension when the user explicitly asks for it — for example:
- "break it down by service" → `by: {ServiceName}`
- "show me by account" → `by: {SubAccountName}`
- "per region" → `by: {Region}`
- "Hyperscaler" → `by: {event.provider}`
- "cloud provider" → `by: {event.provider}`

### Department Grouping

**When the user asks for a breakdown by department**, always group by the **top-level department group** first — the part of `dt_CostDepartmentName` before the first ` : `. Use `splitString` to extract it:

```dql-snippet
| fieldsAdd DepartmentGroup = if(contains(dt_CostDepartmentName, " : "), splitString(dt_CostDepartmentName, " : ")[0], else: dt_CostDepartmentName)
| summarize TotalEffectiveCost = sum(EffectiveCost), by: {DepartmentGroup}
| sort TotalEffectiveCost desc
```

If the user then wants to drill into a specific group (e.g. "show me the Development breakdown"), add `dt_CostDepartmentName` as the grouping dimension instead.

Do not infer that a breakdown would be "more useful" and add one unprompted. Answer what was asked.

### Multiple Dimensions

When a user wants to break costs down by more than one dimension (e.g. account name **and** cloud provider), list all dimensions inside the `by:{}` block:

```dql-snippet
| summarize EffectiveCost = sum(EffectiveCost), by: {SubAccountName, event.provider}
```

Any combination of fields is valid — just add them comma-separated inside `by:{}`:

```dql-snippet
| summarize EffectiveCost = sum(EffectiveCost), by: {SubAccountName, event.provider, ServiceName}
```

**Common dimensions to group by:**

| Dimension | Field |
|---|---|
| Cloud provider | `event.provider` |
| Account / subscription / project | `SubAccountName` |
| Cloud service | `ServiceName` |
| Charge type | `ChargeCategory` |
| Billing period (month) | `BillingPeriodStart` |
| Charge period (day) | `ChargePeriodStart` |
| Bucket (prod vs. non-prod) | `dt.system.bucket` |

---

## Marketplace Transactions

The marketplace filter applies **only to production queries** (`*_prod` buckets). Non-production and R&D queries must **omit** this filter because marketplace purchases (SaaS, tools, managed services) are legitimate engineering costs. Additionally, on AWS, the production filter must preserve AI services (Bedrock, Anthropic, Cohere) which are billed as marketplace charges.

### Filter Scoping Rules

**Non-production / R&D queries** (`*_nonprod` buckets):
- **Omit** the marketplace filter entirely — no `filterOut` on `InvoiceIssuerName`

**Production queries** — provider-specific:

**AWS production** (`*_prod` + `event.provider == "AWS"`):
```dql-snippet
| filterOut event.provider == "AWS"
    AND NOT (InvoiceIssuerName == PublisherName
      OR in(PublisherName, {"Anthropic, PBC", "CohereAI", "CanonicalGroupLimited"})
      OR contains(ResourceId, "Bedrock"))
```
This preserves marketplace charges from known AI publishers (Anthropic, Cohere, Bedrock) while filtering other third-party/reseller charges.

**Microsoft and Google Cloud production** (`*_prod` + those providers):
```dql-snippet
| filterOut in(event.provider, {"Microsoft", "Google Cloud"})
    AND InvoiceIssuerName != PublisherName
```
Their AI services (Azure OpenAI, Vertex AI) are billed as first-party, so the standard marketplace filter applies.

**Mixed queries** (both `*_prod` and `*_nonprod` buckets):
- Add the production bucket guard to both filters above:
```dql-snippet
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
```

### Why AI Services Don't Need a Special Exception

With the above rules, AI services are naturally preserved:
- **Non-production**: no marketplace filter → all AI spend captured
- **Production AWS**: AI-allowlist filter → Bedrock, Anthropic, Cohere explicitly preserved
- **Production Microsoft/GCP**: AI services billed as first-party → not affected by the marketplace filter

**User-requested marketplace data:** If a user explicitly wants to see all marketplace charges (not just prod restrictions), omit these filters entirely or use a modified form.

---

## Tax and Adjustment Filters

By default, **always** exclude tax, credit, refund, and adjustment line items. These are non-usage charges that should not be included in cloud cost reporting. Add these lines after the Marketplace filter in every query:

```dql-snippet
// AWS — filter out tax, non-EC2 credits, refunds, and adjustments
| filterOut event.provider == "AWS" AND (
    ChargeCategory == "Tax"
    OR ChargeCategory == "Refund"
    OR ChargeCategory == "Adjustment"
    OR (ChargeCategory == "Credit" AND (ServiceName == "Amazon Elastic Compute Cloud" OR contains(ChargeDescription, "Contractual Credit")))
  )

// Microsoft and Google Cloud — filter out tax, credit, refunds, and adjustments
| filterOut in(event.provider, {"Microsoft", "Google Cloud"}) AND in(lower(ChargeCategory), {"tax", "credit", "refund", "adjustment"})
```

**Omit these lines** only if the user explicitly asks to include taxes or adjustments.

---

## Troubleshooting

### When a User's Numbers Don't Match a Provider Dashboard

If a user says their DQL query results differ from what they see in an AWS Cost Explorer, Azure Cost Management, or Google Cloud Billing Console, the most likely reasons are:

1. **Different cost metric**: Provider dashboards often show list price or "unblended" cost by default, not amortized cost. They may also omit commitment discounts that only certain users have visibility into.
2. **DQL uses amortized cost**: `EffectiveCost` spreads reservation and savings-plan upfront fees evenly across the commitment period — a provider dashboard may show the full upfront charge in one month and $0 in others.
3. **Different timeframe logic**: DQL queries use `ChargePeriodStart` which may differ slightly from what the provider dashboard calendar shows.

**Reassure the user:** The amortized cost (`EffectiveCost`) returned by DQL queries is almost certainly the correct number for any reporting, budgeting, or decision-making use case. If they are still in doubt, they should reach out to the FinOps team on Slack: **#help-finops** — https://dynatrace.enterprise.slack.com/archives/C05GPED9NSF

### When a Query Returns Empty Results

If a user reports that a query returns no data, the most likely cause is a missing or not-yet-active data access permission. Work through the following steps:

1. **Ask whether they have requested access** — Billing data in Grail is access-controlled. If the user has not yet requested access, direct them to the **FinOps Data Request** template to apply:  
   https://juno.internal.dynatrace.com/create/templates/default/finops-request-data-access

2. **If they just submitted a request** — Let them know that it can take **2–3 hours** for the newly granted permissions to become active. They should retry the query after that window.

3. **If access was granted a while ago and results are still empty** — Double-check the query for common mistakes (wrong bucket, wrong `event.type` for the provider, timeframe filter not matching available data). If the query looks correct, direct the user to **#help-finops** on Slack for further assistance:  
   https://dynatrace.enterprise.slack.com/archives/C05GPED9NSF
