# ESA Tenant Evaluator CLI

Local fallback for tenants where the Dynatrace app cannot be installed.

The CLI exports the app's DQL catalog, calls Dynatrace REST/Platform APIs when a token is provided, and writes local reports. Every run uses this naming convention:

```text
tenant-mmddyy-runNN-*
```

Example:

```text
mjs70956-062326-run01-summary.html
mjs70956-062326-run01-detailed-evidence.json
mjs70956-062326-run01-tenant-evaluation.json
mjs70956-062326-run01-dql-results.json
mjs70956-062326-run01-api-results.json
mjs70956-062326-run01-oes-pillars.csv
mjs70956-062326-run01-dql/
```

`summary.html` is self-contained: CSS and evidence JSON are embedded in the file, so it can be opened directly in a browser or shared without the app.

`detailed-evidence.json` is the audit file. It includes the run metadata, derived report, DQL catalog, API call catalog, settings schema list, raw DQL results, raw API responses, settings counts, and all collection failures.

## Export Only

Generate DQL and API call definitions without connecting to a tenant:

```bash
npm run tenant:evaluate -- --export-only
```

## Preview The HTML Report

Generate a sample self-contained report without a token:

```bash
npm run tenant:evaluate -- --sample-report
```

## Run Against A Tenant

Use a token with the required read scopes for the data you want to collect.
Environment API tokens usually use `Api-Token`; OAuth/platform tokens usually use `Bearer`.
The CLI defaults to `auto` and retries both for `401`/`403`.

```bash
DT_ENV_URL=https://rdi66192.apps.dynatrace.com \
DT_TOKEN=dt0c01... \
npm run tenant:evaluate
```

When `DT_ENV_URL` is an `apps.dynatrace.com` URL, the CLI automatically derives the classic Environment API URL as `https://<tenant>.live.dynatrace.com` for `/api/v2` and `/api/config` calls. Override it when needed:

```bash
DT_ENV_URL=https://rdi66192.apps.dynatrace.com \
DT_ENV_API_URL=https://rdi66192.live.dynatrace.com \
DT_TOKEN=dt0c01... \
npm run tenant:evaluate
```

Force a scheme when needed:

```bash
DT_ENV_URL=https://rdi66192.apps.dynatrace.com \
DT_TOKEN=... \
DT_AUTH_SCHEME=Bearer \
npm run tenant:evaluate
```

## Useful Options

```bash
npm run tenant:evaluate -- --skip-dql
npm run tenant:evaluate -- --skip-api
npm run tenant:evaluate -- --out ./tenant-report
npm run tenant:evaluate -- --timeout-ms 120000
npm run tenant:evaluate -- --sample-report
npm run tenant:evaluate -- --auth-check --env-url https://rdi66192.apps.dynatrace.com
```

## Notes

Some Platform APIs, including Documents, Automation, and Grail query execution, may require OAuth/platform bearer tokens rather than classic Environment API tokens. The report still writes partial results and records failures in `tenant-evaluation.json`.

Classic personal tokens are useful for Environment API inventory, but they generally cannot execute Grail DQL through the Platform query endpoint. Use `--skip-dql` for an Environment API-only run with a personal token, or use an OAuth/platform bearer token for full DQL coverage.

If every call returns `401`, first run `--auth-check`. The CLI strips accidental `Bearer ` or `Api-Token ` prefixes from `DT_TOKEN`, so provide either the raw token or the full copied header value.
