"""noise_scoring.py — the Alerting Effectiveness composite, in code.

This file is the single executable authority for the Problem Noise headline score
(see scoring.md "The headline"). Build scripts import it (or run it as a CLI) rather
than hand-computing, so the number is reproducible across analysts and sessions.

    Effectiveness = 0.40*S + 0.30*N + 0.30*T

    S  (signal quality)           = 100 * PUI
        PUI = 0.4*rootCauseRate + 0.3*impactMultiRate + 0.3*actionableRate   (P4, 30d)
    N  (native-detection adoption) = 100 * (1 - custom_share_30d)             (P2, 30d)
    T  (detector tuning)           = the Phase 2 per-detector rollup (scoring.md)

Config-only rule (enforced here): with BOTH volume pillars absent there is no
composite — the deliverable's headline is "Detector Tuning Score (configuration-only)"
and this module refuses to emit an effectiveness number. With exactly one volume
pillar absent, the remaining weights are renormalized and the result is flagged.

Stdlib-only. Run with any python3:

    python3 noise_scoring.py --rc 0.143 --im 0.076 --ac 0.973 \
        --custom-share 0.456 --tuning 73.9
"""

import argparse
import json

WEIGHTS = {"signal_quality": 0.40, "native_adoption": 0.30, "detector_tuning": 0.30}
PUI_WEIGHTS = {"root_cause": 0.4, "impact_multi": 0.3, "actionable": 0.3}

# Family bands — must match scoring_engine.py (A>=85, B>=70, C>=50, D<50).
GRADE_BANDS = [(85.0, "A"), (70.0, "B"), (50.0, "C")]
# CLIENT-FACING vocabulary, in lock-step with docx_style.EXTERNAL_LABELS and
# scoring_engine.GRADE_LABELS. This map blended the two vocabularies until
# v1.17.36 — external A/B with internal C/D ("Needs work", "At risk") — and
# output-spec.md routes this value straight onto the report cover, so a tenant
# scoring below 70 got internal diagnostic language on a customer deliverable.
GRADE_LABELS = {"A": "Excellent", "B": "Strong", "C": "Building",
                "D": "Foundational"}


def grade(score):
    """Letter grade for a 0-100 score using the family bands."""
    for threshold, letter in GRADE_BANDS:
        if score >= threshold:
            return letter
    return "D"


def pui(root_cause_rate, impact_multi_rate, actionable_rate):
    """Problem Usefulness Index over the deduped 30-day stream (rates are 0-1)."""
    for name, v in (("root_cause_rate", root_cause_rate),
                    ("impact_multi_rate", impact_multi_rate),
                    ("actionable_rate", actionable_rate)):
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"{name} must be a 0-1 rate, got {v!r}")
    return (PUI_WEIGHTS["root_cause"] * root_cause_rate
            + PUI_WEIGHTS["impact_multi"] * impact_multi_rate
            + PUI_WEIGHTS["actionable"] * actionable_rate)


def signal_quality(root_cause_rate, impact_multi_rate, actionable_rate):
    """S pillar: 100 x PUI."""
    return 100.0 * pui(root_cause_rate, impact_multi_rate, actionable_rate)


def native_adoption(custom_share_30d):
    """N pillar: 100 x (1 - CUSTOM_ALERT share of the 30-day deduped stream)."""
    if not 0.0 <= custom_share_30d <= 1.0:
        raise ValueError(f"custom_share_30d must be a 0-1 share, got {custom_share_30d!r}")
    return 100.0 * (1.0 - custom_share_30d)


def effectiveness(signal_quality=None, native_adoption=None, detector_tuning=None):
    """The composite. Pillar args are 0-100 scores; pass None for an unavailable pillar.

    Returns a dict: {score, grade, grade_label, pillars, weights_used, renormalized}.
    Raises ValueError when both volume pillars (S and N) are None — that is
    config-only mode, which has no effectiveness score by design (scoring.md).
    """
    provided = {k: v for k, v in (("signal_quality", signal_quality),
                                  ("native_adoption", native_adoption),
                                  ("detector_tuning", detector_tuning)) if v is not None}
    if "signal_quality" not in provided and "native_adoption" not in provided:
        raise ValueError(
            "config-only mode: both volume pillars are unavailable — there is no "
            "Alerting Effectiveness Score; report 'Detector Tuning Score "
            "(configuration-only)' instead (scoring.md, missing-pillars rule)")
    if "detector_tuning" not in provided:
        raise ValueError("detector_tuning is required — Phase 2 always runs")
    for name, v in provided.items():
        if not 0.0 <= v <= 100.0:
            raise ValueError(f"{name} must be a 0-100 score, got {v!r}")

    total_w = sum(WEIGHTS[k] for k in provided)
    weights_used = {k: WEIGHTS[k] / total_w for k in provided}
    score = round(sum(provided[k] * weights_used[k] for k in provided), 1)
    return {
        "score": score,
        "grade": grade(score),
        "grade_label": GRADE_LABELS[grade(score)],
        "pillars": {k: round(v, 1) for k, v in provided.items()},
        "weights_used": {k: round(w, 4) for k, w in weights_used.items()},
        "renormalized": len(provided) < 3,
    }


def main():
    ap = argparse.ArgumentParser(description="Alerting Effectiveness composite")
    ap.add_argument("--rc", type=float, help="rootCauseRate 0-1 (P4)")
    ap.add_argument("--im", type=float, help="impactMultiRate 0-1 (P4)")
    ap.add_argument("--ac", type=float, help="actionableRate 0-1 (P4)")
    ap.add_argument("--custom-share", type=float, help="CUSTOM_ALERT share 0-1 (P2, 30d)")
    ap.add_argument("--tuning", type=float, required=True,
                    help="detector-tuning rollup 0-100 (Phase 2)")
    args = ap.parse_args()

    s = None
    if args.rc is not None and args.im is not None and args.ac is not None:
        s = signal_quality(args.rc, args.im, args.ac)
    n = native_adoption(args.custom_share) if args.custom_share is not None else None
    print(json.dumps(effectiveness(signal_quality=s, native_adoption=n,
                                   detector_tuning=args.tuning), indent=2))


if __name__ == "__main__":
    main()
