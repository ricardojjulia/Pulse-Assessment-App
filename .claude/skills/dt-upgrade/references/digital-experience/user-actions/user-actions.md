# User Actions (Load Actions, XHR, Custom)

<!-- Jira: PRODUCT-13038, PRODUCT-14379 -->

**Gen3 replacement**: User Actions, Core web vitals

**Phase 2 required**: yes

## What changes

Tracking and alerting of user actions is available out of the box for both web and mobile frameworks. Custom actions can also be tracked. To measure page load performance it is recommended to use W3C nav timings or web vitals (e.g. LCP). To measure app start performance it is recommended to use app start duration as a KPI.

## Customer actions

- Create naming rules for actions in OpenPipeline
- Capture custom actions via API on 3rd gen
- Create health alert for user action duration
