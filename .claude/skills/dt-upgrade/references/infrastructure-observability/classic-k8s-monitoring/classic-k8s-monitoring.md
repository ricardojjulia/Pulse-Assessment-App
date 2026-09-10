# Classic K8s Monitoring

<!-- Jira: none -->

**Gen3 replacement**: K8s Observability

**Phase 2 required**: no

## What changes

New Kubernetes Observability provides both deeper and broader K8s platform monitoring.

## Customer actions

- Activate clusters in the UI
- Upgrade to ActiveGate 1.327+

## Tracking queries

Check ActiveGate version for K8s clusters:

```dql
fetch dt.entity.kubernetes_cluster
| fields activeGateVersion
```

## Documentation

- [Enable existing clusters](https://docs.dynatrace.com/docs/shortlink/enable-existing-clusters)
- [Enhanced object visibility for monitored Kubernetes clusters](https://docs.dynatrace.com/docs/shortlink/release-notes-saas-sprint-331#enhanced-object-visibility-for-monitored-kubernetes-clusters)
