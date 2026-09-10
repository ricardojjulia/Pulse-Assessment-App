# Configuration-as-Code (Terraform Provider, Monaco CLI)

<!-- Jira: none -->

**Gen3 replacement**: Configuration-as-Code (updated APIs)

**Phase 2 required**: no

## What changes

Generic disclaimer to update classic resources in config-as-code setup to the latest APIs and update the Terraform provider or Monaco CLI to the latest version. Every Dynatrace API owner must ensure that their adapted/new APIs are supported by config-as-code where applicable.

## Customer actions

- Manually adapt all config-as-code templates and resources to the latest endpoints
- Update Terraform provider and/or Monaco CLI to the latest version

## Tracking queries

Classic APIs called by Terraform/Monaco user agent -- use API audit events filtered by user-agent dimension.
