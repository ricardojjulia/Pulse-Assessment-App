# Memory Dump on ActiveGate

<!-- Jira: APPOBS-32138 -->

**Gen3 replacement**: OAuth-based AG endpoint for memory dump storage and retrieval

**Phase 2 required**: yes

## What changes

Storing OneAgent memory dumps on Environment AG and retrieval from UI will require ActiveGates that support OAuth authorization for the memory dump endpoint.

## Customer actions

- Upgrade ActiveGates with memory dump feature enabled (off by default) to the required version that supports OAuth authorization
