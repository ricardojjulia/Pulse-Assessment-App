# Management Zones

<!-- Jira: none -->

## What are Management Zones

Management Zones are an information-partitioning mechanism present in the Dynatrace classic product that groups monitored entities (hosts, services, applications, logs, metrics) and scopes what users see across all Dynatrace views. Users assigned to a zone only see data relevant to their zone, though problems that span zones still provide end-to-end visibility within permitted boundaries.

Typical use cases include organizing hosts by environment (staging, production), grouping services by technology, managing team-specific SLOs and alerts, and controlling access based on team responsibilities. Zones can overlap to reflect cross-team dependencies.

**Gen3 replacement**: Segments (filtering); IAM policies or dedicated Grail buckets (access control); Spaces (situational)

**Phase 2 required**: no

## Why there is no direct Gen3 equivalent

In classic (2nd gen), enrichment workers evaluate Management Zone membership by matching rules against the extracted entity model — for example, "zone `ebanking` = all hosts whose host group name starts with `ebanking`". Deciding whether any single datapoint (metric, log, trace) belongs to a zone is therefore resolved **on read**, by traversing entity relationships. Those traversals are effectively JOINs, and they run for every query and every permission check.

This does not scale on Grail. For both filtering and permission evaluation, the new platform **avoids ad-hoc joins at any price**. Instead, the discriminating information is **materialized and enriched directly onto the data** at ingest — as primary Grail fields, tags, and security context. Filters and access rules then operate on those enriched fields, keeping the query execution plan optimized at large scale.

This is why Management Zones were not rebuilt, and why migration **cannot be a 1:1 mapping**. The work is to move the membership logic from on-read rule evaluation to ingest-time enrichment on the data itself.

## The two functions of a Management Zone

A Management Zone does two distinct jobs. Migrate each separately, because they map to different Gen3 concepts:

| MZ function | Classic behavior | Gen3 replacement |
|---|---|---|
| **Filtering / focus** | A simple UI dropdown that lets non-expert users focus on "their" data without knowing the entity model (e.g. an ebanking engineer finds that app's error logs) | **Segments** — a filter injected into DQL execution, optimized, no joins |
| **Access control** | An admin grants a user group access to a zone (e.g. group *engineering* sees only zone *ebanking*) | **IAM policy boundaries** on enriched fields/tags, **or** dedicated **Grail buckets** with bucket + record-level permissions |

## Migration strategy: start from the data, not from the zone

Because on-read relationship resolution (host → host group → zone) no longer exists, a Management Zone rule cannot be translated directly. The migration starts from the data:

1. **Read the existing MZ rule** and find the **discriminator** — the attribute that decides membership (host group name, Kubernetes cluster name, department, location, team, app, etc.).
2. **Check whether that discriminator is already enriched on the data** (logs, metrics, spans) as a primary field or a primary tag. Verify with dtctl + DQL (see [Verifying enrichment](#verifying-enrichment)).
3. **If it is enriched**, build the replacements directly on that field/tag:
   - a **Segment** for filtering, and/or
   - an **IAM policy boundary** or **bucket/record-level permission** for access control.
4. **If it is not enriched**, produce a **tagging / enrichment plan** so the discriminator lands on the data — typically by enriching a **primary tag in OpenPipeline**, which is also where that tag drives [routing of records into the correct Grail bucket](https://docs.dynatrace.com/docs/platform/openpipeline/concepts/data-flow). See also [autotagging.md](../autotagging/autotagging.md).

> Example discriminator: a customer maps the infrastructure that classic MZ rules matched (host groups, Kubernetes cluster names) onto a primary tag such as `emea_de_ebanking_prod` (region + country + app + stage). Once that tag is on the data, the **same tag** can drive bucket routing, Segment filters, and access control alike.

### Filtering → Segments

Segments provide the easy, dropdown-style filtering Management Zones offered. The segment filter is injected into DQL execution **on read**, and the execution plan is highly optimized for query performance. JOINs are neither possible nor necessary, because all the data needed to filter is expected to already be enriched on the records.

### Access control → IAM policies or dedicated buckets

Two viable paths, depending on what the customer is willing to do with their data layout:

- **IAM policy boundaries on enriched fields/tags** — reproduce "group X sees only zone Y" by scoping policies to the enriched discriminator. Cross-link to the role-to-policy migration in [iam-2nd-gen-roles.md](../iam-2nd-gen-roles/iam-2nd-gen-roles.md).
- **Physical data partitioning with Grail buckets** — Grail now supports physical data partitioning. Route each team's or department's data into a dedicated bucket and control access with **bucket permissions**. Buckets also carry their own retention and ingest cost, which makes them a natural fit for chargeback models. When dedicated buckets are acceptable, **no MZ equivalent is needed**.

These combine into a **two-tier access model**: a **bucket permission** scopes access at the coarse level (e.g. a whole department), while **record-level permissions** restrict finer slices within a shared bucket (e.g. individual apps whose data lands in the same departmental bucket). The same primary tags that drive bucket routing also drive these record-level rules and the UI Segment filters.

## Verifying enrichment

Before building Segments or policies, confirm the discriminator is actually present on the data. Inspect the customer's tagging configuration and cross-check the data with **dtctl + DQL** — confirm the field or tag appears on the logs and metrics for the entities the zone used to cover. If it is missing or inconsistent, that gap drives the enrichment/tagging plan from step 4 above.

<!-- Concrete dtctl commands and DQL verification queries to be added. -->

## Spaces (note)

Spaces primarily let customers delegate administration of a Dynatrace environment to teams — for example, allowing the ebanking team to manage its own data ingestion and retention. They are not the primary Management Zone replacement. However, because the Space id is enriched on all data (`dt.space`), filtering or assigning permissions by Space is also possible where it fits the organization's model. Detailed Spaces guidance is deferred for now.

## Customer actions

- Identify each Management Zone's **discriminator** and which of its two functions (filtering vs. access control) are in use.
- Verify with dtctl + DQL whether the discriminator is enriched on the data; if not, enrich it as a primary tag in OpenPipeline.
- Stand up the Grail bucket(s) and OpenPipeline routing where physical data separation is wanted.
- Recreate **filtering** with Segments and **access control** with bucket permissions (+ record-level permissions) or IAM policy boundaries.
- Migrate the consumption layer that depended on the zone: dashboards, Segment filters, and alerting configs.
- Management Zones will be removed in Phase 3.

## Tracking queries

Top Management Zones used for queries:

```dql
timeseries
  queries = sum(dt.sfm.server.management_zones.queries_counter), 
  by: { dt.management_zone.id, dt.management_zone.name},
  from: -30d
| fields dt.management_zone.name, queries = arraySum(queries)
| sort queries desc
```

## Worked example

### Context

A very large customer (1000+ teams) runs Dynatrace as an internal, charged-for service. A central **Monitoring team** (~20 people) provisions the platform globally and bills cost back to each department. Onboarding is fully automated: when a new department is added, tooling prepares its Dynatrace experience — UI Segment filters (previously Management Zones), ready-made dashboards, and a cleanly separated data set.

Team identity follows the company org structure. In 2nd gen, identity was derived by mapping infrastructure (host groups, Kubernetes cluster names) onto a Management Zone such as `emea_de_ebanking_prod`. In 3rd gen, the same identity is enriched as a **primary tag on all data** (logs, spans, metrics) in **OpenPipeline**, and that one tag drives:

- **routing** of records into the correct Grail bucket (physical separation, with per-team retention and ingest cost),
- **access control** via bucket permissions (coarse, e.g. department) combined with record-level permissions (fine, e.g. a single app sharing a departmental bucket), and
- **UI Segment filters** for everyday focus.

### The challenge

There is no automated path from the old setup to the new one. A team that used to open a specific dashboard — say, *failed service requests for their app* — needs that whole experience reconstructed on Gen3 primitives.

### What the migration must produce

For each migrated use case, the central Monitoring team (with this skill's help) must deliver:

1. **Enrichment** — all necessary primary tags are present on the data.
2. **Bucket setup** — the correct Grail bucket(s) exist, with retention and cost aligned to the team.
3. **Routing** — OpenPipeline routes the team's data into the correct bucket(s).
4. **Dashboard migration** — the classic dashboard config is translated to a Gen3 dashboard.
5. **Segment filters** — UI Segment filters are configured for the team's focus.
6. **Alerting** — alerting configurations are recreated.

> This checklist is the backbone of an automatable migration: discover the classic discriminator → ensure it is enriched (1) → stand up buckets and routing (2, 3) → rebuild the consumption layer (4, 5, 6).

## References

- [What Management Zones are](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/management-zones)
- [Apply and use Management Zones](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/management-zones/apply-and-use-management-zones)
- [Upgrade guide (Gen3 concepts overview)](https://docs.dynatrace.com/docs/manage/upgrade-guide-landing-page)
- [Migrate roles to policies](https://docs.dynatrace.com/docs/manage/identity-access-management/permission-management/manage-user-permissions-policies/advanced/migrate-roles)
- [OpenPipeline data flow](https://docs.dynatrace.com/docs/platform/openpipeline/concepts/data-flow)
