# Key Fields Reference

| Field | Description |
|---|---|
| `event.provider` | Cloud provider: `"AWS"`, `"Microsoft"`, `"Google Cloud"` |
| `event.type` | `"BillingDraft"` or `"BillingFinal"` |
| `dt.system.bucket` | Grail bucket name (see bucket table in [Data Structure](./data-structure.md)) |
| `ChargePeriodStart` | Start timestamp of the charge period — use for time filtering |
| `ChargePeriodEnd` | End timestamp of the charge period |
| `BillingPeriodStart` | Start of the billing period (month) |
| `BillingPeriodEnd` | End of the billing period (month) |
| `SubAccountName` | AWS account name / Azure subscription name / Google Cloud project name (after parsing). **If filtering by `SubAccountName` returns no results, fall back to `SubAccountId`** (see [Account Lookup Fallback](./provider-quirks.md#account-lookup-fallback)). |
| `SubAccountId` | Cloud provider's internal account identifier: AWS account number, Azure subscription ID, or Google Cloud project ID. Use as a fallback when `SubAccountName` filtering returns no results. |
| `ServiceName` | Cloud service name (e.g. "Amazon Elastic Compute Cloud") |
| `ChargeCategory` | Charge type: `"Usage"`, `"Purchase"`, `"Credit"`, `"Tax"`, `"Refund"`, `"Adjustment"` |
| `ChargeDescription` | Human-readable description of the charge |
| `EffectiveCost` | Amortized cost (default metric). Has direct P&L impact. |
| `ListCost` | List price cost (pre-discount) |
| `ContractedCost` | Cost at contracted unit price (post-negotiation, pre-commitment amortization) |
| `BilledCost` | Invoice cost (for reconciliation) |
| `InvoiceIssuerName` | The entity that issued the invoice (e.g. AWS, Microsoft). Used in the marketplace filter. |
| `PublisherName` | The entity that published/provides the service. Differs from `InvoiceIssuerName` for Marketplace and third-party charges. |
| `x_Project` | Google Cloud specific: JSON string containing Google Cloud project metadata |
| `dt_CostDepartmentName` | Dynatrace cost department the cloud account belongs to. Use to filter by business unit. See [Cost Department Filtering](./data-structure.md#cost-department-filtering) for known mappings and the disambiguation query. |
| `dt_ValidTags` | Boolean flag — `true` if the resource has a valid owner tag assigned, `false` otherwise. Use to report on untagged or incorrectly tagged resources. |
| `dt_OwnerEmail` | Email address of the team that owns the resource. |
| `dt_OwnerTeam` | Team name of the owning team. Accepts any of the three name variants defined in Dynatrace Teams. Less strict — useful for exploratory lookups when the exact internal name is unknown. |
| `dt_OwnedByTeam` | Standardized internal team name from Dynatrace Teams. **Preferred field for filtering by team** — normalized and consistent across accounts. |
