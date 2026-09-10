# Managed → SaaS: source precedence and errata register

**What this is.** The knowledge layer for Dynatrace Managed → SaaS migration work: which
source to trust for what, and the claims in the official material that are **verified wrong**
and must not be propagated. Imported 2026-08-26 from an external method directory built during
a nine-environment migration engagement.

**What this is not.** There is no `/dt-eval-m2s` skill yet. The export-analysis method
(baseline subtraction over Monaco configuration exports) and its measurement traps land with
that skill; this file carries only the parts that are useful immediately and that go stale on
their own schedule. Sibling specs live here for the same reason
([gen3-migration-progress-spec.md](gen3-migration-progress-spec.md),
[mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md)) — the skill directory is the
runbook, `dt-eval-tenant/` is where the domain knowledge is kept.

**Why an errata register exists at all.** Every entry below was believed, written into a draft,
and corrected before delivery. A source being official does not make it current, and three of
the five entries are cases where an official Dynatrace document contradicts the current docs
site. Without a register the same correction gets rediscovered per engagement — or missed.

---

## 1. Source precedence

Highest first. When two sources disagree, the higher rank wins and the lower one gets an
errata entry.

| Rank | Source | Authoritative for | Caution |
|---|---|---|---|
| 1 | **docs.dynatrace.com** | Product behavior, limits, retention, version requirements, API/CLI syntax | The authority for every recommendation. Verify version-sensitive claims here **this run** — see §3 |
| 2 | **Live tenant** (`dtctl`, DQL) | Actual state — bucket retention, record counts, configuration | Needs IAM grants; bucket *metadata* is often readable when the data is not |
| 3 | **Configuration exports** | The customer's configuration surface, measured | Carries **no** host, entity, or licensing data — see §3 |
| 4 | **Official Dynatrace PDFs and decks** | Service shapes, framework, workshop structure | Several are years stale — every §2 entry comes from this rank |
| 5 | **BPN — Best Practice Notebooks, M2S series** | Routing, checklists, a second opinion | **Further reading only** — see the note below |
| 6 | **Internal workbooks and operational guides** | Service tiers, benchmarks, soft limits | **Internal only.** Never quote to a customer, never leave in a deliverable |

### BPN citation policy — this repo's rule governs

The imported source ranked BPN at 5 and instructed *"never cite in a customer deliverable,"*
and shipped a deck verifier that banned the string `Best Practice Notebook` outright.
**That rule does not apply here and must not be reintroduced.** This repo's policy, which
governs:

- BPN is **further reading**, never the authority — `docs.dynatrace.com` is
  ([CLAUDE.md](../../../CLAUDE.md) § Citations, [bpn-library.md](bpn-library.md)).
- A BPN citation **is permitted in a customer deliverable** when it carries a followable
  public URL in the same paragraph. That is the mandated *Further reading* form.
- A **bare series code** (`M2S-02`, `ALERT-07`) with no URL is banned in every customer-facing
  profile, and a BPN mention with no followable link anywhere in its paragraph is a finding
  (`further-reading-without-url`). Both are enforced in
  [verify_docx.py](../.dt-eval-common/verify_docx.py); an internal reader can resolve a series
  code from the skill itself, so the internal profile is exempt.

Route BPN lookups through the `dt-bpn` skill rather than crawling the corpus. The M2S series
covers a 3-phase / 9-step journey; `M2S-02` (approach bands by host count, and the 90/10 rule
— 90% of configuration migrates automatically, the remaining 10% takes 90% of the manual
effort), `M2S-03` (ActiveGate sizing, network zones, SAML/SSO, IAM role mapping), and `M2S-05`
(the `oneagentctl` redirect) carry the most weight for this work.

---

## 2. Errata register — verified wrong

A skill doing Managed → SaaS work must not propagate these.

| # | Source | The claim | The reality | Verification |
|---|---|---|---|---|
| E1 | *Managed to SaaS Best Practices Guide* | "10 days for logs, 35 days for traces" | **Reversed.** Traces default to **10 days**, logs to **35 days** | Re-verified against docs.dynatrace.com on 2026-08-26 (see links below). Also contradicted by the *SaaS Upgrade Guide*'s own differences table, and by reading built-in bucket retention from a live tenant |
| E2 | *ACE Services SaaS Upgrade Offering* deck (sl. 5, 18, 19) and the *SaaS Upgrade Guide* | Elevate Services Portal is included in the engagement | **Retired.** Do not reference it in any deliverable | Confirmed during the source engagement, Aug 2026 |
| E3 | *Tenant/SaaS Migrations* datasheet | Scope is "transfer of settings and configuration" | Dated **July 2022** — predates Segments, Workflows, and Process Grouping Rules. The Gen2 → Gen3 conversions sit outside that language and must be itemized separately, or they are scoped out by implication | Publication date on the datasheet itself |
| E4 | *SaaS Upgrade Plan* template task list | Carries *Process Group Detection / Naming Rules* tasks | Those are classic constructs. The template has **no** tasks for Segments, Workflows, or Process Grouping Rules — the native work is simply absent from the work breakdown | Read from the template's own task list |
| E5 | BPN `M2S-95`, and older decks | Implies entity IDs always change when the tenant moves | **Only true if agents are reinstalled.** `oneagentctl --set-server` preserves host identity, and with it the entity IDs | Confirmed during the source engagement, Aug 2026 |

**E1 sources** (re-verified this import):
[Configure data storage and retention for Distributed Tracing](https://docs.dynatrace.com/docs/observe/application-observability/distributed-tracing/storage)
· [Configure data storage and retention for logs](https://docs.dynatrace.com/docs/analyze-explore-automate/logs/lma-bucket-assignment)

**E2–E5 were carried across as recorded by the source engagement and have not been
independently re-verified since.** Each is a statement about a document or a behavior that can
change; treat them the way §3 treats its own list, and re-confirm before putting any of them in
front of a customer.

**E4 is the one with teeth for scoping.** The plan template is otherwise the best work-breakdown
backbone available (~156 tasks per environment across 8 groups, with durations populated and the
effort column deliberately left for the scoper). Using it unmodified means the Gen2 → Gen3
conversion work is invisible in the scope — which is the same defect E3 describes, arriving by a
second route. `/dt-eval-gen3` measures exactly that gap on a live tenant, and
`/dt-eval-mz2seg` plans the largest piece of it.

---

## 3. Claims worth re-verifying every run

Version-sensitive, and a wrong answer here is expensive. Confirm each against
docs.dynatrace.com in the run that asserts it — do not carry the value forward from this file.

- **Process Grouping Rules migration must complete on Managed *before* the upgrade**, and needs
  **OneAgent 1.329+** on every host (`docs.dynatrace.com/managed/shortlink/up-migrate-cfg`).
- **Extensions 1.0 support ended 30 September 2025**; ActiveGate 1.299 was the last version
  supporting it. Classic extensions found in an export are a retirement decision, not a
  migration item.
- **SaaS trace retention is 10 days by default**, extensible to 10 years with custom buckets
  (E1).
- **SaaS has no multi-regional failover.** RPO ≤ 24h, RTO ≤ 24h, three availability zones
  in-region. A Managed customer with a DR site is losing a capability, and the deliverable has
  to say so plainly.
- **SaaS SSO is SAML/SCIM, with LDAP reached via SCIM** — not "no LDAP equivalent," which is a
  claim that survived several drafts of a delivered document before being corrected.
- **SAML: the entire message must be signed.** Assertion-only signing returns `400`.
- **A Synthetic-enabled ActiveGate cannot run any other module.** This changes ActiveGate
  counts in a sizing.
- **Configuration exports carry no host, entity, or licensing data.** Host units, DEM units and
  DDU must come from the Managed cluster console or the tenant API. Where they are unavailable,
  they are **⚪ not-assessable** — appendix footnote only, never a body page, and never
  substituted with a default (CLAUDE.md hard rule 3).

---

## 4. Related

- [field-notes.md](field-notes.md) — verified field names, error semantics, CLI gotchas. Same
  genre as this file, for live-tenant work.
- [bpn-library.md](bpn-library.md) — the BPN reference layer and the mandated *Further reading*
  citation form.
- [gen3-migration-progress-spec.md](gen3-migration-progress-spec.md) — measures Gen2 → Gen3
  progress on a live tenant. The natural next engagement after a cutover, and the counterpart
  to the gap E3/E4 describe.
- [mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md) — plans the management zones →
  segments piece in execution depth.
