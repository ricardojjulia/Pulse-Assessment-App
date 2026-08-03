# Dynatrace API Extractor

Extracts the latest Dynatrace API catalog from:

```text
https://developer.dynatrace.com/develop/reference/apis/latest-apis/
```

Outputs:

- `latest-api-catalog.json`
- `latest-api-openapi-summary.json`
- `latest-api-catalog.md`

## Public Catalog

This does not require authentication:

```bash
npm run dt:api:extract
```

It extracts the API groups, names, descriptions, Swagger UI links, hosts, and primary names from the public latest APIs page.

## Local OpenAPI Files

Summarize a downloaded OpenAPI YAML/JSON file:

```bash
npm run dt:api:extract -- --openapi /path/to/openapi.yaml
```

## Full Spec Download

Swagger UI config and raw OpenAPI specs are protected by Dynatrace authentication. Use a platform/OAuth bearer token:

```bash
DT_AUTH_SCHEME=Bearer \
DT_TOKEN=... \
npm run dt:api:extract -- --fetch-specs
```

If the token cannot access a spec, the failure is recorded in `latest-api-openapi-summary.json`.
