#!/usr/bin/env python3
"""build_openpipeline_report.py — render the client-ready .docx from run.json + findings.json.

Structure is output-spec.md §1; every number comes from findings.json (built by
assemble_findings.py, validated by findings_schema.py) so the report cannot invent
a figure the run never measured.

    python3 build_openpipeline_report.py \\
        --run runs/<tenant>-<date>/run.json \\
        --findings runs/<tenant>-<date>/findings.json \\
        --content content.json \\
        [--audience external|internal] [--out-dir <dir>] [--grades]

`content.json` carries the analyst's prose — the thesis sentence, the findings, the
sequenced plan. This script computes nothing and authors nothing; it lays out what the
run measured and what the analyst concluded. See `--print-content-schema`.

**The gated path is a first-class outcome.** With `meta.gated` the cover carries no score
and no grade, the adoption notice instead, and the findings still render — a tenant below
the floor gets a real report, not a stub.
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / ".dt-eval-common"))

import docx_style as ds  # noqa: E402
from report_builder import (next_version_number, save_scan_supersede,  # noqa: E402
                            resolve_customer_dir, resolve_delivery_dir)
from build_reports import resolve_output_root  # noqa: E402
import report_helpers as rh  # noqa: E402

CONTENT_SCHEMA = {
    "thesis": "one-sentence executive thesis",
    "drivers": ["3-5 bullet strings tied to operational impact"],
    "what_to_do_first": "one paragraph",
    "picture": {"note": "prose for the routing/pipeline picture section",
                "bucket_rows": [["bucket", "records", "share"]]},
    "scorecard": [{"area": "", "measured": "", "status": "healthy|opportunity|attention",
                   "action": ""}],
    "findings": [{"heading": "", "status": "attention|opportunity|healthy",
                  "what": "", "means": "", "why": "", "consequence": "",
                  "evidence": ["..."], "action": ["sequenced steps"],
                  "reproduction": {"query": "plain DQL", "note": "", "sample": ["<=5"]}}],
    "plan": {"Now": [["item", "why"]], "Next": [], "Later": []},
    "verify": {"note": "UI locations and standing instruments only — never repeat a "
                       "query a finding already shows", "queries": [["label", "dql"]]},
    "appendix": {"method": "client-safe method note", "not_assessed": ["..."],
                 "references": ["docs.dynatrace.com/..."]},
}


def resolve_out(out_dir: Path, tenant: str, date: str, audience: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{tenant}-OpenPipeline-{date}"
    if audience == "internal":
        stem = f"[INTERNAL ONLY]-{stem}"
    n = next_version_number(out_dir, stem, ".docx")
    while (out_dir / f"{stem}(v{n}).docx").exists():
        n += 1
    return out_dir / f"{stem}(v{n}).docx"


def build(run, findings, content, audience, out_path, grades=False):
    m = findings["meta"]
    gated = bool(m.get("gated"))
    internal = audience == "internal"
    # Owner rule 2026-08-25 — the customer edition carries no score, grade badge,
    # dial or pillar scores unless this run was explicitly asked to grade it.
    # `gated` (the adoption floor) already suppressed the headline for its own
    # reason; the two conditions are independent and both must hold for a score
    # to print.
    graded = ds.grades_enabled(internal, grades)
    meta = run.get("meta", {})
    customer = m.get("customer") or meta.get("customer")
    tenant_url = meta.get("tenant_url")

    doc = ds.new_report_doc(internal=internal)

    # ── 1. Cover ────────────────────────────────────────────────────────────
    gauge = None
    if not gated and graded:
        try:
            # A build intermediate, not an artifact — it belongs in a temp dir, not
            # beside the script where it lands untracked in the skill directory and
            # invites someone to commit it. SKILL.md input #4 says the same.
            gauge = str(Path(tempfile.gettempdir()) / f"dt-eval-op-gauge-{os.getpid()}.png")
            ds.render_gauge_png(m["score"], gauge)
        except Exception:
            gauge = None  # Pillow optional — the text badge stands alone

    # These are MEASUREMENTS and belong in the assembled meta, not in the prose
    # file: `content` is hand-authored, its schema never documented these keys, and
    # reading them there rendered "0 routing entries" on every report whose author
    # did not guess at an undocumented field. `content` is still honoured as a
    # fallback so an existing content file keeps working.
    # ABSENT means NOT ESTABLISHED, never 0. `normalize_meta` drops None values, so
    # on the adoption_not_assessable gate `n_authored` is missing from meta entirely
    # — and a `.get(key, 0)` turns the one count the gate exists to withhold into a
    # stated zero on the cover. These are measurements, so they come from the
    # assembled meta; `content` is honoured only as a fallback for an older content
    # file that hand-carried them.
    def scale(key, content_key):
        if m.get(key) is not None:
            return m[key]
        return content.get(content_key)

    subtitle = rh.scale_stat_line(
        scale("n_authored", "n_authored"),
        scale("routing_entries", "routing_entries"),
        scale("signal_types_covered", "scopes_covered"))
    if gated:
        # `diagnosis` decides which not-assessable sentence the cover carries: a
        # tooling gap is fixed by an export and a grant would not help, so saying
        # "the access available for this review" there sends the customer to raise
        # a request that cannot succeed (v1.37.0's correction, which landed in
        # diagnose_pipelines.py's remedy field and not on the cover).
        subtitle = rh.gated_notice(m.get("n_authored"), m.get("adoption_floor"),
                                   m.get("reason"), m.get("diagnosis")) \
            + "  —  " + subtitle
    if internal:
        # The mandated internal-distribution notice rides in `subtitle` (docx_style
        # .cover_page), so composing a subtitle here must PREPEND it rather than
        # replace it — otherwise every internal edition ships without the marking
        # and verify_docx fails it at the cover.
        subtitle = "Dynatrace internal — not for customer distribution  —  " + subtitle

    ds.cover_page(
        doc, customer=customer, tenant_url=tenant_url,
        overall=None if gated else m["score"],
        grade_letter=None if gated else m["grade"],
        grades=grades,
        title="Dynatrace OpenPipeline Configuration Review",
        subtitle=subtitle,
        gauge_path=gauge,
        requested_by=meta.get("requested_by"),
        internal=internal,
    )

    # ── 2. Executive summary ────────────────────────────────────────────────
    doc.add_heading("Executive summary", level=1)
    ds.para(doc, content["thesis"])
    rh.bullets(doc, content.get("drivers", []))
    ds.para(doc, content["what_to_do_first"])

    # ── 3. How to read this ─────────────────────────────────────────────────
    doc.add_heading("How to read this", level=1)
    ds.para(doc, "✅ healthy · 💡 opportunity · ⚠️ needs attention. Items that could not "
                 "be assessed with the access available for this review are listed in the "
                 "appendix, with the access that would include them.")
    ds.para(doc, rh.ownership_note(m.get("n_authored", 0),
                                   m.get("extension_default_pipelines")))

    # ── 4. The routing and pipeline picture ─────────────────────────────────
    doc.add_heading("The routing and pipeline picture", level=1)
    ds.para(doc, content["picture"]["note"])
    if not gated:
        labels = {"routing_integrity": "Routing integrity",
                  "native_adoption_breadth": "Native adoption breadth",
                  "structural_hygiene": "Structural hygiene"}
        pillars = {labels[k]: m[k] for k in ("routing_integrity",
                                             "native_adoption_breadth",
                                             "structural_hygiene") if k in m}
        # Two fixes travelling with the grades option, both live defects. The
        # display names are applied to the KEYS here: `labels=` on
        # pillar_summary_table is the GRADE vocabulary (letter -> word), so
        # passing the pillar map there left the table resolving grade labels from
        # nothing and falling back to the INTERNAL vocabulary on a customer
        # document. And `weights_used` is present on every run, so the Weight
        # column — internal machinery, banned externally — was printing on the
        # customer edition; it is now passed only for the internal one.
        ds.pillar_summary_table(doc, pillars,
                                m.get("weights_used") if internal else None,
                                labels=ds.report_labels(internal),
                                internal=internal, grades=grades)
        if graded:
            ds.pillar_bar_chart(doc, pillars, internal=internal, grades=grades)
    if content["picture"].get("bucket_rows"):
        rh.bucket_table(doc, content["picture"]["bucket_rows"], ds)

    # ── 5. Findings ─────────────────────────────────────────────────────────
    doc.add_heading("Findings", level=1)
    if content.get("scorecard"):
        ds.scorecard_table(doc, content["scorecard"])
    for f in content.get("findings", []):
        ds.finding_section(
            doc, heading=f["heading"], status=f["status"], what=f["what"],
            means=f.get("means"), why=f.get("why"), consequence=f.get("consequence"),
            evidence_lines=f.get("evidence", []), action=f.get("action"),
            reproduction=f.get("reproduction"),
        )

    # ── 6. The plan ─────────────────────────────────────────────────────────
    doc.add_heading("The plan", level=1)
    for when in ("Now", "Next", "Later"):
        items = (content.get("plan") or {}).get(when) or []
        if not items:
            continue
        doc.add_heading(when, level=2)
        rh.numbered(doc, [(a, b) for a, b in items])

    # ── 7. Verifying and re-measuring ───────────────────────────────────────
    doc.add_heading("Verifying and re-measuring", level=1)
    ds.para(doc, content["verify"]["note"])
    for label, q in content["verify"].get("queries", []):
        ds.para(doc, label, bold=True)
        ds.code_block(doc, q)

    # ── 8. Appendix ─────────────────────────────────────────────────────────
    doc.add_heading("Appendix", level=1)
    ds.method_note(doc, content["appendix"]["method"])
    if content["appendix"].get("not_assessed"):
        doc.add_heading("Not assessed in this review", level=2)
        rh.bullets(doc, content["appendix"]["not_assessed"])
    if content["appendix"].get("references"):
        doc.add_heading("References", level=2)
        rh.bullets(doc, content["appendix"]["references"])

    ds.finalize_tables(doc)
    profile = "internal" if Path(out_path).name.startswith("[INTERNAL ONLY]") else "detailed"
    save_scan_supersede(doc, out_path, profile,
                        subject=[content.get("customer"), content.get("tenant")],
                        grades=grades)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Build the OpenPipeline .docx")
    ap.add_argument("--run"); ap.add_argument("--findings"); ap.add_argument("--content")
    ap.add_argument("--audience", choices=["external", "internal"], default="external")
    ap.add_argument("--out-dir")
    ap.add_argument("--grades", action="store_true",
                    help="carry the score, grade badge, dial and pillar scores on an "
                         "EXTERNAL edition too. Off by default — grades are never "
                         "automatically included on a customer-facing document. The "
                         "internal edition is graded either way.")
    ap.add_argument("--print-content-schema", action="store_true")
    a = ap.parse_args()

    if a.print_content_schema:
        print(json.dumps(CONTENT_SCHEMA, indent=1))
        return 0
    for req in ("run", "findings", "content"):
        if not getattr(a, req):
            ap.error(f"--{req} is required")

    run = json.loads(Path(a.run).read_text())
    findings = json.loads(Path(a.findings).read_text())
    content = json.loads(Path(a.content).read_text())

    tenant = run["meta"]["tenant"]
    date = Path(a.run).parent.name[-10:]
    # Defaulting to the run directory filed customer deliverables INSIDE the repo
    # and ignored DT_EVAL_OUTPUT_DIR, which this skill's SKILL.md says to resolve.
    # Two consequences, both silent: a stray .docx in a gitignored run dir, and
    # /dt-eval-rollup never seeing the report — it globs
    # <root>/<customer>/current/*OpenPipeline*.docx, so a report filed elsewhere
    # drops this skill's column from the dashboard with no error anywhere. Every
    # other builder in the family resolves the output root; this one did not.
    if a.out_dir:
        out_dir = Path(a.out_dir)
    else:
        customer = (findings.get("meta", {}).get("customer")
                    or run.get("meta", {}).get("customer"))
        if not customer:
            ap.error("no --out-dir given and neither findings.json nor run.json "
                     "names a customer, so the delivery folder cannot be resolved")
        out_dir = resolve_delivery_dir(resolve_output_root(), customer, tenant)
    out = resolve_out(out_dir, tenant, date, a.audience)
    build(run, findings, content, a.audience, out, grades=a.grades)
    print(f"WROTE {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
