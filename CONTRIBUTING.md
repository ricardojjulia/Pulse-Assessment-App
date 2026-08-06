# Contributing to Pulse Assessment

## Development Setup

### Prerequisites
- Node.js 24+
- `dt-app` CLI v1.8+ (installed via `npm`)
- Access to a Dynatrace SaaS tenant

### Getting Started
```bash
npm install
npm run start   # Starts dev server with hot reload
```

## Development Workflow

### Local Development
```bash
npx dt-app dev --environment-url https://YOUR_TENANT.apps.dynatrace.com
```
`app.config.json` ships with a **dummy** `environmentUrl`
(`https://abc12345.apps.dynatrace.com`) — real tenant URLs are not committed.
It has to be a syntactically valid URL because `dt-app build` validates it and
has no `--environment-url` flag; only `dev` and `deploy` accept one. So: pass
the flag for dev/deploy, or set the URL locally and keep that edit out of your
commits.

### Build
```bash
npm run build
```

### Deploy
```bash
npm run deploy
```

### Switching Tenants
Pass `--environment-url` to `dt-app dev` / `dt-app deploy`, or update
`environmentUrl` in `app.config.json` locally:
```json
"environmentUrl": "https://YOUR_TENANT.apps.dynatrace.com"
```
Never commit a real tenant URL, id or token.

## Code Structure

| Directory | Purpose |
|---|---|
| `ui/app/queries.ts` | DQL criteria definitions — add/modify criteria here |
| `ui/app/data/criterionTiers.ts` | Tier classification (Foundation/Best Practice/Excellence) |
| `ui/app/data/criterionImportance.ts` | Importance descriptions per criterion |
| `ui/app/data/criterionRemediation.ts` | Remediation text per criterion |
| `ui/app/remediationActions.ts` | Remediation actions with doc URLs |
| `ui/app/hooks/useCoverageData.ts` | Query execution engine and scoring logic |
| `ui/app/hooks/useAssessmentHistory.ts` | Snapshot persistence (localStorage + Document Store) |
| `ui/app/pages/CoverageAssessment.tsx` | Main assessment page |
| `ui/app/pages/ComparisonPage.tsx` | Evolution Over Time page |

## Adding a New Criterion

1. **Define the DQL query** in `queries.ts` within the appropriate capability array:
   ```ts
   { id: 'x99', label: 'My new criterion (%)', query: 'fetch ... | summarize count()' }
   ```
   For ratio-based criteria, add `queryB` for the denominator.

2. **Add the tier** in `data/criterionTiers.ts`:
   ```ts
   x99: 'bestPractice',
   ```

3. **Add importance text** in `data/criterionImportance.ts`:
   ```ts
   x99: 'Explanation of why this criterion matters.',
   ```

4. **Add remediation text** in `data/criterionRemediation.ts`:
   ```ts
   x99: 'Steps to fix or improve this criterion.',
   ```

5. **Add remediation action** in `remediationActions.ts`:
   ```ts
   x99: { action: 'Enable feature X', docUrl: 'https://docs.dynatrace.com/...', docLabel: 'Feature X docs' },
   ```

6. **Test** by running `npm run start` and verifying the new criterion appears in the assessment.

## Coding Standards

- **TypeScript strict mode** — No `any` types where avoidable
- **React hooks** — All business logic in custom hooks under `hooks/`
- **Strato components** — Use Dynatrace Strato design system for UI
- **DQL queries** — Always include `| limit` or `| summarize` to bound result size
- **No external API calls** — All data comes from Dynatrace Grail via DQL

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new criterion for XYZ coverage
fix: correct DQL query for AI span coverage
docs: update scoring model documentation
refactor: extract chart rendering to component
```

## Versioning

Version lives in **two** files that must always agree: `app.config.json`
(`"version"`, what the platform installs) and `ui/app/appVersion.ts`
(`APP_VERSION`, what the footer shows). They drifted once and a release had to
be superseded within minutes, because a published version cannot be re-uploaded
with a different checksum — a mismatch costs you a version number.

Bump on every release:
- **Patch** (x.y.Z): Bug fixes, query adjustments
- **Minor** (x.Y.0): New criteria, new features
- **Major** (X.0.0): Breaking changes to scoring model or data format
