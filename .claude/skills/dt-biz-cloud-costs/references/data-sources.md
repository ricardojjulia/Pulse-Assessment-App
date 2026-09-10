# Cloud Cost Data Sources

## How Cloud Costs Are Ingested

Dynatrace ingests cloud cost data using the **FOCUS** (FinOps Open Cost and Usage Specification) standard. Cost data arrives as business events (`bizevents`) with `event.type == "cost.real.spend"`.

### Semantic Dictionary Reference

All field definitions for cost billing events are documented in the Dynatrace Semantic Dictionary:
<https://docs.dynatrace.com/docs/shortlink/semantic-dictionary-business-analytics#real-billing-costs-events-fields>

### Prerequisites

- **Cost & Carbon Optimization app** must be installed in your Dynatrace environment
- Cloud cost ingestion must be configured to pull cost and usage data from your cloud provider (e.g., AWS Cost Explorer)

## Available Attribution Fields

Cost data can be aggregated or filtered by any of the following FOCUS-standard fields:

| Field | Description | Example Values |
|---|---|---|
| `focus.ChargeCategory` | Type of charge | `Usage`, `Credit`, `Tax` |
| `focus.ChargePeriodStart` | Start of the billing period (string — use `toTimestamp()`) | `2026-04-01T00:00:00Z` |
| `focus.ChargePeriodEnd` | End of the billing period | `2026-04-30T23:59:59Z` |
| `focus.ServiceCategory` | High-level service grouping | `Compute`, `Storage`, `Networking` |
| `focus.ServiceName` | Specific cloud service | `Amazon EC2`, `Amazon S3` |
| `focus.SubAccountId` | Cloud account/subscription ID | `123456789012` |
| `focus.SubAccountName` | Cloud account/subscription name | `team-platform-prod` |
| `focus.ResourceId` | Individual resource identifier | `arn:aws:ec2:...` |
| `focus.Tags` | JSON string of resource tags | `{"team":"platform","env":"prod"}` |
| `focus.EffectiveCost` | Cost after discounts and reservations | numeric |
| `focus.BilledCost` | Amount charged on the invoice | numeric |
| `focus.ContractedCost` | Cost based on contracted rates | numeric |
| `focus.ListCost` | List/on-demand price | numeric |

> **Which cost field to use?** Use `focus.EffectiveCost` as the default — it reflects actual cost after discounts. Use `focus.BilledCost` when the user asks about the invoice amount. Use `focus.ListCost` to show the undiscounted rate. For more information on the available cost fields, please refer to the FOCUS documentation <https://focus.finops.org/focus-columns/?version=v1-2>.

## Always Filter to Usage Charges

All cost queries must include:

```dql-snippet
| filter focus.ChargeCategory == "Usage"
```

This excludes credits, refunds, taxes, and other non-usage rows that would distort totals.

## Time Range Considerations

Cloud billing events are ingested at end-of-billing-cycle. Two time filters are needed:

1. **Fetch window** — controls how far back to scan ingest events: `from:now()-10d, to:now()`
2. **Billing period filter** — filters by when the usage actually occurred:

```dql-snippet
| filter toTimestamp(focus.ChargePeriodStart) >= now()-10d and toTimestamp(focus.ChargePeriodStart) < now()
```

Always use `toTimestamp()` when filtering on `focus.ChargePeriodStart` since it is stored as a string.
