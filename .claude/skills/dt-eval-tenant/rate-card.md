# DPS rate card — criticality tiers & consumption-depth grading

The Dynatrace Platform Subscription rate card, sorted by *criticality for observability nirvana on a
modern estate* and used two ways by this skill:

1. **As the weighting spine for consumption-depth grading** (Effective Consumption runs and
   internal-audience reports): if Dynatrace charges for a capability, the review grades whether the
   tenant is consuming it at the depth the capability was designed for.
2. **As the expansion-hook index for internal-audience reports** ([report-audiences.md](../.dt-eval-common/report-audiences.md)):
   every ⚠️/💡 finding maps to the rate-card capability that would move it.

**Source & freshness.** Scraped from `https://www.dynatrace.com/pricing/rate-card/` on 2026-07-13.
Prices are USD list — customer contracts have discounts — and are **directional**: the skill grades
*presence and effective use*, never spend. Re-verify the page (WebFetch) before citing a price in any
internal narrative. **Prices, tier labels, and tier weights never appear in an external (client-facing)
deliverable** — externally the same analysis surfaces as opportunity framing without the machinery.

## How tiers are assigned

Criticality assumes a modern estate: cloud-native (K8s + public cloud), microservices in prod, real
end-user traffic, a security regulator (SOC2/PCI/HIPAA/GDPR), and a functioning on-call practice.

| Tier | Meaning | Depth weight |
|---|---|---|
| **S** — Foundational | Without this there is nothing to observe; absence on a running estate *is* the finding | 1.00 |
| **A** — Modern-stack essentials | Expected once the estate is on K8s / microservices / cloud | 0.85 |
| **B** — Value multipliers | Turn observation into insight and action (Replay, RAP, SPM, synthetics) | 0.65 |
| **C** — Specialized / conditional | Graded **only if the estate condition applies** (mainframe, edge, egress) | 0.40 |
| **D** — Classic / legacy | Inventory, never a gap. Graded **only if consumption > 0** (migration lens) | 0.15 |

Tier weights apply when scoring *depth of use per capability* (the consumption-depth roll-up below).
They are independent of the EC pillar weights in [effective-consumption.md](effective-consumption.md).

## The rate card

### Tier S — Foundational

| # | Capability | List price | Where this skill grades it |
|---|---|---|---|
| S1 | Full-Stack Monitoring | $0.01 / memory-GiB-hour | mode split (B3), service census/topology (B7), spans (B17) |
| S2 | Infrastructure Monitoring | $0.04 / host-hour | mode split (B3), unmonitored candidates (V16) |
| S3 | Log Ingest & Process | $0.20 / GiB | log health/routing (B1), buckets (§A) |
| S4 | Log Retain | $0.0007 / GiB-day | bucket retention (§A) |
| S5 | Log Query | $0.0035 / GiB-scanned | query engagement (EC4/QEI) |
| S6 | Metrics Ingest & Process | $0.15 / 100k datapoints | billing mix (B14), metric estate probes |
| S7 | Metrics Retain | $0.0007 / GiB-day | billing mix (B14) |
| S8 | Traces Ingest & Process | $0.20 / GiB | spans/instrumentation split (B17, B19) |
| S9 | Traces Retain | $0.0007 / GiB-day | billing mix (B14) |
| S10 | Traces Query | $0.0035 / GiB-scanned | query engagement (EC4/QEI) |

**Nirvana pattern (S):** Full-Stack on the app tier and Infrastructure mode covering the rest
(bastions, DB VMs, jump hosts); logs from every prod host and K8s namespace routed through
OpenPipeline into non-default buckets; metrics a healthy platform/custom/OTel mix; traces covering
every service that fronts a user or bizevent.

### Tier A — Modern-stack essentials

| # | Capability | List price | Where this skill grades it |
|---|---|---|---|
| A1 | Kubernetes Platform Monitoring | $0.002 / pod-hour | K8s right-sizing/reliability (B20/B21) |
| A2 | Code Monitoring | $0.005 / container-hour | OneAgent injection share (B17) |
| A3 | Real User Monitoring | $0.00225 / session | RUM quality ratios (B22/B23) |
| A4 | Runtime Vulnerability Analytics | $0.00225 / memory-GiB-hour | AppSec reachability triage (B26) |
| A5 | Automation Workflow | $0.03 / workflow-hour | workflow config (§A) + follow-through (EC2/EC7) |
| A6 | Log Retain with Included Queries | $0.02 / GiB-day | bucket strategy (§A) |

**Nirvana pattern (A):** every prod K8s namespace surfaces as an entity with populated workload
metrics; every prod service carries `vulnerability.davis_assessment` results; workflows fire on Davis
problems and deliver outward (Slack/Jira/PagerDuty); RUM sessions on every user-facing app.

### Tier B — Value multipliers

| # | Capability | List price | Where this skill grades it |
|---|---|---|---|
| B1 | RUM with Session Replay | $0.0045 / replay | replay coverage (B22) |
| B2 | Runtime Application Protection | $0.00225 / memory-GiB-hour | ATTACK_EVENT presence + billing (B26) |
| B3 | Security Posture Management | $0.007 / host-hour | compliance posture (B27) |
| B4 | Browser Monitor / Clickpath | $0.0045 / synthetic action | synthetic availability (B24) |
| B5 | HTTP Monitor | $0.001 / synthetic request | synthetic availability (B24) |
| B6 | Events Ingest & Process | $0.20 / GiB | alert volume/compression (B4/B28) |
| B7 | Events Retain | $0.0007 / GiB-day | billing mix (B14) |
| B8 | Events Query | $0.0035 / GiB-scanned | query engagement (EC4) |

**Nirvana pattern (B):** critical user journeys have a synthetic clickpath **and** > 30% Session
Replay capture; SPM/RVA wired to the framework the customer is regulated under; RAP blocking on the
internet-facing tier; Davis compressing signals at a healthy ratio (B28).

### Tier C — Specialized / conditional (grade only when the condition applies)

| # | Capability | List price | Applies when |
|---|---|---|---|
| C1 | Mainframe Monitoring | $0.10 / MSU-hour | mainframe entities present |
| C2 | Foundation & Discovery | $0.01 / host-hour | discovery-tier hosts present (B3) |
| C3 | RUM Property | $0.0001 / property/session | custom user attributes in play |
| C4 | Third-Party Synthetic API Ingestion | $0.001 / result | an existing synthetic tool feeds in |
| C5 | AppEngine Functions | $0.001 / invocation | custom app tier live |
| C6 | Data Egress | $0.15 / GiB-egressed | Grail data forwarded out of tenant |

### Tier D — Classic / legacy (inventory; absence is never a gap)

| # | Capability | List price |
|---|---|---|
| D1 | Custom Metrics Classic | $0.002 / 1000 datapoints |
| D2 | Log Monitoring Classic | $0.001 / 1000 records |
| D3 | Custom Traces Classic | $0.0014 / 1000 spans |
| D4 | Custom Events Classic | $0.002 / 1000 events |
| D5 | Serverless Functions Classic | $0.004 / 1000 invocations |

**Gen3-first rule (skill hard rule).** Tier D presence **with live consumption** while the
platform-native equivalent is empty = a 💡 migration finding ("classic rates for capacity the
platform includes in ingest"). Presence with **zero** consumption = pure inventory — color only,
never a scored gap. Never recommend creating a classic construct.

## Consumption-depth grading (nirvana-hit levels)

Each applicable capability is graded on a five-level depth scale — presence alone is not the score:

| Depth | Level | Meaning |
|---|---|---|
| 0.00 | absent | no consumption evidence (⚠️ if S/A tier on an estate that needs it; excluded if C-conditional) |
| 0.30 | present-only | consuming at minimum footprint — bought and switched on, little else |
| 0.60 | working | observable output meeting basic thresholds (💡) |
| 0.85 | strong | meets the tier's nirvana pattern |
| 1.00 | excellent | nirvana pattern **plus** cross-correlated evidence of impact (✅) |

**Depth roll-up** (the "Consumption depth" section score in an Effective Consumption /
internal-audience report):

```
depth_score = round(100 × Σ(depth × tier_weight) / Σ(tier_weight))
```

summed over **applicable** capabilities only (C excluded unless its condition holds; D excluded
unless consumption > 0). Depth evidence comes from `dt.billing.*` (B14) cross-read against the
grading probes named per row — when billing metrics are not readable, the section is ⚪ (appendix
footnote naming the scope), never guessed.

## Capabilities not on the rate card that still matter

Graded elsewhere in the skill, listed here so the depth table never silently implies they were
skipped: OneAgent version currency and ActiveGate fleet health (§B), Gen3 surfaces — segments,
OpenPipeline pipelines, Davis anomaly detectors (§A, Gen3-first), ownership/cost/security_context
source-tag enrichment (B30), Davis CoPilot / analyzer usage (§A capability color).

## Audience rules for this file

- **External deliverables:** no prices, no tier labels, no depth weights, no "rate card" citations.
  The same facts surface as value framing: *what the capability delivers at full depth, what was
  measured, the sequenced next step* (see [report-audiences.md](../.dt-eval-common/report-audiences.md)).
- **Internal deliverables:** tiers, weights, and the depth table are first-class content; a specific
  dollar figure is never attached to a customer's numbers (pricing conversations are an AE decision).
