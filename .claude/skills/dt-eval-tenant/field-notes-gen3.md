# Field notes — Gen3 Migration Progress (`/dt-eval-gen3` exclusive)

Split out of [field-notes.md](field-notes.md) on 2026-08-07 for context economy: this content is
scoring-recipe detail for the standalone `/dt-eval-gen3` report and nothing in it is needed by a
plain Configuration Review, Problem Noise, Effective Consumption, or MZ→Segments run. General
OpenPipeline-routing and management-zone mechanics learned during the same 2026-07-24 work — useful
to *any* report touching A21/A22/A17 — stayed in field-notes.md's own "OpenPipeline routing &
management-zone mechanics" section rather than moving here; this file is Gen3-domain-scoring only.
Read this alongside [probes-gen3.md](probes-gen3.md) (§E) and
[gen3-migration-progress-spec.md](gen3-migration-progress-spec.md).

## Gen3 Migration Progress (recipe over existing probes — 2026-07-24)

- **The config-construct domains (E1–E7) collect nothing new.** Their classic-residue signals are
  confirmed §A probes — A14 `builtin:alerting.profile`, A15 `builtin:problem.notifications`, A16
  `builtin:tags.auto-tagging`, A17 `builtin:management-zones`, A18 `builtin:ownership.teams`, A29
  `classic-pipelines-translation` — and their native-target signals are A4 (davis-problem workflows),
  A6 (segments), A21/A22 (OpenPipeline), A8–A10 (dashboards/notebooks/apps), and B5/B30 (source-tag
  enrichment). [probes-gen3.md](probes-gen3.md) (§E) is a **scoring recipe** for those seven — reuse the schema
  IDs, don't re-derive them.
- **The three 2026-07-28 additions DO collect (B33/B34/B35).** The entity model and real usage are not
  in any config probe, so E8/E9 and the E5 correction each add one cheap, guard-railed Grail read:
  **B33** (extension `smartscapeNodes`/`id_classic` audit), **B34** (real-user, non-Dynatrace Grail
  dashboard usage), **B35** (Gen3 SLO enumeration, verify-live). All validated live 2026-07-28 on
  a reference tenant.
- **E5 Dashboarding is graded on real-user USAGE, never native object count (correction, 2026-07-28).**
  The prior rule ("grade on native presence, footnote classic residue ⚪") produced a false
  Gen3-leverage claim on a tenant whose people only opened classic dashboards. Gen3 dashboards run on
  **Grail** (every open executes `dt.system.query_executions`); classic dashboards run on the classic
  metrics API and leave **no** Grail trace — so *low real-user Grail engagement is itself proof the
  users are on classic*, regardless of how many platform dashboards exist (a count is vanity —
  CLAUDE.md rule 6). Grade on **B34**: native dashboards present + near-zero real-user Grail engagement
  ⇒ ⚠️/💡, **never ✅**. `dtctl get dashboards` (A8) count is narrative color only. The classic-dashboard
  *usage* residue (`popularity`/`lastViewed`, classic config API) is a **verify-live** confirmation,
  not a required count.
- **Extension entity model = the "are entities Gen3-native?" signal (B33, E8).** `id_classic` on a
  `smartscapeNodes` node = "the entity ID of the corresponding classic entity" (docs: Smartscape on
  Grail). Classic extensions write `CUSTOM_DEVICE-*`; Gen3 extensions write typed nodes
  (`EXT_NETWORK_DEVICE`, `F5_LTM_POOL`, …). A typed node with a **populated `id_classic`** = binary
  updated but monitoring configs not re-saved (mid-migration); **null `id_classic`** = fully Gen3.
  **Trap:** `id_classic` is *normal* on core/K8s/service nodes (they have classic counterparts by
  design) — the audit MUST restrict to extension-sourced nodes via
  `troubleshooting.upsert_source startsWith "extension:"` (format e.g.
  `"extension:f5-load-balancer|metric:if.status"`) or you will read the whole estate as migration debt.
  Join extension metric volume (`metrics | filter startsWith(dt.openpipeline.source,"extension")`) for
  the P1–P4 priority weight; that join needs `storage:metrics:read` (denied → smartscape side still
  classifies status, minus volume weighting). `metricCount` is a ~2h **relative** footprint indicator,
  not an entity count; Smartscape-only + 0 metrics = OneAgent/WMI-driven (priority understated);
  metrics-only + 0 nodes = still needs migration though it creates no entities.
- **Gen3 SLO enumeration is verify-live (B35, E9).** A3 (`dtctl get slos`) is the platform-native count
  and A37 (`builtin:monitoring.slo`) the classic count — **disjoint populations, not a drill-down**
  (live 2026-07-29: A3 = 0 while A37 held 278 tuned classic SLOs on the same tenant). Both are exact.
  Gen3 SLOs express the SLI as a **single DQL query**; B35 corroborates A3's count live where the
  enumeration surface beyond A3 is otherwise undocumented — resolve the reachable surface live
  (`dtctl get documents` type-filtered · SLO Service Public API · a
  `dt.slo*`-metric presence tell) and, if none is reachable, grade on classic residue + confirmed Gen3
  presence and **say the native count is verify-live — never fabricate one** (same discipline as the
  classic-dashboard footnote).
- **E13 Custom anomaly-detector framework is free on the status side, like E1–E7 (added 2026-08-05).**
  Classic residue is **A13** (`builtin:anomaly-detection.metric-events`); native target is **A2**/A43
  (`builtin:davis.anomaly-detectors`) — both already collected, both already Gen3-first-flagged in
  probes-config.md. The one new read is **B49**, and it exists only to weight the domain's footprint
  by actual firing volume (`dt.settings.schema_id` share on `dt.davis.events`) rather than raw
  enabled-detector count — the same correction B34 made for dashboards, so a disabled clone family
  doesn't count the same as a firing one. **Distinct from domain 1 (alerting delivery) and domain 12
  (service detection):** this domain is about how the detection *rule itself* is authored, a layer
  upstream of both. **`dt.settings.schema_id`, not `event.provider`, is the field that makes this
  distinction** — `event.provider` names the emitter, not the config generation.
- **D4 (alerting delivery chain) is the E1 engine** — it already joins davis-problem workflow
  `isActive`, `problem.notifications` by `.value.type`, and the `alerting.profile` MZ-bound share. The
  MZ-bound profile share is the hard dependency the MZ→segments migration breaks, so sequence E2
  (scoping) before retiring those profiles.
- **Live-validated on the public `playground` tenant (2026-07-24) — Migration Completeness 60/100 (C).**
  All five classic-inventory schemas returned data (`management-zones`, `alerting.profile`,
  `problem.notifications`, `tags.auto-tagging`, `ownership.teams`), confirming the §E source reads; the
  estate scored mid-migration (native-leaning: OpenPipeline/dashboards/apps ✅; alerting & scoping
  dual-running; tagging not started; workflows dormant at 0 runs/30d).
