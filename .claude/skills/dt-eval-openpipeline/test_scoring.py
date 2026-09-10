#!/usr/bin/env python3
"""Self-tests for scoring.py — the OpenPipeline Health composite.

Every case here is either a defect this design actually shipped and had to fix,
or a contract another file depends on. The two that matter most:

  * **The v1.0 inversion.** The original composite (0.35*R + 0.30*N + 0.35*C,
    ungated, orphans double-counted) floored a zero-adoption tenant at 70.0 =
    "B — Strong" while an invested tenant with real defects scored 60.2 = "C".
    Two of three pillars were absence-scored, so having built nothing scored as
    having nothing wrong. `test_gate_*` and `test_invested_*` keep that shut.

  * **The catch-all free-credit defect**, which was the same mistake one level
    down: a weight-3 catch-all check inside RoutingIntegrity handed 60% of the
    pillar to a Gen3 platform default, so a tenant whose EVERY routing entry was
    dangling still scored 60.0. `test_catch_all_*` keeps that shut. The general
    rule these encode: **a check whose ✅ state is the platform default earns
    nothing; only its absence may move a score.**

Run: .venv/bin/python test_scoring.py
"""

import io
import contextlib
import argparse
import sys
from pathlib import Path

import scoring as s

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "dt-eval-prob"))


def _eq(got, want, what):
    assert got == want, f"{what}: got {got!r}, want {want!r}"


def _raises(exc, fn, what, contains=None):
    try:
        fn()
    except exc as e:
        if contains and contains not in str(e):
            raise AssertionError(f"{what}: message {str(e)!r} lacks {contains!r}")
        return e
    raise AssertionError(f"{what}: expected {exc.__name__}, nothing raised")


# A healthy mid-size tenant, well above the adoption floor. Pillar helpers are
# used rather than raw floats so the tests exercise the real seams.
def _healthy(**over):
    kw = dict(n_authored=40, routing_entries=48, dangling=0, shadowed=0,
              catch_all=True, covered=6, pending=0, masking=0.9, affected=0)
    kw.update(over)
    return s.openpipeline_health(
        kw["n_authored"],
        routing_integrity=s.routing_integrity(kw["routing_entries"], kw["dangling"],
                                              kw["shadowed"], kw["catch_all"]),
        native_adoption_breadth=s.native_adoption_breadth(kw["covered"], kw["pending"],
                                                          kw["masking"]),
        structural_hygiene=s.structural_hygiene(kw["n_authored"], kw["affected"]))


# --- The adoption gate ------------------------------------------------------

def test_gate_null_tenant_has_no_composite():
    """The v1.0 headline defect: a tenant with no OpenPipeline configuration
    must not receive a score at all, let alone a passing one."""
    e = _raises(s.NoCompositeError,
                lambda: s.openpipeline_health(0, routing_integrity=100.0,
                                              native_adoption_breadth=0.0,
                                              structural_hygiene=100.0),
                "null tenant must be gated")
    _eq(e.reason, "below_adoption_floor", "gate reason")


def test_gate_unreadable_inventory_is_distinct_from_below_floor():
    """A22 unreadable is 'we could not assess this', not 'the tenant is small'.
    The two produce different customer-facing sentences, so they are different
    machine reasons."""
    e = _raises(s.NoCompositeError, lambda: s.openpipeline_health(None),
                "unknown inventory must be gated")
    _eq(e.reason, "adoption_not_assessable", "gate reason")


def test_gate_boundary_is_exactly_the_floor():
    below = _raises(s.NoCompositeError, lambda: _healthy(n_authored=s.ADOPTION_FLOOR - 1,
                                                         routing_entries=4),
                    "one below the floor must be gated")
    _eq(below.reason, "below_adoption_floor", "gate reason")
    at = _healthy(n_authored=s.ADOPTION_FLOOR, routing_entries=6)
    assert at["score"] is not None, "at the floor a composite must exist"


def test_gated_headline_reports_null_never_zero():
    """O2's rollup contract: a gated tenant is 'not applicable yet'. Rendering it
    as 0 would put it below every scored tenant in the dashboard column."""
    e = _raises(s.NoCompositeError, lambda: s.openpipeline_health(1),
                "below floor")
    h = e.as_headline()
    _eq(h["score"], None, "gated score")
    _eq(h["grade"], None, "gated grade")
    assert h["no_grade_reason"], "finalize needs a non-empty --no-grade-reason string"
    assert h["headline_label"] == "OpenPipeline Adoption (configuration-only)", \
        "gated cover headline"
    assert h["adoption_floor"] == s.ADOPTION_FLOOR, "floor must be reported, not implied"


def test_gate_is_not_renormalized_past():
    """A gated run has no composite to renormalize — the refusal must win even
    when every pillar happens to be present and perfect."""
    _raises(s.NoCompositeError,
            lambda: s.openpipeline_health(2, routing_integrity=100.0,
                                          native_adoption_breadth=100.0,
                                          structural_hygiene=100.0),
            "perfect pillars must not defeat the gate")


# --- The v1.0 inversion -----------------------------------------------------

def test_invested_tenant_outranks_minimal_adopter():
    """Monotonicity against investment. If a tenant that adopted less — and so
    has fewer defects to find — can outrank one that adopted more, a pillar is
    still absence-scored."""
    light = _healthy(n_authored=6, routing_entries=6, covered=1, pending=None,
                     masking=None, affected=0)
    heavy = _healthy(n_authored=60, routing_entries=72, dangling=3, shadowed=1,
                     covered=6, masking=0.8, affected=9)
    assert heavy["score"] > light["score"], \
        f"invested {heavy['score']} must outrank minimal {light['score']}"


def test_remediation_raises_the_score():
    before = _healthy(n_authored=60, routing_entries=72, dangling=3, affected=9)
    after = _healthy(n_authored=60, routing_entries=72, dangling=0, affected=4)
    assert after["score"] > before["score"], \
        f"fixing defects must move the score up ({before['score']} -> {after['score']})"


def test_scoring_is_reproducible():
    """Same evidence, same number — run-over-run and analyst-to-analyst."""
    _eq(_healthy(n_authored=60, routing_entries=72, dangling=3, affected=9),
        _healthy(n_authored=60, routing_entries=72, dangling=3, affected=9),
        "identical inputs must give an identical result")


def test_every_pillar_is_monotonic_in_its_defects():
    """Direction of goodness, checked rather than described — the failure
    scoring_engine.wos_composite's docstring exists to memorialize."""
    base = _healthy(n_authored=40, routing_entries=48, dangling=0, shadowed=0,
                    covered=8, affected=0)["score"]
    for label, worse in (
        ("dangling entries", _healthy(n_authored=40, routing_entries=48, dangling=6,
                                      covered=8, affected=0)),
        ("shadowed entries", _healthy(n_authored=40, routing_entries=48, shadowed=6,
                                      covered=8, affected=0)),
        ("narrower breadth", _healthy(n_authored=40, routing_entries=48, covered=2,
                                      affected=0)),
        ("affected pipelines", _healthy(n_authored=40, routing_entries=48, covered=8,
                                        affected=12)),
    ):
        assert worse["score"] < base, f"more {label} must lower the score"


# --- The catch-all asymmetry ------------------------------------------------

def test_catch_all_presence_earns_no_credit():
    """A catch-all is present by default on any Gen3 tenant. Scoring its presence
    is scoring the absence of work — it let a tenant with every routing entry
    dangling score RoutingIntegrity 60.0."""
    _eq(s.routing_integrity(72, 72, 72, True).value, 0.0,
        "every entry broken must score 0 regardless of the catch-all")


def test_catch_all_absence_caps_into_the_d_band():
    r = s.routing_integrity(72, 0, 0, False)
    assert r.value <= s.CATCH_ALL_UNMEASURED_CAP, \
        f"a missing catch-all with no measured share must cap conservatively, got {r.value}"
    _eq(s.grade(r.value), "D", "capped pillar lands in the D band")
    assert "catch-all" in (r.notes or ""), \
        "the cap must explain itself — the report has to tell the customer why"


def test_catch_all_penalty_scales_with_the_measured_share():
    """The recalibration (2026-08-10). A flat cap moved a live tenant a full grade
    band for a 0.027% fall-through — a penalty that size for a harm that size is a
    miscalibration, not a judgment call. Presence must still earn nothing."""
    tiny = s.routing_integrity(72, 0, 0, False, fall_through_pct=0.027).value
    mid = s.routing_integrity(72, 0, 0, False, fall_through_pct=10.0).value
    huge = s.routing_integrity(72, 0, 0, False, fall_through_pct=90.0).value
    assert tiny > mid > huge, f"penalty must scale: {tiny} > {mid} > {huge}"
    assert huge >= s.CATCH_ALL_MIN_CAP - 1e-9, "the floor must hold"
    # Not measuring must never beat measuring — otherwise the incentive inverts.
    unmeasured = s.routing_integrity(72, 0, 0, False).value
    assert unmeasured <= tiny, "an unmeasured share must not outscore a measured small one"
    # And presence still earns nothing.
    assert s.routing_integrity(72, 72, 72, True, fall_through_pct=0.0).value == 0.0


def test_a_zero_share_is_not_the_same_as_an_unmeasured_one():
    """Passing 0 for 'we did not measure' would claim a measured-and-perfect result
    and earn the lightest penalty for the least evidence."""
    assert (s.routing_integrity(72, 0, 0, False, fall_through_pct=0.0).value
            > s.routing_integrity(72, 0, 0, False).value)
    _raises(ValueError, lambda: s.routing_integrity(72, 0, 0, False, fall_through_pct=101.0),
            "out-of-range share")


def test_catch_all_absence_never_raises_a_worse_score():
    """The cap is a min(), not an assignment: a table that already scores below
    the cap must not be lifted to it."""
    assert s.routing_integrity(72, 72, 72, False).value == 0.0, \
        "the cap must not raise a worse pillar"


# --- Count-once (the double-count the v1.0 draft shipped) -------------------

def test_summed_per_defect_counts_are_rejected():
    """`affected_pipelines` is a DISTINCT set length. Summing per-defect counts is
    how orphans got charged to two pillars at 0.70 combined weight, and it can
    drive the share above 1.0 — a hard error, never a silent clamp."""
    e = _raises(ValueError, lambda: s.structural_hygiene(10, 14),
                "affected > authored must raise", contains="DISTINCT")
    assert "sum of per-defect counts" in str(e), \
        "the message must tell the caller what they did wrong"


def test_hygiene_weights_by_configured_processing():
    """The second defect the first live run found. Counting pipelines cannot tell a
    trivial defect from a serious one: two orphans of thirty scored 93.3 whether
    they were empty shells or the PII-isolation pair carrying a fifth of the
    estate's processing."""
    unweighted = s.structural_hygiene(30, 2).value
    weighted = s.structural_hygiene(30, 2, affected_weight=1347, total_weight=6368).value
    assert weighted < unweighted, (
        f"substantial disconnected configuration must score worse than a bare count "
        f"suggests: weighted {weighted} vs unweighted {unweighted}")
    # ...and a trivial defect must score BETTER than the bare count suggests.
    trivial = s.structural_hygiene(30, 2, affected_weight=4, total_weight=6368).value
    assert trivial > unweighted, "two empty shells must not read like two big pipelines"


def test_hygiene_weight_floor_keeps_routing_only_orphans_visible():
    """A routing-only pipeline legitimately has zero processors. Without a floor of
    1 per pipeline it would weigh nothing and an orphaned one would vanish from the
    arithmetic entirely — config debt that scores as clean."""
    # Caller applies max(1, processors); this asserts the arithmetic honours it.
    v = s.structural_hygiene(10, 1, affected_weight=1, total_weight=10).value
    assert v < 100.0, "an orphaned routing-only pipeline must still cost something"


def test_hygiene_rejects_incoherent_weights():
    _raises(ValueError, lambda: s.structural_hygiene(30, 2, affected_weight=99,
                                                     total_weight=10),
            "affected weight above total")
    _raises(ValueError, lambda: s.structural_hygiene(30, 2, affected_weight=1,
                                                     total_weight=0),
            "zero total weight")


def test_all_pipelines_affected_scores_zero():
    _eq(s.structural_hygiene(10, 10).value, 0.0, "every pipeline affected")


# --- ⚪ handling and required pillars ---------------------------------------

def test_unreadable_routing_table_is_none_not_zero():
    """⚪ is excluded from the denominator, never scored 0 — reporting 'we could
    not read this' as 'your configuration is broken' is the failure mode."""
    _eq(s.routing_integrity(0, 0, 0, True), None, "no routing entries")
    _eq(s.routing_integrity(48, 0, 0, None), None, "catch-all unreadable")
    _eq(s.structural_hygiene(0, 0), None, "no authored pipelines")


def test_unreadable_a29_degrades_gracefully():
    """A29 can 500 or permission-error. That drops one check, never the pillar."""
    n = s.native_adoption_breadth(4, None, 0.5)
    assert n is not None, "A29 being unreadable must not void the pillar"
    assert n.confidence.value in ("Low", "Medium"), \
        "a dropped check must cost confidence, not be silently absorbed"


def test_routing_integrity_is_required_above_the_floor():
    """An unreadable routing table means there is nothing to review. A composite
    carried by the other two pillars would imply otherwise."""
    _raises(ValueError,
            lambda: s.openpipeline_health(40, routing_integrity=None,
                                          native_adoption_breadth=80.0,
                                          structural_hygiene=80.0),
            "missing routing pillar must refuse", contains="required")


def test_missing_optional_pillar_renormalizes_and_flags():
    out = s.openpipeline_health(40, routing_integrity=90.0,
                                native_adoption_breadth=None, structural_hygiene=60.0)
    assert out["renormalized"] is True, "a dropped pillar must be flagged"
    assert "native_adoption_breadth" not in out["pillars"], "⚪ pillar must not appear"
    _eq(round(sum(out["weights_used"].values()), 6), 1.0, "reweighted weights sum to 1")
    _eq(out["weights_used"]["routing_integrity"], round(0.40 / 0.70, 4), "reweighted share")


def test_confidence_inherits_the_weakest_pillar():
    """Three pillars present is not evidence of a strong sample. Without
    inheriting the minimum, a composite resting on a handful of pipelines
    reported High."""
    small = _healthy(n_authored=6, routing_entries=6, covered=6)
    _eq(small["confidence"], "Low", "a small estate must not read High")


# --- Cross-module contracts -------------------------------------------------

def test_weights_sum_to_one():
    _eq(round(sum(s.WEIGHTS.values()), 6), 1.0, "declared weights")


def test_grade_bands_match_the_family():
    for score, want in ((100, "A"), (85, "A"), (84.9, "B"), (70, "B"),
                        (69.9, "C"), (50, "C"), (49.9, "D"), (0, "D")):
        _eq(s.grade(score), want, f"band at {score}")


def test_grade_labels_are_client_facing_and_in_lockstep():
    """The label routes straight onto the report cover. noise_scoring's copy of
    this map blended external A/B with internal C/D vocabulary until v1.17.36,
    so a tenant below 70 got internal diagnostic language on a client
    deliverable. Both maps must stay identical."""
    import noise_scoring
    _eq(s.GRADE_LABELS, noise_scoring.GRADE_LABELS,
        "grade labels must match dt-eval-prob's exactly")


def test_shipped_self_test_still_passes():
    """scoring.py --self-test is the spec's acceptance criteria. If it drifts
    from green, the design regressed even when these unit tests pass."""
    with contextlib.redirect_stdout(io.StringIO()):
        rc = s.self_test()
    _eq(rc, 0, "shipped --self-test exit code")


# --- pipeline-ruleset.json --------------------------------------------------
#
# The ruleset's own meta declares "scoring.py is the executable authority; where
# the two disagree, scoring.py is right and this file is the bug." These tests
# are what makes that claim true instead of aspirational — the two files
# duplicate the signal-type family and the catch-all cap, and a hand-authored
# JSON has no compiler to notice when one side moves.

def _ruleset():
    import json
    return json.loads((HERE / "pipeline-ruleset.json").read_text())


def test_ruleset_parses_with_unique_ids():
    rules = _ruleset()["rules"]
    ids = [r["id"] for r in rules]
    _eq(len(ids), len(set(ids)), "rule ids must be unique")
    assert rules, "ruleset must not be empty"


def test_every_rule_declares_scored():
    """The arithmetic/narrative seam is structural, not prose. A rule with no
    `scored` field is one a maintainer has to guess about — which is how
    adjustable limits and possibly-intentional configuration reached the
    v1.0 arithmetic."""
    for r in _ruleset()["rules"]:
        assert isinstance(r.get("scored"), bool), f"{r['id']}: `scored` must be a bool"


def test_scored_rules_name_a_real_pillar():
    for r in _ruleset()["rules"]:
        if not r["scored"]:
            continue
        target = r.get("pillar")
        if target is None:  # filters/gates declare applies_to instead
            assert r.get("applies_to"), f"{r['id']}: scored rule needs pillar or applies_to"
            continue
        assert target in s.WEIGHTS, f"{r['id']}: unknown pillar {target!r}"


def test_unscored_rules_say_why_not():
    """A `scored: false` with no reason reads as an oversight, and the next
    maintainer promotes it."""
    for r in _ruleset()["rules"]:
        if r["scored"]:
            continue
        assert r.get("reason_not_scored") or r.get("use"), \
            f"{r['id']}: unscored rules must carry reason_not_scored or use"


def test_catch_all_cap_matches_scoring():
    rule = next(r for r in _ruleset()["rules"] if r["id"] == "catch-all-matcher")
    _eq(rule["absent_cap_unmeasured"], s.CATCH_ALL_UNMEASURED_CAP,
        "unmeasured catch-all cap must not drift")
    _eq(rule["unchosen_penalty"], s.CATCH_ALL_UNCHOSEN_PENALTY,
        "the fixed latent-risk component must not drift")
    _eq(rule["present_credit"], 0, "presence must never earn credit")


def test_signal_type_family_matches_scoring():
    rule = next(r for r in _ruleset()["rules"] if r["id"] == "signal-type-family")
    _eq(tuple(rule["family"]), s.SIGNAL_TYPES, "signal-type family must not drift")


def test_capacity_tiers_stay_unconfirmed_until_confirmed():
    """Guards the one place an invented number would do real damage: internal
    soft-limit tiers are adjustable and not publicly citable, so a hardcoded
    value that nobody confirmed is worse than a null."""
    rule = next(r for r in _ruleset()["rules"] if r["id"] == "pipeline-capacity-soft-limits")
    _eq(rule["scored"], False, "capacity must never be scored")
    tiers = rule["internal_tiers"]
    if tiers.get("pending_confirmation"):
        for limit, bands in tiers.items():
            if not isinstance(bands, dict):
                continue
            assert all(v is None for v in bands.values()), \
                f"{limit}: values recorded while still pending_confirmation — confirm first, then clear the flag"
    assert rule["citable_public_figures"]["source"].startswith("https://docs.dynatrace.com"), \
        "the citable figure must point at public docs"


def test_confirmation_gated_rules_are_not_scored_by_default():
    """Governance drift and near-duplicate families may both be deliberate
    configuration. Scoring either blind penalizes a tenant for being right."""
    for rid in ("governance-drift", "near-duplicate-family"):
        r = next(x for x in _ruleset()["rules"] if x["id"] == rid)
        _eq(r["scored"], False, f"{rid} must not be scored by default")
        _eq(r["scored_after_confirmation"], True, f"{rid} must be promotable on confirmation")
        assert r.get("severity_cap") == "opportunity", f"{rid} caps at 💡, never ⚠️"


def test_orphans_are_scored_in_one_pillar_only():
    """The v1.0 double-count: orphans charged to RoutingIntegrity and to the
    hygiene pillar, one measurement across 0.70 of the composite."""
    orphan = next(r for r in _ruleset()["rules"] if r["id"] == "unrouted-orphan")
    _eq(orphan["pillar"], "structural_hygiene", "orphans belong to hygiene alone")
    routing = [r["id"] for r in _ruleset()["rules"]
               if r["scored"] and r.get("pillar") == "routing_integrity"]
    assert "unrouted-orphan" not in routing, "orphans must not also score routing"


# --- scoring.md -------------------------------------------------------------
#
# scoring.md is the rubric a reader reaches for when they want to know how the
# number was made. A prose formula that has drifted from the code is the exact
# defect scoring_engine.wos_composite's docstring memorializes — two defensible
# readings of one KPI moved a live pillar across part of a grade band.

def _rubric():
    return (HERE / "scoring.md").read_text()


def _stated_weights(text, marker, where):
    """Pull the weights out of a prose formula line. Reports a readable failure
    when the line is gone entirely — a bare StopIteration tells a maintainer
    nothing, and this is exactly the test they will meet after an edit."""
    import re
    line = next((ln for ln in text.splitlines() if marker in ln), None)
    assert line is not None, f"{where}: no formula line containing {marker!r} — was it reworded?"
    return sorted(float(x) for x in re.findall(r"0\.\d\d", line))


def test_rubric_states_the_real_weights():
    _eq(_stated_weights(_rubric(), "Health = ", "scoring.md"),
        sorted(s.WEIGHTS.values()), "scoring.md's formula must match WEIGHTS")


def test_rubric_states_the_real_constants():
    md = _rubric()
    assert f"ADOPTION_FLOOR = {s.ADOPTION_FLOOR}" in md, \
        "scoring.md must state the floor actually in force"
    assert f"max(40, 100 \u2212 5 \u2212 fall_through_pct)".replace("40", f"{s.CATCH_ALL_MIN_CAP:.0f}") \
        .replace("5", f"{s.CATCH_ALL_UNCHOSEN_PENALTY:.0f}") in md, \
        "scoring.md must state the catch-all cap formula actually in force"
    assert f"conservative cap of {s.CATCH_ALL_UNMEASURED_CAP:.0f}" in md, \
        "scoring.md must state the unmeasured-share cap actually in force"


def test_rubric_carries_the_hard_rules():
    """These are the rules a report author reads instead of the code. Losing one
    in an edit is silent — nothing downstream fails."""
    md = _rubric()
    for phrase in (
        "never \"scored 0\"",                      # a gated tenant is not a zero
        "earns nothing",                           # the platform-default rule
        "counts once",                             # the double-count guard
        "minimum",                                 # confidence inheritance
        "R is required above the floor",           # the required pillar
    ):
        assert phrase in md, f"scoring.md must state: {phrase!r}"


def test_rubric_lists_every_unscored_rule():
    """Anything the ruleset marks `scored: false` must be visible in the rubric's
    'Deliberately outside the arithmetic' section, or a reader will assume it
    counts."""
    import json
    md = _rubric().split("## Deliberately outside the arithmetic")[1].split("\n## ")[0]
    ruleset = json.loads((HERE / "pipeline-ruleset.json").read_text())
    # Collection-discipline and ordering rules are not scoring exclusions.
    exempt = {"schema-read-discipline", "canonical-survivor-selection"}
    keywords = {
        "pipeline-capacity-soft-limits": "Capacity pressure",
        "governance-drift": "Governance drift",
        "near-duplicate-family": "Near-duplicate family",
        "a21-a22-overlap-sanity": "zero ID-overlap",
        "throughput-context-only": "throughput",
    }
    for rule in ruleset["rules"]:
        if rule["scored"] or rule["id"] in exempt:
            continue
        needle = keywords.get(rule["id"])
        assert needle, f"{rule['id']}: unscored rule has no keyword mapped in this test"
        assert needle in md, f"{rule['id']}: not listed in scoring.md's exclusions"


# --- SKILL.md ---------------------------------------------------------------
#
# The runbook is what an analyst follows at 4pm on a Friday. Three of its claims
# are load-bearing enough that drift is silent and expensive.

def _runbook():
    return (HERE / "SKILL.md").read_text()


def test_runbook_frontmatter_names_this_skill():
    md = _runbook()
    assert md.startswith("---\n"), "SKILL.md needs YAML frontmatter"
    front = md.split("---", 2)[1]
    assert f"name: {HERE.name}" in front, f"frontmatter name must be {HERE.name}"
    assert "description:" in front, "frontmatter needs a description for the skill listing"


def test_runbook_states_the_real_formula():
    _eq(_stated_weights(_runbook(), "·R + ", "SKILL.md"),
        sorted(s.WEIGHTS.values()), "SKILL.md's formula must match WEIGHTS")


def test_runbook_scope_list_matches_the_signal_family():
    """The runbook tells the analyst which scopes to collect. If it drifts from
    SIGNAL_TYPES the breadth pillar is computed over a different denominator
    than the one that was collected."""
    md = _runbook()
    line = next(ln for ln in md.splitlines()
                if "default **all** OpenPipeline data-type scopes" in ln)
    for scope in s.SIGNAL_TYPES:
        assert f"`{scope}`" in line, f"SKILL.md's scope list omits {scope!r}"


def test_runbook_pins_the_rollup_filename_stem():
    """dt-eval-rollup's SKILLS registry matches reports on this stem. A rename
    drops this skill's column from the dashboard with no error anywhere."""
    md = _runbook()
    assert "<tenantId>-OpenPipeline-<YYYY-MM-DD>(vN)" in md, \
        "SKILL.md must pin the OpenPipeline filename stem the rollup matches on"
    assert "--skill openpipeline" in md, "SKILL.md must document the finalize namespace flag"


def test_every_local_probe_id_is_covered_by_the_hygiene_scanner():
    """Every `OP-*` identifier this skill uses must be in `_PROBE_ID`'s named
    whitelist, or a leak of that ID into customer-facing prose goes uncaught —
    the RUN_STATE leak class.

    Closed 2026-08-10 (spec O6) after validating the pattern against the full
    delivered corpus. This is the guard that keeps it closed: add a twelfth
    `OP-*` probe without adding it to the scanner and this fails, which is
    exactly when the omission is cheap to fix.

    Reads the regex as text rather than importing verify_docx, which pulls in
    python-docx — this suite stays stdlib-only.
    """
    import re
    scanner = (HERE.parent / ".dt-eval-common" / "verify_docx.py").read_text()
    block = re.search(r"_PROBE_ID = \((.*?)\n\)", scanner, re.S)
    assert block, "could not locate _PROBE_ID in verify_docx.py — did it move?"
    whitelist = block.group(1)
    assert "OP-" in whitelist, (
        "OP-* local IDs are no longer covered by the hygiene scanner — a leaked "
        "identifier would reach a client deliverable uncaught (spec O6)")

    # Every ID named in the runbook's alias table must appear in the whitelist.
    aliased = set(re.findall(r"^\s*\| `OP-([a-z-]+)` \|", _runbook(), re.M))
    assert aliased, "SKILL.md's alias table parsed as empty — did its shape change?"
    missing = sorted(n for n in aliased if n not in whitelist)
    assert not missing, (
        f"probe(s) {missing} are in SKILL.md's alias table but not in "
        f"verify_docx.py's OP- whitelist — a leak of those IDs is not caught")

    # Named alternatives only. A wildcard here is what turned the old unanchored
    # EC\\d+ pattern into nine delivered documents' worth of false positives.
    assert r"OP-(?:" in whitelist and r"OP-\w" not in whitelist, \
        "the OP- entry must be a named alternation, never a wildcard"


def test_probes_doc_defines_every_aliased_probe():
    """A probe named in SKILL.md's alias table but with no recipe in probes.md
    is one an analyst will improvise — which is exactly how a verified gotcha
    gets re-derived wrongly."""
    import re
    aliased = set(re.findall(r"^\s*\| `(OP-[a-z-]+)` \|", _runbook(), re.M))
    assert aliased, "SKILL.md's alias table parsed as empty — did its shape change?"
    probes = (HERE / "probes.md").read_text()
    missing = {p for p in aliased if f"### {p} " not in probes}
    assert not missing, f"probes.md has no recipe for {sorted(missing)}"


def test_runbook_alias_table_covers_every_ruleset_probe():
    """The alias table is how a run avoids re-billing a probe the tenant skill
    already cached. A probe the ruleset depends on but the table omits gets
    silently re-collected."""
    import json
    ruleset = json.loads((HERE / "pipeline-ruleset.json").read_text())
    md = _runbook()
    needed = {p.split()[0] for r in ruleset["rules"]
              for p in r.get("derived_from", {}).get("probes", [])}
    missing = {p for p in needed if f"| {p} |" not in md}
    assert not missing, f"SKILL.md's alias table omits probe(s) {sorted(missing)}"


# --- Input validation -------------------------------------------------------

def test_out_of_range_inputs_raise():
    _raises(ValueError, lambda: s.routing_integrity(10, 11, 0, True), "dangling > total")
    _raises(ValueError, lambda: s.native_adoption_breadth(99, 0, 0.5), "covered > total")
    _raises(ValueError, lambda: s.native_adoption_breadth(4, 0, 1.5), "masking > 1")
    _raises(ValueError, lambda: s.openpipeline_health(40, routing_integrity=101.0),
            "pillar above 100")


def test_not_assessable_sentinel_parses_to_none():
    """The CLI spelling of "could not read it" must reach the library's None.

    Regression: `--n-authored` was type=int on BOTH CLIs, so the documented
    adoption_not_assessable gate was reachable only by importing the library and
    calling assemble_meta() by hand — which is what a live run had to do.
    """
    assert s.n_authored_arg(s.NOT_ASSESSABLE) is None, \
        "the sentinel must parse to None, which is what raises the gate"
    assert s.n_authored_arg("30") == 30
    assert s.n_authored_arg("0") == 0, "zero is a real count, not the sentinel"


def test_zero_is_not_the_sentinel():
    """0 and not-assessable are DIFFERENT findings and must not collapse.

    0 says "we looked and there are none" -> below_adoption_floor.
    None says "we could not look"          -> adoption_not_assessable.
    Spelling the second as the first is the inversion this whole gate exists to
    avoid: it tells a tenant with working pipelines that it has built nothing.
    """
    try:
        s.openpipeline_health(0, routing_integrity=50.0)
    except s.NoCompositeError as e:
        assert e.reason == "below_adoption_floor", e.reason
    else:
        raise AssertionError("n_authored=0 must gate")

    try:
        s.openpipeline_health(s.n_authored_arg(s.NOT_ASSESSABLE), routing_integrity=50.0)
    except s.NoCompositeError as e:
        assert e.reason == "adoption_not_assessable", e.reason
        assert e.as_headline()["n_authored"] is None, \
            "a not-assessable headline must not report a count it does not have"
    else:
        raise AssertionError("the sentinel must gate")


def test_bad_n_authored_says_what_to_pass_instead():
    """The error has to name the sentinel, or the operator reaches for 0."""
    import argparse
    for bad in ("banana", "-1", ""):
        try:
            s.n_authored_arg(bad)
        except argparse.ArgumentTypeError as e:
            if bad != "-1":
                assert s.NOT_ASSESSABLE in str(e), f"error for {bad!r} must name the sentinel"
        else:
            raise AssertionError(f"{bad!r} should not parse")


# --- the ⚪ state has to be SAYABLE, not just omittable (2026-08-26) -------
#
# v1.37.0 gave --n-authored the NOT_ASSESSABLE sentinel because the gate it feeds
# was documented and unreachable from the CLI. The same shape sits on every flag
# whose help says "OMIT when not assessable, never pass 0": omission does produce
# the right None, but there is nothing to TYPE, so a caller reaching for ⚪ finds
# no way to express it and tries the obvious empty string.
#
# That is not hypothetical for --classic-pending: the CLI verb behind it was
# removed in dtctl 0.38.0, so its read is now ⚪ on every tenant and the
# undiscoverable path became the only correct one.


def test_not_assessable_arg_accepts_the_literal():
    parse = s.not_assessable_arg(int, "an integer")
    assert parse(s.NOT_ASSESSABLE) is None, "the literal means None"
    assert parse("7") == 7, "and an ordinary value still parses"


def test_not_assessable_arg_message_says_what_to_type():
    """The old failure was `invalid int value: ''` — true, and useless."""
    parse = s.not_assessable_arg(int, "an integer")
    try:
        parse("")
    except argparse.ArgumentTypeError as e:
        msg = str(e)
        assert s.NOT_ASSESSABLE in msg, f"the message must name the sentinel: {msg}"
        assert "do NOT pass 0" in msg, f"and keep the zero warning: {msg}"
        return
    raise AssertionError("an unparseable value must raise")


def test_float_variant_parses_shares():
    parse = s.not_assessable_arg(float, "a 0-1 share")
    assert parse("0.62") == 0.62
    assert parse(s.NOT_ASSESSABLE) is None


def test_sentinel_and_omission_are_the_same_answer():
    """The invariant that makes this safe to add: saying ⚪ out loud and leaving
    the flag off must reach scoring identically, or the new spelling is a second
    behaviour rather than a second spelling."""
    said = s.native_adoption_breadth(3, s.not_assessable_arg(int)(
        s.NOT_ASSESSABLE), None)
    omitted = s.native_adoption_breadth(3, None, None)
    _eq(said.value, omitted.value, "sentinel and omission score identically")


def test_zero_is_still_a_measured_answer():
    """The distinction the sentinel protects: 0 means 'looked, found none'."""
    measured_none = s.native_adoption_breadth(3, 0, None)
    not_looked = s.native_adoption_breadth(3, None, None)
    assert measured_none.value != not_looked.value, \
        "0 and not-assessable must not score alike — that collapse is what the "\
        "sentinel exists to keep visible"


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
