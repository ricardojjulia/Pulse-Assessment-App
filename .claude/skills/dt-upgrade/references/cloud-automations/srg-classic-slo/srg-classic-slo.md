# SRG with Classic SLO Reference

<!-- Jira: PRODUCT-10142 -->

**Gen3 replacement**: SRG with DQL objectives

**Phase 2 required**: no

## What changes

To use SLOs as SRG objectives, the DQL query (SLI) can be used directly in the SRG objective. Classic SLOs are deprecated and no longer work.

## Customer actions

- Update SRG objectives that use classic SLO references to the appropriate DQL queries
