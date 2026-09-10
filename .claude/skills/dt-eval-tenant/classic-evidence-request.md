# Requesting the classic-API evidence — four options, decreasing trust required

**Purpose.** Four facts about a Dynatrace environment live only on the classic API. They cannot be
read by the platform token the review uses, at any scoping. This document is written to be **sent to
the customer**: it explains what is needed, why, and offers four ways to provide it — from "run our
script" down to "answer six questions and send us nothing at all".

**The review never needs a credential.** No option here involves handing anyone a token. Pick the row
that matches what the customer's security posture allows; every option produces a usable review, and
the differences are in precision, not validity.

| Option | Customer effort | What they run | What leaves the tenant |
|---|---|---|---|
| **A** | Lowest | Our collector script | One redacted JSON file |
| **B** | Low | Plain `curl` commands they can read first | Field-limited JSON they control |
| **C** | Medium | Nothing — exports from the UI | Files they export and inspect |
| **D** | Highest | Nothing — reads six numbers off screens | **Nothing.** Six answers |

---

## What is being asked for, and why

Written in customer terms — no internal vocabulary — so this section can be pasted into an email.

| # | What | Why it matters to you |
|---|---|---|
| 1 | **API token inventory** — name, owner, scopes, last-used | Integrations calling the retiring API are identified only by token; the platform records no owner against them. Without this you get a list of anonymous callers and have to find their owners by hand. With it, you get named systems and their owners — and a stale/over-scoped token review for free. |
| 2 | **ActiveGate auto-update status** | We can see your ActiveGate versions and your update *policy*, but not whether auto-update is actually switched on. That is the difference between "these gates are behind" and "these gates will stay behind". |
| 3 | **Request attribute & request naming rules** — their scoping | Two of the four rule families that need re-scoping before upgrade. The other two we can read. Assessing only those two has produced a false all-clear before: on one environment they were clean while 21 of 45 request attributes used scoping that stops working. |
| 4 | **Classic dashboard filters** — which dashboards filter on a management zone | A dashboard filtering on a management zone is a consumer of that zone. Retiring the zone breaks the dashboard silently. This is the only way to know which zones are genuinely safe to retire. |

**Item 4 has a deadline.** That endpoint stops responding after the upgrade, so the inventory must be
taken beforehand. The other three remain available afterwards.

**Minimum token scopes**, if the customer is generating one for options A or B:
`apiTokens.read` (item 1) · `activeGates.read` (item 2) · `ReadConfig` (items 3 and 4). Grant only the
ones for the items being provided — every option degrades cleanly and reports what was skipped.

---

## Option A — run the collector (recommended)

One script, standard library only, no dependencies to vet. It reads with `GET` and nothing else,
redacts credentials, e-mail addresses and IPs before writing, then re-scans its own output and refuses
to write if anything credential-shaped survived.

```bash
python3 collect_classic_evidence.py --tenant <id> --dashboard-ids @used-dashboards.txt --out classic-evidence.json
```

The token is typed at a hidden prompt — not stored, not in shell history, not in the environment. Send
back `classic-evidence.json`. Review the script first; it is short and deliberately readable.

`used-dashboards.txt` is supplied by the reviewer and lists only the dashboards measured as actually in
use — typically a few dozen out of thousands, which keeps the run small.

---

## Option B — plain `curl`, nothing of ours executed

For customers whose change control will not run an unreviewed script. Each command projects only the
fields needed; nothing else is read or emitted.

```bash
TENANT=<id>; read -rs -p "Classic API token: " T && echo    # hidden input

# 1. Token inventory — no token VALUES are emitted, only names and metadata
curl -s -H "Authorization: Api-Token $T" \
  "https://$TENANT.live.dynatrace.com/api/v2/apiTokens?pageSize=500" \
  | jq '[.apiTokens[] | {name, owner, enabled, expirationDate, lastUsedDate, scopes}]' > tokens.json

# 2. ActiveGate update status — no IP addresses emitted
curl -s -H "Authorization: Api-Token $T" \
  "https://$TENANT.live.dynatrace.com/api/v2/activeGates" \
  | jq '[.activeGates[] | {hostname, version, autoUpdateStatus, type, group}]' > activegates.json

# 3a. Request attributes — the scope fields are only on the per-item read
curl -s -H "Authorization: Api-Token $T" \
  "https://$TENANT.live.dynatrace.com/api/config/v1/service/requestAttributes" \
  | jq -r '.values[].id' | while read -r id; do
  curl -s -H "Authorization: Api-Token $T" \
    "https://$TENANT.live.dynatrace.com/api/config/v1/service/requestAttributes/$id" \
  | jq -c '{name, enabled, scopes: [.dataSources[]?.scope | {tagOfProcessGroup, serviceTechnology}]}'
done > request-attributes.jsonl

# 3b. Request naming
curl -s -H "Authorization: Api-Token $T" \
  "https://$TENANT.live.dynatrace.com/api/config/v1/service/requestNaming" \
  | jq -r '.values[].id' | while read -r id; do
  curl -s -H "Authorization: Api-Token $T" \
    "https://$TENANT.live.dynatrace.com/api/config/v1/service/requestNaming/$id" \
  | jq -c '{namingPattern, enabled, managementZones, conditionAttributes: [.conditions[]?.attribute]}'
done > request-naming.jsonl

# 4. Dashboard filters — only the dashboards on the supplied list
while read -r id; do
  curl -s -H "Authorization: Api-Token $T" \
    "https://$TENANT.live.dynatrace.com/api/config/v1/dashboards/$id" \
  | jq -c '{id, name: .dashboardMetadata.name,
            managementZone: .dashboardMetadata.dashboardFilter.managementZone}'
done < used-dashboards.txt > dashboard-filters.jsonl

unset T
```

**Matching an anonymous caller to one of your tokens.** The review reports callers as a reference such
as `TOKEN_4c9db4e9`. Compute the same reference for your own tokens and match locally — no token value
needs to be shared:

```bash
printf '%s' "dt0c01.$TOKEN_PUBLIC_ID" | shasum -a 256 | cut -c1-8
```

**Before sending:** the outputs above contain owner e-mail addresses. Strip them if that matters:

```bash
sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/REDACTED/g' tokens.json > tokens-clean.json
```

---

## Option C — export from the interface, no command line

Slower and less precise, but needs no token and no terminal.

| Item | Where | What to export or capture |
|---|---|---|
| 1 | **Settings → Access tokens** | The token list view. Name, owner, last used and scopes are all on screen; a screenshot or CSV export is enough. |
| 2 | **Deployment Status → ActiveGates** | The ActiveGate list — it shows version **and** auto-update state per gate, which is the part we cannot query. |
| 3 | **Settings → search "request attributes"**, then **"request naming"** | For each **enabled** rule, whether its scope uses a process-group tag, and whether that tag begins `primary_tags.`. Also flag any rule scoped by service technology, management zone, or service tag. |
| 4 | **Dashboards (classic) → each dashboard → Settings → Filter** | Whether a management zone is set. Only needed for the dashboards on the supplied list. |

The environment also ships a **Check your upgrade readiness** dashboard which covers much of the same
ground and can simply be screenshared.

---

## Option D — answer six questions, send nothing

If no data may leave the environment at all, these six answers are enough to keep every domain scored
rather than excluded. All are readable from the screens in Option C.

1. How many API tokens are **enabled**, and how many have **no expiry date**?
2. Of the tokens used in the last 30 days, how many have an owner who has **left or changed role**?
3. How many ActiveGates show auto-update **disabled** or **outdated**?
4. Of your **enabled** request-attribute rules: how many total, and how many are scoped on a
   process-group tag that does **not** start with `primary_tags.`?
5. Same two counts for **request naming** rules — plus how many use a management zone or a service tag.
6. Of the dashboards on the supplied list: how many have a **management zone filter** set, and which
   zones?

**What this costs.** Counts instead of names. The review can state how much work exists and how urgent
it is, but not *which* rule or *which* dashboard — so the remediation list has to be assembled by the
customer's own team rather than handed to them. Every domain stays scored; nothing is excluded.

---

## If nothing is provided

The review runs and completes. The four affected areas are reported as **not assessed**, each naming
the access that would include it, and are **excluded from the score rather than counted against it** —
a permissions gap is never reported as a migration gap. The cost is precision in exactly the four
places above, most importantly: the integration break-list stays anonymous, and no management zone can
be confirmed safe to retire.
