#!/usr/bin/env python3
"""Self-tests for the OpenPipeline report helpers — the gated cover notice.

The notice is the first sentence a customer reads on a gated report, and it has
been wrong twice in the same place, both times by describing the WRONG CAUSE:

  2026-08-25  `gated_notice` took no `reason`, so the below-floor sentence
              ("this tenant has not yet built enough") rendered on the
              not-assessable gate too. Two tenants moving 16.3B and 82.5B records
              through working pipelines would have been told they had built
              nothing. Fixed by branching on `reason`.

  2026-08-26  the not-assessable sentence said the configuration "could not be
              read with the access available for this review". v1.37.0 had
              already established that the usual cause is a TOOLING gap -- dtctl
              reads the settings-object API, the app reads
              /platform/openpipeline/v1/configurations/<scope>, and dtctl
              implements no verb for it -- so a permission grant changes nothing
              and the same user opens the pipelines in the browser.
              `diagnose_pipelines.py`'s `remedy` field was corrected and a test
              pinned it; the cover kept sending customers to raise grant requests
              that could not help. Fixed by branching on `diagnosis`.

Both fixes are one-line-reversible, which is why they are asserted here rather
than trusted to review. The shape of every case below is: does the sentence claim
the cause the evidence actually supports?

Run: .venv/bin/python test_report_helpers.py
"""

import sys

import report_helpers as rh

# Phrases that CLAIM the customer's access is what is missing. Deliberately
# phrases and not bare words: the tooling-gap notice has to say "no permission
# change is needed", so a sweep for "permission" flags the sentence for
# containing its own denial. The test must assert the CLAIM, not the vocabulary
# — the first cut of this file failed the correct wording for saying the right
# thing, which is exactly the false-positive discipline redact.py's rule 1
# documents for a different scanner.
ACCESS_CLAIMS = (
    "access available for this review",
    "insufficient",
    "not authorized",
    "additional access",
    "permission change is required",
    "requires a permission",
    "request access",
)

# The negations that make the tooling case unambiguous. Their PRESENCE is the
# assertion; ACCESS_CLAIMS' absence alone would also pass on a sentence that
# simply says nothing about access, which is not good enough here.
ACCESS_DENIALS = ("not a limitation of anyone's access", "no permission change is needed")


def _eq(got, want, what):
    assert got == want, f"{what}: got {got!r}, want {want!r}"


def _gated(diagnosis=None, reason="adoption_not_assessable"):
    return rh.gated_notice(None, 3, reason, diagnosis)


# --- the 2026-08-26 correction, on the cover ------------------------------

def test_tooling_gap_does_not_blame_access():
    """The regression this closes. `diagnose_pipelines.py`'s remedy has said
    'Not an access problem' since v1.37.0; the cover said the opposite."""
    text = _gated("dtctl_cannot_read_this_surface").lower()
    for claim in ACCESS_CLAIMS:
        assert claim not in text, (
            f"the tooling-gap notice must not blame access (found {claim!r}) — a grant "
            f"cannot fix a surface dtctl has no verb for, and saying so sent a live "
            f"engagement to raise one: {text}")


def test_tooling_gap_says_plainly_that_access_is_not_the_problem():
    """Not blaming access is not the same as saying so. The customer is deciding
    whether to open a ticket; the sentence has to answer that."""
    text = _gated("dtctl_cannot_read_this_surface").lower()
    for denial in ACCESS_DENIALS:
        assert denial in text, \
            f"the notice must state the negative explicitly ({denial!r}): {text}"


def test_tooling_gap_names_the_export_as_the_fix():
    """A cause with no remedy is worse than no cause — it reads as a dead end."""
    text = _gated("dtctl_cannot_read_this_surface").lower()
    assert "export" in text, f"the remedy is an export: {text}"
    assert "openpipeline app" in text, f"and the notice says from where: {text}"


def test_partial_denial_gets_the_same_tooling_wording():
    """`_partial` is the same cause on a subset — it must not fall through to the
    neutral sentence and lose the 'do not raise a ticket' line."""
    full = _gated("dtctl_cannot_read_this_surface")
    partial = _gated("dtctl_cannot_read_this_surface_partial")
    _eq(partial, full, "partial denial reads as the same cause")


def test_every_tooling_gap_diagnosis_is_wired():
    """Drift guard: a new not-assessable diagnosis added to diagnose_pipelines.py
    without a decision here silently falls to the neutral sentence."""
    for code in rh.TOOLING_GAP_DIAGNOSES:
        text = _gated(code).lower()
        assert "export" in text, f"{code} did not get the tooling wording: {text}"
        for claim in ACCESS_CLAIMS:
            assert claim not in text, f"{code} blamed access ({claim!r})"


# --- the case where naming access IS honest -------------------------------

def test_unreadable_routing_keeps_the_access_wording():
    """The genuine access gap must survive the fix. Unreadable ROUTING has no
    second surface to export from, so access is the true statement there."""
    text = _gated("routing_unreadable").lower()
    assert "access available for this review" in text, \
        f"the real access gap must still say so: {text}"
    assert "routing configuration" in text, \
        f"and name what could not be read, not the pipelines: {text}"


def test_the_two_gaps_do_not_share_a_sentence():
    """The defect was one string serving both. Different causes, opposite actions."""
    assert _gated("dtctl_cannot_read_this_surface") != _gated("routing_unreadable"), \
        "a tooling gap and an access gap must not read identically"


# --- the unknown case -----------------------------------------------------

def test_unknown_diagnosis_asserts_neither_cause():
    """Most gated runs whose cause was not recorded are tooling gaps, so guessing
    'access' is wrong far more often than it is right. Guess nothing."""
    text = _gated(None).lower()
    for claim in ACCESS_CLAIMS:
        assert claim not in text, f"unknown cause must not claim access ({claim!r}): {text}"
    assert "could not be retrieved" in text, f"but must still state the outcome: {text}"


def test_unknown_diagnosis_still_promises_a_completion_path():
    text = _gated(None).lower()
    assert "complete the review" in text, f"the reader needs a next step: {text}"


# --- the 2026-08-25 correction must not regress ---------------------------

def test_not_assessable_never_says_the_tenant_built_nothing():
    """The first defect in this function. Every not-assessable variant, including
    the unknown one, must avoid the below-floor claim."""
    for diagnosis in (None, "dtctl_cannot_read_this_surface",
                      "dtctl_cannot_read_this_surface_partial", "routing_unreadable",
                      "scope_or_pagination", "pipeline_read_errored"):
        text = _gated(diagnosis).lower()
        assert "has not yet built enough" not in text, \
            f"diagnosis={diagnosis!r} reported an unreadable estate as an unbuilt one: {text}"


def test_below_floor_wording_is_unchanged():
    """The genuinely-unbuilt tenant still gets the adoption sentence — and a
    diagnosis must not leak into it, because there is nothing unreadable there."""
    text = rh.gated_notice(1, 3, "below_adoption_floor")
    assert "has not yet built enough OpenPipeline configuration" in text, text
    _eq(rh.gated_notice(1, 3, "below_adoption_floor", "dtctl_cannot_read_this_surface"),
        text, "a stray diagnosis cannot change the below-floor sentence")


def test_no_reason_defaults_to_below_floor():
    """Back-compat: callers predating the `reason` argument keep their wording."""
    _eq(rh.gated_notice(1, 3), rh.gated_notice(1, 3, "below_adoption_floor"),
        "reason=None is the below-floor case")


# --- the notice actually reaches the cover --------------------------------

def test_diagnosis_survives_the_meta_round_trip():
    """The wording is only as good as the plumbing: `diagnosis` has to reach the
    builder through findings.json, or the cover falls back to the neutral text."""
    import findings_schema
    assert "diagnosis" in findings_schema.OPTIONAL_META_KEYS, \
        "findings_schema must recognize `diagnosis` or assemble_meta rejects it"
    meta = findings_schema.assemble_meta(
        window="7d", n_authored=None, diagnosis="dtctl_cannot_read_this_surface")
    _eq(meta.get("reason"), "adoption_not_assessable", "gated as expected")
    _eq(meta.get("diagnosis"), "dtctl_cannot_read_this_surface",
        "diagnosis survives into findings.json meta")
    notice = rh.gated_notice(meta.get("n_authored"), meta.get("adoption_floor"),
                             meta.get("reason"), meta.get("diagnosis"))
    assert "export" in notice.lower(), "and the builder's call renders the right sentence"


def test_scale_line_never_spells_an_unestablished_count_as_zero():
    """A None count means NOT ESTABLISHED and must not render as 0.

    On the adoption_not_assessable gate the pipeline inventory is exactly what
    could not be read. A cover reading "0 customer-authored pipelines" beside a
    notice explaining the count is unavailable asserts the false zero the gate
    exists to prevent — and contradicts its own body. Live 2026-08-26: a tenant
    whose single pipeline had moved 3.9 billion records that week.
    """
    gated = rh.scale_stat_line(None, 1, 2)
    assert "0 customer-authored pipelines" not in gated, gated
    assert "None" not in gated, gated
    assert "not established" in gated, gated
    # the measured halves still render as measurements
    assert "1 routing entries" in gated, gated
    assert "2 of 8 signal-type scopes configured" in gated, gated


def test_scale_line_renders_measured_counts_unchanged():
    line = rh.scale_stat_line(12, 9, 3)
    assert line.startswith("12 customer-authored pipelines"), line
    assert "9 routing entries" in line, line
    assert "not established" not in line, line


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
    print(f"\n{'OK' if not failures else 'FAILED'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
