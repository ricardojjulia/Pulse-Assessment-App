#!/usr/bin/env python3
"""Self-tests for findings_schema.py.

Same discipline as dt-eval-prob's test_noise_findings_schema.py: each case is
either a defect this family has actually shipped, or a contract a downstream
consumer depends on. The defect being pre-empted here is the one that produced
`noise_findings_schema.py` — a pillar reaching findings.json under two spellings
and a consumer reading the stale one through a silent `.get(key, "")`, so a
rename became a blank cell in a delivered spreadsheet instead of a build failure.

Run: .venv/bin/python test_findings_schema.py
"""

import sys

import findings_schema as fs
import scoring

FULL = {
    "score": 78.8, "grade": "B", "grade_label": "Strong",
    "routing_integrity": 96.3, "native_adoption_breadth": 66.5,
    "structural_hygiene": 67.6, "n_authored": 34, "window": "7d",
    "renormalized": False,
}

GATED = {
    "gated": True, "reason": "below_adoption_floor",
    "no_grade_reason": "below the OpenPipeline adoption floor (3 customer-authored "
                       "pipeline(s), floor 5) — no health score; see the adoption finding",
    "headline_label": "OpenPipeline Adoption (configuration-only)",
    "adoption_floor": 5, "n_authored": 3, "window": "7d",
}


def _eq(got, want, what):
    assert got == want, f"{what}: got {got!r}, want {want!r}"


def _raises(fn, what, contains=None):
    try:
        fn()
    except ValueError as e:
        if contains and contains not in str(e):
            raise AssertionError(f"{what}: message {str(e)!r} lacks {contains!r}")
        return e
    raise AssertionError(f"{what}: expected ValueError, nothing raised")


# --- normalize_meta: the happy paths ----------------------------------------

def test_full_meta_round_trips():
    _eq(fs.normalize_meta(FULL), FULL, "a valid full meta must pass unchanged")


def test_gated_meta_round_trips():
    _eq(fs.normalize_meta(GATED), GATED, "a valid gated meta must pass unchanged")


def test_renormalized_run_may_omit_an_optional_pillar():
    """An access-limited run legitimately loses a pillar to ⚪."""
    meta = {k: v for k, v in FULL.items() if k != "native_adoption_breadth"}
    meta["renormalized"] = True
    assert fs.normalize_meta(meta), "a renormalized run must remain valid"


# --- The mode contradiction -------------------------------------------------

def test_gated_meta_may_not_carry_a_score():
    """The OpenPipeline analogue of dt-eval-prob's config-only-plus-effectiveness
    contradiction, and the one most likely to be hand-typed into existence: a
    gated run still produces findings, so it is tempting to give them a number."""
    _raises(lambda: fs.normalize_meta({**GATED, "score": 70.0}),
            "gated + score must raise", contains="no health verdict by design")


def test_gated_meta_may_not_carry_scored_pillars():
    """Reporting RoutingIntegrity below the floor is the absence-scoring defect
    the gate exists to prevent — the denominators are too small to mean
    anything."""
    _raises(lambda: fs.normalize_meta({**GATED, "structural_hygiene": 100.0}),
            "gated + pillar must raise", contains="absence-scoring")


def test_scored_meta_may_not_route_around_the_gate():
    """A hand-authored findings.json must not do what scoring.py refuses to."""
    _raises(lambda: fs.normalize_meta({**FULL, "n_authored": scoring.ADOPTION_FLOOR - 1}),
            "score below the floor must raise", contains="should be gated")


def test_renormalized_false_with_a_missing_pillar_raises():
    """Either the pillar was ⚪ (say so) or it was dropped by accident."""
    meta = {k: v for k, v in FULL.items() if k != "structural_hygiene"}
    _raises(lambda: fs.normalize_meta(meta),
            "renormalized=false + missing pillar must raise", contains="renormalized=false")


# --- Unknown, rejected and missing keys -------------------------------------

def test_unknown_key_raises_rather_than_being_ignored():
    """The whole point: a typo or an un-registered rename fails the build
    instead of rendering a blank cell downstream."""
    _raises(lambda: fs.normalize_meta({**FULL, "strucutral_hygiene": 60.0}),
            "typo must raise", contains="unrecognized key")


def test_inverted_rename_is_rejected_not_aliased():
    """`consolidation_opportunity` -> `structural_hygiene` INVERTED the direction
    of goodness. A silent alias would carry the number across unchanged and hand
    a badly-built tenant an excellent pillar. An alias table is only safe when a
    rename is cosmetic."""
    e = _raises(lambda: fs.normalize_meta({**FULL, "consolidation_opportunity": 20.0}),
                "inverted rename must raise", contains="inverted")
    assert "recompute" in str(e), "the message must tell the caller what to do instead"


def test_capacity_may_not_be_smuggled_in_as_a_score():
    """Soft processor/pipeline tiers are internal, adjustable and not publicly
    citable — a findings.json that scores them would put an undefendable number
    on a customer deliverable."""
    _raises(lambda: fs.normalize_meta({**FULL, "capacity_score": 55.0}),
            "capacity_score must raise", contains="never scored")


def test_capacity_is_welcome_as_a_finding():
    """The un-scored counterpart must pass — rejecting the score must not also
    reject reporting the pressure."""
    assert fs.normalize_meta({**FULL, "capacity_pressure": {"max_processors": 812}}), \
        "capacity_pressure is a legitimate findings-side key"


def test_missing_required_key_names_what_is_missing():
    meta = {k: v for k, v in FULL.items() if k != "window"}
    _raises(lambda: fs.normalize_meta(meta), "missing required key", contains="window")


def test_gated_meta_must_carry_its_reason():
    """runlog.py finalize --no-grade-reason consumes this verbatim; a gated
    headline with no explanation reads as a failed review rather than a
    finding."""
    meta = {k: v for k, v in GATED.items() if k != "no_grade_reason"}
    _raises(lambda: fs.normalize_meta(meta), "gated without reason",
            contains="no_grade_reason")


# --- Drift guards -----------------------------------------------------------

def test_hardcoded_pillar_names_track_scoring():
    """The defect this whole file exists to prevent, applied to itself.

    PILLAR_KEYS is `frozenset(scoring.WEIGHTS)`, so asserting the two are equal
    is a tautology that can never fail — it looks like coverage and is worth
    nothing. What CAN drift is the handful of places this module names a pillar
    as a literal string: REQUIRED_META_KEYS_FULL requires 'routing_integrity'
    because scoring.py refuses a composite without it, and REJECTED_KEYS names
    'structural_hygiene' in its migration advice. Rename a pillar in scoring.py
    and those strings go stale silently."""
    literals = {k for k in fs.REQUIRED_META_KEYS_FULL if k not in {
        "score", "grade", "grade_label", "n_authored", "window"}}
    unknown = literals - set(scoring.WEIGHTS)
    assert not unknown, (
        f"REQUIRED_META_KEYS_FULL names pillar(s) {sorted(unknown)} that scoring.WEIGHTS "
        f"no longer defines — reconcile the two")

    advice = fs.REJECTED_KEYS["consolidation_opportunity"]
    assert "structural_hygiene" in advice and "structural_hygiene" in scoring.WEIGHTS, \
        "the migration advice must name a pillar that still exists"


def test_every_rejected_key_explains_itself():
    for key, reason in fs.REJECTED_KEYS.items():
        assert len(reason) > 40, f"{key}: rejection must explain what to do instead"
        assert key not in fs.ALL_KNOWN_KEYS, f"{key} cannot be both rejected and known"


def test_legacy_aliases_resolve_to_real_keys():
    """Empty today, but the table must never point at a key that no longer
    exists — that would turn a compatible old file into an unknown-key error."""
    for legacy, canonical in fs.LEGACY_ALIASES.items():
        assert canonical in fs.ALL_KNOWN_KEYS, f"{legacy} -> {canonical} is not a known key"


# --- assemble_meta ----------------------------------------------------------

def test_assemble_meta_builds_a_valid_full_meta():
    meta = fs.assemble_meta(
        window="7d", n_authored=34,
        routing_integrity=scoring.routing_integrity(41, 2, 1, True),
        native_adoption_breadth=scoring.native_adoption_breadth(3, 0, 0.62),
        structural_hygiene=scoring.structural_hygiene(34, 11))
    _eq(meta["grade"], scoring.grade(meta["score"]), "grade must match the score")
    assert not meta.get("gated"), "an above-floor run is not gated"
    assert fs.normalize_meta(meta), "assemble_meta output must satisfy its own schema"


def test_assemble_meta_returns_gated_meta_instead_of_raising():
    """A gated run is a legitimate outcome that still ships a report — the caller
    should not have to catch an exception to write a normal deliverable."""
    meta = fs.assemble_meta(
        window="7d", n_authored=3,
        routing_integrity=scoring.routing_integrity(4, 0, 0, True),
        native_adoption_breadth=scoring.native_adoption_breadth(1, 0, None),
        structural_hygiene=scoring.structural_hygiene(3, 0))
    _eq(meta["gated"], True, "below the floor must produce a gated meta")
    assert "score" not in meta, "a gated meta must carry no score"
    assert meta["no_grade_reason"], "finalize needs the reason string"


def test_assemble_meta_rejects_a_typo_in_the_findings_kwargs():
    """**findings is convenient and therefore dangerous — a typo there must fail
    the build rather than vanish from the report."""
    _raises(lambda: fs.assemble_meta(
        window="7d", n_authored=34,
        routing_integrity=90.0, native_adoption_breadth=70.0, structural_hygiene=70.0,
        capacity_presure={"max": 1}), "typo in findings kwargs", contains="unrecognized key")


def test_assemble_meta_omits_an_unassessable_pillar_and_flags_it():
    meta = fs.assemble_meta(
        window="7d", n_authored=34,
        routing_integrity=90.0, native_adoption_breadth=None, structural_hygiene=70.0)
    assert "native_adoption_breadth" not in meta, "⚪ pillar must not appear"
    _eq(meta["renormalized"], True, "a dropped pillar must be flagged")


# --- output-spec.md ---------------------------------------------------------

def test_output_spec_documents_every_required_key():
    """output-spec.md is what a report author reads to know what findings.json
    must contain. A required key added here but not documented there is one the
    author discovers by hitting the schema's error at build time."""
    from pathlib import Path
    spec = Path(__file__).resolve().parent / "output-spec.md"
    section = spec.read_text().split("## `findings.json`")
    assert len(section) == 2, "output-spec.md has no findings.json section"
    body = section[1]
    for mode, keys in (("full", fs.REQUIRED_META_KEYS_FULL),
                       ("gated", fs.REQUIRED_META_KEYS_GATED)):
        missing = sorted(k for k in keys if f"`{k}`" not in body)
        assert not missing, f"output-spec.md omits {mode}-mode required key(s) {missing}"


def test_gated_meta_carries_the_cover_scale_measurements():
    """routing_entries and signal_types_covered are MEASUREMENTS, so they live in
    meta beside n_authored — including on a gated run.

    The builder used to read them from the hand-authored content file, whose
    schema never documented them, so every cover rendered "0 routing entries ·
    0 of 8 signal-type scopes" unless its author guessed at an undocumented key.
    A gated report is exactly the one that still has to state the estate size.
    """
    meta = fs.assemble_meta(
        window="7d", n_authored=None, routing_entries=1, signal_types_covered=2,
        customer="Acme Corp", tenant="abc12345",
        diagnosis="dtctl_cannot_read_this_surface")
    assert meta.get("gated") is True, meta
    assert meta["routing_entries"] == 1, meta
    assert meta["signal_types_covered"] == 2, meta


def test_scale_measurements_survive_an_ungated_run_too():
    meta = fs.assemble_meta(
        window="7d", n_authored=12, routing_integrity=100.0,
        native_adoption_breadth=80.0, structural_hygiene=90.0,
        routing_entries=9, signal_types_covered=3,
        customer="Acme Corp", tenant="abc12345")
    assert meta["routing_entries"] == 9, meta
    assert meta["signal_types_covered"] == 3, meta


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    sys.exit(1 if failures else 0)
