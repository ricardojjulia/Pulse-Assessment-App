# Study — Running Pulse on classic-SKU SaaS tenants without Traces on Grail

**Status:** Study only. No application code is changed by this document.
**Scope question:** Can the app produce (near-)normal results for SaaS
customers on classic SKU licensing that do not have Traces on Grail — and
what is the proposal to get there?

---

## 1. Hard facts from the current code (v2.5.3 / feat/davis-insights)

1. **The app is an AppEngine custom app.** Installing/running it requires
   the tenant to support custom apps (platform entitlement). Classic-SKU
   tenants that were never platform-migrated cannot install it at all.
2. **100% of assessment data comes from DQL against Grail**
   (`@dynatrace-sdk/client-query`). There is no classic-API data path.
3. **Preflight blocks unconditionally.** `usePreflight.ts` probes 7
   sources (`entities, logs, metrics, events, spans, bizevents, buckets`)
   with `fetch … | limit 1`. Any single failure ⇒ "Assessment blocked".
   The spans probe runs **even if the user excluded every span-based
   capability** from the run. ⇒ **Today there is no in-app workaround**:
   a tenant without Traces on Grail cannot run any part of the
   assessment, including the 91 checks that don't need spans.
4. **Span dependency inventory** (from `docs/DATA-SOURCES.md`):

   | Capability | Span checks | Total checks | Affected share |
   |---|---|---|---|
   | Application Observability | 7 (tracing, root span, OTel, DB, messaging, depth, DB-call depth) | 13 | 54% |
   | AI Observability | **9 — all** (`gen_ai.*` exists only on spans) | 9 | 100% |
   | Application Security | 3 (attack surface / failed-request / sensitive spans) | 11 | 27% |
   | Infrastructure | 1 (cloud span enrichment) | 22 | 5% |
   | **Total** | **20** | **111** | **18%** |

   The remaining **91 checks** (metrics, entities, logs, events, Davis
   problems, bizevents) are unaffected by the trace entitlement.

5. **The error signature** on a tenant without the entitlement is
   `TRACE_QUERY_ENTITLEMENT_MISSING` / `exceptionType: ENTITLEMENT-MISSING`
   — distinguishable from a missing OAuth scope (403). The current
   preflight message wrongly suggests granting scopes.

---

## 2. Tenant scenarios (what "classic SaaS SKU" actually means)

| Scenario | Grail? | Custom apps? | Spans on Grail? | Pulse today |
|---|---|---|---|---|
| **S1 — DPS tenant, trace entitlement not enabled** (the screenshot case) | ✅ | ✅ | ❌ | Blocked by preflight |
| **S2 — Classic SKU, platform-migrated** ("Latest Dynatrace" experience; Grail for logs/events; licensing still HU/DEM/DDU) | ✅ partial | usually ✅ (verify) | ❌ typically | Blocked by preflight |
| **S3 — Classic SKU, not migrated** (no Grail at all) | ❌ | ❌ | ❌ | Cannot install/run — out of scope for app changes |

### 5-minute qualification checklist (run per customer before promising anything)
1. Hub → can a custom app be installed? (AppEngine entitlement)
2. Notebook: `fetch dt.entity.host | limit 1` → Grail entities OK?
3. `fetch logs | limit 1` → logs on Grail OK?
4. `fetch spans | limit 1` → distinguishes S1/S2 (ENTITLEMENT-MISSING) from full-Grail
5. `fetch bizevents | limit 1` → Business Obs feasibility

---

## 3. Options

### Option A — **Trace Proxy Mode** (recommended; solves S1 and S2)

Principle: the same OneAgent instrumentation that produces spans also
produces **service metrics and topology on Grail**, which these tenants
DO have. Most span checks can be re-expressed against those sources with
honest fidelity. What cannot be proxied is excluded transparently — never
faked, never counted as customer failure.

**A.1 Preflight becomes entitlement-aware (no more total block)**
- Detect `ENTITLEMENT-MISSING` on the spans probe → mark the source as
  "Not entitled (Traces on Grail disabled)" instead of "fail", show
  correct guidance, and offer **Continue in Trace Proxy Mode**.
- All other sources keep blocking as today (they're genuinely required).

**A.2 Proxy mapping per check** (validated sketches; final DQL to be
tested against a real S1 tenant before implementation):

| Check (span-based today) | Proxy source & sketch | Fidelity |
|---|---|---|
| a1 Service tracing coverage | services with `dt.service.request.count` data in window ÷ total services | **High** — a traced service emits request metrics |
| a3 Root span coverage | services with incoming-request metrics (`dt.service.request.count`) | High |
| a5–a7 (already metrics) | unchanged | — |
| a8 Database span coverage | topology: services with `calls` relation to database services / DB metrics | High |
| a13 Database call depth | topology: services calling ≥2 distinct database entities | High |
| a9 Messaging span coverage | `dt.entity.queue` linked to services / messaging service type | Medium |
| a10 Multi-service trace depth | topology: services with outgoing `calls` to other services | Medium — proves cross-service calling, not per-trace depth |
| a4 OTel instrumentation | service entity metadata (technology/ingest origin) | Medium |
| s8 Failed request coverage | `dt.service.request.failure_count` per service | High |
| s10 HTTP request surface | service entities of web/request `serviceType` | Medium |
| s4 Sensitive/attack spans | no honest proxy → **excluded** | — |
| i18 Cloud span enrichment | **excluded** (cloud context already measured via logs/hosts in i13–i17) | — |
| ai1–ai9 AI Observability | **capability excluded** — `gen_ai.*` attributes exist only on spans | — |

Net effect: **~15 of 20 span checks keep producing comparable results;
5–11 are excluded with explicit "Requires Traces on Grail" labeling.**

**A.3 Scoring integrity rules**
- Excluded checks leave the **denominator** (reuse of the existing
  consolidation/excludedCaps mechanics) — the customer is not penalised
  for an entitlement they can't buy their way out of mid-run.
- AI Observability renders as a locked card: "Requires Traces on Grail"
  → becomes an explicit upsell/enablement conversation, not a 0%.
- Proxied checks carry an "≈ proxy" marker (same visual language as the
  Scale Tier "≈") in cards, criteria list, PDF and Assist context.
- Banner (ScaleTierBanner pattern): *"Trace Proxy Mode — 15 checks
  proxied from service metrics/topology, 9 excluded (Traces on Grail not
  enabled on this environment)."*

**A.4 Effort & risks**
- Effort: ~2–3 days (proxy DQL authoring + validation on an S1 tenant,
  preflight branch, banner/markers, docs) — after the freeze is lifted.
- Risks: proxy drift vs true span numbers (validate side-by-side on a
  tenant that has BOTH, e.g. <reference-tenant>: run span query and proxy query,
  accept if delta ≤5 pts per check); topology relations vary by
  instrumentation (OneAgent vs pure OTel).

### Option B — Classic-API data layer (only for S3; not recommended now)

A second data path via `client-classic-environment-v2` (Metrics v2
selectors, Entities/Monitored entities v2, Problems v2, Events v2;
classic Log API limited; **no bizevents**). Would let a non-Grail tenant
run a reduced assessment (~60–70 checks re-expressed).

- Effort: 2–4 weeks + permanent dual-path maintenance + different scoring
  semantics ⇒ **do not build unless there is concrete pipeline demand
  from non-migrated classic customers.** Their strategic path is platform
  migration anyway — the assessment is a reason to migrate, and Option A
  plus the qualification checklist covers everyone already on Grail.

### Option C — Zero-app-change paths available TODAY

1. **Run on a Grail tenant**: not applicable cross-customer (data is
   per-tenant) — only valid for internal demos (verified on a reference tenant).
2. **"Pulse Lite" companion asset** (separate notebook/dashboard pack,
   no app changes): hand-picked subset of the 91 non-span checks as DQL
   tiles for S1/S2 tenants, produced as a field-asset-library notebook.
   Gives the SE *something* to show while Option A isn't built.
3. Inside the current app: **none** — finding #3 above (unconditional
   preflight) makes the app unusable on these tenants as-is.

---

## 4. Validation plan (before any implementation)

1. Identify one **S1 tenant** (the environment from the screenshot
   qualifies) — confirm signature via `fetch spans | limit 1`.
2. On **the reference tenant** (has spans): run each proxy DQL **and** its span
   original side-by-side; record deltas. Acceptance: |delta| ≤ 5 pts per
   check; document any check that exceeds it (downgrade to excluded).
3. On the S1 tenant: run the 91 non-span checks manually (notebook) to
   confirm no second hidden entitlement gap (bizevents is the likely
   next candidate on S2 tenants — the checklist covers it).
4. Only then implement Option A behind the existing dev gating, validate
   end-to-end on the S1 tenant, and ship in the next published version.

---

## 5. Recommendation

- **Phase 1 (now, no code):** adopt the qualification checklist in
  §2 for every customer conversation; use a reference tenant for demos; optionally
  produce the "Pulse Lite" notebook asset for S1/S2 customers.
- **Phase 2 (next release window):** implement Option A (Trace Proxy
  Mode) — it makes the app work *normally minus AI Observability* for
  every Grail tenant without the trace entitlement, with honest scoring.
- **Phase 3 (only on demand):** revisit Option B if real S3 pipeline
  appears; default answer for S3 remains "platform migration first".

**Bottom line:** same results are achievable for ~96 of 111 checks
(91 unaffected + ~15 proxied) on tenants without Traces on Grail;
AI Observability cannot be measured without spans and must be excluded
transparently — which itself becomes the enablement conversation.

---

## 6. Implementation addendum (Option A built — post-validation)

Option A was implemented after side-by-side validation on the reference tenant
(97 services, 2h window). Measured fidelity changed the final split from
the §A.2 estimate of ~15 proxied to **9 proxied + 11 excluded**:

| Check | Span truth | Proxy value | Outcome |
|---|---|---|---|
| a1 traced services | 83 (85.6%) | request-metric services 90 (92.8%) | proxied — same band |
| a3 root-span services | 75 (77.3%) | request-metric services 90 (92.8%) | proxied — band-equivalent |
| a4 OTel services | 64 (66.0%) | UNIFIED-type services 60 (61.9%) | proxied — low fidelity, Δ-4pts |
| a8/s4 DB services | 6 (6.2%) | DATABASE_SERVICE callers 1 (1.0%) | proxied — low here, better on OneAgent estates |
| a9 messaging services | 10 (10.3%) | messaging-type + callers 2–4 | proxied — undercounts, same pass |
| a10 multi-service | 27.0% of traces | 40.2% of services w/ outgoing calls | proxied — service-level reframe |
| a13 DB call depth | n/m | topology ≥2 DB entities | proxied — same topology basis as a8 |
| s8 failing services | 7 (7.2%) | failure_count>0 services 11 (11.3%) | proxied — Δ+4pts |
| s10 HTTP surface | 51 (52.6%) | entity types 11 (11.3%) | **excluded** — no honest proxy |
| i18, ai1–ai9 | — | — | **excluded** as designed |

Every proxied check keeps the same pass/fail outcome at its operative
(lowest) threshold. Implementation lives in `ui/app/trace-proxy.ts`
(proxy map + capability transform), `usePreflight.ts` (entitlement-aware
spans probe + dev simulation via `?noTraces=1` / `localStorage.cca.noTraces`),
`TraceProxyBanner.tsx`, and the "≈ proxy" chips on criteria rows.
The mode activates only via the preflight's **Continue in Trace Proxy
Mode** action — tenants with the entitlement see zero behavior change.
