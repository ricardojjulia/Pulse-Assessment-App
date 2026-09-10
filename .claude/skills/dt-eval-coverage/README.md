# dt-eval-coverage — Pulse Assessment / Tenant Review App

A Claude Code skill providing reference knowledge for the **Pulse Assessment** (published as the **Tenant Review** Dynatrace App). Covers the 111 evaluation criteria, the Coverage/Utilization scoring model, DQL data sources, and App development guidelines.

## When to invoke this skill

- Understanding or interpreting coverage/utilization scores from the Tenant Review App
- Adding, modifying, or debugging evaluation criteria
- Developing or extending the Tenant Review Dynatrace App (Strato UI, SDK hooks, DQL queries)
- Explaining the scoring model (progressive gates, tier weights, divergence between Coverage and Utilization)

## What this skill contains

| File | Purpose |
|---|---|
| [SKILL.md](SKILL.md) | Full reference: 9 capabilities, scoring model, cost controls, interpretation guide |
| [criteria-catalog.md](criteria-catalog.md) | All 111 criteria — ID, tier, what it validates, pass threshold |
| [scoring-model.md](scoring-model.md) | Coverage and Utilization formulas with worked examples |
| [data-sources.md](data-sources.md) | Grail data source per criterion (metric/entity/log/span/event/bizevent) |
| [dev-guide.md](dev-guide.md) | App development guidelines: Strato, SDK hooks, DQL, build/deploy workflow |

## Relationship to the /dt-eval-* family

The Pulse Assessment is a **live Dynatrace App** — it runs DQL directly against Grail in the browser, needs no `dtctl`, and produces an interactive UI with exportable PDFs. The `/dt-eval-tenant`, `/dt-eval-consumption`, and `/dt-eval-gen3` skills use `dtctl` to collect probes and produce `.docx` Word deliverables. They answer overlapping questions through different toolchains and are complementary.
