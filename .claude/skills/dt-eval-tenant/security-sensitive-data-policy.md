# Security & Sensitive Data Policy

**Version 1.4** — Adopted 2026-07-28 following live disclosure of API keys and PII in raw probe outputs (pharma tenant evaluation). **v1.1 (2026-07-31):** Layer 2 is now executable ([`redact.py`](../.dt-eval-common/redact.py)) rather than pseudocode, and the detector-config read is covered — see "Detector configuration" below. **v1.2 (2026-08-05):** field finding during a live §A battery (a reference tenant, non-prod) surfaced two gaps: A15 webhook URLs can carry a live credential as a query-string parameter, which no key-based rule could see (`redact.py`'s `URL_TOKEN_PARAM_RE`, gated on `"://"`); and A5 `get workflow-executions` was missing from this table even though its execution payloads carry the same `eventTemplate` recipient-list PII that A2/A43 carry — see "A5" below. **v1.2 addendum, same day:** a follow-up re-check of the actual `runs/` output (not just this policy table) found that this row already existing in the table did not mean the probe's own catalog entry told anyone to pipe through `redact.py` — **B34** (real-user Gen3 engagement) had been in this table since the original disclosure but its entry in `probes-grail.md` never carried the instruction, and had never once been redacted on a live run (confirmed: 64-67 cleartext addresses per run, three separate dates, zero `***REDACTED_*` markers). **A15** and **A18** had the identical gap — both are documented below and in the Layer 2 table, but their `probes-config.md` entries carried no redaction instruction at all. **EC4** (`/dt-eval-consumption`) has a documented query variant that groups `by:{user.email}` with no redaction note next to it. All four now carry the same explicit "pipe through redact.py" instruction A2/A5 already had — see each probe's section below and its catalog entry. **The lesson repeats:** a row in this table is necessary but not sufficient; the probe's own collection instruction is what a collection run actually reads, and it must carry the pipe explicitly, every time. **v1.3 (2026-08-07):** a live A2 run (`problem.notifications`) surfaced two more gaps in `URL_TOKEN_PARAM_RE`/`EMAIL_RE`/`TOKEN_ID_RE` themselves, not in the collection instructions — a webhook URL carried its SAS signature as `sig=`, a param name the covered list didn't include; and the same notification's `summary` display field (Markdown-rendered, so it backslash-escapes every literal `.`) carried an email address and a token id that the dot-only regexes couldn't see past the backslash. See "A15" below. **v1.4 (2026-08-09):** a live A15 run surfaced a third webhook-header shape gap — `redact.py`'s `{key, value}` special case (settings properties) never matched A15's own `headers: [{name, value, secret}]` list, so a header named e.g. `Authorization`/`X-Api-Key` fell through to the generic walk, where neither sibling field name (`name`, `value`, `secret`) is itself in `SENSITIVE_KEYS` — 4 cleartext Basic-auth header values reached run storage on a live run before this was caught. `redact.py` now carries an equivalent `{name, value}` special case alongside the `{key, value}` one; `secret: false` still does not gate the check (a header can carry a live credential regardless of that flag — that is the whole point of the mandatory disclosure rule).

## Problem Statement

Several probes collect sensitive data (API keys, webhook secrets, email addresses) that must never appear in:
- Deliverables (customer-facing Word documents, notebooks, dashboards)
- Run evidence retained longer than necessary
- Cloud storage or shared output directories

Observed live (2026-07-28):
- **A15 `builtin:problem.notifications`** — webhook headers in cleartext when `"secret": false` expose live API keys
- **A18 `builtin:ownership.teams`** — employee email addresses and team structures
- Both written verbatim to `~/.claude/runs/<tenantId>-<date>/` and persist indefinitely

## Policy: Three Layers

### Layer 1 — Detection & Disclosure (Immediate)

**When a probe output contains PII/secrets:**

1. **Operator notification (log + summary):** Immediately emit a **WARNING** during the run:
   ```
   ⚠️  SECURITY: A15 probe contains secret API keys (3 webhooks with "secret": false).
       Fields have been redacted in run storage. Operator action: verify no cleartext
       backups exist. If this run is delivered, a security finding will appear in the
       report as a mandatory disclosure. Do not suppress.
   ```

2. **Real security finding:** This triggers a **MANDATORY DISCLOSURE** in the report:
   - **Domain:** Security Posture
   - **Status:** ⚠️ (Needs attention)
   - **Title:** Cleartext API keys in webhook notification configuration
   - **Description:** The tenant stores live API credentials in problem notification settings without encryption. If these webhooks are ever exfiltrated (backup breach, insider access, API log exposure), the credentials become compromised.
   - **Remediation:** [docs.dynatrace.com link to webhook security best practices] + [BPN notification-workflow-security code]

3. **Never suppress or omit** — a security control finding is a real risk, not a config preference.

### Layer 2 — Redaction on Save (Technical)

**Storage in run directory (`runs/<tenantId>-<date>/*.json`):**

Apply redaction when writing raw probe outputs. Redaction rules per probe:

| Probe | Sensitive fields | Redaction rule | Example |
|-------|------------------|----------------|---------|
| **A15** `problem.notifications` | `value.headers[*].value` (webhook headers — observed in BOTH a `{key, value}` settings-property shape AND a `{name, value, secret}` shape; the header name lives in `name`, not `key`, in the latter, and `secret: false` does not gate the check either way), `authToken`, secret-key fields; **also `webHookNotification.url` query-string parameters** (`vtoken`, `token`, `api_key`, `apikey`, `secret`, `access_token`, `client_secret`, `sig`, `signature`) — a credential can ride in the URL instead of a header; **also emails/token ids inside Markdown-escaped display fields** (`summary`), where every literal `.` is backslash-escaped | Headers/keys: replace with `***REDACTED_API_KEY***`. URL param value (only inside a string containing `"://"`): replace with `***REDACTED_URL_TOKEN***`, leaving the param name and the rest of the URL intact. `EMAIL_RE`/`TOKEN_ID_RE` tolerate an optional backslash before each dot, so a Markdown-escaped address or token id is still caught | `"Authorization": "Bearer sk_live_..." → "Authorization": "***REDACTED_API_KEY***"`; `{"name": "Authorization", "value": "Basic dXNlcjpwYXNz", "secret": false} → {"name": "Authorization", "value": "***REDACTED_API_KEY***", "secret": false}`; `?vtoken=AbCd…&team=sre → ?vtoken=***REDACTED_URL_TOKEN***&team=sre`; `?sig=AbCd…&sv=1.0 → ?sig=***REDACTED_URL_TOKEN***&sv=1.0` (sv left intact — not a secret); `Notify Jordan\.Rivera@example\.com → Notify ***REDACTED_EMAIL***` |
| **A18** `ownership.teams` | `email`, `displayName` (if PII), team member lists with emails | Replace with `***REDACTED_EMAIL***` or `***REDACTED_NAME***` | `"email": "john.doe@example.com" → "email": "***REDACTED_EMAIL***"` |
| **A5** `get workflow-executions` | Execution payloads inline the triggering workflow's own `eventTemplate` properties, so the same `opc_email_recipients`-shaped addresses A2/A43 carry flow through into execution records | Whole-value → `***REDACTED_EMAIL***` (same rule as A2/A43 — no separate rule needed; `redact.py`'s generic key/value walk already covers it once the output is piped through) | `{"key": "opc_email_recipients", "value": "a.b@corp.com"} → {"key": "opc_email_recipients", "value": "***REDACTED_EMAIL***"}` |
| **B43** classic API usage by caller (`dt.system.events` AUDIT_EVENT) | `authentication.token` — a **cleartext Dynatrace token public identifier** (`dt0c01.` + 24 chars); also any token embedded in `resource` | Replace with the **stable pseudonym** `***REDACTED_TOKEN_ID_<8hex>***` (truncated SHA-256 of the public id). **Never a constant marker** — it merges distinct callers and voids the probe | `"authentication.token": "dt0c01.ABCD…" → "***REDACTED_TOKEN_ID***"` |
| **A27** `builtin:token-settings` | Token values (if exposed), credential storage config | Redact token values; keep config presence | If token list appears, mark as `***REDACTED_TOKEN_LIST***` |
| **A38** `attribute-masking` & **A39** `oneagent.side.masking` | Example masking patterns with real data | Redact patterns containing sample PII | `"pattern": "SSN=\\d{3}-\\d{2}-\\d{4}" → "pattern": "***REDACTED_PATTERN***"` |
| **A2 / A43** `anomaly-detectors` (`builtin:davis.anomaly-detectors`) — **the same object set**, and all of [dt-eval-prob probes.md §3](../dt-eval-prob/probes.md) | `value.eventTemplate.properties[]` entries keyed `opc_email_recipients` (notification routing baked into the detector); any `to`/`cc`/`bcc`/`recipients` | Whole-value → `***REDACTED_EMAIL***` | `{"key": "opc_email_recipients", "value": "a.b@corp.com,c.d@corp.com"} → {"key": "opc_email_recipients", "value": "***REDACTED_EMAIL***"}` |

**This table is per-probe; one gap is per-TRANSPORT and applies to every row in it.** Any probe whose result is large enough spills to a result-file envelope instead of returning rows (see design rule 6 below), and a spilled result is redacted only if the pointer is followed. The rule is therefore not "redact probe X" but **"redact what the probe actually returned"** — pipe every sensitive probe through `redact.py` and let it decide, rather than reasoning about which probes are big enough to spill. B34 is the one observed live, but nothing about the spill is specific to it.

**Implementation — [`redact.py`](../.dt-eval-common/redact.py) (executable; self-tests in `test_redact.py`):**
```python
import redact
red, report = redact.redact(raw_json)          # or redact.redact_file(path, in_place=True)
if report.total:
    print(report.warning(probe_id), file=sys.stderr)   # the Layer-1 operator WARNING
write_to_run_dir(f"{probe_id}.json", red)
runlog.record(run, probe_id, "ok", summary=report.summary())   # counts only, never an address
```
Or from a collection shell script — exit status **2** means "something was redacted, this run needs the mandatory security finding":
```bash
dtctl get anomaly-detectors -o json | python3 redact.py - --probe-id A2 > "runs/$RUN/A2.json"
```

**Five design rules, all measured rather than assumed — do not "simplify" them away:**

1. **Redact by KEY, never by value keyword.** A `secret|token|password` scan over *values* matched **209 detector titles** on a reference estate, none of them credentials — "C2MQ_Mainframe Password Reset_Unlock", "AAC Salesforce - Token Issue", "C1 - AWSSecretsManager usage". Those titles are the join key P6 and the §3 detector worklist rank detectors by, so a value-keyword redactor destroys the analysis while protecting nothing. Sensitive *keys* are enumerable; sensitive *values* are not.
2. **Email substitution is surgical.** Only the matched address is replaced, never the whole string, so a title or description stays joinable. If an address is found inside an analysis-critical field (`title`, `event.name`, `query.expression`, `objectId`, …) the address still goes — PII wins — but the WARNING names the field, because silently rewriting a grouping key is how a reconciliation bug ships.
3. **Short recipient keys are conditional, not unconditional.** `to` / `cc` / `bcc` / `recipients` are also ordinary DQL column names — caught during the 2026-07-31 sweep, before any file was written: `cc` matched `.result.records[0].cc`, an **integer 0** from a `summarize`, not a carbon copy. Those keys redact only when the value is a string that actually contains an address; explicitly-named keys (`opc_email_recipients`, `Authorization`, `password`, …) redact any scalar unconditionally. Adding a short, generic key to `SENSITIVE_KEYS` instead of `CONDITIONAL_KEYS` silently corrupts saved query results — the same class of damage as the value-keyword scan rule 1 forbids.
4. **A credential embedded in a URL has no key at all, so it needs its own gate.** A15's webhook `url` can carry a live token as a query-string parameter (`?vtoken=…`) — no dict key names it, so no `SENSITIVE_KEYS`/`CONDITIONAL_KEYS` rule can see it (field finding on a reference tenant (non-prod), 2026-08-05). `redact.py`'s `URL_TOKEN_PARAM_RE` fires only inside a string that contains `"://"` — an ordinary `key=value` string with no URL around it is left alone, the same false-positive discipline rule 1 and rule 3 apply. Only params that are the actual secret get added — a live A2 finding (2026-08-07) added `sig`/`signature` (an Azure/Power Automate SAS signature, the credential itself) but deliberately **not** `sv` (SAS version) or `sp` (scoped permission path), which are metadata that happen to sit next to the credential in the same query string, not credentials themselves.
5. **A backslash-escaped separator is still the separator, everywhere in this module — not a per-field special case.** A15's `summary` field renders through Markdown and backslash-escapes every literal `.` (the same convention behind `"1\. item"` to stop Markdown reading `"1."` as a numbered-list marker). Observed live (2026-08-07): `Jordan\.Rivera@example\.com` is plainly an email to a human reader, but the old dot-only `EMAIL_RE`/`TOKEN_ID_RE` couldn't see past the backslash and passed it through untouched. Rather than special-casing the one field where this was first observed, both regexes' dot separator now optionally tolerates a leading backslash wherever it appears — any field using the same Markdown-escaping convention is covered, and the fix costs nothing on the unescaped case (the backslash is simply absent).

6. **A large result is not in the payload at all — follow the pointer (field finding, 2026-08-26).** When a query result is big, dtctl does not return rows inline: it writes them to `~/Library/Caches/dtctl/results/<tenantId>/q-<hash>.jsonl` and returns an **envelope** — `{"ok":true,"result":{"kind":"result-file","path":"…","rows":N,"columns":[…]}}` — whose only content is a path, a row count, and a tiny per-column `top` sample. Redacting that envelope as an ordinary payload redacts the sample and **nothing else**: every row stays in cleartext in dtctl's cache, outside `runs/`, while the run directory looks clean and the operator WARNING reports the sample's handful of matches. Live on two large tenants collecting B34, that left roughly **500 and 1,000 distinct customer addresses** unredacted behind a passing check, and the warning said "6 inline email address(es)" — actively misleading, because it implies the file was handled. `redact.py`'s `redact_envelope()` now detects the envelope, reads the JSONL, redacts every row, and returns an ordinary **records** envelope, so the saved probe output holds the complete redacted result rather than a pointer (and the envelope's `columns[].top` samples are dropped with it). **A missing spill file raises rather than passing the pointer through** — emitting a "redacted" output whose only content is a pointer to an unredacted file is the original failure repeating itself. `--no-follow-spill` exists for a deliberate exception; `--scrub-cache` additionally overwrites dtctl's cache copy, off by default because it mutates a file outside this tree.

**Deliberately NOT redacted:** URLs in `dt_description` (observed: internal runbook/ticket links). They carry no credential and the run directory is already per-tenant and never shared. A URL carrying an embedded query-string token is covered by rule 4 above the moment it matches one of the known param names; a token under an unrecognized param name is not yet covered — extend `URL_TOKEN_PARAM_RE` if one is observed.

### Layer 3 — Lifecycle Management (Operational)

**Raw run directories are temporary evidence, not archives:**

1. **Default retention:** `runs/<tenantId>-<date>/` directories are cleaned up **7 days** after the run completes (or earlier if the user deletes them manually).
1b. **dtctl's result cache is sensitive evidence too, and the "never share `runs/`" rule does NOT cover it.** A spilled result lives at `~/Library/Caches/dtctl/results/<tenantId>/q-<hash>.jsonl` — outside the repo, outside `runs/`, untouched by any retention rule here, and invisible to the C7 pre-delivery scan, which only reads deliverables. Treat it as part of the run's evidence: after collection, either re-run the redactor with `--scrub-cache` (which overwrites the cached rows with their redacted form) or delete the tenant's cache directory. `redact.py` names the exact path in its operator note whenever it follows a spill that contained PII, so the action is never a search. **This is the one sensitive location a reader of this policy would not think to look in** — it was found only because a redacted run directory and an unredacted cache existed side by side for two days.
2. **Deliverables are permanent; evidence is transient:** `.docx` files and notebooks live in `<output-root>/`; run directories live in `.gitignore`-d `runs/` and should be deleted after the report is delivered and verified.
3. **Pre-delivery hygiene scan (C7):** Before any report is finalized and delivered, run a security scan:
   - Check for any `***REDACTED_*` markers in run.json summaries (if found, the report must include the security finding)
   - Scan deliverable `.docx` for any cleartext API keys or email addresses — **whitelisting exactly one occurrence: the mandated AI-disclosure attribution** (the `requested_by` auditor email on the cover, which must never be suppressed or reworded). Any other email, or a second occurrence, fails the scan.
   - Log summary: "Scan passed" or "Scan failed: X redacted fields found → security finding added to report"
   - **A spilled row count is never a total.** `redact.py` records `spilled_count_is_authoritative: false` in the probe summary whenever it followed a result-file, because the count is what dtctl *wrote to disk*, not what the query matched — one tenant's file stopped at exactly 1,000 rows. Any figure derived from a spilled result must come from an aggregate query instead. This is CLAUDE.md's "check every derived total against its physical ceiling" rule applied to the tooling itself, and it is enforced in the summary rather than left to the analyst to remember.

## Per-Probe Security Notes

### A15 — Problem Notifications (Critical)

**Sensitive content:** Webhook URLs often contain API keys; custom headers may include auth tokens.

**Redaction:** Headers `[*].value` where `name` ∈ {`Authorization`, `X-API-Key`, `X-Token`, `Auth-Token`, …} → `***REDACTED_API_KEY***`. **Also `webHookNotification.url` query-string parameters** (field finding on a reference tenant (non-prod), 2026-08-05): a live-looking API token can ride in the URL itself instead of a header — observed a `?vtoken=<32-char-token>` param, which the header/key rules above cannot see because the credential is not a dict key. `redact.py`'s `URL_TOKEN_PARAM_RE` catches `vtoken`/`token`/`api_key`/`apikey`/`secret`/`access_token`/`client_secret`/`sig`/`signature` params (gated on the string containing `"://"`, so it never fires outside a URL) and substitutes only the value → `***REDACTED_URL_TOKEN***`, leaving the rest of the URL joinable.

**Disclosure rule:** If any `"secret": false` webhook with sensitive headers **or a credential embedded in the URL** exists, **MANDATORY security finding**. Report should state: "The tenant stores X webhooks with cleartext secrets. These are at risk of exposure in backups or logs. Migrate to platform-managed credential storage or use Dynatrace's webhook credential vault."

**Fixed 2026-08-05:** despite A15 being the probe this whole policy exists for (Critical, first disclosed 2026-07-28), its `probes-config.md` catalog entry carried **no redaction instruction at all** — the table above and this section documented the risk, but the collection step itself never pointed at `redact.py`. Added the explicit "pipe through redact.py" instruction to A15's entry, matching A2/A5.

**Fixed 2026-08-07 (two more gaps, this time in `redact.py` itself, not the collection instruction):**
- **`sig`/`signature` added to `URL_TOKEN_PARAM_RE`'s covered param names.** A live webhook URL (Power Automate / Azure Logic Apps HTTP-trigger shape) carried its SAS signature as `sig=<44-char-token>` — the actual credential, since anyone holding the URL and a valid `sig` can invoke the flow. `sv` (SAS version) and `sp` (scoped permission path) sit in the same query string but are metadata, not secrets, and were deliberately left uncovered.
- **`EMAIL_RE`/`TOKEN_ID_RE` now tolerate a backslash before each dot.** The same notification's `summary` field renders through Markdown, which backslash-escapes every literal `.` (the convention behind `"1\. item"` to stop `"1."` being read as a numbered-list marker). An address like `Jordan\.Rivera@example\.com` is plainly an email to a human reader but was invisible to the old dot-only regex. Fixed generally — the dot separator now optionally accepts a leading backslash in both regexes — rather than as an A15-only special case, since any Markdown-rendered display field elsewhere in the probe set could carry the same escaping.

**Example finding:**
> **Webhook Secret Exposure Risk (⚠️)** — The tenant has 3 webhooks configured with secret credentials in cleartext (`"secret": false`). If the webhook configuration is ever exfiltrated (backup breach, API log exposure, unauthorized access), the API keys become compromised. **Action:** Enable secret storage (Dynatrace credential vault) or redeploy webhooks using environment variables / credential management system.

### A18 — Ownership Teams (Medium)

**Sensitive content:** Email addresses, team membership structures (potential social-engineering intel).

**Redaction:** `email` and member email lists → `***REDACTED_EMAIL***`

**Disclosure rule:** If team email lists are exposed in run.json, the report should **acknowledge** (not in a finding, but in an appendix or internal note) that email structures are present and should not be shared beyond internal team. No mandatory security finding unless email is breached externally (out of scope).

**Fixed 2026-08-05:** same operational gap as A15/B34 — `probes-config.md`'s A18 entry had no redaction instruction despite this section documenting the risk since adoption. Added the explicit pipe-through-`redact.py` instruction.

### B34 engagement / actor reads (Medium)

**Sensitive content:** User-activity probes return actor email addresses directly in their result rows. Observed 2026-07-31 across two tenants: **186 and 209 distinct addresses** in `74-b34-engagement.json`, carried through into the aggregated `_b_results.json`. **Re-confirmed live 2026-08-05 on a reference tenant (non-prod):** despite this table listing B34 since the original disclosure, its `probes-grail.md` catalog entry never carried a redaction instruction, so it had **never once been redacted** on a live run — 64-67 distinct cleartext addresses in every captured run across three separate dates, zero `***REDACTED_*` markers.

**Redaction:** surgical inline substitution — the addresses sit in ordinary result values, not under a named credential key, so the email sweep is what catches them. **Analysis is unaffected**: engagement math keys on user *id* and on day-counts, never on the literal address (same rule as the EC battery below).

**Fixed 2026-08-05:** `probes-grail.md`'s B34 entry now carries an explicit "pipe through `redact.py`" instruction, the same pattern A2/A5 use — the gap was operational (the row existed here, but nothing told the collection step to act on it), not a missing rule.

**Leaked again, wider, 2026-08-26 — and this time the instruction was being followed.** B34's output on a large tenant is big enough that dtctl spills it to a result-file rather than returning rows, so the documented `| redact.py` pipe redacted the envelope's column sample and left every row in cleartext in dtctl's cache. Two tenants, roughly **500 and 1,000 distinct addresses**, with a clean-looking run directory and a warning reporting 6 matches. The lesson is not "add another instruction": it is that a redaction rule keyed to a *probe* cannot see a gap that belongs to the *transport*. Fixed in `redact.py` (design rule 6) so the pipe now covers it wherever it is used, with no per-probe change. The three cache files this left behind were scrubbed on discovery.

**Disclosure rule:** as A18 — operator-only note, no client-facing security finding.

### A5 — Workflow Executions (Medium)

**Sensitive content:** `dtctl get workflow-executions` was missing from this table entirely (field finding on a reference tenant (non-prod), 2026-08-05) — added late for the same reason the detector-config leak was: the rule lived nowhere so nothing failed closed. An execution record carries the triggering workflow's own `eventTemplate` properties inline, so the same `opc_email_recipients`-shaped addresses A2/A43 carry flow through into A5's execution payloads. Verified live: running `redact.py --in-place` on a captured A5 file found and redacted **104 inline email occurrences, 5 distinct addresses**.

**Redaction:** no new rule needed — `redact.py`'s generic key/value walk (the same `opc_email_recipients` / `email_recipients` / `to`/`cc`/`bcc` rules as A2/A43) already catches these once A5's output is piped through it. The gap was operational, not a missing rule: A5 collection was not documented as needing redaction, so a collection script could skip the pipe entirely. Fixed in [probes-config.md](probes-config.md) A5 and [probes-gen3.md](probes-gen3.md) E6.

**Disclosure rule:** as A18/B34 — operator-only note, no client-facing security finding (this is PII flow-through from workflow config, not a tenant credential misconfiguration).

### Detector configuration — A2 / A43 and dt-eval-prob §3 (Medium-High)

**Sensitive content:** Migrated detector libraries commonly bake their notification routing into the detector's own `eventTemplate`, so the recipient list travels with the config. Observed on a reference estate: **294 distinct employee email addresses across 667 of 1,276 detectors**, every one under `opc_email_recipients`, written in cleartext to `runs/<tenantId>-<date>/` and persisting there indefinitely.

**Redaction:** `eventTemplate.properties[]` entries whose `key` is a recipient key → `***REDACTED_EMAIL***` (whole value — a recipient list has no analytical use).

**Reach:** this is one object set behind three doors — `dtctl get anomaly-detectors` (A2), `dtctl get settings --schema builtin:davis.anomaly-detectors` (A43), and every §3 read in the Problem Noise skill. Redact at the **write** to `runs/`, so all three inherit it; do not attach the rule to a probe id.

**Disclosure rule:** No mandatory *security finding* — unlike A15, cleartext recipients are not a tenant misconfiguration, they are how the migration tool emitted the rules. Handle as A18: acknowledge in an operator-only internal note, never in the client-facing body, and never share the run directory. **What this does justify in the report** is the ordinary Gen3-first observation that per-detector routing is unmaintainable at this scale and belongs in workflows — a consolidation finding, not a security one.

**How this was missed:** the policy's own extension rule (see "Future Probes" below) says to add a redaction row *before* adding a probe that touches settings with secrets. The detector read was added without one, and Layer 2 was pseudocode, so nothing failed closed. Both are fixed in v1.1 — the rule is in the table above and `redact.py` is executable — but the general lesson stands: **a policy that exists only as prose is a policy that gets skipped.**

### B43 — Classic API usage by caller (High)

**Field:** `authentication.token` from `dt.system.events` / `event.kind == "AUDIT_EVENT"`.

**What it actually is:** the token's **public identifier** (`dt0c01.` + 24 uppercase alphanumerics),
not the secret half — a Dynatrace API token is `dt0c01.<publicId>.<secret>` and only the first two
segments appear here. **It is therefore not a usable credential.** It is still redacted, for three
reasons that hold regardless: it is a token *identifier* that maps 1:1 to a real credential in the
customer's token list; it is indistinguishable at a glance from a full token and will trip the C7
cleartext-credential scan; and `user.id` reads `UNKNOWN` on these rows, which makes the token the
*only* attribution available and therefore the field most likely to be copied into a report.

**Redaction:** `authentication.token` → **`***REDACTED_TOKEN_ID_<8hex>***`, a stable pseudonym**
(truncated SHA-256 of the public identifier), plus a value-shape rule
(`TOKEN_ID_RE`, `dt0[cs]\d{2}\.[A-Z0-9]{16,}`) that catches a token embedded anywhere in a string —
the second value-shape rule in `redact.py` after the email one, and as deliberately narrow.

**Pseudonymize, never flatten (corrected 2026-07-31 after it shipped wrong).** A constant marker
merged **14 distinct integrations into one caller** on a live tenant. `user.id` is `UNKNOWN` on these
rows, so the token is the only discriminator, and a merged group looks exactly like a real one —
nothing downstream reveals the loss. The alias is one-way and carries no credential material, and it
is **stable across runs** so an integration keeps its identity between reviews. **General rule: when
a field being redacted is also a join or grouping key, pseudonymize it; only flatten fields with no
analytical role.**

**Two operational rules:**
- **Never alias the field in the probe query.** `redact.py` matches sensitive keys on the whole key
  name; `caller = authentication.token` yields a column the redactor does not know and writes
  cleartext to the run directory. probes-grail.md B43 states this at the query.
- **The report names integrations, never tokens.** Carry a stable per-token alias
  (`Integration A`, `Integration B`) through the analysis; the customer maps the alias to a token in
  their own token list, where they can see the name and owner we deliberately do not collect.

**Also strip the tenant ID from `resource`** — some classic paths embed it (`/e/<tenantid>/api/…`).
B43's `replacePattern` line does this; a tenant ID in a deliverable is a rule-5 cross-tenant leak.

### Future Probes with Sensitive Data

As the evaluation skills expand, new probes may collect PII/secrets:

- **Settings objects with embedded credentials** (OAuth tokens, database passwords, SMTP secrets in custom notifier configs) — apply same redaction rules
- **User/group inventory** (if ever collected) — email addresses → `***REDACTED_EMAIL***`
- **EC battery (EC1–EC17, `/dt-eval-consumption`)** — actor identifiers from `dt.system.events` audit reads and `dt.system.query_executions` (`user.email`, `user.id`): redact `user.email` → `***REDACTED_EMAIL***` in saved raw files wherever the analysis doesn't need the literal address (HHI/day-count math keys on `user.id`; apply the `@dynatrace.com` test at query time and store the boolean/aggregate). Deliverables carry aggregates and de-identified role/tool descriptions only — never a raw email or user id. **Fixed 2026-08-05:** `probes-consumption.md`'s EC4 documents a day-key query variant that groups `by:{user.email}` (the canonical QEI query in effective-consumption.md groups `by:{user.id}` instead and never emits the address) — this variant had no redaction note next to it; added the explicit pipe-through-`redact.py` instruction.
- **Extension configs** (if they embed API keys) — redact per the extension's schema

**Rule:** Before adding a new probe that touches settings with secrets, add the redaction rule to this table and document the operator disclosure. **Add it to [`redact.py`](../.dt-eval-common/redact.py)'s `SENSITIVE_KEYS` in the same change** — a rule that lives only in this table is invisible at collection time, which is exactly how the detector-config leak happened.

## Report-Side Consequences

**Deliverables NEVER contain redacted markers or indicate redaction occurred.**

- Security findings are disclosed clearly and separately
- Summaries use general language: "X webhooks with secrets" (no specific URLs, keys, or email addresses)
- If redaction occurred, the report must include a corresponding security finding **or** an operator-only internal note (never omitted entirely)

## Testing & Validation

- **Unit test:** `test_redact.py` (27 cases, stdlib-only — `.venv/bin/python test_redact.py`). Each case is either a real leaked shape or a real false positive; the false-positive half is the load-bearing half, because a redactor that mangles detector titles gets reverted and then nothing is redacted at all.
- **End-to-end (run this when the rules change):** redact a captured detector-config file and assert three things — **zero** residual `@` matches; `(objectId, title, enabled, analyzer)` byte-identical before and after; and a downstream per-detector analysis returning the same answer on both. Verified against a captured 1,276-detector file: 667 fields redacted, 294 distinct addresses removed, analysis keys unchanged, and the per-detector rollup identical (1,253) on both sides.
- **Integration test:** Run the full evaluation on a test tenant with known-sensitive data (test webhook, test team with emails); verify:
  - Redacted markers appear in `runs/<id>/a15.json`
  - Operator gets a WARNING log during collection
  - Final report includes the security finding
  - No cleartext API keys appear in the `.docx`
- **Pre-delivery scan:** Automated check for `***REDACTED_*` in summaries and deliverable content (see C7)

## Governance

- **Version:** Versioned in this file; updated only by PR review
- **Scope:** Applies to all `/dt-eval-*` skills (tenant, prob, gen3, consumption)
- **Audit:** Security-finding disclosure is visible in every report; if a run redacted data, the finding appears (cannot be silenced by the operator)
- **Operator responsibility:** Do not share `runs/<id>/` directories (which may contain redacted-marker trails) with customers or untrusted parties; always deliver only the final `.docx`/`.json` reports
