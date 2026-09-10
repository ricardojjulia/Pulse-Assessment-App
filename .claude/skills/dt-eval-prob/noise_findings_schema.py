#!/usr/bin/env python3
"""noise_findings_schema.py — the one canonical shape for findings.json's `meta` block.

Why this exists (field finding, 2026-08-09): findings.json has no schema and
no script ever wrote it end to end — noise_scoring.py computes the composite,
but nothing bridged its output into findings.json, so every run hand-typed
the meta dict independently. The pillar noise_scoring.py itself calls
"detector_tuning" (WEIGHTS, effectiveness()) reached real findings.json files
under two different spellings depending on which run wrote it — "noise_score"
(the older name, still on 8 of 9 real runs/*/findings.json on disk the day
this was found) and "detector_tuning" (current). build_tuning_sheet.py's
consumer read the stale key with a silent `.get(key, "")` fallback, which
turned a renamed key into a blank Summary-tab cell rather than a build
failure — exactly the class of defect SKILL.md's own `resolve_status()`
already refuses for detector status tokens ("a sheet silently dropping half
its status rows is worse than one that fails to build").

This module is the single source of truth for two things now:
  1. `assemble_meta()` — builds the canonical meta dict via noise_scoring.py's
     own computation, so a run never hand-types its vocabulary again. Prefer
     `assemble_findings.py` (the CLI wrapper) over calling this directly.
  2. `normalize_meta()` — resolves legacy aliases to canonical keys and RAISES
     on anything neither canonical, optional, nor a known alias, so a future
     rename fails the build loudly instead of rendering a blank cell.
     `build_tuning_sheet.py` calls this on every `--findings` file it loads.

The REQUIRED sets below were not designed in the abstract — they are the
INTERSECTION of keys actually present across every real findings.json this
skill has produced (9 files, `runs/*/findings.json`, checked 2026-08-09).
"confidence" is deliberately NOT required even though scoring.md treats it as
report-level: only 1 of those 9 files carries it in `meta` at all (the flag
travels to `runlog.py finalize --confidence` separately on the others), so
requiring it here would retroactively fail 8 real, already-delivered runs.
"""

import noise_scoring

# Present in every real findings.json this skill has produced, after
# resolving legacy aliases. build_tuning_sheet.py's Summary tab and Word
# report cannot build a meaningful headline without these.
REQUIRED_META_KEYS_FULL = {
    "effectiveness", "grade", "signal_quality", "native_adoption",
    "detector_tuning", "custom_alert_share", "total_problems", "window",
}

# Config-only mode (SKILL.md "Rules in config-only mode", rule 0): both
# volume pillars are unmeasurable, so effectiveness/signal_quality/
# native_adoption/custom_alert_share/total_problems do not exist this run —
# requiring them would defeat the whole point of config-only mode.
REQUIRED_META_KEYS_CONFIG_ONLY = {"detector_tuning", "grade", "window"}

# Recognized, seen on at least one real run, never required — their absence
# is not a build error. `grade_label`/`weights_used`/`renormalized` are
# noise_scoring.effectiveness()'s own return keys; no findings.json on disk
# carries them yet (hand-authored files skipped them), but assemble_meta()
# writes them and they must not trip the unknown-key check going forward.
OPTIONAL_META_KEYS = {
    "customer", "tenant", "confidence", "confidence_basis", "area_scores",
    "area_weighting", "pui_rates", "custom_rule_worklist", "change_plan",
    "grade_label", "weights_used", "renormalized", "config_only",
}

# key a findings.json might still carry -> the canonical key that replaced
# it. Extend this table, never delete an entry — an old findings.json on
# disk (runs/<id>-<date>/findings.json) must keep loading and comparing.
LEGACY_ALIASES = {
    "noise_score": "detector_tuning",
}

ALL_KNOWN_KEYS = (REQUIRED_META_KEYS_FULL | REQUIRED_META_KEYS_CONFIG_ONLY
                  | OPTIONAL_META_KEYS)


def normalize_meta(meta):
    """Resolve legacy aliases to canonical keys; RAISE on anything else
    unrecognized, and on any required key still missing afterward.

    A key that is neither canonical, optional, nor a known legacy alias is
    either a typo or a rename this table was never updated for — both are a
    build-time defect, not something to silently `.get()` past. Call this on
    every `meta` dict loaded from a real findings.json (build_tuning_sheet.py
    does, whenever `--findings` is given); skip it for the empty `{}` template
    default used when no findings.json exists yet.
    """
    out = dict(meta)
    for legacy, canonical in LEGACY_ALIASES.items():
        if legacy in out:
            out.setdefault(canonical, out.pop(legacy))
            out.pop(legacy, None)  # canonical wins if BOTH were present

    unknown = set(out) - ALL_KNOWN_KEYS
    if unknown:
        raise ValueError(
            f"findings.json meta carries unrecognized key(s) {sorted(unknown)} — "
            f"add them to noise_findings_schema.py's REQUIRED/OPTIONAL_META_KEYS "
            f"(or LEGACY_ALIASES if this is a rename) before they can be read")

    config_only = bool(out.get("config_only"))
    if config_only and "effectiveness" in out:
        raise ValueError(
            "findings.json meta has config_only=true AND an 'effectiveness' "
            "key — SKILL.md's config-only rule 0 is 'never present the "
            "tuning-only number as effectiveness'; drop the effectiveness key")

    required = REQUIRED_META_KEYS_CONFIG_ONLY if config_only else REQUIRED_META_KEYS_FULL
    missing = required - set(out)
    if missing:
        mode = "config-only" if config_only else "full"
        raise ValueError(
            f"findings.json meta is missing required key(s) {sorted(missing)} "
            f"for {mode} mode (needs all of {sorted(required)})")
    return out


def assemble_meta(*, detector_tuning, window, signal_quality=None,
                   native_adoption=None, custom_alert_share=None,
                   total_problems=None, customer=None, tenant=None,
                   confidence=None, confidence_basis=None, area_scores=None,
                   area_weighting=None, pui_rates=None,
                   custom_rule_worklist=None, change_plan=None):
    """Build the canonical meta dict via noise_scoring.py — the ONE place the
    composite gets computed AND the ONE place its key names get chosen, so a
    build step never hand-types noise_scoring's own vocabulary again.

    `signal_quality`/`native_adoption` both `None` means config-only mode
    (SKILL.md rule 0): no composite is computed, and the headline becomes
    "Detector Tuning Score (configuration-only)" — the grade shown is the
    tuning score's own grade, never an effectiveness grade, because there is
    no effectiveness this run.

    Returns a dict ready to drop straight into findings.json["meta"] —
    already passed through `normalize_meta()`, so a caller cannot write a
    findings.json that fails its own schema.
    """
    config_only = signal_quality is None and native_adoption is None
    if config_only:
        meta = {
            "detector_tuning": round(detector_tuning, 1),
            "grade": noise_scoring.grade(detector_tuning),
            "window": window,
            "config_only": True,
        }
    else:
        result = noise_scoring.effectiveness(
            signal_quality=signal_quality, native_adoption=native_adoption,
            detector_tuning=detector_tuning)
        meta = {
            "effectiveness": result["score"],
            "grade": result["grade"],
            "grade_label": result["grade_label"],
            "weights_used": result["weights_used"],
            "renormalized": result["renormalized"],
            "custom_alert_share": custom_alert_share,
            "total_problems": total_problems,
            "window": window,
            **result["pillars"],  # signal_quality / native_adoption / detector_tuning
        }

    for key, value in (
        ("customer", customer), ("tenant", tenant),
        ("confidence", confidence), ("confidence_basis", confidence_basis),
        ("area_scores", area_scores), ("area_weighting", area_weighting),
        ("pui_rates", pui_rates),
        ("custom_rule_worklist", custom_rule_worklist),
        ("change_plan", change_plan),
    ):
        if value is not None:
            meta[key] = value

    return normalize_meta(meta)  # self-check before it ever reaches disk
