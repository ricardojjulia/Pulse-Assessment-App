"""scoring.py — the OpenPipeline Health composite, in code.

DRAFT. This file is the single executable authority for the OpenPipeline
headline score (see scoring.md, and docs/specs/dt-eval-openpipeline-skill-spec.md
§O7). Build scripts import it (or run it as a CLI) rather than hand-computing, so
the number is reproducible across analysts and sessions.

    OpenPipelineHealth = 0.40*RoutingIntegrity
                       + 0.30*NativeAdoptionBreadth
                       + 0.30*StructuralHygiene

**The adoption gate is the load-bearing rule here, not the weights.** Two of the
three pillars measure the ABSENCE of defects, and a tenant that has never authored
a pipeline has no defects to find. An ungated composite therefore pays a null
tenant for having done nothing: the v1.0 spec draft (0.35/0.30/0.35, orphans
double-counted across two pillars) floored a zero-adoption tenant at 70.0 = "B —
Strong" and scored three clean pipelines at 85.0 = "A — Excellent", while an
invested tenant carrying real structural debt scored 60.2 = "C". That inversion
rewards non-adoption — the Gen3-first rule stood on its head. Below
ADOPTION_FLOOR customer-authored pipelines this module REFUSES to emit a
composite, the same way noise_scoring.effectiveness() refuses in config-only
mode. `--self-test` runs the spec's acceptance criteria, including that one.

Direction of goodness is encoded, not described: every pillar here is named and
computed so that HIGHER IS BETTER, and all three are bounded shares by
construction so estate size cannot inflate one. The spec's original third pillar
was called `ConsolidationOpportunity` — a problem name carrying a positive weight
in a higher-is-better composite, with no inversion stated anywhere. That is the
defect scoring_engine.wos_composite's docstring exists to memorialize; the pillar
is `structural_hygiene` here for that reason.

Deliberately NOT scored (measured and reported, never in the arithmetic — see
§O7 "Deliberately outside the arithmetic"): soft processor/pipeline capacity
tiers (internal, adjustable, not publicly citable), governance drift pending
analyst confirmation (D6: drift may be intentional), A21<->A22 zero ID-overlap
(a permissions artifact, so ⚪ and never a defect), and B45 throughput
(~100% on any Gen3 tenant regardless of migration depth).

Stdlib-only apart from the shared engine. Run with any python3:

    python3 scoring.py --n-authored 34 --routing-entries 41 --dangling 2 \
        --shadowed 1 --catch-all --signal-types-covered 3 \
        --classic-pending 0 --masking-coverage 0.62 --affected-pipelines 11
    python3 scoring.py --self-test
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / ".dt-eval-common"))

from scoring_engine import Score, score_checks, ScoringEngine  # noqa: E402

# ── Constants ───────────────────────────────────────────────────────────────

# DRAFT weights. Mirrors dt-eval-prob's 0.40/0.30/0.30 shape deliberately and for
# the same reason: the pillar measuring whether the mechanism WORKS outweighs the
# pillars measuring how tidily it is built. A dangling routing entry means data
# does not land where the customer believes it lands (correctness); a duplicate
# family means maintenance burden and drift risk (real, but not the same thing).
# Not final until the four acceptance criteria in scoring.md pass on live runs.
WEIGHTS = {
    "routing_integrity": 0.40,
    "native_adoption_breadth": 0.30,
    "structural_hygiene": 0.30,
}

# DRAFT. Customer-authored pipelines (post-D2 externalId ownership partition)
# below which RoutingIntegrity and StructuralHygiene have denominators too small
# for a defect share to mean anything. One of the things live validation exists
# to settle — see scoring.md's gate-boundary acceptance criterion.
ADOPTION_FLOOR = 5

# The CLI spelling of "the pipeline inventory could not be read". Without it the
# `adoption_not_assessable` gate was reachable from the library and NOT from either
# CLI (`--n-authored` was type=int), so the documented gate state had no documented
# way to reach it — a live run had to import findings_schema and call assemble_meta()
# by hand. `None` is the in-process value; this is how you say it on a command line.
_UNSET = object()   # "flag not supplied", distinct from None ("supplied as not-assessable")
NOT_ASSESSABLE = "not-assessable"


def n_authored_arg(value):
    """argparse type for --n-authored: a non-negative int, or NOT_ASSESSABLE -> None.

    Returning None is the whole point — openpipeline_health() reads None as
    "the inventory could not be read" and raises the adoption_not_assessable gate,
    which is a different finding from below_adoption_floor and must not be spelled
    as 0. Zero means "we looked and there are none"; None means "we could not look".
    """
    if value == NOT_ASSESSABLE:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(
            f"expected a non-negative integer or {NOT_ASSESSABLE!r}, got {value!r}. "
            f"Use {NOT_ASSESSABLE!r} when the pipeline objects could not be read — "
            f"do NOT pass 0, which asserts the tenant has none.")
    if n < 0:
        raise argparse.ArgumentTypeError(f"must be >= 0, got {n}")
    return n

def not_assessable_arg(cast=int, unit="value"):
    """argparse type for any flag whose ⚪ state must be sayable, not just omittable.

    `--n-authored` got the NOT_ASSESSABLE sentinel in v1.37.0 because the gate it
    feeds was documented and unreachable from the CLI. The same shape sits on
    every other flag whose help text says "OMIT when not assessable, never pass 0":
    `--classic-pending`, `--masking-coverage`, `--fall-through-pct`. Omission does
    produce the right None, but it is an **invisible** convention — there is
    nothing to type, so a caller reaching for the ⚪ state finds no way to express
    it, tries the obvious `--classic-pending ""` and gets `invalid int value: ''`.
    That happened live on 2026-08-26, on the one flag whose read is now ⚪ on
    every tenant (the classic-translation CLI verb was removed in dtctl 0.38.0),
    so the undiscoverable path had become the only correct path.

    Accepting the literal makes the ⚪ state **typeable and greppable** without
    changing what omission does. Both spellings mean exactly None.
    """
    def parse(value):
        if value == NOT_ASSESSABLE:
            return None
        try:
            return cast(value)
        except (TypeError, ValueError):
            raise argparse.ArgumentTypeError(
                f"expected {unit} or {NOT_ASSESSABLE!r}, got {value!r}. Use "
                f"{NOT_ASSESSABLE!r} (or omit the flag) when the read did not succeed — "
                f"do NOT pass 0, which asserts a measured result of none.")
    return parse


# Catch-all is an ASYMMETRIC, MEASURED cap on RoutingIntegrity — not a weighted
# check, and no longer a flat penalty.
#
# Presence still earns NOTHING. That half is non-negotiable: a catch-all matcher
# is present by default on any Gen3 tenant, and the first draft of this file made
# it a weight-3 check, which handed 60% of the pillar to a platform default and
# let a tenant whose every routing entry was dangling still score 60.0. Scoring
# the presence of a default is scoring the absence of work.
#
# What changed (2026-08-10, after the first live run): the ABSENCE penalty was a
# flat cap at 40, set on the belief that absence meant silent data loss. It does
# not. Unmatched records fall through to the default pipeline and bucket — they
# get default processing, no custom security context and no custom retention, but
# they are not dropped. First live measurement put the fall-through at 0.027% of
# a 191M-record day, and the flat cap moved that tenant a full grade band (73.5
# -> 50.2) for it. A penalty that size for a harm that size is not a judgment
# call, it is a miscalibration.
#
# The penalty now scales with the MEASURED fall-through share, because that share
# IS the harm: it is the proportion of records not receiving the governance the
# routing table was built to apply. Two components:
#
#   UNCHOSEN  — a small fixed deduction that applies however small the share is.
#               Absence of a catch-all is a latent risk independent of today's
#               volume: the destination of unmatched records is unchosen, so the
#               next source added without a rule lands somewhere nobody picked,
#               with no signal when it happens.
#   share     — the measured percentage, deducted point for point. 10% of records
#               missing their intended governance is a 10-point deduction.
#
# When the share was NOT measured, the cap stays at the old conservative flat
# value. That is deliberate: an unmeasured tenant cannot score better than a
# measured one, so measuring is how a tenant earns the lighter penalty, and a
# missing measurement never silently reads as a small one.
CATCH_ALL_UNCHOSEN_PENALTY = 5.0    # absent, share measured: the latent component
CATCH_ALL_UNMEASURED_CAP = 40.0     # absent, share NOT measured: unchanged, conservative
CATCH_ALL_MIN_CAP = 40.0            # floor — a scaled penalty never reads better than
                                    # the unmeasured case, however large the share

# The signal-type family OpenPipeline can be configured across (A23/A54 breadth
# read). Held here rather than in pipeline-ruleset.json ONLY until that file
# exists; it belongs there (scored: true) per §O7a.
SIGNAL_TYPES = (
    "logs", "bizevents", "events", "events.security",
    "davis.problems", "davis.events", "events.sdlc", "metrics",
)

# CLIENT-FACING vocabulary, in lock-step with docx_style.EXTERNAL_LABELS,
# scoring_engine.GRADE_LABELS and noise_scoring.GRADE_LABELS. Keep all four in
# step: noise_scoring's copy of this map blended external A/B with internal C/D
# until v1.17.36, and output-spec routes the value straight onto the report
# cover, so a tenant below 70 got internal diagnostic language on a customer
# deliverable.
GRADE_LABELS = {"A": "Excellent", "B": "Strong", "C": "Building",
                "D": "Foundational"}

_GATED_HEADLINE = "OpenPipeline Adoption (configuration-only)"


class NoCompositeError(Exception):
    """No OpenPipelineHealth score exists for this run, by design.

    Carries the strings `finalize` needs so the caller passes them straight
    through to runlog.py rather than reinventing the wording per skill:

        headline_label   -> the report cover's headline in the gated case
        no_grade_reason  -> finalize --no-grade-reason "<this>"

    `reason` is a stable machine key: "below_adoption_floor" (the tenant has not
    built enough OpenPipeline configuration for a health verdict — a finding in
    itself, not a failure of the review) or "adoption_not_assessable" (A22 could
    not be read, so the gate itself cannot be evaluated).
    """

    def __init__(self, reason, no_grade_reason, n_authored=None):
        super().__init__(no_grade_reason)
        self.reason = reason
        self.no_grade_reason = no_grade_reason
        self.headline_label = _GATED_HEADLINE
        self.n_authored = n_authored

    def as_headline(self):
        """The gated run's machine-readable headline block (O2: value is null,
        never 0 — a gated tenant is 'not applicable yet', never 'scored 0')."""
        return {
            "score": None,
            "grade": None,
            "grade_label": None,
            "headline_label": self.headline_label,
            "no_grade_reason": self.no_grade_reason,
            "reason": self.reason,
            "n_authored": self.n_authored,
            "adoption_floor": ADOPTION_FLOOR,
        }


def grade(score):
    """Letter grade for a 0-100 score using the family bands (A>=85/B>=70/C>=50)."""
    return ScoringEngine()._score_to_grade(score).value


# ── Pillars ─────────────────────────────────────────────────────────────────

def catch_all_cap(fall_through_pct=None):
    """The cap absence of a catch-all places on RoutingIntegrity.

    `fall_through_pct` is the MEASURED share (0-100) of records reaching the
    default bucket. Pass None when it was not measured — never 0, which would
    claim a measured-and-perfect result and earn the lightest possible penalty
    for the least evidence.
    """
    if fall_through_pct is None:
        return CATCH_ALL_UNMEASURED_CAP
    if not 0.0 <= fall_through_pct <= 100.0:
        raise ValueError(f"fall_through_pct must be a 0-100 percentage, got {fall_through_pct!r}")
    return max(CATCH_ALL_MIN_CAP, 100.0 - CATCH_ALL_UNCHOSEN_PENALTY - fall_through_pct)


def routing_integrity(total_routing_entries, dangling_entries, shadowed_entries,
                      catch_all_present, fall_through_pct=None):
    """RoutingIntegrity (A21, A22) — does data land where the customer thinks?

    Args:
        total_routing_entries: routingEntries[] length (the denominator).
        dangling_entries: entries targeting a pipeline ID that does not exist.
        shadowed_entries: entries unreachable because an earlier first-match-wins
            entry subsumes them.
        catch_all_present: bool, or None when the routing table was unreadable.

    Returns a Score, or None (⚪) when there is no readable routing table.

    NOTE: the orphan check does NOT live here. The v1.0 spec draft scored orphan
    pipelines inside both this pillar and the hygiene pillar, double-counting one
    measurement across 0.70 of the composite. Orphans are in structural_hygiene().

    NOTE: A21<->A22 zero ID-overlap is not an input. Its documented likely cause
    is object-level read-share denial, so scoring it here would report "we could
    not read this" to the customer as "your configuration is broken." It is ⚪
    with a 3-step diagnosis in the narrative.
    """
    if not total_routing_entries or catch_all_present is None:
        return None
    for name, v in (("dangling_entries", dangling_entries),
                    ("shadowed_entries", shadowed_entries)):
        if not 0 <= v <= total_routing_entries:
            raise ValueError(f"{name} must be within 0..{total_routing_entries}, got {v!r}")

    checks = {
        "resolvable_entries": 100.0 * (1.0 - dangling_entries / total_routing_entries),
        "reachable_entries": 100.0 * (1.0 - shadowed_entries / total_routing_entries),
    }
    rolled = score_checks(checks, name="RoutingIntegrity",
                          denominators={"routing_entries": total_routing_entries})
    if catch_all_present or rolled is None:
        return rolled
    # Absent catch-all: cap by the MEASURED fall-through share, and say both the
    # cap and the evidence behind it. Never a bonus for presence.
    cap = catch_all_cap(fall_through_pct)
    capped = min(rolled.value, cap)
    if fall_through_pct is None:
        why = ("no catch-all matcher, and the fall-through share was not measured — "
               "capped conservatively. Measure the default-bucket share to scale this "
               "penalty to the actual harm")
    else:
        why = (f"no catch-all matcher — {fall_through_pct:.3f}% of records reach the "
               f"default bucket, receiving default processing with no custom security "
               f"context or retention (they are NOT dropped)")
    return Score(value=capped, confidence=rolled.confidence,
                 grade=ScoringEngine()._score_to_grade(capped),
                 denominators=rolled.denominators,
                 notes=f"{rolled.notes}; {why} — capped at {cap:.1f}")


def native_adoption_breadth(signal_types_covered, classic_translation_pending,
                            masking_coverage, signal_types_total=len(SIGNAL_TYPES)):
    """NativeAdoptionBreadth (A23, A29, A38, A46, A54) — how widely is it adopted?

    Args:
        signal_types_covered: how many of SIGNAL_TYPES carry a live pipeline.
        classic_translation_pending: A29 residue count, or None when A29 was
            unreadable (it can 500 or permission-error — graceful-degrade to ⚪,
            never fail the pillar).
        masking_coverage: 0-1 share (A38), or None when not assessable.

    Returns a Score, or None (⚪) when nothing in the pillar was readable.

    Gen3's E4 domain reads the same residue-vs-native pair. E4 is the precedence
    authority for the ADOPTION VERDICT and this pillar defers to it; this pillar
    carries the breadth/masking depth E4 deliberately does not. If the two ever
    disagree on whether OpenPipeline is adopted, that is a defect in one of them,
    not a finding about the tenant.
    """
    if not 0 <= signal_types_covered <= signal_types_total:
        raise ValueError(f"signal_types_covered must be within 0..{signal_types_total}, "
                         f"got {signal_types_covered!r}")

    checks = {"breadth": 100.0 * signal_types_covered / signal_types_total}

    # Residue is ✅ when empty and 💡 when not — deliberately not ⚠️ and
    # deliberately not a linear share: pending translations mean migration is
    # incomplete, which is an opportunity, and there is no trustworthy
    # denominator to scale them against.
    if classic_translation_pending is None:
        checks["classic_residue"] = None
    else:
        checks["classic_residue"] = "healthy" if classic_translation_pending == 0 else "opportunity"

    if masking_coverage is None:
        checks["masking_coverage"] = None
    elif not 0.0 <= masking_coverage <= 1.0:
        raise ValueError(f"masking_coverage must be a 0-1 share, got {masking_coverage!r}")
    else:
        checks["masking_coverage"] = 100.0 * masking_coverage

    return score_checks(checks, name="NativeAdoptionBreadth")


def structural_hygiene(n_authored, affected_pipelines, affected_weight=None,
                       total_weight=None):
    """StructuralHygiene (D6, D2's ownership partition, B50) — how tidily built?

        weighted:   100 * (1 - affected_weight / total_weight)
        unweighted: 100 * (1 - affected_pipelines / n_authored)      [fallback]

    **Why weighting matters, and why by CONFIGURATION rather than by volume**
    (recalibrated 2026-08-10, second defect found by the first live run).

    The unweighted share counts pipelines, so it cannot tell a trivial defect from
    a serious one: two orphans out of thirty scored 93.3 whether they were empty
    shells or — as measured live — the PII-isolation pair for roughly 16.5M
    records a day, carrying 1,347 of the estate's 6,361 processing steps between
    them. A pillar that reads "A" while a fifth of the configured processing sits
    disconnected is not measuring what it claims to.

    The obvious fix, weighting by record volume, is **backwards for the dominant
    defect class**: an orphan receives no records by definition, so its volume is
    zero and volume-weighting would make the worst orphans weightless. What an
    orphan actually represents is *disconnected intent* — configuration that was
    built and is not running — and the measure of that is how much was built.

    So the weight is processing steps, with a floor of 1 per pipeline so a
    routing-only pipeline (legitimately zero processors) still counts as config
    debt when orphaned rather than vanishing from the arithmetic.

    Args:
        n_authored: customer-authored pipelines after the ownership partition.
        affected_pipelines: DISTINCT count implicated in at least one hygiene
            defect — membership in an exact-duplicate family, being an unrouted
            orphan after the ownership filter, or sitting on a duplicate
            collection path. **Count once**: a pipeline implicated in two defects
            contributes 1, not 2. Callers pass a set length, never a sum of
            per-defect counts — summing is how the v1.0 draft double-counted
            orphans, and it can drive the share above 1.0, which is a hard error
            here rather than a clamp.
        affected_weight: summed max(1, processor_count) over the affected
            pipelines. Omit to fall back to the unweighted share.
        total_weight: the same sum over all n_authored pipelines.

    Governance drift and near-duplicate families are NOT in affected_pipelines
    until an analyst confirms them (D6: both may be deliberate configuration, and
    scoring possibly-correct config penalizes a tenant for being right).

    Returns a Score, or None (⚪) when n_authored is 0 or unknown.
    """
    if not n_authored:
        return None
    if not 0 <= affected_pipelines <= n_authored:
        raise ValueError(
            f"affected_pipelines must be within 0..{n_authored} (a DISTINCT count of "
            f"affected pipelines, not a sum of per-defect counts), got {affected_pipelines!r}")

    weighted = affected_weight is not None and total_weight is not None
    if weighted:
        if total_weight <= 0:
            raise ValueError(f"total_weight must be positive, got {total_weight!r}")
        if not 0 <= affected_weight <= total_weight:
            raise ValueError(
                f"affected_weight must be within 0..{total_weight}, got {affected_weight!r}")
        value = 100.0 * (1.0 - affected_weight / total_weight)
        note = (f"weighted by configured processing: {affected_weight} of {total_weight} "
                f"processing steps sit in the {affected_pipelines} affected pipeline(s)")
    else:
        value = 100.0 * (1.0 - affected_pipelines / n_authored)
        note = ("unweighted pipeline count — supply affected_weight/total_weight to "
                "weight by configured processing, which distinguishes a trivial defect "
                "from a substantial one")

    rolled = score_checks({"unaffected_share": value}, name="StructuralHygiene",
                          denominators={"authored_pipelines": n_authored})
    return Score(value=rolled.value, confidence=rolled.confidence, grade=rolled.grade,
                 denominators=rolled.denominators, notes=f"{rolled.notes}; {note}")


# ── The composite ───────────────────────────────────────────────────────────

def openpipeline_health(n_authored, routing_integrity=None,
                        native_adoption_breadth=None, structural_hygiene=None):
    """The composite. Pillars are Score objects or 0-100 floats; None means ⚪.

    Returns {score, grade, grade_label, pillars, weights_used, renormalized,
             confidence, n_authored}.

    Raises NoCompositeError when the adoption gate trips — below ADOPTION_FLOOR
    there is no health verdict, and the caller reports the gated headline instead
    (see NoCompositeError.as_headline). Never renormalize past the gate: a gated
    run has no composite to renormalize.

    Raises ValueError when routing_integrity is ⚪ above the floor — an unreadable
    routing table means there is nothing to review, and a composite carried by
    the other two pillars would imply otherwise. This mirrors
    noise_scoring.effectiveness()'s "detector_tuning is required".
    """
    if n_authored is None:
        raise NoCompositeError(
            "adoption_not_assessable",
            "the customer-authored pipeline inventory could not be read, so "
            "OpenPipeline health was not assessed in this review")
    if n_authored < ADOPTION_FLOOR:
        raise NoCompositeError(
            "below_adoption_floor",
            f"below the OpenPipeline adoption floor ({n_authored} customer-authored "
            f"pipeline(s), floor {ADOPTION_FLOOR}) — no health score; see the adoption finding",
            n_authored=n_authored)

    def _value(p):
        return p.value if isinstance(p, Score) else p

    pillars = {
        "routing_integrity": _value(routing_integrity),
        "native_adoption_breadth": _value(native_adoption_breadth),
        "structural_hygiene": _value(structural_hygiene),
    }
    if pillars["routing_integrity"] is None:
        raise ValueError(
            "routing_integrity is required above the adoption floor — an unreadable "
            "routing table means there is nothing to review; report the access gap "
            "rather than a composite carried by the remaining pillars")
    for name, v in pillars.items():
        if v is not None and not 0.0 <= v <= 100.0:
            raise ValueError(f"{name} must be a 0-100 score, got {v!r}")

    # score_checks is the one implementation of the ⚪-exclusion + reweight rule
    # (scoring_engine.py). Re-deriving it here is exactly how that rule drifts.
    rolled = score_checks(pillars, weights=WEIGHTS, name="OpenPipelineHealth")
    present = {k: v for k, v in pillars.items() if v is not None}
    total_w = sum(WEIGHTS[k] for k in present)

    # Confidence inherits the MINIMUM of the pillars' own confidences, not just
    # the composite's ⚪ count — matching calculate_oes. Without this, three
    # pillars all present reads "High" even when one rests on a handful of
    # pipelines: score_checks sees no ⚪ at the composite level and never learns
    # that a pillar underneath it was Low on sample size.
    rank = {"Low": 0, "Medium": 1, "High": 2}
    confidences = [rolled.confidence] + [
        p.confidence for p in (routing_integrity, native_adoption_breadth, structural_hygiene)
        if isinstance(p, Score)
    ]
    confidence = min(confidences, key=lambda c: rank[c.value])

    return {
        "score": round(rolled.value, 1),
        "grade": rolled.grade.value,
        "grade_label": GRADE_LABELS[rolled.grade.value],
        "pillars": {k: round(v, 1) for k, v in present.items()},
        "weights_used": {k: round(WEIGHTS[k] / total_w, 4) for k in present},
        "renormalized": len(present) < len(WEIGHTS),
        "confidence": confidence.value,
        "n_authored": n_authored,
    }


# ── Acceptance criteria (spec §O7) ──────────────────────────────────────────

def self_test():
    """The spec's acceptance criteria, as arithmetic on synthetic pillar values.

    Criteria 1 and 2 are the two the v1.0 composite failed. Both cost nothing to
    run and neither needs a probe — which is the point: "validated against 2-3
    tenants" without a pass condition would have let the inversion through.
    """
    failures = []

    def check(label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{detail and '  — ' + detail}")
        if not ok:
            failures.append(label)

    print("Acceptance criteria (scoring.md):")

    # 1. Null-tenant floor — no composite at all, never a passing grade.
    try:
        openpipeline_health(0, routing_integrity=100.0,
                            native_adoption_breadth=0.0, structural_hygiene=100.0)
        check("1. null tenant produces no composite", False, "a score was emitted")
    except NoCompositeError as e:
        check("1. null tenant produces no composite", True, e.reason)

    # 2. Monotonicity against investment — an invested tenant with defects must
    #    never be outranked by a lighter-adopting tenant with fewer defects to
    #    find. Both are above the floor so the gate is not doing the work here.
    light = openpipeline_health(6, routing_integrity=routing_integrity(6, 0, 0, True),
                                native_adoption_breadth=native_adoption_breadth(1, 4, None),
                                structural_hygiene=structural_hygiene(6, 0))
    heavy = openpipeline_health(60, routing_integrity=routing_integrity(72, 3, 1, True),
                                native_adoption_breadth=native_adoption_breadth(6, 0, 0.8),
                                structural_hygiene=structural_hygiene(60, 9))
    check("2. invested tenant outranks minimal adopter", heavy["score"] > light["score"],
          f"heavy {heavy['score']} vs light {light['score']}")

    # 3. Monotonicity against remediation — fixing a real defect moves it up.
    before = openpipeline_health(60, routing_integrity=routing_integrity(72, 3, 1, True),
                                 native_adoption_breadth=native_adoption_breadth(6, 0, 0.8),
                                 structural_hygiene=structural_hygiene(60, 9))
    after = openpipeline_health(60, routing_integrity=routing_integrity(72, 0, 1, True),
                                native_adoption_breadth=native_adoption_breadth(6, 0, 0.8),
                                structural_hygiene=structural_hygiene(60, 4))
    check("3. remediation raises the score", after["score"] > before["score"],
          f"{before['score']} -> {after['score']}")
    check("3b. re-scoring pre-fix evidence reproduces the pre-fix score",
          before == heavy, "identical inputs, identical output")

    # 4. Gate boundary — at the floor and one below must not be a cliff.
    at_floor = openpipeline_health(
        ADOPTION_FLOOR, routing_integrity=routing_integrity(ADOPTION_FLOOR, 0, 0, True),
        native_adoption_breadth=native_adoption_breadth(1, 4, None),
        structural_hygiene=structural_hygiene(ADOPTION_FLOOR, 0))
    try:
        openpipeline_health(
            ADOPTION_FLOOR - 1, routing_integrity=100.0,
            native_adoption_breadth=native_adoption_breadth(1, 4, None),
            structural_hygiene=100.0)
        check("4. one below the floor is gated", False, "a score was emitted")
    except NoCompositeError:
        check("4. one below the floor is gated", True,
              f"at floor: {at_floor['score']} ({at_floor['grade']}); below: no score")

    # Guard the count-once rule the v1.0 draft violated by summing per-defect counts.
    try:
        structural_hygiene(10, 14)
        check("5. summed per-defect counts are rejected", False, "no error raised")
    except ValueError:
        check("5. summed per-defect counts are rejected", True)

    # Guard the catch-all asymmetry: presence must earn nothing, absence must
    # bite. A weighted catch-all check let a tenant whose every routing entry was
    # dangling still score RoutingIntegrity 60.0 — the gate's own defect, one
    # level down.
    all_broken = routing_integrity(72, 72, 72, True).value
    check("6a. catch-all presence earns no free credit", all_broken == 0.0,
          f"every entry broken, catch-all present -> R {all_broken:.1f}")
    unmeasured = routing_integrity(72, 0, 0, False).value
    check("6b. absent + unmeasured share caps conservatively",
          unmeasured == CATCH_ALL_UNMEASURED_CAP,
          f"clean table, no catch-all, share unknown -> R {unmeasured:.1f}")
    tiny = routing_integrity(72, 0, 0, False, fall_through_pct=0.027).value
    big = routing_integrity(72, 0, 0, False, fall_through_pct=40.0).value
    check("6c. the penalty scales with the measured share", tiny > big > CATCH_ALL_MIN_CAP - 1,
          f"0.027% -> {tiny:.1f}, 40% -> {big:.1f}")
    check("6d. a measured share never scores worse than not measuring",
          routing_integrity(72, 0, 0, False, fall_through_pct=100.0).value
          >= CATCH_ALL_MIN_CAP - 0.001, "floor holds at 100% fall-through")

    print(f"\n{'All criteria pass.' if not failures else str(len(failures)) + ' FAILED: ' + ', '.join(failures)}")
    return 0 if not failures else 1


# ── CLI ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="OpenPipeline Health composite (DRAFT)")
    ap.add_argument("--self-test", action="store_true",
                    help="run the spec's acceptance criteria and exit")
    ap.add_argument("--n-authored", type=n_authored_arg, default=_UNSET,
                    help="customer-authored pipelines after D2's ownership partition, "
                         f"or {NOT_ASSESSABLE!r} when the pipeline objects could not be "
                         "read (never 0 for that case)")
    ap.add_argument("--routing-entries", type=int, help="routingEntries[] length (A21)")
    ap.add_argument("--dangling", type=int, default=0, help="entries targeting a missing pipeline")
    ap.add_argument("--shadowed", type=int, default=0, help="entries unreachable by first-match-wins")
    ap.add_argument("--catch-all", dest="catch_all", action="store_true", default=None,
                    help="catch-all matcher present")
    ap.add_argument("--no-catch-all", dest="catch_all", action="store_false",
                    help="catch-all matcher absent")
    ap.add_argument("--signal-types-covered", type=int, default=0,
                    help=f"how many of {len(SIGNAL_TYPES)} signal types carry a live pipeline")
    ap.add_argument("--classic-pending", type=not_assessable_arg(int, "an integer"),
                    default=None,
                    help="A29 residue count; omit when A29 was unreadable (⚪)")
    ap.add_argument("--masking-coverage",
                    type=not_assessable_arg(float, "a 0-1 share"), default=None,
                    help="A38 masking coverage 0-1; omit when not assessable (⚪)")
    ap.add_argument("--affected-pipelines", type=int, default=0,
                    help="DISTINCT authored pipelines with >=1 hygiene defect (count once)")
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    # `None` is now a MEANINGFUL value (the not-assessable gate), so the
    # required-ness check keys on the _UNSET sentinel rather than on None.
    if a.n_authored is _UNSET:
        ap.error(f"--n-authored is required (an integer, or {NOT_ASSESSABLE!r} when the "
                 f"pipeline objects could not be read) — or use --self-test")

    r = (routing_integrity(a.routing_entries, a.dangling, a.shadowed, a.catch_all)
         if a.routing_entries else None)
    n = native_adoption_breadth(a.signal_types_covered, a.classic_pending, a.masking_coverage)
    c = structural_hygiene(a.n_authored, a.affected_pipelines)

    try:
        out = openpipeline_health(a.n_authored, routing_integrity=r,
                                  native_adoption_breadth=n, structural_hygiene=c)
    except NoCompositeError as e:
        # A gated run is a legitimate outcome, not a CLI failure: emit the
        # headline block finalize needs and exit 0.
        print(json.dumps(e.as_headline(), indent=2))
        return 0
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
