# Blast Radius Mapping

How to systematically identify everything a change can affect, using Dynatrace
topology and trace data.

## Why Map Blast Radius

A change to service A may break service B. Without mapping the blast radius,
teams discover impact only after deployment — in production, from users.

Blast-radius mapping answers three questions:
1. **Who calls this service?** (upstream consumers)
2. **What does this service call?** (downstream dependencies)
3. **What infrastructure does this service share?** (hosts, clusters, databases)

## Step 1: Identify Upstream Consumers

Find all services that call the target service:

```dql
fetch spans
| filter span.kind == "client"
  AND peer.service == "<target-service-name>"
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize
    calls = count(),
    p90 = percentile(duration, 90),
    errorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { service_name }
| sort calls desc
```

**Interpret results:**
- High-call-count consumers are most affected by latency or error changes
- Consumers with existing high error rates may be fragile to additional issues
- Document all consumers — they are your blast radius upstream

## Step 2: Identify Downstream Dependencies

Find all services and systems the target service calls:

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("<service-id>")
| summarize
    calls = count(),
    p90 = percentile(duration, 90),
    errorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { peer.service }
| sort calls desc
```

**Database dependencies:**

```dql
fetch spans
| filter dt.smartscape.service == toSmartscapeId("<service-id>")
  AND db.system != ""
| summarize
    queries = count(),
    p90 = percentile(duration, 90),
  by: { db.system, db.name }
```

## Step 3: Identify Shared Infrastructure

**Co-located services (same host):**

```dql
fetch spans, from: now()-2h
| filter dt.smartscape.host == toSmartscapeId("<host-id>")
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize calls = count(), by: { service_name }
| sort calls desc
```

**Same Kubernetes namespace:**

```dql
smartscapeNodes CLOUD_APPLICATION
| filter contains(name, "<namespace>")
| fields id, name
```

## Step 4: Check Current Health of Blast Radius

Before the change, verify nothing in the blast radius is already degraded:

**Active problems on any affected entity:**

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND event.status == "ACTIVE"
| expand affected_entity_ids
| filter affected_entity_ids == "<service-id>"
  OR affected_entity_ids == "<consumer-1-id>"
  OR affected_entity_ids == "<consumer-2-id>"
| fields timestamp, display_id, title, affected_entity_ids
```

**Error rates across the blast radius:**

```dql
fetch spans
| filter span.kind == "server"
  AND request.is_root_span == true
  AND (dt.smartscape.service == toSmartscapeId("<service-id>")
    OR dt.smartscape.service == toSmartscapeId("<consumer-1-id>")
    OR dt.smartscape.service == toSmartscapeId("<consumer-2-id>"))
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize
    errorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { service_name }
| sort errorRate desc
```

## Blast Radius Documentation Template

```markdown
## Blast Radius — [Change Name]

### Target Service
- Name: [service name]
- Entity ID: [entity ID]

### Upstream Consumers
| Service | Call Volume | Current Error Rate | Risk |
|---------|------------|-------------------|------|
| | | | |

### Downstream Dependencies
| Service/System | Call Volume | Current p90 | Risk |
|---------------|------------|-------------|------|
| | | | |

### Shared Infrastructure
| Resource | Co-located Services | Risk |
|----------|-------------------|------|
| | | |

### Current Health
- Active problems: [none / list]
- Degraded services: [none / list]
- Risk assessment: [low / medium / high]
```

## When to Escalate

If the blast-radius mapping reveals:
- **>5 upstream consumers** — the change has wide impact; consider canary rollout
- **Active problems on blast-radius services** — defer the change until resolved
- **Shared database or message bus** — schema or config changes cascade; full Tier 2 lifecycle required
- **Cross-team dependencies** — notify consuming teams before deployment
