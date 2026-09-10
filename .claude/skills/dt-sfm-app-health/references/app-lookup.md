# App Lookup

Discover all known app IDs, or resolve a RUM `$application_id` entity from a known `$app`.

---

## List All Known App IDs

When the `$app` value is unknown, query adoption bizevents to enumerate all apps that have sent data:

```dql
fetch bizevents
| filter dt.system.bucket == "custom_sen_low_bizevents_frontend_adoptiondata_ui_statistics"
| filter event.type == "adoption.data"
| fields adoption.app
| dedup adoption.app
| limit 1
```

> Remove `| limit 1` to list all apps. Add `| filter adoption.app ~ "<search_term>"` to narrow by name.

---

## Resolve RUM Application Entity (`$application_id`) from `$app`

Several queries (Web Vitals, HTTP requests, RUM links) require the RUM entity ID. Resolve it using an entity lookup:

```dql-template
smartscapeNodes FRONTEND, from: now()-30d, to: now()
| filter matchesPhrase(name, concat("[Dtp-App][", $app, "]"))
| fields id
| limit 1
```

**Returns:** `id` — the `APPLICATION-*` entity ID to use as `$application_id`.

### Notes

- The RUM application name follows the format `[Dtp-App][<appId>]` — for example, `[Dtp-App][dynatrace.notebooks]`
- A `30d` lookback is used to catch apps that may not have had recent activity
- If no result is returned the app either has no RUM application configured or was never monitored — check prerequisites via `references/prerequisites.md`

---

## Summary

| Goal | Query to use |
|---|---|
| Don't know the app ID | List all apps query above |
| Know `$app`, need `$application_id` | Resolve RUM entity query above |
| Check RUM is actually configured | See `references/prerequisites.md` |
