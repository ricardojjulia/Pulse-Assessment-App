# DT UI Self-Monitoring (RUM on dre63214)

Dynatrace installs a RUM agent on the DT UI itself. This agent sends `user.events` to dre63214 capturing how customers interact with the Dynatrace UI (both Gen2 classic and Gen3). Use this to analyze feature adoption, UI performance, and usage patterns per tenant.

**How it works:** The `url.full` field in `user.events` contains the tenant hostname (e.g., `xyh62485.live.dynatrace.com`). Filter by tenant ID in the URL to find that tenant's DT UI usage.

## Examples

**Check if a tenant's users are viewing session replays:**
```dql
fetch user.events, from: now() - 7d, scanLimitGBytes: -1
| filter contains(toString(url.full), "<tenant-id>")
    and contains(toString(url.path), "sessionreplay")
| summarize events = count(),
    unique_sessions = countDistinct(dt.rum.session.id)
```

**Break down replay activity by type:**
```dql
fetch user.events, from: now() - 7d, scanLimitGBytes: -1
| filter contains(toString(url.full), "<tenant-id>")
    and contains(toString(url.path), "sessionreplay")
| fieldsAdd action = if(contains(toString(url.path), "/events"), "replay_playback",
    else: if(contains(toString(url.path), "/affected/"), "affected_check",
    else: if(contains(toString(url.path), "/resources"), "resource_load",
    else: if(contains(toString(url.path), "/timeline-summary"), "timeline_load",
    else: "other"))))
| summarize events = count(),
    unique_sessions = countDistinct(dt.rum.session.id),
    by: {action}
| sort events desc
```

**Get user identity for DT UI sessions:**
```dql
fetch user.sessions, from: now() - 8d, scanLimitGBytes: -1
| filter in(dt.rum.session.id, "<session-id-1>", "<session-id-2>")
| fields dt.rum.session.id, dt.rum.user_tag, client.ip, start_time, end_time
```

## Notes

- `dt.rum.user_tag` contains the user's email when the DT UI calls `identifyUser()` — but most Gen2 sessions do **not** set it, leaving `client.ip` as the only user differentiator
- Use `user.sessions` (not `user.events`) for the user tag — it's a session-level field
- Extend the `user.sessions` lookback by 8h+ to account for long sessions (see dt-obs-frontends skill)
