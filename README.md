# Pulse Assessment

> Automated observability coverage and utilization assessment for Dynatrace environments.

Pulse Assessment is a native **Dynatrace App** that evaluates your environment's observability posture across **9 capabilities** and **111 criteria** using real-time DQL queries against Grail. It provides dual-dimension scoring (Coverage + Utilization), guided remediation, historical snapshots, and PDF reporting.

---

## Features

- **Automated Assessment** — Executes ~94 unique DQL queries (111 criteria with cross-entity ratios) against your Dynatrace tenant
- **Dual Scoring Dimensions**
  - **Coverage** — Percentage of criteria passing thresholds (simple pass/fail ratio)
  - **Utilization** — Weighted progressive scoring across Foundation (60%), Best Practice (25%), and Excellence (15%) tiers with gating rules
- **Interactive Radar Chart** — Canvas-rendered polar chart with hover tooltips and click-to-drill-down
- **3 View Modes** — Coverage, Utilization, and Executive Summary
- **Executive Summary** — Headline Coverage / Utilization / Adoption, a Coverage-only radar, and a Capability Map pairing coverage bars with a utilization line
- **Guided Remediation** — Specific actions and documentation links for every unmet criterion
- **Historical Snapshots** — Auto-saved to Dynatrace Document Store with up to 12 snapshots retained
- **Evolution Over Time** — A/B comparison of any two snapshots with delta analysis per capability and criterion
- **App Adoption** — Distinct users opening the Dynatrace apps behind each capability, as a share of the platform's active users. Reported beside coverage; it never feeds a score
- **Persona PDF Reports** — Executive, Tactical and Technical, each in English, Portuguese and Spanish, plus a Custom builder (pick title, capabilities and sections). Reports embed the app's own charts
- **Trace Proxy Mode** — Runs on tenants without the Traces-on-Grail entitlement by substituting validated metric/topology equivalents for span checks, and excluding the checks that have no honest proxy rather than faking them
- **Economy Mode (DPS)** — Samples the checks where sampling provably cancels out and narrows the window where it does not, cutting a full run from ~370 GB to ~41 GB of Grail scan
- **Preflight Validation** — Verifies all API scopes before running, and detects a missing span entitlement
- **Dark/Light Theme** — Full support via Dynatrace Strato design tokens

## 9 Capabilities Assessed

| Capability | Criteria | Tiers (F / BP / E) | Color |
|---|---|---|---|
| Infrastructure Observability | 22 | 4 / 10 / 8 | `#3B82F6` |
| Application Observability | 13 | 3 / 4 / 6 | `#8B5CF6` |
| Digital Experience | 11 | 3 / 5 / 3 | `#EC4899` |
| Log Analytics | 16 | 4 / 6 / 6 | `#F59E0B` |
| Application Security | 11 | 4 / 4 / 3 | `#EF4444` |
| Threat Observability | 11 | 3 / 5 / 3 | `#F97316` |
| AI Observability | 9 | 3 / 2 / 4 | `#06B6D4` |
| Business Observability | 8 | 3 / 2 / 3 | `#10B981` |
| Software Delivery | 10 | 3 / 4 / 3 | `#6366F1` |
| **Total** | **111** | **30 / 46 / 40** | |

## Utilization Scoring Model

### Tier Weights (Progressive)

| Tier | Weight | Gate |
|---|---|---|
| Foundation | 60% | Always counted |
| Best Practice | 25% | Only counts if Foundation ≥ 80% |
| Excellence | 15% | Only counts if Best Practice ≥ 60% |

### Utilization Levels

| Level | Label | Condition |
|---|---|---|
| L0 | Not Adopted | Foundation < 50% |
| L1 | Foundation | Foundation ≥ 50% |
| L2 | Operational | Foundation = 100% AND Best Practice ≥ 50% |
| L3 | Optimized | Foundation = 100% AND Best Practice = 100% AND Excellence ≥ 50% |

> **Why progressive?** Coverage shows *how much* you cover. Utilization shows *if you're covering in the right order*. A solid Foundation must come before chasing Excellence.

## Prerequisites

- **Node.js** 20+ (recommended: 22 LTS or later)
- **npm** 10+ (ships with Node.js 20+)
- **Dynatrace App Toolkit** (`dt-app` CLI v1.8+) — install via `npm install -g dt-app`
- Access to a Dynatrace tenant (SaaS or Managed)
- VSCode with the [Dynatrace Apps extension](https://marketplace.visualstudio.com/items?itemName=dynatrace.dynatrace-extensions) (recommended)

> **Important:** Verify your Node.js version before starting: `node --version` (must be ≥ v20).

## Quick Start

### TL;DR (3 commands)
```bash
git clone https://github.com/mbdccoletta/Pulse-Assessment-App.git
cd Pulse-Assessment-App
# Edit app.config.json → set your environmentUrl
./setup.sh
```

The `setup.sh` script validates prerequisites (Node.js ≥ 20, npm ≥ 10), checks your tenant config, installs dependencies with `npm ci`, and verifies the `dt-app` CLI. After setup, run `npm run start` (dev) or `npm run deploy` (production).

<details>
<summary>Manual step-by-step instructions</summary>

### 1. Verify prerequisites
```bash
node --version   # Must be >= v20
npm --version    # Must be >= 10
```

### 2. Clone the repository
```bash
git clone https://github.com/mbdccoletta/Pulse-Assessment-App.git
cd Pulse-Assessment-App
```

### 3. Configure your tenant
Edit `app.config.json` and set your environment URL:
```json
"environmentUrl": "https://YOUR_TENANT_ID.apps.dynatrace.com"
```

### 4. Install dependencies
```bash
npm ci
```

> **Use `npm ci`, not `npm install`.** This installs exact versions from `package-lock.json`, ensuring everyone gets the same dependency tree and avoiding version mismatch errors.

> **Never delete `package-lock.json`** — it pins the exact dependency versions that are tested and guaranteed to work.

### 5. Verify installation
```bash
npx dt-app --version   # Should show dt-app CLI version
```

### 6. Run locally (dev mode)
```bash
npm run start
```
Opens in browser connected to your tenant with hot reload.

### 7. Deploy to production
```bash
npm run build
npm run deploy
```

</details>

> **After every `git pull`**, always run `npm ci` again to pick up any dependency changes.

## Required Scopes

The app requires 11 scopes (configured in `app.config.json`):

| Scope | Purpose |
|---|---|
| `storage:entities:read` | Entity queries (hosts, services, apps) |
| `storage:logs:read` | Log Analytics criteria |
| `storage:metrics:read` | Infrastructure metrics (timeseries) |
| `storage:spans:read` | APM + AI Observability tracing |
| `storage:events:read` | Security, Delivery, Problems |
| `storage:bizevents:read` | Business Observability events |
| `storage:buckets:read` | Grail bucket access for DQL |
| `storage:system:read` | System table access |
| `document:documents:read` | Load assessment snapshots |
| `document:documents:write` | Save assessment snapshots |
| `document:documents:delete` | Cleanup old snapshots |

## Project Structure

```
cca-app/
├── app.config.json               # App manifest
├── package.json                  # Dependencies
├── ui/
│   ├── main.tsx                  # Entry point
│   └── app/
│       ├── App.tsx               # Routes (/, /compare)
│       ├── queries.ts            # 111 DQL criteria definitions
│       ├── remediationActions.ts # Remediation for all criteria
│       ├── components/           # Reusable UI components
│       ├── data/                 # Static data (tiers, summaries)
│       ├── hooks/                # Business logic hooks
│       ├── pages/                # Page components
│       └── utils/                # Shared utilities
└── docs/
    └── ARCHITECTURE.md           # Detailed architecture docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture, data flow, and scoring model documentation.

## Tech Stack

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript 5.3 | Type safety |
| Dynatrace Strato | Design system |
| Chart.js | Evolution charts |
| jsPDF | PDF report generation |
| DQL | Grail data queries |
| dt-app CLI | Build, dev, deploy |

## Grail Query Cost (DPS Consumption)

> **Important:** Each assessment execution queries Grail tables (logs, spans, events, bizevents) which consume **DPS** based on GiB scanned.

### Measured cost per assessment

Numbers below were measured on a reference tenant over 30 days by reading the
platform's own `dt.system.events` query log (which is itself free to query),
not estimated.

| | Before Economy Mode | With Economy Mode |
|---|---|---|
| Scan per full run | 370 GB | **41 GB** |
| Cost per run | ~$3.70 | **~$0.41** |
| 16 runs / month | ~$59.83 | **~$6.60** |

Where the scan went before optimization: spans 81%, logs 18%, everything else
under 1%. Entity (`fetch dt.entity.*`) and `timeseries` queries measured
**literally zero** — 696 executions, 0 bytes.

### How Economy Mode gets there

Two levers, applied per criterion in `ui/app/scale-tier.ts`:

- **Sampling** (`samplingRatio: 1000`) — only where it provably cancels out:
  both sides of the ratio must be plain counts over the same table and window.
  Measured on 2h of logs: scan fell from 4.99 GB to ~0.003 GB while the ratios
  held (trace-correlated share 8.78% → 9.07%).
- **Shorter window** — the honest lever for the rest, because `countDistinct`
  collapses under sampling (distinct log sources 63 → 28; AI providers 4 → 1).
  2h → 15m costs 0.61 GB instead of 3.87 GB and keeps 94% of distinct sources.

Everything else is left alone, and a `scanLimitGBytes` ceiling caps every hot
query so none can run away on a large tenant.

Coverage values therefore become close estimates rather than exact counts —
within ~1.5 percentage points on ratios and ~6% lower on distinct counts. The
pass thresholds are wide bands (≥80 / ≥50 / ≥1), so pass/fail outcomes are
effectively unchanged. The app discloses this on screen next to the scores.

### Other cost controls

- **24h query cache** — repeated runs in the same day are served from the
  Document Store at zero Grail cost. Measured: 3,289 executions served from
  119 distinct queries.
- **Query deduplication** — identical query strings execute once regardless of
  how many criteria share them.
- **Aggregates only** — every query returns `summarize count()`-shaped output,
  never raw records.
- **Trace Proxy Mode** is cheaper still: its metric/topology replacements are
  not Grail-scanning queries, so the 12 span checks leave the plan entirely.

## Scripts

| Command | Description |
|---|---|
| `npm run start` | Start dev server with hot reload |
| `npm run build` | Build for production |
| `npm run deploy` | Deploy to Dynatrace tenant |
| `npm run uninstall` | Remove app from tenant |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Troubleshooting

### TS2307: Cannot find module '@dynatrace/strato-components-preview/...'

If you see TypeScript errors like:
```
Cannot find module '@dynatrace/strato-components-preview/buttons' or its corresponding type declarations.
Cannot find module '@dynatrace/strato-components-preview/overlays' or its corresponding type declarations.
```

**Cause:** Wrong versions of `@dynatrace/strato-components-preview` were installed — likely from running `npm install` instead of `npm ci`.

**Fix:**
```bash
rm -rf node_modules
npm ci
```

This ensures the exact versions from `package-lock.json` are installed. The subpath imports (`/buttons`, `/overlays`, `/layouts`, `/navigation`) require `@dynatrace/strato-components-preview >= 1.11.0`.

### Build fails after `git pull`

If dependencies changed in a pull, always re-install:
```bash
npm ci
```

### `dt-app` command not found

Install the Dynatrace App Toolkit globally:
```bash
npm install -g dt-app
```

Or use it via `npx` (already configured in `package.json` scripts):
```bash
npx dt-app dev
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

Internal — Dynatrace. See [LICENSE](LICENSE).
