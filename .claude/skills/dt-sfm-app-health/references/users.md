# User Adoption

Track how many users are actively using a Dynatrace app over time, broken down by app version.

---

## When to Use

- Understand daily or weekly active user counts for an app
- Compare adoption across app versions after a release
- Provide adoption context when investigating incidents (e.g. "2k users were active when the error spiked")

---

## Query: Users Over Time (by App and Version)

```dql
fetch events, bucket: { "strato_ui_events" }
| makeTimeseries { users = countDistinct(bhv.user.id, default:0) },
    by:{ app=bhv.app.id, version=bhv.app.version }, bins:240
```

**Scoped to a single app** — add a filter before `makeTimeseries`:

```dql-template
fetch events, bucket: { "strato_ui_events" }
| filter bhv.app.id == $app
| makeTimeseries { users = countDistinct(bhv.user.id, default:0) },
    by:{ app=bhv.app.id, version=bhv.app.version }, bins:240
```

---

## Key Fields

| Field | Description | Example |
|---|---|---|
| `bhv.user.id` | Unique user identifier (distinct user count) | `user@example.com` |
| `bhv.app.id` | App identifier matching `$app` | `dynatrace.notebooks` |
| `bhv.app.version` | Deployed version of the app | `1.42.0` |

---

## Notes

- Bucket: `strato_ui_events` — this is the app shell behavioural event stream
- `countDistinct(bhv.user.id)` counts unique users, not page views or sessions
- Without a `filter` clause, the query returns user counts across **all** apps — always filter by `bhv.app.id == $app` for single-app analysis
- `bins:240` gives fine-grained resolution; reduce to `bins:30` for a broader trend view
