# Classic Session Segmentation

<!-- Jira: none -->

**Gen3 replacement**: Users & Sessions app

**Phase 2 required**: yes

## What changes

Get full visibility into how your users experience every digital transaction across web, mobile, and custom applications. Categorize your application's user sessions into meaningful cohorts based on shared characteristics such as operating system, browser type, or location. Resolve customer support requests by analyzing specific users and sessions via advanced filtering.

## Customer actions

- Start migrating from Session Segmentation to the Users & Sessions app
- Readiness for a full transition depends on non-app criteria and must be evaluated case-by-case (e.g., SR, UX score, session properties, and other factors)

## Tracking queries

Customers with access to RUM on Grail:

```dql
fetch user.sessions
```

This shows if users enabled at least one frontend with RUM on Grail.

## Documentation

- [Users and Sessions](https://docs.dynatrace.com/docs/observe/digital-experience/new-rum-experience/users-and-sessions)
