---
name: dt-sfm-finops-focus
description: >
  Use this skill when writing DQL queries for cloud cost analysis, billing workflows, or FinOps investigations in Dynatrace.
  Apply immediately if a user requests DQL queries involving: cloud spend or cost breakdown (AWS / Amazon Web Services, Azure / Microsoft, GCP / Google Cloud Platform);
  cost metrics (EffectiveCost, ListCost, BilledCost, ContractedCost, ChargeCategory, ChargePeriodStart); cost optimization (reserved instances, amortized cost);
  billing data buckets; cost trends or comparisons; or cost by tags/dimensions.
  Provides guidance on FOCUS-formatted billing data in Dynatrace Grail, bucket selection (custom_sen_critical_events_finops_*),
  cost field definitions and calculations, amortized cost filtering, provider-specific data quirks, and cost analysis patterns
  across cloud providers.
---

# FinOps FOCUS DQL Queries

## When to apply this skill

If the user asks for a DQL query in general, quickly assess whether the topic involves cloud cost or billing — if unclear, ask before proceeding.

> **⚠️ Important — Reporting disclaimer:** Always remind the user that **query results must be reviewed and confirmed by the FinOps team before being used for any reporting purpose** — regardless of the format (slide deck, Excel sheet, email, dashboard, or any other output). Raw DQL results are a starting point, not a vetted figure. To get results signed off, the user should reach out via **#help-finops** — https://dynatrace.enterprise.slack.com/archives/C05GPED9NSF

---

## Key Concepts

### Timeframe Rules

**Always clarify the timeframe before writing a query.** Do not assume a default. See [Timeframe Handling](./references/timeframe-handling.md) for detailed rules on BillingPeriodStart vs. ChargePeriodStart, DST offsets for Google Cloud, and `fetch events, from:` settings.

### Data Structure

Cloud cost data is stored in four buckets split by event type (Draft vs. Final) and cloud account category (Production vs. Non-Production). See [Data Structure](./references/data-structure.md) for bucket details, cost department filtering, and organization data joins.

### Cost Fields

The FOCUS format defines four cost metrics: `EffectiveCost` (default, amortized), `ListCost`, `ContractedCost`, and `BilledCost`. See [FOCUS Cost Fields](./references/cost-fields.md) for detailed semantics, field selection rules, marketplace transactions, and tax/adjustment filters.

### Provider Names

Cloud cost data uses three canonical provider names in the `event.provider` field. When a user mentions any alias, translate it to the canonical name in your DQL filter:

| Canonical Name | User-facing Aliases |
|---|---|
| `AWS` | Amazon, Amazon Web Services |
| `Microsoft` | Azure, Microsoft Azure |
| `Google Cloud` | GCP, GC, Google Cloud Platform |

Always use the canonical provider name in `event.provider` filters, regardless of which alias the user mentions.

---

## Use Case Routing

| User Intent | Reference |
|---|---|
| **Writing a query for the first time** | [Query Templates](./references/query-templates.md) — essential template and provider-specific examples |
| **Queries involving cost aggregation and grouping** | [Query Templates](./references/query-templates.md) — cost field selection, grouping rules, output formatting |
| **Understanding FOCUS cost metrics or field selection** | [FOCUS Cost Fields](./references/cost-fields.md) — cost field semantics, discrepancies vs. provider dashboards, empty results troubleshooting |
| **Marketplace, tax, credit, or adjustment filtering** | [FOCUS Cost Fields](./references/cost-fields.md) — marketplace filter, AI services exception, tax/adjustment exclusion rules |
| **Handling Google Cloud quirks or provider-specific behavior** | [Provider Quirks](./references/provider-quirks.md) — SubAccountName parsing, BillingDraft unavailability, ingestion timing, fetch offset rules |
| **Looking up available fields or field descriptions** | [Key Fields Reference](./references/key-fields.md) — comprehensive field table with FOCUS mappings |
| **Filtering or reporting by resource owner or team** | [Owner Tagging](./references/owner-tagging.md) — owner tagging fields, team filtering, example queries |

---

## Support

For questions about cloud cost data, discrepancies, or FinOps best practices, reach out to the FinOps team on Slack:  
**#help-finops** — https://dynatrace.enterprise.slack.com/archives/C05GPED9NSF
