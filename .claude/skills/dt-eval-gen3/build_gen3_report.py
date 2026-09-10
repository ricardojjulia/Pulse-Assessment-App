#!/usr/bin/env python3
"""Gen3 Migration Progress report builder — structure only, ZERO canned content.

This skill had no committed report builder until 2026-08-11. Every run
hand-wrote one in the session scratchpad and threw it away, so nothing enforced
the rules the skill documents: the external voice, the "never a classic-construct
recommendation" rule, the per-domain WHY+HOW remediation, or the appendix a ⚪
domain is required to land in. Disposable code was producing client deliverables,
and on a sibling skill that same gap shipped four customer-facing reports in the
internal diagnostic voice before anyone noticed.

Same contract as the shared `build_reports.py` scaffold: the structure lives
here, every number and every sentence comes from a per-run content module
written fresh from that run's evidence, and a missing required field RAISES
rather than shipping a placeholder. Never put content literals in this file.

Usage:
  python3 build_gen3_report.py <run_dir> <content.py> [--external] [--internal]

The content module lives in the SESSION SCRATCHPAD (it holds tenant data — never
commit it) and defines CONTENT, a dict with:

  migration_pct     int             0-100, the headline
  grade_letter      str             "A".."D"
  confidence        str             High | Medium | Low
  executive_summary [str, ...]      paragraphs
  domain_table      [[domain, native mechanism, status, effort], ...]
  domains           [{title, status, what, why, means, consequence,
                      remediation:[str,...], reproduction:{...}}, ...]
  not_assessable    [str, ...]      the ⚪ roster — appendix only, never the body
  glossary          [[classic construct, native mechanism, what changes], ...]
  derivation        [[domain, weight, score, contribution, confidence], ...]  (internal)
  talk_tracks       {domain_title: [str, ...]}                                (internal)

Two rules this builder enforces mechanically, because both were prose-only:
  - a domain finding must carry `remediation`, and the skill's own rule is that
    a remediation never says "delete this" without naming the native replacement
    first — `finding_section` renders it as sequenced steps so the WHY+HOW shape
    is visible rather than assumed;
  - ⚪ domains go to `not_assessable` and are refused in `domains`, so an
    unassessable domain cannot reach the body (CLAUDE.md hard rule 3).
"""
import argparse
import importlib.util
import json
import pathlib
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / ".dt-eval-common"))

import docx_style  # noqa: E402
from docx_style import (finding_section, finalize_tables, render_gauge_png,  # noqa: E402
                        para, rag_summary, code_block)
from report_builder import ReportBuilder, save_scan_supersede  # noqa: E402
from build_reports import resolve_output_root  # noqa: E402
from report_builder import includes_section  # noqa: E402

# The C6 deliverable type, and the key this skill's audience scoping is
# registered under (report_builder._AUDIENCE_CONFIG). Asking rather than
# deciding locally is what keeps report-audiences.md and the built page in
# agreement -- the doc describes a six-part internal structure that a
# migration report cannot carry, and every builder used to resolve that
# privately in an `if internal:` branch.
DELIVERABLE = "gen3_migration"

# This deliverable measures progress toward a native target, so it speaks the
# progress vocabulary: ✅ Complete / 💡 In progress / ⚠️ Not started. Until the
# C4 palette landed it could only say that in its legend prose, while every
# domain heading underneath rendered the health words — a report that
# contradicted its own legend on the same page.
PALETTE = "progress"



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


REQUIRED = ("migration_pct", "grade_letter", "confidence", "executive_summary",
            "domain_table", "domains", "glossary")
REQUIRED_DOMAIN = ("title", "status", "what", "why", "means", "consequence",
                   "remediation", "reproduction", "evidence")


def load_content(path, tenant=None):
    spec = importlib.util.spec_from_file_location("gen3_content", str(path))
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


class Gen3Report(ReportBuilder):
    def __init__(self, run_dir, content, grades=False):
        super().__init__(pathlib.Path(run_dir), resolve_output_root(),
                         docx_style_module=docx_style)
        self.c = content
        # Owner rule 2026-08-25 — grades are an option, never automatic on a
        # customer-facing document. What that costs THIS deliverable is smaller
        # than it first looks, because the completeness percentage is a PROGRESS
        # headline and progress is exempt (owner decision, same day): the cover
        # keeps "Migration Completeness: N%" in every audience, and the customer
        # edition loses only the A–D badge beside it and the grade-band dial.
        # Everything that tells the reader what to DO is untouched — per-domain
        # ✅/💡/⚠️ statuses, the domain breakdown, every finding, every sequenced
        # retirement step. Pass --grades when the engagement wants the letter too.
        self.grades = grades
        for key in REQUIRED:
            if not content.get(key):
                raise MissingContentError(
                    f"required content field {key!r} is missing or empty. Write it from this "
                    f"run's evidence — this builder contains no content.")
        for d in content["domains"]:
            for key in REQUIRED_DOMAIN:
                if not d.get(key):
                    raise MissingContentError(
                        f"domain {d.get('title', '<untitled>')!r} is missing {key!r}. Every "
                        f"domain needs its native replacement and the steps to get there — a "
                        f"count without a 'here's how' is incomplete (SKILL.md).")
            if d["status"] == "unknown":
                raise MissingContentError(
                    f"domain {d['title']!r} is ⚪ and cannot appear in the body. Move it to "
                    f"`not_assessable`, naming the access that would include it next time "
                    f"(CLAUDE.md hard rule 3).")

    def build(self, internal):
        c = self.c
        audience = "internal" if internal else "external"
        graded = docx_style.grades_enabled(internal, self.grades)
        doc = docx_style.new_report_doc(internal=internal)

        gauge = pathlib.Path(tempfile.gettempdir()) / f"gauge-{self.meta.tenant}-gen3.png"
        if graded:
            # The dial's arcs are the A–D bands, so it is a grade drawn rather
            # than written — it goes with the letter, even though the number it
            # points at stays.
            render_gauge_png(c["migration_pct"], str(gauge))
        docx_style.cover_page(
            doc, self.meta.customer, self.meta.tenant_url,
            c["migration_pct"], c["grade_letter"],
            title="Dynatrace Gen3 Migration Progress",
            subtitle=("Dynatrace internal — not for customer distribution" if internal else None),
            internal=internal, requested_by=self.meta.requested_by,
            date=self.cover_date,
            grades=self.grades,
            gauge_path=str(gauge) if graded and gauge.exists() else None,
            # This deliverable measures progress toward a native target, not a
            # score. Before the headline was a parameter the cover read "Overall
            # Score: 68/100" and this line then restated the same number as
            # "Migration completeness 68%" — two framings, one page, one of them
            # wrong. The number is now stated once, on the headline line. The
            # preset also declares headline_kind="progress", which is what exempts
            # the percentage from the grades rule.
            headline_format="percent")
        para(doc, f"Confidence {c['confidence']}", size=10, italic=True)
        if internal:
            self._add_internal_notice(doc)
        doc.add_page_break()

        doc.add_heading("Executive summary", level=1)
        for p in c["executive_summary"]:
            doc.add_paragraph(p)

        if not internal:
            # The three names are read out of the palette rather than retyped. This
            # legend and the domain headings below have to say the same words, and
            # for as long as they were two independent literals they did not.
            done = " ".join(docx_style.status_parts("healthy", PALETTE)[:2])
            doing = " ".join(docx_style.status_parts("opportunity", PALETTE)[:2])
            todo = " ".join(docx_style.status_parts("attention", PALETTE)[:2])
            doc.add_heading("How to read this report", level=1)
            doc.add_paragraph(
                f"Every domain carries one of three statuses. {done} means the native "
                f"mechanism is in place and the classic one has been retired. {doing} "
                "means both are live at once — real progress, with the cost of maintaining two "
                f"systems until one is retired. {todo} means the classic mechanism is "
                "still the only one in use. The completeness figure measures progress toward "
                "the native target, so an environment that has fully adopted the native "
                "mechanisms scores 100% — nothing is counted as a gap merely for lacking a "
                "classic construct. Items that could not be assessed are excluded from the "
                "figure entirely and are listed in the appendix.")

        if includes_section(DELIVERABLE, audience, "scoring_math") and c.get("derivation"):
            doc.add_heading("Score composition", level=1)
            # The domain weights are a judgment call — no standard is documented
            # for this skill — so the basis travels with the table rather than
            # being inferred from it.
            doc.add_paragraph(
                c.get("derivation_note")
                or "Domain weights reflect migration footprint: how much of the estate the "
                   "classic construct spans and how much other work its retirement unblocks. "
                   "No weighting standard is documented for this assessment, so these are a "
                   "reviewable judgment rather than a fixed rubric — the completeness figure "
                   "moves by several points under an equal-weight reading, and the per-domain "
                   "statuses below do not.")
            t = doc.add_table(rows=1, cols=5)
            t.style = "Light Grid Accent 1"
            for i, h in enumerate(("Domain", "Weight", "Score", "Contribution", "Confidence")):
                t.rows[0].cells[i].text = h
            for row in c["derivation"]:
                cells = t.add_row().cells
                for i, v in enumerate(row):
                    cells[i].text = str(v)

        doc.add_heading("Domain breakdown", level=2)
        t = doc.add_table(rows=1, cols=4)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("Domain", "Native mechanism", "Status", "Effort")):
            t.rows[0].cells[i].text = h
        for row in c["domain_table"]:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = str(v)
        doc.add_paragraph()
        counts = {"healthy": 0, "opportunity": 0, "attention": 0}
        for d in c["domains"]:
            counts[d["status"]] = counts.get(d["status"], 0) + 1
        rag_summary(doc, counts["healthy"], counts["opportunity"], counts["attention"],
                    title="Domain status summary", palette=PALETTE)

        doc.add_page_break()
        doc.add_heading("Domain-by-domain findings", level=1)
        talk = (c.get("talk_tracks", {})
                if includes_section(DELIVERABLE, audience, "talk_tracks") else {})
        for d in c["domains"]:
            finding_section(doc, d["title"], d["status"], d["what"], d["why"],
                            d["evidence"], d["remediation"], means=d["means"],
                            consequence=d["consequence"], reproduction=d["reproduction"],
                            palette=PALETTE)
            if d["title"] in talk:
                doc.add_heading("Talk-track and expansion hooks", level=3)
                for line in _as_lines(talk[d["title"]], d["title"], "talk_tracks"):
                    doc.add_paragraph(line, style="List Bullet")

        if c.get("plan"):
            doc.add_heading("Priority action plan", level=1)
            t = doc.add_table(rows=1, cols=3)
            t.style = "Light Grid Accent 1"
            for i, h in enumerate(("When", "Action", "Outcome")):
                t.rows[0].cells[i].text = h
            for row in c["plan"]:
                cells = t.add_row().cells
                for i, v in enumerate(row):
                    cells[i].text = str(v)
            doc.add_paragraph()

        if c.get("verification"):
            doc.add_heading("Verify these findings yourself", level=1)
            doc.add_paragraph(
                "Start with the platform's own \u201cCheck your upgrade readiness\u201d dashboard, "
                "already present in this environment — it tracks several of these domains "
                "continuously, so it is the standing instrument rather than a point-in-time "
                "read. Every domain above also carries the query that produced its numbers, "
                "directly beneath the measurement it supports. The checks below have no single "
                "domain to sit under.")
            for entry in c["verification"]:
                label, query, note = (list(entry) + ["", ""])[:3]
                head = doc.add_paragraph(style="List Bullet 2")
                head.add_run(f"{label}:").bold = True
                head.paragraph_format.keep_with_next = True
                if query:
                    code_block(doc, query)
                if note:
                    doc.add_paragraph(note, style="List Bullet 3")

        doc.add_page_break()
        self._add_appendix(doc, not_assessed=c.get("not_assessable"),
                           references=c.get("references"))
        doc.add_heading("Glossary of native constructs", level=2)
        t = doc.add_table(rows=1, cols=3)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("Classic construct", "Native mechanism", "What changes")):
            t.rows[0].cells[i].text = h
        for row in c["glossary"]:
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].text = str(v)
        doc.add_paragraph()
        para(doc, "Community tool, not officially supported by Dynatrace. A fully native tenant "
                  "scores 100% complete; this measure tracks progress toward the native target "
                  "rather than counting classic constructs as defects.", size=9)

        finalize_tables(doc)
        out = self._build_output_path("gen3-migration-progress", audience=audience)
        return save_scan_supersede(doc, out, "internal" if internal else "gen3",
                                   subject=[self.meta.customer, self.meta.tenant],
                                   grades=self.grades)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("content", help="per-run content module defining CONTENT (scratchpad only)")
    ap.add_argument("--external", action="store_true")
    ap.add_argument("--internal", action="store_true")
    ap.add_argument("--grades", action="store_true",
                    help="carry the completeness headline, grade badge and dial on "
                         "the EXTERNAL edition too. Off by default — grades are "
                         "never automatically included on a customer-facing "
                         "document. The internal edition is graded either way.")
    a = ap.parse_args()
    if not (a.external or a.internal):
        ap.error("choose at least one of --external / --internal")

    tenant = pathlib.Path(a.run_dir).name.rsplit("-", 3)[0]
    report = Gen3Report(a.run_dir, load_content(pathlib.Path(a.content), tenant),
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
