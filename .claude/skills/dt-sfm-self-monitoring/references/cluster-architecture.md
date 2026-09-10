# Cluster Architecture Reference

Dynatrace production platform architecture: cluster generations, naming, types, deployment families, and host groups.

---

## Gen2 vs Gen3 Clusters

Two generations of cluster infrastructure coexist in Dynatrace production.

**Gen2 (Classic)** — the original deployment model based on Cassandra and Elasticsearch. These are **not** Kubernetes clusters. Each Gen2 cluster is a standalone deployment in a specific cloud region.

**Gen3 (Grail)** — the modern deployment model running on Kubernetes. Each Gen3 cluster hosts Grail components (ingest, query, PPX) and related platform services organized into deployment families.

| Aspect | Gen2 (Classic) | Gen3 (Grail) |
|--------|----------------|--------------|
| **Infrastructure** | Cassandra + Elasticsearch | Kubernetes |
| **Entity type** | Represented as a field (`dt.host_group.id`) on HOST | `dt.smartscape.k8s_cluster` / K8S_CLUSTER |
| **Naming prefixes** | `cluster_` (AWS), `doaks-` (Azure AKS), `dogke-` (GCP GKE) | `dtp-` |
| **Format** | `<prefix><prodN>-<region>` | `dtp-<deployment>-<type>` |
| **Example** | `cluster_prod11-virginia`, `doaks-prod3-westeurope`, `dogke-prod1-us-east4` | `dtp-prod11-grail` |

### Gen2 Cluster Naming Formats

Gen2 clusters have **two levels of naming**: the infrastructure host-group name (seen in entities) and the logical cluster name (used in tenant mappings and operational references).

**Infrastructure host-group names** (as seen in `dt.host_group.id` on HOST nodes):
- `cluster_<prodN>-<region>` — AWS deployments (e.g., `cluster_prod11-virginia`)
- `doaks-<prodN>-<region>` — Azure AKS deployments (e.g., `doaks-prod3-westeurope`)
- `dogke-<prodN>-<region>` — GCP GKE deployments (e.g., `dogke-prod1-us-east4`)

**Logical cluster names** (three formats depending on deployment type):
- **SaaS (legacy named):** `prod<N>-<region>` (e.g., `prod23-ireland`, `prod11-virginia`)
- **SaaS (newer):** `prd-<uuid>` (e.g., `prd-ae8e9ca0-63d7-4133-9f45-5cee130fb006`)
- **Managed:** bare UUID (e.g., `194921b8-3027-4a54-8853-42649171599e`)

The legacy named format is the most common for SaaS. Newer SaaS clusters use a `prd-` prefix with a UUID. Managed deployments use a bare UUID with no prefix.

### Tenant-to-Cluster Relationship (N:M)

Each tenant belongs to exactly **one Gen2 cluster** and exactly **one Gen3 cluster**, but the mapping between Gen2 and Gen3 clusters is **many-to-many**:

- Tenants in the same Gen2 cluster may be spread across **different** Gen3 clusters
- Tenants in the same Gen3 cluster may come from **different** Gen2 clusters
- There is no 1:1 mapping between Gen2 and Gen3 clusters

### Listing Gen2 clusters

```dql
smartscapeNodes HOST
| fieldsAdd dt.host_group.id
| filter startsWith(dt.host_group.id, "cluster_") OR startsWith(dt.host_group.id, "doaks-") OR startsWith(dt.host_group.id, "dogke-")
| summarize count(), by: {dt.host_group.id}
| fields value = dt.host_group.id
| sort value
```

### Listing Gen3 clusters

```dql
smartscapeNodes K8S_CLUSTER
| filter startsWith(name, "dtp-")
| fieldsAdd dt.host_group.id = name
| fields name
| sort name
```

> **Cross-reference:** For tenant-to-cluster mapping (finding which Gen2 and Gen3 cluster a tenant belongs to), load a skill covering tenant-to-customer mapping and cluster lookups.

---

## Gen3 Cluster Naming & Types

**Naming format:** `dtp-<deployment>-<type>`

| Type | Example | Purpose | Key Components |
|------|---------|---------|----------------|
| `grail` | `dtp-prod107-grail` | Grail ingest and query | DPS ingest, Query frontend, Query engine, PPX services |
| `plsrv` | `dtp-prod107-plsrv` | Platform services | Document service, Analyzer service |
| `apigw` | `dtp-prod107-apigw` | External API access | API gateway, external-facing services |
| `apprt` | `dtp-prod107-apprt` | Application runtime (AppEngine) | Dynatrace Apps execution; present in larger deployments (prod101+, prod201+) |
| `dac` | `dtp-prod107-dac` | Data ingestion | Data ingest controller |

The `grail` cluster is the **most critical type** — it runs the entire data pipeline (ingest, query, and OpenPipeline processing).

---

## Deployment Families

All clusters sharing the same deployment number form a **deployment family** — they are related and serve the same set of tenants.

```text
prod11 deployment family:
├── dtp-prod11-grail   (Grail: ingest, query, PPX)
├── dtp-prod11-plsrv   (Platform services)
├── dtp-prod11-apigw   (API gateway)
├── dtp-prod11-apprt   (App runtime)
└── dtp-prod11-dac     (Data ingest controller)
```

**Inferring related clusters:** swap the type suffix while keeping the deployment number.

- Tenant on `dtp-prod11-grail` → platform services on `dtp-prod11-plsrv`
- Tenant on `dtp-prod107-grail` → API gateway on `dtp-prod107-apigw`

Not all families have every type — smaller deployments may lack `apprt`.

---

## Host Groups

Host group, cluster, and independent deployment are **interchangeable terms**.

| Property | Detail |
|----------|--------|
| Canonical identifier | `dt.host_group.id` |
| Entity queries | `name` = `dt.host_group.id` |
| Infrastructure | Independent — no sharing between host groups |
| Signal coverage | Present in all metrics, logs, and spans |

Use `dt.host_group.id` for all cluster-based filtering across metrics, logs, and spans.
