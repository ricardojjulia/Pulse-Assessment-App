"""rca_participation.py — the C-rcrel classifier, in code.

Executable authority for probes.md §3 item 7. Import it (or run it as a CLI over a
saved `dtctl get anomaly-detectors` dump) rather than re-deriving the rule inline,
so the verdict is reproducible across analysts and sessions.

WHY THIS FILE EXISTS (field finding, 2026-08-03). The classifier shipped as
pseudocode in a markdown block, and it was wrong in the one direction that
matters. It read an ABSENT `dt.davis.is_merging_allowed` as "merging allowed":

    "merging_allowed": merge != "false"      # None -> True

That inference is unsound. Absence means the key was not written; it does not
mean the platform permits merging. On two live estates (807 detectors, 2026-08-03)
**zero** detectors set either flag, so the old rule reported **100% RCA-capable**
— while the event stream measured **0.0% mergeable**, every event carrying
`dt.davis.disable_merging_reason == "Set by event reporter"`. A probe whose whole
purpose is to explain a 0.0% root-cause rate instead certified the estate clean.

Two rules carry the fix, and both came from measuring real detector configs
rather than from reasoning about what the flags "should" mean:

1. **Absence is UNKNOWN, never "allowed".** Configuration can prove a detector is
   excluded from correlation; it cannot prove one participates. So there is no
   `capable` verdict in this module at all — the caller gets `not_capable`,
   `not_capable_by_type`, or `unknown`, and reports a LOWER BOUND. Removing the
   optimistic verdict is the fix; softening its wording would not have been.

2. **`event.type` is the config-readable predictor when the flags are absent.**
   All 807 detectors emitted `event.type: CUSTOM_ALERT`, and every resulting
   event was non-mergeable. That alert class is excluded from correlation with no
   per-detector flag involved, which is exactly why rule 1's `unknown` would
   otherwise be uselessly vague on the detector class this probe targets.

Corollary for the stream twin (D-rcrel): `disable_merging_reason == "Set by event
reporter"` names the reporting COMPONENT, not the detector's own template. It
appeared on every event on estates where no template set the flag, so it is not
evidence of a per-detector opt-out.

Both estate shapes must classify correctly, and `test_rca_participation.py` pins
both:

    reference (2026-07-28)  1,254 / 1,276 set "false"  -> not_capable        (proven)
    live      (2026-08-03)  0 / 807 set anything       -> not_capable_by_type (inferred)

Stdlib only. Run with any python3:

    python3 rca_participation.py C-davis-detectors.json
"""

import argparse
import json
import sys

MERGE_KEY = "dt.davis.is_merging_allowed"
RCREL_KEY = "dt.davis.is_rootcause_relevant"
TYPE_KEY = "event.type"

# Alert types excluded from Davis correlation regardless of any per-detector flag.
# Measured, not assumed: every detector emitting this type produced non-mergeable
# events on both live estates. Extend only with the same class of evidence.
EXCLUDED_EVENT_TYPES = frozenset({"CUSTOM_ALERT"})

# The three verdicts. `capable` is deliberately absent — see rule 1 above.
NOT_CAPABLE = "not_capable"                  # explicit opt-out in the event template
NOT_CAPABLE_BY_TYPE = "not_capable_by_type"  # inferred from the emitted alert type
UNKNOWN = "unknown"                          # configuration establishes nothing
VERDICTS = (NOT_CAPABLE, NOT_CAPABLE_BY_TYPE, UNKNOWN)


def event_template_properties(detector):
    """The eventTemplate property list as a dict. Values are STRINGS ("false", not False)."""
    template = detector.get("value", {}).get("eventTemplate") or {}
    return {p.get("key"): p.get("value") for p in (template.get("properties") or [])}


def classify(detector):
    """Classify one detector's RCA participation from configuration alone.

    Returns a dict with a `verdict` in VERDICTS. There is no "capable" outcome:
    an absent flag is UNKNOWN, because configuration cannot prove participation.
    """
    props = event_template_properties(detector)
    merge = props.get(MERGE_KEY)          # None => unknown, NOT "allowed"
    rcrel = props.get(RCREL_KEY)          # None => unknown, NOT "relevant"
    event_type = props.get(TYPE_KEY)

    merging_disabled = merge == "false"
    rootcause_irrelevant = rcrel == "false"

    if merging_disabled or rootcause_irrelevant:
        verdict = NOT_CAPABLE
    elif event_type in EXCLUDED_EVENT_TYPES:
        verdict = NOT_CAPABLE_BY_TYPE
    else:
        verdict = UNKNOWN

    return {
        "objectId": detector.get("objectId"),
        "title": detector.get("value", {}).get("title"),
        "enabled": bool(detector.get("value", {}).get("enabled")),
        "merging_disabled_explicitly": merging_disabled,
        "rootcause_irrelevant_explicitly": rootcause_irrelevant,
        "event_type": event_type,
        "verdict": verdict,
    }


def summarize(detectors, enabled_only=True):
    """Roll up to the `--summary` contract in probes.md's probe-ID registry.

    The headline is a LOWER BOUND: `not_capable_total` counts detectors proven or
    inferred to be excluded. It is never a capability rate, so there is no
    `rca_capable` key — a run.json carrying one predates this module.
    """
    rows = [classify(d) for d in detectors]
    scored = [r for r in rows if r["enabled"]] if enabled_only else rows
    n = len(scored)
    counts = {v: sum(1 for r in scored if r["verdict"] == v) for v in VERDICTS}
    not_capable_total = counts[NOT_CAPABLE] + counts[NOT_CAPABLE_BY_TYPE]
    return {
        "detectors": len(rows),
        "enabled": sum(1 for r in rows if r["enabled"]),
        "scored": n,
        "merging_disabled_explicitly": sum(1 for r in scored if r["merging_disabled_explicitly"]),
        "rootcause_irrelevant_explicitly": sum(1 for r in scored if r["rootcause_irrelevant_explicitly"]),
        "not_capable_explicit": counts[NOT_CAPABLE],
        "not_capable_by_type": counts[NOT_CAPABLE_BY_TYPE],
        "not_capable_total": not_capable_total,
        "unknown": counts[UNKNOWN],
        # A lower bound on exclusion — NOT the complement of a capability rate.
        "not_capable_pct_lower_bound": round(100.0 * not_capable_total / n, 1) if n else None,
        "basis": ("explicit event-template opt-out" if counts[NOT_CAPABLE] else
                  "emitted alert type" if counts[NOT_CAPABLE_BY_TYPE] else
                  "not established from configuration"),
    }, rows


def phrase(summary):
    """The one sentence a report may state from this probe. Never an all-clear."""
    n, total = summary["not_capable_total"], summary["scored"]
    if not total:
        return "No enabled detectors were read, so root-cause participation was not assessed."
    if not n:
        return (f"Root-cause participation could not be established from configuration for any of the "
                f"{total} enabled detectors. This is not a clean result — the configuration-side read "
                f"can only prove exclusion, never participation.")
    return (f"At least {n} of {total} enabled detectors cannot participate in root-cause analysis "
            f"({summary['basis']}), so their alerts arrive with no root cause and a single affected entity.")


def main():
    ap = argparse.ArgumentParser(description="C-rcrel — RCA participation from detector configuration")
    ap.add_argument("path", help="a saved `dtctl get anomaly-detectors -o json` dump (redacted is fine)")
    ap.add_argument("--all", action="store_true", help="include disabled detectors in the rollup")
    a = ap.parse_args()

    data = json.load(open(a.path))
    detectors = data.get("result", data) if isinstance(data, dict) else data
    summary, rows = summarize(detectors, enabled_only=not a.all)
    print(json.dumps(summary, indent=1))
    print(phrase(summary), file=sys.stderr)


if __name__ == "__main__":
    main()
