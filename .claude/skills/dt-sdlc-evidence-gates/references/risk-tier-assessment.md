# Risk Tier Assessment

How to determine the correct risk tier for a change, and what lifecycle depth
each tier requires.

## Tier Decision Tree

Ask these questions in order. The first match determines the tier.

### Is this Tier 0? (Minimal lifecycle)

- Does the change affect only documentation, naming, comments, or formatting?
- Is it a refactor with zero behavior change (verified by existing tests)?
- Does it affect only non-production configuration (dev tooling, IDE settings)?

If **yes** to any → **Tier 0**: local validation only, no Dynatrace gates.

### Is this Tier 2? (Full lifecycle)

- Does the change affect a **hot path** (high traffic, low latency SLO)?
- Does it modify **external dependencies** or their configuration (new service call, DB schema change)?
- Does it change **timeout, retry, circuit-breaker, or rate-limit** settings?
- Does it modify **authentication, authorization, or security** configuration?
- Does it change **data schema** or data pipeline behavior?
- Is it a **major version upgrade** of a critical dependency?

If **yes** to any → **Tier 2**: full lifecycle with design gate, delivery gate, and runtime gate.

### Everything Else → Tier 1

Non-hot-path changes, minor feature additions, low-risk automation changes.

**Tier 1** requires: design enrichment + delivery gate. Runtime gate is optional
but recommended for services with tight SLOs.

## Tier Summary

| Tier | Lifecycle Depth | Design Gate | Delivery Gate | Runtime Gate |
|------|-----------------|-------------|---------------|--------------|
| **0** | Minimal | Skip | Local only | Skip |
| **1** | Standard | Enrichment | Required | Optional |
| **2** | Full | Required | Required | Required |

## Evidence Requirements by Tier

### Tier 0

- [ ] Local tests pass
- [ ] No behavior change confirmed by existing test coverage

### Tier 1

- [ ] Baseline collected for affected services
- [ ] Dependency map reviewed
- [ ] Delivery gate passes (no regression vs baseline)
- [ ] Observability plan exists (at minimum, verification queries)

### Tier 2

All of Tier 1, plus:

- [ ] Blast-radius analysis documented
- [ ] Rollback criteria defined with specific thresholds
- [ ] SLO impact assessed
- [ ] Feature flag or canary strategy defined
- [ ] Post-deploy verification queries ready
- [ ] Runtime gate monitoring active after deployment

## Common Tier Mistakes

| Mistake | Why It's Wrong | Correct Tier |
|---------|---------------|--------------|
| Treating a timeout change as Tier 1 | Timeout changes directly affect reliability and can cascade | Tier 2 |
| Treating a new API endpoint as Tier 0 | New endpoints are new behavior, even if internal | Tier 1 or 2 |
| Treating a dependency upgrade as Tier 0 | Dependency changes can introduce behavior changes | Tier 1 (minor) or Tier 2 (major) |
| Treating a hot-path refactor as Tier 1 | Hot-path changes need full lifecycle regardless of intent | Tier 2 |
