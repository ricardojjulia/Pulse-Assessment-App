---
name: dt-sdlc-observability-design
description: >
  Design observability before implementation — not after. Guides users through
  baseline discovery, blast-radius mapping, verification queries, SLOs, and
  rollback criteria using live Dynatrace data. Primary context is Dynatrace
  Assist in the platform UI (no source code access required). Produces an
  exportable observability plan for handoff to development teams.
license: Apache-2.0
---

# Observability-Driven Design

Design observability into every change before implementation begins. This skill
helps teams define what they will measure, how they will verify success, and what
will trigger rollback — all grounded in Dynatrace runtime data.

## When to Use This Skill

- Planning a service change and need to understand current behavior first
- Assessing what a planned change could break (blast radius)
- Preparing verification queries to run after deployment
- Defining or reviewing SLOs and rollback criteria
- Generating an observability plan to hand off to a development team

> **Starting out?** If you just want an automated post-deploy check, start with
> a skill that focuses on quality gates and post-deployment validation first.
> This skill is for teams ready to design observability *before*
> implementation.

## Core Principle

> **Observability is designed before implementation, not bolted on after.**

Traditional approaches add monitoring after the code is written. This inverts
that — before writing code, the team uses Dynatrace to establish:

1. What the current baseline is (measured from live data, not assumed)
2. What signals will prove the change works
3. What signals will trigger rollback
4. What the blast radius is (from real topology, not guesses)

## User Journey — Dynatrace Assist

This skill is designed for **conversational use in Dynatrace Assist** within the
platform UI. The user does not have source code access in this context — all
analysis is driven by live runtime data already collected by Dynatrace.

### Interaction Flow

The conversation follows these steps. Assist resolves entities, runs queries,
and builds the plan incrementally.

```
User: "I'm planning a change to [service]. Help me build an observability plan."
  │
  ▼
Step 1: Identify the service
  Assist resolves the service name to a Dynatrace entity.
  │
  ▼
Step 2: Collect baseline
  Assist runs DQL against live data to capture current performance.
  │
  ▼
Step 3: Map blast radius
  Assist queries topology — upstream callers, downstream deps, shared infra.
  │
  ▼
Step 4: Generate verification queries
  Assist produces ready-to-run DQL for post-deployment validation.
  │
  ▼
Step 5: Review SLOs
  Assist checks existing SLOs and recommends additions.
  │
  ▼
Step 6: Define rollback criteria
  Assist derives thresholds from baseline data.
  │
  ▼
Output: Exportable observability plan
  Structured Markdown or Notebook the user takes to their dev team / ticket.
```

### Step 1: Identify the Target Service

Start by resolving the service the user plans to change. Do not require the user
to know entity IDs — resolve from the service name.

```dql
smartscapeNodes SERVICE
| filter contains(name, "checkout")
| fields id, name
```

Once the service is identified, use its entity ID for all subsequent queries.

### Step 2: Baseline Discovery

Run these queries against live data to capture the current state. Present the
results to the user as the documented baseline.

**Service latency and error rate:**

```dql
timeseries {
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
filter: { dt.smartscape.service == toSmartscapeId("<resolved-service-id>") }
| fieldsAdd
    p50_ms = arrayAvg(p50) / 1000,
    p90_ms = arrayAvg(p90) / 1000,
    p99_ms = arrayAvg(p99) / 1000,
    throughput = arraySum(requests),
    errorRate = arraySum(failures) * 100.0 / arraySum(requests)
```

**Dependency health:**

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("<resolved-service-id>")
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize
    calls = count(),
    p90 = percentile(duration, 90),
    errorRate = countIf(request.is_failed == true) / count() * 100.0,
  by: { service_name }
| sort errorRate desc
```

**Infrastructure:**

```dql
timeseries {
  cpuAvg = avg(dt.host.cpu.usage),
  cpuMax = max(dt.host.cpu.usage)
},
from: now()-2h,
filter: { host.name == "<resolved-host>" }
```

```dql
timeseries {
  memAvg = avg(dt.host.memory.usage),
  memMax = max(dt.host.memory.usage)
},
from: now()-2h,
filter: { host.name == "<resolved-host>" }
```

Present the results as a baseline summary table:

| Metric | Current Value |
|--------|---------------|
| p50 latency | *from query* |
| p90 latency | *from query* |
| p99 latency | *from query* |
| Error rate | *from query* |
| Throughput (req/count) | *from query* |
| CPU avg | *from query* |
| Memory avg | *from query* |

### Step 3: Blast Radius Mapping

Use Dynatrace topology data to identify everything the change can affect.

**Upstream consumers — who calls this service:**

```dql
fetch spans
| filter span.kind == "client"
  AND peer.service == "<resolved-service-name>"
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize callers = count(), by: { service_name }
| sort callers desc
```

**Downstream dependencies — what this service calls:**

```dql
fetch spans
| filter span.kind == "client"
  AND dt.smartscape.service == toSmartscapeId("<resolved-service-id>")
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize calls = count(), by: { peer.service }
| sort calls desc
```

**Shared infrastructure:**

```dql
fetch spans, from: now()-2h
| filter dt.smartscape.host == toSmartscapeId("<resolved-host-id>")
| fieldsAdd service_name = getNodeName(dt.smartscape.service)
| summarize calls = count(), by: { service_name }
| sort calls desc
```

**Active problems in the blast radius:**

```dql
fetch events
| filter event.type == "DAVIS_PROBLEM"
  AND event.status == "ACTIVE"
| expand affected_entity_ids
| filter affected_entity_ids == "<resolved-service-id>"
| fields timestamp, display_id, title, affected_entity_ids
```

Present as a blast radius summary:

- **Upstream consumers:** [list with call volumes]
- **Downstream dependencies:** [list with error rates]
- **Shared infrastructure:** [co-located services]
- **Active problems:** [none / list — if any, flag as risk]

### Step 4: Verification Query Design

Generate ready-to-run DQL that the user can execute after deployment. These are
not templates — Assist fills in the actual entity IDs and derives thresholds
from the baseline collected in Step 2.

| Query Purpose | What It Checks | Threshold (from baseline) |
|---------------|----------------|--------------------------|
| **Success verification** | The intended behavior is observed | Specific to the change |
| **Regression detection** | No degradation vs baseline | p90 latency within 10% of baseline value |
| **Error rate check** | No new error patterns | Error rate ≤ baseline + 0.5% |
| **Dependency health** | Downstream services unaffected | No new failures on dependencies |

**Success verification:**

```dql
timeseries {
  p90 = percentile(dt.service.request.response_time, 90),
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
},
from: now()-30m,
filter: { dt.smartscape.service == toSmartscapeId("<resolved-service-id>") }
| fieldsAdd
    p90_ms = arrayAvg(p90) / 1000,
    errorRate = arraySum(failures) * 100.0 / arraySum(requests),
    throughput = arraySum(requests)
```

**Regression detection (compare before/after windows):**

```dql
timeseries recent_p90 = percentile(dt.service.request.response_time, 90),
  from: now()-1h,
  filter: { dt.smartscape.service == toSmartscapeId("<resolved-service-id>") }
| fieldsAdd recent_p90_ms = arrayAvg(recent_p90) / 1000
| append [
  timeseries baseline_p90 = percentile(dt.service.request.response_time, 90),
    filter: { dt.smartscape.service == toSmartscapeId("<resolved-service-id>") },
    shift: -1h
  | fieldsAdd baseline_p90_ms = arrayAvg(baseline_p90) / 1000
]
| fieldsAdd degradation_pct = (recent_p90_ms - baseline_p90_ms) * 100.0 / baseline_p90_ms
```

### Step 5: SLO Review

Check whether the service already has SLOs defined. If not, recommend them based
on the baseline data.

Key SLO types to recommend:

| SLO Type | Measures | Suggested Target (from baseline) |
|----------|----------|----------------------------------|
| **Availability** | Successful requests / total requests | 99.9% (adjust based on current error rate) |
| **Latency** | Requests completing under threshold | 95% under p90 baseline value |
| **Error rate** | Failed requests / total requests | Current error rate + small margin |
| **Throughput** | Maintained request volume | No drop > 10% from baseline throughput |

### Step 6: Rollback Criteria

Derive explicit, measurable rollback conditions from the baseline. Do not use
generic thresholds — anchor to the actual baseline values collected in Step 2.

| Condition | Metric | Threshold (derived from baseline) | Action |
|-----------|--------|-----------------------------------|--------|
| Latency regression | p90 duration | > 2x baseline p90 for 5 minutes | Rollback |
| Error spike | Error rate | > baseline error rate + 2% for 3 minutes | Rollback |
| Dependency failure | Downstream error rate | > 5% for 2 minutes | Rollback |
| SLO burn rate | Error budget burn | > 10x normal rate | Rollback |

## Output: Exportable Observability Plan

The final output of this skill is a structured document the user exports from
the conversation to their development workflow — as a ticket attachment, a
Dynatrace Notebook, or Markdown pasted into a repo.

```markdown
## Observability Plan — [Service Name] — [Change Description]

**Generated:** [date]
**Service:** [entity name] ([entity ID])
**Environment:** [environment]

### Baseline (collected from live data)
| Metric | Value |
|--------|-------|
| p50 latency | [actual] |
| p90 latency | [actual] |
| p99 latency | [actual] |
| Error rate | [actual] |
| Throughput | [actual] req/[timeframe] |

### Blast Radius
**Upstream consumers:**
| Service | Call Volume | Current Error Rate |
|---------|------------|-------------------|
| [from query] | [from query] | [from query] |

**Downstream dependencies:**
| Service | Call Volume | Current p90 |
|---------|------------|-------------|
| [from query] | [from query] | [from query] |

**Shared infrastructure:** [from query]
**Active problems:** [from query — none / list]

### Verification Queries (run after deployment)
1. **Success check** — [full DQL with resolved entity ID]
2. **Regression check** — [full DQL with resolved entity ID]
3. **Dependency health** — [full DQL with resolved entity ID]

### Rollback Criteria
| Condition | Threshold | Action |
|-----------|-----------|--------|
| p90 latency | > [2x baseline value] for 5 min | Rollback |
| Error rate | > [baseline + 2%] for 3 min | Rollback |
| Downstream errors | > 5% for 2 min | Rollback |

### SLO Impact
- [Which SLOs are affected and recommended targets]

### Instrumentation Recommendations (for development team)
- [What to add] — [why] — [how to verify it's working]
```

> **This plan is the handoff artifact.** It bridges the gap between Dynatrace
> runtime insight and development action. The development team uses it to know
> *what to instrument*, *what to verify*, and *when to roll back*.

## Instrumentation Recommendations

When Assist identifies observability gaps during the analysis, it should include
instrumentation recommendations in the exportable plan. These are **handoff
items for the development team** — they cannot be implemented from within
Dynatrace Assist.

| Type | What to Add | Why | How to Verify |
|------|-------------|-----|---------------|
| **Custom spans** | Business-logic spans for new code paths | Trace visibility into new behavior | Query for span name after deployment |
| **Custom metrics** | Counters or gauges for new features | Dashboard and alerting support | Check metric explorer for new keys |
| **Structured logs** | Log lines with trace context and business attributes | Correlation and debugging | Query logs filtered by trace ID |
| **Events** | Deployment and configuration change events | Change correlation | Check events feed after deployment |

> **Note:** These are recommendations, not actions Assist can take. Include them
> in the observability plan so the development team can implement them before
> deployment.

## Common Pitfalls

- **Skipping baseline collection** — You cannot detect regression without a
  baseline. Always collect before the change.
- **Designing for happy path only** — Verification must cover failure modes,
  not just success.
- **Ignoring dependencies** — A change to service A may break service B. Always
  map the blast radius.
- **Vague rollback criteria** — "Roll back if things look bad" is not a
  criterion. Use specific metrics and thresholds derived from actual data.
- **Using placeholder entity IDs** — In Assist, always resolve entity names to
  real IDs before running queries. Never leave `<service-id>` placeholders.
- **Treating the plan as Dynatrace-internal** — The observability plan must
  leave Dynatrace. It is a handoff artifact for the development workflow.

---

## Query Hygiene

Before executing any DQL query from this skill:

1. **Verify syntax first** — avoids wasted execution time on malformed queries:
   ```dtctl
   dtctl verify query "fetch spans | filter span.kind == \"SERVER\" | ..."
   # or from file:
   dtctl verify query -f observability-plan.dql --fail-on-warn
   ```
2. **Keep windows narrow for triage, wider for baseline** — use `from: now()-30m`
   for post-deploy checks, `from: now()-24h` for baseline collection.
3. **Resolve entity IDs before running** — never execute queries with
   `<service-id>` placeholders. In Assist, ask the user for the service name
   and resolve it with the entity lookup query first.

## Advanced: IDE / Agent Integration

When this skill is used within an IDE agent (e.g., Copilot with Dynatrace MCP)
rather than Dynatrace Assist, the following additional capabilities apply:

### Source Code Context

With access to the codebase, the agent can:
- Review the proposed code change and identify which services are affected
- Check that new code paths have adequate span instrumentation
- Validate that log statements include trace context
- Suggest specific OpenTelemetry instrumentation code

### CI/CD Integration

With pipeline access, the agent can:
- Embed verification queries into deployment gates
- Configure automated rollback triggers
- Create Site Reliability Guardian validations
- Wire SLOs into the delivery pipeline

### Design Review as Code

Instead of an exportable Markdown document, the observability plan can be
committed as a review artifact alongside the code change — enabling versioned,
auditable observability design decisions.

## Detailed Procedures

- [Baseline Collection Guide](references/baseline-collection.md) — How to collect and document service baselines
- [Blast Radius Mapping](references/blast-radius-mapping.md) — Systematically identify everything a change can affect

## Related Capabilities

- Load a skill for evidence-based delivery gates when you need explicit design,
  delivery, or runtime verdicts tied to observed behavior.
- Load a skill for production-readiness assessment when you need to turn this
  design work into a final rollout decision.
- Load a skill for DQL query authoring when you need help refining or debugging
  the baseline and verification queries.
- Load a skill for distributed tracing analysis when service interactions need
  deeper request-path investigation.
- Load a skill for service performance analysis when you need broader latency,
  throughput, and dependency context.
