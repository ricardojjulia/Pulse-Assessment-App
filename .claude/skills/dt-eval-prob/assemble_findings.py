#!/usr/bin/env python3
"""assemble_findings.py — build findings.json end to end, in one script.

Replaces the hand-typed findings.json this skill has produced every run
until now (see noise_findings_schema.py for why that drifted). This is the
ONE place that:
  1. computes the composite via noise_scoring.py (never re-derived by hand),
  2. names its meta keys via noise_findings_schema.assemble_meta() (never
     typed out again per run), and
  3. merges in the qualitative content an analyst already authored this run
     (`rules`, `change_plan`, `custom_rule_worklist`) — those are Phase 2/3
     judgment calls this script cannot compute, so they arrive as files.

Usage — full mode (the normal case; matches noise_scoring.py's own CLI):
    python3 assemble_findings.py --out findings.json \\
        --rc 0.011 --im 0.006 --ac 0.998 --custom-share 0.8209 --tuning 40.4 \\
        --total-problems 48022 --window 30d \\
        --customer "Acme Corp" --tenant abc12345 \\
        --rules rules.json [--change-plan change_plan.json] \\
        [--confidence High] [--confidence-basis "..."] \\
        [--area-scores area_scores.json] [--custom-rule-worklist worklist.json]

Usage — config-only mode (SKILL.md rule 0; problem stream unreadable — omit
--rc/--im/--ac/--custom-share/--total-problems entirely, never pass them as 0
or a placeholder, which would silently claim a measured-but-zero volume):
    python3 assemble_findings.py --out findings.json --tuning 40.4 \\
        --window 30d --rules rules.json

`rules.json` / `change_plan.json` / `area_scores.json` / `worklist.json` are
each just the JSON value that slots into findings.json at that key — write
them with any tool (including inline `python3 -c "json.dump(...)"`), this
script only merges and validates, it does not author the analysis.
"""
import argparse
import json
import sys

import noise_findings_schema
import noise_scoring


def _load_json_arg(path):
    if not path:
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="output findings.json path")
    ap.add_argument("--tuning", type=float, required=True,
                    help="detector-tuning rollup 0-100 (Phase 2)")
    ap.add_argument("--window", default="30d")
    ap.add_argument("--rc", type=float, help="rootCauseRate 0-1 (P4)")
    ap.add_argument("--im", type=float, help="impactMultiRate 0-1 (P4)")
    ap.add_argument("--ac", type=float, help="actionableRate 0-1 (P4)")
    ap.add_argument("--custom-share", type=float, help="CUSTOM_ALERT share 0-1 (P2, 30d)")
    ap.add_argument("--total-problems", type=int)
    ap.add_argument("--customer")
    ap.add_argument("--tenant")
    ap.add_argument("--confidence", choices=["High", "Medium", "Low"])
    ap.add_argument("--confidence-basis")
    ap.add_argument("--rules", help="JSON file: {rule_id: {...}} per-rule findings")
    ap.add_argument("--change-plan", help="JSON file: [...] non-ruleset actions")
    ap.add_argument("--custom-rule-worklist", help="JSON file: [...] worklist entries")
    ap.add_argument("--area-scores", help="JSON file: {area: score} per-area rollup")
    ap.add_argument("--area-weighting", help="JSON file: {area: weight}")
    ap.add_argument("--pui-rates", help="JSON file: {root_cause, impact_multi, actionable}")
    a = ap.parse_args()

    rc_im_ac_given = [a.rc is not None, a.im is not None, a.ac is not None]
    if any(rc_im_ac_given) and not all(rc_im_ac_given):
        sys.exit("--rc/--im/--ac must be given together (all three) or not at all — "
                  "a partial set cannot compute signal_quality")
    signal_quality = (noise_scoring.signal_quality(a.rc, a.im, a.ac)
                       if all(rc_im_ac_given) else None)
    native_adoption = (noise_scoring.native_adoption(a.custom_share)
                        if a.custom_share is not None else None)

    if signal_quality is None and native_adoption is None:
        # config-only mode: a --total-problems/--custom-share value here would
        # silently claim a measured volume that config-only mode, by
        # definition, does not have (SKILL.md rule 0).
        if a.total_problems is not None or a.custom_share is not None:
            sys.exit("config-only mode (no --rc/--im/--ac given): "
                      "--total-problems/--custom-share must not be passed either — "
                      "there is no measured volume this run")

    rules = _load_json_arg(a.rules) or {}
    change_plan = _load_json_arg(a.change_plan)
    worklist = _load_json_arg(a.custom_rule_worklist)
    area_scores = _load_json_arg(a.area_scores)
    area_weighting = _load_json_arg(a.area_weighting)
    pui_rates = _load_json_arg(a.pui_rates)

    meta = noise_findings_schema.assemble_meta(
        detector_tuning=a.tuning, window=a.window,
        signal_quality=signal_quality, native_adoption=native_adoption,
        custom_alert_share=a.custom_share, total_problems=a.total_problems,
        customer=a.customer, tenant=a.tenant,
        confidence=a.confidence, confidence_basis=a.confidence_basis,
        area_scores=area_scores, area_weighting=area_weighting,
        pui_rates=pui_rates, custom_rule_worklist=worklist,
        change_plan=change_plan,
    )

    findings = {"meta": meta, "rules": rules}
    if change_plan is not None:
        findings["change_plan"] = change_plan  # top-level, per the documented shape

    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(findings, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    mode = "config-only" if meta.get("config_only") else "full"
    headline = (f"Detector Tuning Score (configuration-only) = {meta['detector_tuning']}"
                if mode == "config-only"
                else f"Alerting Effectiveness = {meta['effectiveness']} ({meta['grade']})")
    print(f"wrote {a.out} — {mode} mode, {len(rules)} rule(s), {headline}")


if __name__ == "__main__":
    main()
