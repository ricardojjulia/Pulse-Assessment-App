#!/usr/bin/env python3
"""findings_schema.py — the one canonical shape for findings.json's `meta` block.

Written from day one rather than retrofitted, on `dt-eval-prob`'s explicit
advice. Its `noise_findings_schema.py` exists because a pillar that
`noise_scoring.py` calls `detector_tuning` reached real findings.json files
under two spellings depending on which run wrote it, and the downstream consumer
read the stale key through a silent `.get(key, "")` — turning a rename into a
blank cell in a delivered spreadsheet instead of a build failure. Eight of nine
findings.json files on disk carried the stale key by the time anyone noticed.
Nothing about that defect was specific to alerting; it was specific to having no
schema, which is a thing you can only avoid by writing one before the first run.

This module is the single source of truth for two things:

  1. `assemble_meta()` — builds the canonical meta dict via `scoring.py`'s own
     computation, so a run never hand-types the vocabulary. Prefer
     `assemble_findings.py` (the CLI wrapper) over calling this directly.
  2. `normalize_meta()` — resolves legacy aliases, REJECTS keys whose values
     cannot be mechanically migrated, and RAISES on anything neither canonical,
     optional, nor known. A future rename fails the build loudly.

**The pillar key names are derived from `scoring.WEIGHTS`, not restated here.**
Restating them is the drift this file exists to prevent, and a schema that can
disagree with the thing it validates is worse than no schema.

**The two modes are `full` and `gated`, and mixing them is a hard error.** A
gated run (below the adoption floor, or an unreadable pipeline inventory) has no
health score by design — see `scoring.openpipeline_health`. A meta dict that
claims `gated: true` while carrying a `score` is the OpenPipeline analogue of
`dt-eval-prob`'s config-only-plus-effectiveness contradiction, and it is the one
most likely to be hand-typed into existence, because a gated run still produces
plenty of findings and it is tempting to give them a number.
"""

import scoring

# The pillar vocabulary, derived — never restated. If a pillar is renamed in
# scoring.py this schema follows it automatically instead of silently
# disagreeing.
PILLAR_KEYS = frozenset(scoring.WEIGHTS)

# routing_integrity is required above the floor because scoring.py refuses to
# emit a composite without it (an unreadable routing table means there is
# nothing to review). The other two pillars may legitimately be ⚪ on an
# access-limited run, which is what `renormalized` records.
REQUIRED_META_KEYS_FULL = {
    "score", "grade", "grade_label", "routing_integrity", "n_authored", "window",
}

# Gated mode: there is no score, no grade and no pillars to report. What a gated
# run MUST carry is the reason — `runlog.py finalize --no-grade-reason` consumes
# it verbatim, and a gated headline with no explanation reads to the customer as
# a failed review rather than as the finding it is.
REQUIRED_META_KEYS_GATED = {
    "gated", "reason", "no_grade_reason", "headline_label", "adoption_floor", "window",
}

# Recognized, never required. Absence is not a build error.
OPTIONAL_META_KEYS = {
    "customer", "tenant", "confidence", "confidence_basis", "window_note",
    "weights_used", "renormalized", "n_authored", "gated",
    # Which KIND of not-assessable (diagnose_pipelines.py's `diagnosis`). Optional
    # because a gated run is valid without it, but it decides the cover wording:
    # a tooling gap and an access gap call for opposite actions from the customer,
    # and one sentence served both until 2026-08-26. See report_helpers.gated_notice.
    "diagnosis",
    # The cover's scale line (report_helpers.scale_stat_line). These are
    # MEASUREMENTS and belong here beside n_authored, not in the hand-authored
    # content file the builder used to read them from — that file's schema never
    # documented them, so every report rendered "0 routing entries · 0 of 8
    # signal-type scopes" unless its author guessed at an undocumented key.
    "routing_entries", "signal_types_covered",
    # Findings-side detail. Deliberately NOT part of the arithmetic — see
    # pipeline-ruleset.json's `scored: false` rules. They live in meta so the
    # report can render them and the rollup can ignore them.
    "capacity_pressure", "governance_drift_families", "near_duplicate_families",
    "extension_default_pipelines", "confirmations", "consolidation_worklist",
    "orphan_pipelines", "duplicate_collection_paths",
} | PILLAR_KEYS

# A key a findings.json might still carry -> the canonical key that replaced it.
# Extend this table, never delete an entry: an old findings.json on disk must
# keep loading and comparing. Empty today — this skill has produced no runs yet,
# so there is no disk history to be compatible with. Kept (rather than omitted)
# so the first rename has an obvious home instead of inventing one under
# pressure.
LEGACY_ALIASES = {}

# Keys that must RAISE rather than resolve, because the value cannot be
# mechanically carried across the rename.
#
# This table is the one real departure from noise_findings_schema.py's design,
# and the reason is worth keeping: `consolidation_opportunity` was the v1.0
# spec's name for what is now `structural_hygiene`, but the rename INVERTED the
# direction of goodness — the old name denoted a problem (more is worse) while
# the new one denotes health (more is better). A silent alias would carry the
# number across unchanged and hand a badly-built tenant an excellent pillar. An
# alias table is only safe when the rename is cosmetic; when the semantics move,
# the right behavior is to refuse and make a human re-derive the value.
REJECTED_KEYS = {
    "consolidation_opportunity": (
        "renamed to 'structural_hygiene' AND inverted: the old key counted "
        "defects (higher = worse), the new one measures health (higher = "
        "better). The value cannot be carried across mechanically — recompute "
        "it with scoring.structural_hygiene(n_authored, affected_pipelines)"
    ),
    "openpipeline_health": (
        "the composite's key in meta is 'score', matching every sibling skill's "
        "findings.json — use 'score'"
    ),
    "capacity_score": (
        "capacity is never scored: the soft processor/pipeline tiers are "
        "internal, Dynatrace-adjustable and not publicly citable "
        "(pipeline-ruleset.json rule pipeline-capacity-soft-limits). Report it "
        "under 'capacity_pressure' as a finding instead"
    ),
}

ALL_KNOWN_KEYS = (REQUIRED_META_KEYS_FULL | REQUIRED_META_KEYS_GATED
                  | OPTIONAL_META_KEYS)

# Fail at import rather than at the first run if scoring.py's vocabulary and
# this schema's required set ever part company.
assert "routing_integrity" in PILLAR_KEYS, (
    "scoring.WEIGHTS no longer defines 'routing_integrity' — "
    "REQUIRED_META_KEYS_FULL still requires it; reconcile the two")


def normalize_meta(meta):
    """Resolve legacy aliases; RAISE on rejected, unknown, or missing keys.

    Call this on every `meta` dict loaded from a real findings.json. A key that
    is neither canonical, optional, nor a known alias is either a typo or a
    rename this table was never updated for — both are build-time defects, not
    something to silently `.get()` past.
    """
    out = dict(meta)

    rejected = sorted(set(out) & set(REJECTED_KEYS))
    if rejected:
        detail = "; ".join(f"'{k}': {REJECTED_KEYS[k]}" for k in rejected)
        raise ValueError(
            f"findings.json meta carries key(s) that cannot be migrated automatically — {detail}")

    for legacy, canonical in LEGACY_ALIASES.items():
        if legacy in out:
            out.setdefault(canonical, out.pop(legacy))
            out.pop(legacy, None)  # canonical wins if BOTH were present

    unknown = set(out) - ALL_KNOWN_KEYS
    if unknown:
        raise ValueError(
            f"findings.json meta carries unrecognized key(s) {sorted(unknown)} — "
            f"add them to findings_schema.py's REQUIRED/OPTIONAL_META_KEYS "
            f"(or LEGACY_ALIASES if this is a rename) before they can be read")

    gated = bool(out.get("gated"))

    if gated:
        for banned in ("score", "grade", "grade_label"):
            if out.get(banned) is not None:
                raise ValueError(
                    f"findings.json meta has gated=true AND a non-null '{banned}' — a gated "
                    f"run has no health verdict by design (scoring.openpipeline_health raises "
                    f"NoCompositeError below the adoption floor). Drop the key, or drop "
                    f"gated=true if the tenant is in fact above the floor")
        scored_pillars = sorted(k for k in PILLAR_KEYS if out.get(k) is not None)
        if scored_pillars:
            raise ValueError(
                f"findings.json meta has gated=true AND scored pillar(s) {scored_pillars} — "
                f"RoutingIntegrity and StructuralHygiene are ⚪ below the floor because their "
                f"denominators are too small to mean anything; reporting them anyway is the "
                f"absence-scoring defect the gate exists to prevent")
    else:
        n = out.get("n_authored")
        if n is not None and n < scoring.ADOPTION_FLOOR:
            raise ValueError(
                f"findings.json meta reports a score with n_authored={n}, below the adoption "
                f"floor of {scoring.ADOPTION_FLOOR} — this run should be gated. A hand-authored "
                f"findings.json must not route around scoring.py's gate")
        if out.get("renormalized") is False:
            missing_pillars = sorted(PILLAR_KEYS - set(out))
            if missing_pillars:
                raise ValueError(
                    f"findings.json meta says renormalized=false but omits pillar(s) "
                    f"{missing_pillars} — either the pillar was ⚪ (set renormalized=true) "
                    f"or it was dropped by accident")

    required = REQUIRED_META_KEYS_GATED if gated else REQUIRED_META_KEYS_FULL
    missing = required - set(out)
    if missing:
        mode = "gated" if gated else "full"
        raise ValueError(
            f"findings.json meta is missing required key(s) {sorted(missing)} "
            f"for {mode} mode (needs all of {sorted(required)})")
    return out


def assemble_meta(*, window, n_authored=None, routing_integrity=None,
                  native_adoption_breadth=None, structural_hygiene=None,
                  customer=None, tenant=None, confidence_basis=None,
                  window_note=None, **findings):
    """Build the canonical meta dict via `scoring.py` — the ONE place the
    composite gets computed AND the ONE place its key names get chosen.

    Pass the pillar Score objects (or 0-100 floats, or None for ⚪) exactly as
    `scoring.openpipeline_health` takes them. When the adoption gate trips this
    returns the GATED meta rather than raising: a gated run is a legitimate
    outcome that still ships a report, so the caller should not have to catch an
    exception to write a normal deliverable.

    `**findings` accepts the un-scored, findings-side keys (capacity_pressure,
    governance_drift_families, ...). They are validated against
    OPTIONAL_META_KEYS like everything else, so a typo there fails the build
    rather than vanishing from the report.

    Returns a dict ready to drop straight into findings.json["meta"] — already
    passed through `normalize_meta()`, so a caller cannot write a findings.json
    that fails its own schema.
    """
    try:
        result = scoring.openpipeline_health(
            n_authored,
            routing_integrity=routing_integrity,
            native_adoption_breadth=native_adoption_breadth,
            structural_hygiene=structural_hygiene)
    except scoring.NoCompositeError as e:
        headline = e.as_headline()
        meta = {
            "gated": True,
            "reason": headline["reason"],
            "no_grade_reason": headline["no_grade_reason"],
            "headline_label": headline["headline_label"],
            "adoption_floor": headline["adoption_floor"],
            "window": window,
        }
        if headline["n_authored"] is not None:
            meta["n_authored"] = headline["n_authored"]
    else:
        meta = {
            "score": result["score"],
            "grade": result["grade"],
            "grade_label": result["grade_label"],
            "weights_used": result["weights_used"],
            "renormalized": result["renormalized"],
            "confidence": result["confidence"],
            "n_authored": result["n_authored"],
            "window": window,
            **result["pillars"],  # only the pillars that were assessable
        }

    for key, value in (("customer", customer), ("tenant", tenant),
                       ("confidence_basis", confidence_basis),
                       ("window_note", window_note)):
        if value is not None:
            meta[key] = value
    for key, value in findings.items():
        if value is not None:
            meta[key] = value

    return normalize_meta(meta)  # self-check before it ever reaches disk
