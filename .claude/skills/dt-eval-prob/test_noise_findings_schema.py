#!/usr/bin/env python3
"""Self-tests for noise_findings_schema.py.

Run: .venv/bin/python test_noise_findings_schema.py
"""

import glob
import json
import os
import sys

import noise_findings_schema as s

HERE = os.path.dirname(os.path.abspath(__file__))


def _eq(got, want, what):
    assert got == want, f"{what}: got {got!r}, want {want!r}"


FULL_META = {
    "effectiveness": 50.0, "grade": "C", "signal_quality": 50.0,
    "native_adoption": 50.0, "detector_tuning": 50.0,
    "custom_alert_share": 0.5, "total_problems": 1000, "window": "30d",
}


# --- normalize_meta ---------------------------------------------------------

def test_legacy_noise_score_resolves_to_detector_tuning():
    meta = {k: v for k, v in FULL_META.items() if k != "detector_tuning"}
    meta["noise_score"] = 71.5
    out = s.normalize_meta(meta)
    _eq(out["detector_tuning"], 71.5, "legacy key resolved to canonical")
    assert "noise_score" not in out, "legacy key must not survive normalization"


def test_canonical_key_wins_when_both_present():
    out = s.normalize_meta({**FULL_META, "detector_tuning": 65.0, "noise_score": 999.0})
    _eq(out["detector_tuning"], 65.0, "canonical key takes precedence")


def test_unknown_key_raises():
    try:
        s.normalize_meta({**FULL_META, "detector_tunning": 40.4})  # typo
        assert False, "expected ValueError"
    except ValueError as e:
        assert "detector_tunning" in str(e), str(e)


def test_missing_required_key_raises():
    meta = {k: v for k, v in FULL_META.items() if k != "custom_alert_share"}
    try:
        s.normalize_meta(meta)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "custom_alert_share" in str(e), str(e)


def test_config_only_requires_only_its_own_smaller_set():
    """Config-only mode's required set omits effectiveness/signal_quality/
    native_adoption/custom_alert_share/total_problems entirely -- a findings.json
    missing all of those is VALID when config_only=true."""
    out = s.normalize_meta({"config_only": True, "detector_tuning": 40.4,
                            "grade": "D", "window": "30d"})
    _eq(out["detector_tuning"], 40.4, "minimal config-only meta accepted")


def test_config_only_with_effectiveness_key_raises():
    """SKILL.md rule 0: never present the tuning-only number as effectiveness.
    Mechanically enforced, not just documented."""
    try:
        s.normalize_meta({"config_only": True, "detector_tuning": 40.4,
                          "grade": "D", "window": "30d", "effectiveness": 40.4})
        assert False, "expected ValueError"
    except ValueError as e:
        assert "effectiveness" in str(e), str(e)


def test_every_real_findings_json_on_disk_still_validates():
    """The schema was derived FROM every real findings.json this skill has
    produced -- it must never reject one of them. Skips files with an empty
    meta (nothing to validate) and the reference example's `_comment` sibling
    key (not a meta key, not checked here).

    **The floor is per-source, because `runs/` is gitignored.** This asserted a
    flat `checked >= 9` until 2026-08-11, which encoded one developer's local run
    history: it passed on a machine with nine past runs and failed anywhere else.
    That went unnoticed while the suite ran only locally, and surfaced the moment
    it was wired into CI -- where `runs/` is empty and only the committed example
    exists. The committed corpus is what CI can guarantee, so that is what is
    required; local run state is checked when present but never demanded.
    """
    committed = sorted(glob.glob(os.path.join(HERE, "examples", "*.json")))
    local_runs = sorted(glob.glob(os.path.join(HERE, "runs", "*", "findings.json")))
    checked = {"committed": 0, "local": 0}
    for label, paths in (("committed", committed), ("local", local_runs)):
        for path in paths:
            meta = json.load(open(path)).get("meta", {})
            if not meta:
                continue
            s.normalize_meta(meta)  # raises on failure -- that IS the assertion
            checked[label] += 1
    assert checked["committed"] >= 1, (
        "no committed findings example validated -- examples/findings.reference.json "
        "is the corpus this test can rely on everywhere, and it must not disappear "
        f"(found {len(committed)} candidate file(s))")


# --- assemble_meta -----------------------------------------------------------

def test_assemble_meta_full_mode_computes_via_noise_scoring():
    meta = s.assemble_meta(
        detector_tuning=40.4, window="30d", signal_quality=32.7,
        native_adoption=17.9, custom_alert_share=0.8209, total_problems=48022)
    _eq(meta["detector_tuning"], 40.4, "tuning pillar carried through")
    _eq(meta["signal_quality"], 32.7, "signal quality pillar carried through")
    _eq(meta["native_adoption"], 17.9, "native adoption pillar carried through")
    # effectiveness = 0.40*32.7 + 0.30*17.9 + 0.30*40.4 = 30.63 -> rounds to 30.6,
    # matching the live afi-prod/Ameriprise finding this whole chain started from.
    _eq(meta["effectiveness"], 30.6, "composite computed by noise_scoring, not hand-typed")
    assert meta["grade"] == "D", meta["grade"]
    assert "config_only" not in meta, "full mode must not set config_only"


def test_assemble_meta_config_only_mode_has_no_effectiveness():
    meta = s.assemble_meta(detector_tuning=40.4, window="30d")
    assert meta["config_only"] is True
    assert "effectiveness" not in meta, "config-only meta must never carry effectiveness"
    _eq(meta["grade"], "D", "grade comes from the tuning score's own band")


def test_assemble_meta_output_always_passes_normalize_meta():
    """assemble_meta() calls normalize_meta() on its own output before
    returning -- a caller cannot end up with a findings.json that fails its
    own schema check downstream in build_tuning_sheet.py."""
    meta = s.assemble_meta(detector_tuning=50.0, window="30d", signal_quality=50.0,
                           native_adoption=50.0, custom_alert_share=0.5,
                           total_problems=100)
    s.normalize_meta(meta)  # must not raise


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
    print(f"\n{'FAILED' if failures else 'OK'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
