#!/usr/bin/env python3
"""assemble_findings.py — build findings.json end to end, in one script.

The ONE place that:
  1. computes the pillars and composite via `scoring.py` (never re-derived by hand),
  2. names its meta keys via `findings_schema.assemble_meta()` (never typed per run), and
  3. merges in the qualitative content the analyst authored this run — dispositions,
     the worklist, the two Phase-4 confirmations — which are judgment calls this
     script cannot compute, so they arrive as files.

**The gated case is a normal outcome, not an error.** Below the adoption floor this
still writes a valid findings.json — one carrying `gated: true`, the headline label and
the `no_grade_reason` string `finalize` needs, and no score. A caller never has to catch
an exception to write a deliverable for a tenant that has not built enough OpenPipeline
configuration to be graded.

Usage — scored:

    python3 assemble_findings.py --out runs/<id>/findings.json \\
        --n-authored 30 --routing-entries 29 --dangling 1 --shadowed 0 --no-catch-all \\
        --signal-types-covered 1 --classic-pending 1 --masking-coverage 0.0 \\
        --affected-pipelines 2 --window "7d" \\
        --customer "Acme Corp" --tenant abc12345 \\
        [--capacity capacity.json] [--worklist worklist.json] \\
        [--orphans orphans.json] [--confirmations confirmations.json]

Usage — gated, inventory unreadable (the adoption_not_assessable gate):
    python3 assemble_findings.py --out findings.json \\
        --n-authored not-assessable --routing-entries 7 --catch-all --window 7d

Usage — gated (below the adoption floor). Pass the real `--n-authored`; do NOT omit it
or pass a placeholder, which would claim a measured-but-different estate:

    python3 assemble_findings.py --out runs/<id>/findings.json \\
        --n-authored 3 --routing-entries 4 --catch-all --window 7d

Each `--capacity` / `--worklist` / `--orphans` / `--confirmations` file is just the JSON
value that slots into findings.json at that key. Write them with any tool; this script
merges and validates, it does not author the analysis.
"""
import argparse
import json
import sys

import findings_schema
import scoring


def _load(path):
    if not path:
        return None
    with open(path) as f:
        return json.load(f)


def build(a):
    """Compute pillars, assemble meta, merge analyst content. Returns findings dict."""
    routing = (scoring.routing_integrity(a.routing_entries, a.dangling, a.shadowed,
                                         a.catch_all, a.fall_through_pct)
               if a.routing_entries else None)
    breadth = scoring.native_adoption_breadth(a.signal_types_covered, a.classic_pending,
                                              a.masking_coverage)
    hygiene = scoring.structural_hygiene(a.n_authored, a.affected_pipelines,
                                         a.affected_weight, a.total_weight)

    meta = findings_schema.assemble_meta(
        window=a.window,
        n_authored=a.n_authored,
        routing_integrity=routing,
        native_adoption_breadth=breadth,
        structural_hygiene=hygiene,
        customer=a.customer,
        tenant=a.tenant,
        confidence_basis=a.confidence_basis,
        window_note=a.window_note,
        # Only meaningful on a gated run, and harmless otherwise: it is what
        # report_helpers.gated_notice branches on to tell a tooling gap (fixed by
        # an export) from an access gap (fixed by a grant) on the cover.
        diagnosis=a.diagnosis,
        # The cover's scale line. Carried on a GATED run too: the estate size is
        # exactly what a gated report still has to state, and rendering 0 there
        # asserts the count the gate exists to say could not be established.
        routing_entries=a.routing_entries,
        signal_types_covered=a.signal_types_covered,
        # Findings-side, deliberately outside the arithmetic (pipeline-ruleset.json's
        # `scored: false` rules). A typo in any of these keys fails the schema rather
        # than vanishing from the report.
        capacity_pressure=_load(a.capacity),
        consolidation_worklist=_load(a.worklist),
        orphan_pipelines=_load(a.orphans),
        governance_drift_families=_load(a.governance_drift),
        near_duplicate_families=_load(a.near_duplicates),
        duplicate_collection_paths=_load(a.duplicate_collectors),
        extension_default_pipelines=a.extension_pipelines,
        confirmations=_load(a.confirmations),
    )
    return {"meta": meta}


def main():
    ap = argparse.ArgumentParser(description="Build findings.json for /dt-eval-openpipeline")
    ap.add_argument("--out", required=True)
    ap.add_argument("--window", required=True,
                    help="the throughput window, e.g. '7d'. Configuration reads are "
                         "point-in-time and carry no window — say so in --window-note")
    ap.add_argument("--window-note")

    ap.add_argument("--n-authored", type=scoring.n_authored_arg, required=True,
                    help="customer-authored pipelines AFTER the externalId ownership "
                         "partition — the adoption gate's denominator. Pass "
                         f"{scoring.NOT_ASSESSABLE!r} when the pipeline objects could not "
                         "be read; never 0, which asserts the tenant has none.")
    ap.add_argument("--routing-entries", type=int, default=0)
    ap.add_argument("--dangling", type=int, default=0)
    ap.add_argument("--shadowed", type=int, default=0)
    ap.add_argument("--catch-all", dest="catch_all", action="store_true", default=None)
    ap.add_argument("--no-catch-all", dest="catch_all", action="store_false")
    ap.add_argument("--fall-through-pct",
                    type=scoring.not_assessable_arg(float, "a 0-100 share"), default=None,
                    help="MEASURED share (0-100) of records reaching the default bucket. "
                         "Scales the missing-catch-all penalty. Pass "
                         f"{scoring.NOT_ASSESSABLE!r} (or omit) when not measured — "
                         "never pass 0, which claims a measured-and-perfect result on no "
                         "evidence and earns the lightest penalty for the least proof")
    ap.add_argument("--signal-types-covered", type=int, default=0)
    ap.add_argument("--classic-pending",
                    type=scoring.not_assessable_arg(int, "an integer"), default=None,
                    help="A29 residue count. Pass "
                         f"{scoring.NOT_ASSESSABLE!r} (or omit) when the read failed (⚪) — "
                         "never pass 0. NOTE this read is ⚪ on every tenant since the "
                         "`classic-pipelines-translation` verb was removed in dtctl 0.38.0, "
                         "so the not-assessable path is now the normal one")
    ap.add_argument("--masking-coverage",
                    type=scoring.not_assessable_arg(float, "a 0-1 share"), default=None,
                    help="0-1 share. Pass "
                         f"{scoring.NOT_ASSESSABLE!r} (or omit) when not assessable (⚪) — "
                         "never pass 0")
    ap.add_argument("--affected-pipelines", type=int, default=0,
                    help="DISTINCT customer-authored pipelines with >=1 hygiene defect "
                         "(count once — never a sum of per-defect counts)")
    ap.add_argument("--affected-weight", type=float, default=None,
                    help="summed max(1, processor_count) over the AFFECTED pipelines. "
                         "Weights the hygiene pillar by how much configuration is "
                         "disconnected, so two empty shells and two 670-processor PII "
                         "pipelines stop scoring alike. Omit to fall back to the count")
    ap.add_argument("--total-weight", type=float, default=None,
                    help="the same sum over all --n-authored pipelines")

    ap.add_argument("--customer")
    ap.add_argument("--tenant")
    ap.add_argument("--diagnosis",
                    help="which kind of not-assessable this is — pass diagnose_pipelines.py's\n"
                         "`diagnosis` value verbatim. It decides the cover wording: a tooling\n"
                         "gap (definitions on a surface dtctl cannot reach — an EXPORT fixes it,\n"
                         "a permission grant does not) reads differently to a customer than a\n"
                         "genuine access denial. Omitted, the notice asserts neither.")
    ap.add_argument("--confidence-basis")
    ap.add_argument("--extension-pipelines", type=int, default=None)

    for flag in ("capacity", "worklist", "orphans", "governance-drift",
                 "near-duplicates", "duplicate-collectors", "confirmations"):
        ap.add_argument(f"--{flag}", help=f"JSON file for the {flag.replace('-', ' ')} block")

    a = ap.parse_args()
    findings = build(a)
    with open(a.out, "w") as f:
        json.dump(findings, f, indent=1)

    m = findings["meta"]
    if m.get("gated"):
        print(f"WROTE {a.out} — GATED ({m['reason']}): {m['no_grade_reason']}")
        print(f"  headline: {m['headline_label']}  (no score by design)")
    else:
        print(f"WROTE {a.out} — {m['score']} {m['grade']} ({m['grade_label']}), "
              f"confidence {m['confidence']}")
        print(f"  pillars: {json.dumps({k: m[k] for k in scoring.WEIGHTS if k in m})}")
        if m.get("renormalized"):
            print("  NOTE: renormalized — a pillar was ⚪; say so wherever the score appears")
    return 0


if __name__ == "__main__":
    sys.exit(main())
