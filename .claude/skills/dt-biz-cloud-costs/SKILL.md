---
name: dt-biz-cloud-costs
description: "Business Observability for cloud infrastructure costs — analyze AWS cloud spending using Dynatrace. Covers cost trends, team/application attribution, cost allocation, chargeback/showback, and identifying resources for cost optimization. Use when answering questions about cloud spend, cost allocation, or ROI of infrastructure."
license: Apache-2.0
---

# dt-biz-cloud-costs

Analyze cloud infrastructure costs through Dynatrace Business Observability. Customer AWS cloud billing data is ingested into Grail as business events and queried with DQL to answer cost, trend, and attribution questions.

> **Scope boundary**: This skill covers AWS cloud *infrastructure* costs. For Dynatrace *platform* billing (DPS consumption), use `dt-platform-costs` instead.

---

## Prerequisites

- Cost & Carbon Optimization app must be installed in Dynatrace environment (see [references/data-sources.md](references/data-sources.md))
- Cloud cost ingestion must be configured to ingest cost and usage data into Dynatrace (see [references/data-sources.md](references/data-sources.md))
- Access to Grail with appropriate scopes
- `dt-dql-essentials` loaded for DQL syntax guidance

---

## When to Use This Skill

| User Request | Action | Reference |
|---|---|---|
| "Can I ingest my cloud costs into Dynatrace?", "Can I get my AWS rate card into Dynatrace?" | Explain FOCUS ingestion | [data-sources.md](references/data-sources.md) |
| "What were my AWS costs this month?", "How much did we spend on AWS?" | Total spend summary | [cost-overview.md](references/cost-overview.md) |
| "What can I break down cost data by?", "What dimensions are available?" | List available FOCUS fields | [data-sources.md](references/data-sources.md) |
| "How much did I spend on compute?", "Breakdown costs by service category" | Per-service-category summary | [cost-overview.md](references/cost-overview.md) |
| "Breakdown my AWS costs by service" | Service-level drill-down | [cost-overview.md](references/cost-overview.md) |
| "Show me my cost trend", "daily spend", "how has spend changed", "cost over time" | Time-series daily trend (overall, by service, or by account) | [cost-trends.md](references/cost-trends.md) |
| "Cost trend by account", "Cost trend for my account", "service breakdown for account" | Two-step: list accounts first, then filter by chosen account | [cost-trends.md](references/cost-trends.md) |
| "How much did my team spend?", "Cost by sub-account", "chargeback", "showback" | Sub-account attribution | [cost-attribution.md](references/cost-attribution.md) |
| "Cost by tag", "What tags do we use?", "Costs by owner", "Costs by team tag" | Tag-based attribution | [cost-attribution.md](references/cost-attribution.md) |

---

## Agent Instructions

### Step 1: Confirm data is present

Before running queries, verify cloud cost events are being ingested:

```dql
fetch bizevents, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| limit 1
```

If no results, direct the user to set up ingestion. See [references/data-sources.md](references/data-sources.md).

### Step 2: Always filter to usage charges

All cost queries must filter `focus.ChargeCategory == "Usage"` to exclude credits, refunds, and tax rows that would distort totals.

### Step 3: Apply a billing period filter

Cloud billing events are ingested at the end of a billing cycle. Filter on `focus.ChargePeriodStart` (the period the cost relates to), not just the event ingestion timestamp:

```dql-snippet
| filter toTimestamp(focus.ChargePeriodStart) >= now()-30d and toTimestamp(focus.ChargePeriodStart) < now()
```

### Step 4: Map the request to an attribution dimension

| User wants costs by... | Field to use |
|---|---|
| Cloud service category (Compute, Storage, etc.) | `focus.ServiceCategory` |
| Specific cloud service (EC2, S3, etc.) | `focus.ServiceName` |
| AWS account / subscription | `focus.SubAccountId`, `focus.SubAccountName` |
| Tag (team, owner, environment, etc.) | `focus.Tags` (JSON string — see [cost-attribution.md](references/cost-attribution.md)) |
| Specific resource | `focus.ResourceId` |

> **When tags are involved**: first run the tag enumeration query to show the user available tag names, then ask which tag to filter on before running the value breakdown.

---

## Core DQL Patterns

### Verify data is present

```dql
fetch bizevents, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| limit 1
```

### Total spend (last 10 days)

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}
```

### Discover available service categories and services

Run this first to show the user what service categories exist in their data before filtering:

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize records=count(), by: {focus.ServiceCategory, focus.ServiceName}
| sort focus.ServiceCategory, focus.ServiceName asc
```

### Cost by service category

```dql-template
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter focus.ServiceCategory == "<CATEGORY>"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:focus.ServiceCategory
```

Known `focus.ServiceCategory` values: `AI and Machine Learning`, `Analytics`, `Business Applications`, `Compute`, `Databases`, `Developer Tools`, `Multicloud`, `Identity`, `Integration`, `Internet of Things`, `Management and Governance`, `Media`, `Migration`, `Mobile`, `Networking`, `Security`, `Storage`, `Web`, `Other`

### Cost by sub-account (team/department attribution)

```dql
fetch bizevents, scanLimitGBytes:-1, from:now()-10d, to:now()
| filter event.type == "cost.real.spend"
| filter focus.ChargeCategory == "Usage"
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
| summarize {EffectiveCost=sum(focus.EffectiveCost), BilledCost=sum(focus.BilledCost), ContractedCost=sum(focus.ContractedCost), ListCost=sum(focus.ListCost)}, by:{focus.SubAccountId, focus.SubAccountName}
```

---

## References

| Topic | File |
|---|---|
| FOCUS ingestion setup, semantic dictionary, available attribution fields | [references/data-sources.md](references/data-sources.md) |
| Total spend, service category and service-level breakdown queries | [references/cost-overview.md](references/cost-overview.md) |
| Time-series cost trends by day, service category, or account | [references/cost-trends.md](references/cost-trends.md) |
| Sub-account attribution, tag enumeration, tag-value breakdown | [references/cost-attribution.md](references/cost-attribution.md) |
