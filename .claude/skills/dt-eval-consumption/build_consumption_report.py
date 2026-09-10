#!/usr/bin/env python3
"""Effective Consumption Review builder — structure only, ZERO canned content.

This skill had no committed report builder until 2026-08-11. Every run
hand-wrote one in the session scratchpad and threw it away, so nothing enforced
the rules the skill documents: the external voice, "active engagement never
vanity metrics", the ban on dollar figures beside customer numbers, and the ⚪
appendix rule. Disposable code was producing client deliverables, and on a
sibling skill that same gap shipped four customer-facing reports in the internal
diagnostic voice before anyone noticed.

Same contract as the shared `build_reports.py` scaffold: structure here, every
number and sentence from a per-run content module, and a missing required field
RAISES rather than shipping a placeholder. Never put content literals here.

Usage:
  python3 build_consumption_report.py <run_dir> <content.py> [--external] [--internal]

The content module lives in the SESSION SCRATCHPAD (it holds tenant data — never
commit it) and defines CONTENT, a dict with:

  oes               int             0-100 Overall Effective Score, the headline
  grade_letter      str             "A".."D"
  confidence        str             High | Medium | Low — the LOWEST pillar flag
  executive_summary [str, ...]      paragraphs
  pillars           {name: score}   Signals / Automation / Foundation / Engagement
  pillar_confidence {name: flag}    per-pillar High|Medium|Low
  scorecard         [{area, measured, status, action}, ...]   DICTS, not lists —
                    this renders through docx_style.scorecard_table. The tenant
                    Configuration Review's scaffold takes the list form instead;
                    the two renderers differ and this docstring said the wrong one
                    until 2026-08-26, which cost a rebuild.
  context_rows      [[measure, value, what it says], ...]   context, never scored
  findings          [{title, status, what, why, means, consequence,
                      remediation:[str,...], reproduction:{...}}, ...]
  plan              [[when, action, outcome], ...]
  verification      [[label, query, note], ...]
  scope_notes       [str, ...]      the ⚪ roster — appendix only, never the body
  foundation_note   str             why Foundation reads as it does
  derivation        [[pillar, weight, score, contribution, confidence], ...] (internal)
  talk_tracks       {finding_title: [str, ...]}                              (internal)

The per-pillar confidence flag is rendered wherever a pillar score appears: the
rubric makes a Low flag meaningless unless it travels with the number it
qualifies, and a pillar resolved from two checks is not the same evidence as one
resolved from two hundred.
"""
import argparse
import importlib.util
import pathlib
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / ".dt-eval-common"))

import docx_style  # noqa: E402
from docx_style import (finding_section, finalize_tables, render_gauge_png,  # noqa: E402
                        para, scorecard_table, pillar_bar_chart, code_block)
from report_builder import ReportBuilder, save_scan_supersede  # noqa: E402
from build_reports import resolve_output_root  # noqa: E402



def _as_lines(value, title, field):
    """Bulleted fields are lists; a bare string would be bulleted per character.

    Twelve deliverables shipped with a page of single-character bullets before
    anyone opened one (2026-08-11), because a string satisfies every truthiness
    and iterability check on the way to `add_paragraph`. Refuse it here.
    """
    if isinstance(value, (str, bytes)):
        raise TypeError(
            f"{title!r}: {field} must be a list of strings, not a single string — "
            f"a string is bulleted one character at a time. Got: {value[:80]!r}...")
    return value

class MissingContentError(ValueError):
    """A required content field is absent — the build must not proceed."""


REQUIRED = ("oes", "grade_letter", "confidence", "executive_summary", "pillars",
            "pillar_confidence", "scorecard", "findings", "plan", "verification")
REQUIRED_FINDING = ("title", "status", "what", "why", "means", "consequence",
                    "remediation", "reproduction", "evidence")


def load_content(path, tenant=None):
    spec = importlib.util.spec_from_file_location("ec_content", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    content = module.CONTENT
    if tenant and tenant in content and isinstance(content[tenant], dict):
        return content[tenant]
    if tenant and not any(k in content for k in REQUIRED):
        raise MissingContentError(
            f"content module has no entry for tenant {tenant!r} and is not a content dict "
            f"itself — a build must never fall back to another tenant's narrative.")
    return content


class ConsumptionReport(ReportBuilder):
    def __init__(self, run_dir, content, grades=False):
        super().__init__(pathlib.Path(run_dir), resolve_output_root(),
                         docx_style_module=docx_style)
        self.c = content
        # Owner rule 2026-08-25: no OES, grade badge, dial or pillar scores on the
        # customer edition unless this run was explicitly asked to grade it. The
        # pillar CONFIDENCE flags stay — a confidence flag qualifies evidence, it
        # does not rank the customer.
        self.grades = grades
        for key in REQUIRED:
            if not content.get(key):
                raise MissingContentError(
                    f"required content field {key!r} is missing or empty. Write it from this "
                    f"run's evidence — this builder contains no content.")
        for f in content["findings"]:
            for key in REQUIRED_FINDING:
                if not f.get(key):
                    raise MissingContentError(
                        f"finding {f.get('title', '<untitled>')!r} is missing {key!r} — a "
                        f"finding that stops at a number is unfinished.")
            if f["status"] == "unknown":
                raise MissingContentError(
                    f"finding {f['title']!r} is ⚪ and cannot appear in the body. Move it to "
                    f"`scope_notes` with the access that would include it (CLAUDE.md rule 3).")
        missing_flag = set(content["pillars"]) - set(content["pillar_confidence"])
        if missing_flag:
            raise MissingContentError(
                f"pillars {sorted(missing_flag)} have no confidence flag. The rubric requires the "
                f"flag to travel with the score it qualifies — a pillar resolved from two checks "
                f"is not the evidence a pillar resolved from two hundred is.")

    def build(self, internal):
        c = self.c
        graded = docx_style.grades_enabled(internal, self.grades)
        doc = docx_style.new_report_doc(internal=internal)

        gauge = pathlib.Path(tempfile.gettempdir()) / f"gauge-{self.meta.tenant}-ec.png"
        if graded:
            render_gauge_png(c["oes"], str(gauge))
        docx_style.cover_page(
            doc, self.meta.customer, self.meta.tenant_url, c["oes"], c["grade_letter"],
            title="Dynatrace Effective Consumption Review",
            subtitle=("Dynatrace internal — not for customer distribution" if internal else None),
            internal=internal, requested_by=self.meta.requested_by,
            date=self.cover_date,
            grades=self.grades,
            gauge_path=str(gauge) if graded and gauge.exists() else None)
        para(doc,
             (f"Overall Effective Score {c['oes']} · confidence {c['confidence']}"
              if graded else f"Confidence {c['confidence']}"),
             size=10, italic=True)
        if internal:
            self._add_internal_notice(doc)
        doc.add_page_break()

        doc.add_heading("Executive summary", level=1)
        for p in c["executive_summary"]:
            doc.add_paragraph(p)

        if internal and c.get("derivation"):
            doc.add_heading("Score composition", level=1)
            t = doc.add_table(rows=1, cols=5)
            t.style = "Light Grid Accent 1"
            for i, h in enumerate(("Pillar", "Weight", "Score", "Contribution", "Confidence")):
                t.rows[0].cells[i].text = h
            for row in c["derivation"]:
                cells = t.add_row().cells
                for i, v in enumerate(row):
                    cells[i].text = str(v)
        else:
            doc.add_heading("How to read this report", level=1)
            doc.add_paragraph(
                "Status legend: ✅ = Healthy, 💡 = Opportunity, ⚠️ = Needs attention. Items not "
                "assessed in this review are listed in the appendix. This review measures how "
                "effectively the platform is used — sustained, active engagement rather than "
                "object counts — so a large estate with little recurring use scores lower than a "
                "smaller one that is worked daily.")

        doc.add_heading("Scorecard", level=1)
        if graded:
            pillar_bar_chart(doc, c["pillars"], title="Effective consumption by pillar",
                             internal=internal, grades=self.grades)
        doc.add_paragraph()
        # Ungraded: Pillar | Status | Confidence — the same four pillars, read
        # qualitatively. The confidence flag stays in both readings; it is what
        # tells the customer how much evidence stands behind the status.
        headers = ("Pillar", "Score", "Confidence") if graded \
            else ("Pillar", "Status", "Confidence")
        t = doc.add_table(rows=1, cols=3)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(headers):
            t.rows[0].cells[i].text = h
        for name, score in c["pillars"].items():
            cells = t.add_row().cells
            cells[0].text = name
            if graded:
                cells[1].text = str(score)
            else:
                icon, label, _ = docx_style.status_parts(docx_style.score_status(score))
                cells[1].text = f"{icon} {label}"
            cells[2].text = c["pillar_confidence"][name]
        doc.add_paragraph()
        scorecard_table(doc, c["scorecard"])

        if c.get("context_rows"):
            doc.add_heading("Context measurements", level=2)
            doc.add_paragraph(
                "These are reported for context and are deliberately not scored — an estimate or "
                "an estate-size measure would distort a score built on sustained use.")
            t = doc.add_table(rows=1, cols=3)
            t.style = "Light Grid Accent 1"
            for i, h in enumerate(("Measure", "Value", "What it says")):
                t.rows[0].cells[i].text = h
            for row in c["context_rows"]:
                cells = t.add_row().cells
                for i, v in enumerate(row):
                    cells[i].text = str(v)

        doc.add_page_break()
        doc.add_heading("Findings", level=1)
        talk = c.get("talk_tracks", {}) if internal else {}
        for f in c["findings"]:
            finding_section(doc, f["title"], f["status"], f["what"], f["why"],
                            f["evidence"], f["remediation"], means=f["means"],
                            consequence=f["consequence"], reproduction=f["reproduction"])
            if internal and f["title"] in talk:
                doc.add_heading("Talk-track and expansion hooks", level=3)
                for line in _as_lines(talk[f["title"]], f["title"], "talk_tracks"):
                    doc.add_paragraph(line, style="List Bullet")

        doc.add_page_break()
        doc.add_heading("Priority action plan", level=1)
        t = doc.add_table(rows=1, cols=3)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("When", "Action", "Outcome")):
            t.rows[0].cells[i].text = h
        for row in c["plan"]:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = str(v)

        doc.add_heading("Verify these findings yourself", level=1)
        doc.add_paragraph(
            "Every finding above carries the query that produced its numbers, directly beneath "
            "the measurement it supports. The checks below have no single finding to sit under.")
        for label, query, note in c["verification"]:
            head = doc.add_paragraph(style="List Bullet 2")
            head.add_run(f"{label}:").bold = True
            head.paragraph_format.keep_with_next = True
            if query:
                code_block(doc, query)
            if note:
                doc.add_paragraph(note, style="List Bullet 3")

        self._add_appendix(
            doc,
            not_assessed=c.get("scope_notes"),
            references=c.get("references"),
            extra=([("On the foundation score", c["foundation_note"])]
                   if c.get("foundation_note") else None))

        finalize_tables(doc)
        audience = "internal" if internal else "external"
        out = self._build_output_path("effective-consumption", audience=audience)
        return save_scan_supersede(doc, out, "internal" if internal else "consumption",
                                   grades=self.grades,
                                   subject=[self.meta.customer, self.meta.tenant])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("content", help="per-run content module defining CONTENT (scratchpad only)")
    ap.add_argument("--external", action="store_true")
    ap.add_argument("--internal", action="store_true")
    ap.add_argument("--grades", action="store_true",
                    help="carry the OES, grade badge, dial and pillar scores on the "
                         "EXTERNAL edition too. Off by default — grades are never "
                         "automatically included on a customer-facing document. The "
                         "internal edition is graded either way.")
    a = ap.parse_args()
    if not (a.external or a.internal):
        ap.error("choose at least one of --external / --internal")

    tenant = pathlib.Path(a.run_dir).name.rsplit("-", 3)[0]
    report = ConsumptionReport(a.run_dir, load_content(pathlib.Path(a.content), tenant),
                               grades=a.grades)
    built = []
    if a.external:
        built.append(("External", report.build(internal=False)))
    if a.internal:
        built.append(("Internal", report.build(internal=True)))
    for label, path in built:
        if not pathlib.Path(path).exists():
            sys.exit(f"ERROR: {label} report missing on re-stat: {path}")
        print(f"✅ {label}: {path}")


if __name__ == "__main__":
    main()
