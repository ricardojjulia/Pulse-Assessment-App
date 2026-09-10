# Development Guide — Tenant Review Dynatrace App

Reference for AI coding agents and developers working on the Tenant Review App (ESA Tenant Evaluator).
Source: `AGENTS.md` in the app repo.

---

## Before Writing Code

### DQL queries

Before writing any DQL query for a criterion, search for relevant DQL documentation, syntax, and examples.
Use `dt-dql-essentials` skill first — it carries critical syntax rules and common pitfalls. DQL errors in
criteria are silent failures; the criterion just returns 0 and scores as failed.

### Strato UI components

Before using any Strato component, check its documentation:
- **`strato_search`** — find components by name or keyword
- **`strato_get_component`** — get props and code examples
- **`strato_get_usecase_details`** — get code for specific patterns

---

## Project Type

**Dynatrace App** built with the Dynatrace App Toolkit (`dt-app`), running on **Dynatrace AppEngine**.

- UI is TypeScript/React using the **Strato Design System**
- Backend functions run inside the Dynatrace JavaScript runtime (for external API calls)
- Apps communicate via **Intents** and can expose **Actions** and **Widgets**

---

## Core Concepts

### Grail

Grail stores all observability data: logs, metrics, events, spans, traces, business events.
**DQL** (Dynatrace Query Language) is the query interface.

### Platform Services

| Service | Client SDK | Purpose |
|---|---|---|
| Grail Query | `@dynatrace-sdk/client-query` | Execute DQL queries |
| Document Store | `@dynatrace-sdk/client-document` | Store/retrieve JSON documents (snapshots, dashboards) |
| App State | `@dynatrace-sdk/client-state` | Per-user or per-app key/value storage (prefs, cache) |

**Always prefer `@dynatrace-sdk/react-hooks`** in UI code — hooks handle state management, polling, and error handling. Use raw client SDKs only when hooks can't express the operation.

---

## Strato Design System

Dynatrace's official component library. Provides React components, design tokens, and icons.

### Import rules (critical)

**Never** import from the package root. **Always** import from a category subdirectory:

```typescript
// WRONG:
import { Flex, Heading } from "@dynatrace/strato-components";

// CORRECT:
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
```

### Available packages

| Package | Contents |
|---|---|
| `@dynatrace/strato-components` | Stable: Button, ProgressBar, Container, Flex, Grid, Heading, Text, Link |
| `@dynatrace/strato-components-preview` | Most components: Charts, Tables, Forms, Navigation, Overlays, Filters |
| `@dynatrace/strato-design-tokens` | Colors, spacing, typography tokens |
| `@dynatrace/strato-icons` | Icon library |
| `@dynatrace/strato-geo` | Map primitives |

### Category imports (strato-components-preview)

```typescript
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { Select } from "@dynatrace/strato-components-preview/forms";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import { Tabs } from "@dynatrace/strato-components-preview/navigation";
import { Accordion } from "@dynatrace/strato-components-preview/content";
import { TimeseriesChart } from "@dynatrace/strato-components-preview/charts";
import { FilterBar } from "@dynatrace/strato-components-preview/filters";
import { AppHeader, Page } from "@dynatrace/strato-components-preview/layouts";
```

### Table components

Prefer `DataTable` for interactive tables (sorting, filtering, pagination, selection).
Use `SimpleTable` only for static display (e.g. Markdown rendering).

```typescript
// DataTable requires data, columns (with id, header, accessor)
import { DataTable } from "@dynatrace/strato-components-preview/tables";
```

### TypeScript definitions

Component `.d.ts` files live directly in the package:

```
node_modules/@dynatrace/strato-components-preview/<category>/<component>/<Component>.d.ts
```

Example: `node_modules/@dynatrace/strato-components-preview/forms/select/Select.d.ts`

**Always check `.d.ts` files** for prop types. Do not look for a separate `types/` directory.

---

## React Hooks (SDK)

Prefer hooks over direct client calls in UI code:

```typescript
// DQL query
const { data, error, isLoading } = useDql(query);

// Document Store
const { data } = useDocument({ id: documentId });
const { data } = useListDocuments(params);  // requires document:documents:read scope

// App State
const { data } = useAppState({ key: "myKey" });
const { data } = useUserAppState({ key: "myKey" });
const setAppState = useSetAppState();       // returns execute function
const setUserAppState = useSetUserAppState();

// Backend functions
const { data } = useAppFunction({ name: "myFunction", data: payload });
```

All update hooks return an `execute` function — call it to perform the action.

---

## DQL in Criteria (queries.ts)

The core data model for evaluation criteria lives in `ui/app/queries.ts`. Each criterion object:

```typescript
{
  id: "i1",                              // unique identifier, referenced in criterionTiers.ts
  label: "Host CPU coverage",            // display label
  query: "timeseries ...",               // numerator DQL
  queryB: "fetch dt.entity.host ...",    // denominator DQL (optional)
  denominatorConstant: 5,                // constant denominator (optional, use instead of queryB)
  thresholds: [{ min: 90 }, { min: 50 }, { min: 1 }],  // any threshold met = passed
}
```

**DQL patterns used in criteria:**

```dql
// Entity count (denominator)
fetch dt.entity.host | summarize count()

// Metric-based numerator
timeseries val=avg(dt.host.cpu.usage), by:{dt.entity.host}
| dedup | summarize c=count()

// Span filter
fetch spans, from:now()-2h
| filter isNotNull(db.system)
| summarize count(span_id), by:{service.name}

// Entity relationship check
fetch dt.entity.service
| fieldsAdd pgCount = arraySize(toRelationships.runsOn)
| filter pgCount > 0
| summarize count()
```

**Cost guardrails** — Economy Mode rewrites the executed query, not the catalog string:
- Plain count ratios → `samplingRatio: 1000` (scan drops ~1600×)
- `countDistinct` or `by:` grouping → narrower window (2h → 15m)
- AI Observability → always 72h, no narrowing (bursty workloads)

---

## Project Structure

```
ui/
├── main.tsx                       # Entry: AppRoot + Router
└── app/
    ├── App.tsx                    # Routes: /, /compare, /ai-insights
    ├── queries.ts                 # 9 capabilities, 111 DQL criteria — SOURCE OF TRUTH
    ├── remediationActions.ts      # Remediation actions for all criteria
    ├── scale-tier.ts              # Economy Mode (sampling/window)
    ├── trace-proxy.ts             # Span → metric/entity substitutes
    ├── appVersion.ts              # Version string shown in UI footer
    ├── ai/                        # Davis CoPilot integration
    ├── components/                # Shared UI components
    ├── data/
    │   ├── criterionTiers.ts      # F / BP / E classification per criterion ID
    │   ├── criterionImportance.ts # Importance descriptions
    │   ├── criterionRemediation.ts# Remediation descriptions
    │   └── appCapabilityMap.ts    # Dynatrace app ID → capability mapping
    ├── hooks/
    │   ├── useCoverageData.ts     # Main query engine + scoring (Coverage and Utilization)
    │   ├── useAssessmentHistory.ts# Snapshot persistence (localStorage + Document Store)
    │   ├── useScaleTier.ts        # Host count → tier, with override
    │   └── usePreflight.ts        # Scope probes + span entitlement check
    ├── pages/
    │   ├── CoverageAssessment.tsx # Main page (3 view modes: Coverage / Utilization / Executive)
    │   ├── ComparisonPage.tsx     # Evolution Over Time
    │   └── AiInsightsPage.tsx     # Davis insights (dev-gated)
    ├── reports/
    │   ├── personaReports.ts      # Executive/Tactical/Technical/Custom PDF builders
    │   └── aiNarrativePdf.ts      # Free-text report via Davis CoPilot
    └── utils/colors.ts            # Score band colors
```

---

## Development Commands

| Command | What it does |
|---|---|
| `npm run start` | Dev server with hot reload, auto-opens browser |
| `npm run build` | Build to `dist/` |
| `npm run deploy` | Deploy to the environment in `app.config.json` |

Powered by `dt-app` CLI.

---

## App Configuration

`app.config.json` controls:
- **App ID and name** — `id`, `name`
- **Version** — `version` (also maintained in `ui/app/appVersion.ts`)
- **Environment** — `environmentUrl` (target Dynatrace tenant)
- **Scopes** — required API permissions

Scopes the Tenant Review App needs:

```json
"scopes": [
  "storage:metrics:read",
  "storage:entities:read",
  "storage:spans:read",
  "storage:logs:read",
  "storage:events:read",
  "storage:bizevents:read",
  "document:documents:read",
  "document:documents:write",
  "state:app-states:read",
  "state:app-states:write"
]
```

---

## Common Tasks

### Add a new route

1. Add a `<Route>` in `ui/app/App.tsx`
2. Add a nav item in `ui/app/components/Header.tsx`

### Add a new criterion

1. Add the criterion to `ui/app/queries.ts` (id, label, query, thresholds)
2. Classify tier in `ui/app/data/criterionTiers.ts`
3. Add importance in `ui/app/data/criterionImportance.ts`
4. Add remediation in `ui/app/data/criterionRemediation.ts`
5. Update `docs/CRITERIA-SUMMARY.md` and `docs/DATA-SOURCES.md`

### Query data in a component

```typescript
import { useDql } from "@dynatrace-sdk/react-hooks";

const { data, error, isLoading } = useDql(
  `fetch dt.entity.host | summarize count()`
);
```

### Use design tokens for styling

```typescript
import colors from "@dynatrace/strato-design-tokens/colors";
import borders from "@dynatrace/strato-design-tokens/borders";
import shadows from "@dynatrace/strato-design-tokens/box-shadows";
```

### Persist state across sessions

```typescript
// Per-user preference (survives navigation, user-scoped)
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

const { data: theme } = useUserAppState({ key: "preferredTheme" });
const setTheme = useSetUserAppState();
await setTheme.execute({ key: "preferredTheme", value: "dark" });
```

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@dynatrace-sdk/client-query` | DQL execution (low-level) |
| `@dynatrace-sdk/client-document` | Snapshot persistence |
| `@dynatrace-sdk/react-hooks` | React hooks: `useDql`, `useDocument`, `useAppState` |
| `@dynatrace-sdk/units` | Human-readable value formatting (bytes → KB/MB) |
| `@dynatrace-sdk/app-environment` | Read app/env context (IDs, URLs, current user) |
| `@dynatrace-sdk/user-preferences` | User theme, language, regional format, timezone |
| `@dynatrace/strato-components` | Stable Strato UI components |
| `@dynatrace/strato-components-preview` | Preview Strato components (charts, tables, forms, etc.) |
| `@dynatrace/strato-design-tokens` | Design tokens |
| `chart.js` + `react-chartjs-2` | Evolution mini-chart (non-Strato) |
| `jspdf` | Client-side PDF report generation |
| `react-router-dom` | Client-side routing |

---

## Theming

Full dark/light mode via `useCurrentTheme()` from `@dynatrace-sdk/user-preferences`.
All Strato components adapt automatically. Custom styles must use design tokens — never hardcode colors.

---

## PDF Reports

Built client-side via `jsPDF` in `ui/app/reports/personaReports.ts`.

**Limitations:**
- WinAnsi fonts cannot render: ✓ ✗ ≈ ≥ → — use `OK`/`GAP`/`ERR` `~` `>=` `->` instead
- Charts are exported as JPEG (not PNG) for size efficiency — ~20× smaller on gradient-heavy canvases
- A 12.4 MB report dropped to manageable size after switching to JPEG

Reports are available in English, Portuguese, and Spanish.
