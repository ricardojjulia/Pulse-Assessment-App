# Field notes — MZ → Segments Migration Plan (`/dt-eval-mz2seg` exclusive)

Split out of [field-notes.md](field-notes.md) on 2026-08-07 for context economy: this content is
zone-dimension-reduction and consumer-cutover mechanics for the standalone `/dt-eval-mz2seg` plan,
not needed by a plain Configuration Review, Gen3 Migration Progress, Problem Noise, or Effective
Consumption run. The general `dt.sfm.*` delivery/ingest self-monitoring gotchas learned during the
same 2026-07-29 validation sweep — used by B39/B39b/B40/B41 in every dt-eval-tenant and dt-eval-prob
run — stayed in field-notes.md's own "Delivery/ingest self-monitoring surfaces" section rather than
moving here; this file is MZ→Segments-plan mechanics only. Read this alongside
[mz2seg-migration-plan-spec.md](mz2seg-migration-plan-spec.md) and `analyze_mz2seg.py`
(`.claude/skills/dt-eval-mz2seg/`).

## MZ → Segments migration plan (validated on two live estates — 2026-07-29)

- **Zone dimension reduction must handle six condition families, not just tags.** On a large
  reference estate (~320 zones) the dominant rule-condition keys were `HOST_GROUP_ID` (~340
  conditions), `HOST_GROUP_NAME` (~200) and `PROCESS_GROUP_NAME` (~200) before any `*_TAGS` family —
  the E2 tag-prefix reduction alone would have missed most of the estate's shape. Families:
  entity-pin (`HOST_GROUP_ID` + `entityId`) · name-pattern (`*_NAME`/`*_DETECTED_NAME`) · tag-key
  (`tag` field, `Key:value` or bare key) · k8s/cloud metadata · tech/type refinements ·
  **hygiene-exclusion** (`NOT_REGEX_MATCHES` agent/system noise lists — monitoring hygiene, never
  scoping intent; do not "migrate" these into segments).
- **`entitySelector` rules are a second rule shape A17 carries** (`rules[].entitySelector`, no
  `attributeRule`) and they cluster: `tag("Key:value", "Key:value2")` (multi-arg — a `[^"]+`
  capture reads only the first arg, same dimension either way), `hostGroupName(...)`/`detectedName(...)`
  (host-group dimension again), bare `entityName` patterns, and extension-entity types
  (`type("ibmmq:local_queue")`, `type("os:service")`) — the last are extension topologies (E8
  adjacency) and deserve their own dimension, not "other".
- **Primary-dimension tier:** when a zone scopes on a structural dimension (entity-pin / tag /
  k8s / ext-type), its name-pattern conditions are *refinements* narrowing that population, not
  scoping boundaries — demote them or covered zones read as blocked by their own refinements
  (~6% of the reference estate flipped on this rule alone).
- **Consumer joins:** A14 `.value.managementZone` **is the A17 settings `objectId`** (not the
  zone name, not the legacy numeric ID) — join directly. A15 `.value.alertingProfile` is the A14
  `objectId` — the notification→profile→zone chain resolves offline. Reference estate: ~700 of
  ~900 profiles MZ-bound across ~100 distinct zones — the consumer cutover, not segment authoring,
  is the bulk of an MZ migration; plan sequencing must rehome consumers before any retirement.
- **Coverage % must be zone-weighted (population-weighted once B37 is joined), never
  per-dimension-unweighted** — a long tail of one-zone tag keys otherwise drowns the estate's real
  shape (unweighted read ~4% vs zone-weighted ~44% on the same estate; only the latter matched
  manual inspection).
- **Run-dir probe filenames appear under three conventions** across the family's history
  (`A17-management-zones.json`, `a17-management-zones.json`, `17-management-zones.json`) — any
  offline tool reading a run cache must glob all three (see `analyze_mz2seg.py` PROBE_PATTERNS).
- **B37 live results arrive as the dtctl query records envelope** (`result.kind == "records"`,
  rows under `result.records`) with **counts as strings** and one **`mz: null` row = entities in
  no zone at all** (unzoned-estate size, worth reporting, never a zone). Once B37 has run,
  **absence from the census IS the measurement** — a defined zone with no census row matches zero
  entities; only a missing B37 file makes population "unknown". Live-validated: ~230 of ~320
  defined zones populated; a large minority of "defined" zones match nothing.
- **Report BOTH coverage bases — zone-count and population-weighted — their divergence is itself a
  finding.** Live-validated shape: ~44% of zones ready by count vs ~6% of scoped entities by
  population — the small app zones ride the covered host-group dimension while a handful of
  estate-wide mega-zones (tens of thousands of entities each, keyed on management tags like
  `server_managed_by`) are exactly the uncovered ones. One number without the other misleads in
  opposite directions.
- **Empty-but-consumed zones = dead alert routing.** A zone with zero population but live alerting
  profiles bound to it can never fire those notifications — disposition "investigate", and name
  them in the consumer-cutover section (live estate: ~a dozen).
- **B5 presence is NOT source-tag evidence.** B5 reads `dt.entity.* | expand tags` — the classic
  entity-tag surface, which *includes* tags computed by classic auto-tagging rules (A16). The only
  surface that proves a tag is source-set is **Smartscape `tags`** (`smartscapeNodes HOST`) — that
  is where primary Grail tags live and what segments/IAM can key on. Live-validated the hard way:
  the reference estate's dominant app-ID tag sat on every classic entity (B5) and on **six** of
  ~23k Smartscape hosts — classic auto-tag only, invisible to segments, and the reason the
  tenant's bridge segments parse tag strings.
- **No key-enumeration function on `smartscapeNodes`** — `recordKeys()` and `fieldsNames()` both
  return UNKNOWN_FUNCTION (verified live). The B38 pattern is a **candidate-key census**:
  `countIf(contains(toString(tags), "<key>"))` per key of interest, in one aggregate query.
  Record access by literal key (`tags[`AppID`]`) works per-key too.
- **Tag-at-source is the ordering constraint of an MZ→segment plan.** Provenance splits every
  zone tag dimension three ways with opposite remediations: source-propagated (segment-ready
  now — on the reference estate the estate-management tags behind the *biggest* zones were
  ~93%-fleet propagated) · context-imported `[Azure]`/`[Environment]` (segment on the native
  metadata field, never the rendered string) · classic-computed, not propagated (establish the
  source tag FIRST; the classic tag retires with Gen2). A <1%-fleet token presence is not
  propagation.
- **Two BPN-vs-docs divergences on segment mechanics — docs win, both recorded 2026-07-29.**
  (1) **`entity.name` wildcard support:** MZ2POL-05 §5.3 and ORGNZ-08 claim contains/ends-with
  (`"*payment*"`, `"*-prod"`) work in segment includes; the segments limits reference documents
  **starts-with only** (includes support `=` and `in()`; classic entity properties equals-only).
  A CONTAINS/ENDS_WITH zone condition is therefore a conversion **blocker**, not a mapping.
  (2) **Host-group propagation to derived data:** ORGNZ-10 §3 lists host group as carrying over
  to service metrics; the segments upgrade guide's carried-key list is exactly
  `dt.security_context`, `dt.cost.costcenter`, `dt.cost.product` — host group is absent. Treated
  as **verify-live**, asserted neither way. Both divergences are encoded as constants in
  `analyze_mz2seg.py` (`UNCONVERTIBLE_OP`, `DERIVED_DATA_KEYS`) with their source comments.
- **Alerting-profile duration filter has NO successor** (upgrade guide, alert notification —
  verbatim: "Currently there is no alternative to deliver problems that are active longer than
  X minutes"). MZ2POL-09 §6.1 cites the wrong page (the *segments* upgrade guide, which never
  mentions alerting). One approximation exists that the BPN calls impossible: a scheduled
  workflow filtering on problem duration — imprecise timing, but it exists; "cannot be designed
  around" overstates. Delay-dependent profiles sequence LAST in an MZ→segments cutover.

## Tag-propagation census: two ways to read a false zero (validated 2026-08-24)

Both were found on the same run, and each one alone would have inverted the plan's central finding.

- **A context-imported tag is stored under its BARE key.** A zone filters on the rendered form
  `[Environment]server_managed_by`; the source tag is `server_managed_by`. B38's
  `contains(toString(tags), "[Environment]server_managed_by")` returns **0** and reads as
  "classic-only, establish tagging at source first" — on what was in fact the estate's
  **best-propagated tag, at 88% and 94% of fleet on two environments**. The bracketed prefixes
  (`[Environment]`, `[Azure]`, `[AZURE]`, `[AMS]`) are the classic *rendering* of an imported
  context, never part of the key. **Always census both the literal key and its bracket-stripped
  form**, and quote the bare key in anything a reader will run. `tag_provenance()` now records
  `propagated_hosts` on context-imported keys instead of discarding the measurement — the reach of
  the tag is what turns "build a tagging practice" into "extend the one you already have", which is
  a completely different conversation with the customer.
- **Match tags by KEY, not as text.** `contains(toString(tags), "AppID")` also matches tag
  *values*: it reported the application tag on 3 and 6 hosts that merely carry those letters
  somewhere in a value, against **0** that carry the key. Use record access by literal key —
  ``countIf(isNotNull(tags[`AppID`]))`` — which is both correct and far more readable in a
  client-facing reproduction block. The two forms disagreeing is the tell.
- **Name auxiliary artifacts `aux-<probe>-*`, outside the probe glob.** `load_probe` resolves a
  probe by globbing its number (`B38-*`), so anything else under that prefix is a candidate. This
  used to be silent and dangerous — a `B38-keymap.json` sorting ahead of `B38-tag-propagation.json`
  read as an empty result and the analysis reported `b38_collected: false` with the census sitting
  right there. Hardened 2026-08-24: payloads are now recognized rather than assumed, so a stray file
  is skipped with a warning (recorded in `analysis.json`'s `probe_diagnostics`), an unreadable one
  raises `ProbeFileError`, and **`None` never means "found something I could not read"** — it means
  not collected, `[]` means zero rows. Two payload-shaped files under one prefix raise rather than
  resolve by sort order. The naming convention is still worth keeping: it avoids the warning
  entirely, and a *second valid payload* (a saved raw response next to the normalized census) is the
  one case the loader refuses outright.

## The population base is MEMBERSHIPS, not entities (ceiling check, 2026-08-24)

`managementZones` is an array, so B37's census counts one row per entity-per-zone. Summed, it is a
count of **zone memberships**, and it routinely exceeds the estate's entity count — 1.92x and 3.57x
on two live environments (169k memberships over 88k entities; 394k over 110k). Read B30's entity
total as the physical ceiling and report the ratio: labelling the weighted coverage figure a "share
of scoped entities" overstates the base by that factor. The ratio is also a finding in its own
right — an average entity sitting in 3.6 zones is 3.6 definitions to maintain and 3.6 chances to
drift, which is the strongest available argument that the target model is not one-segment-per-zone.
`analysis.json` carries it as `population_base`.
