"""report_helpers.py — reusable document-building helpers for the Problem Noise report.

Import alongside the shared ../.dt-eval-common/docx_style.py in a per-run build script
(paths relative to this skill directory as the working directory):

    import sys, os
    sys.path.insert(0, "../.dt-eval-common")   # for docx_style (single shared copy)
    import docx_style as ds
    from report_helpers import lead, bullets, lead_bullets, options_table, numbered

House-format rules these enforce (see output-spec.md and the assessment-report-format memory):
  * findings lead with a summary table (ds.scorecard_table) then per-item detail;
  * multi-fact content is BULLETS (lead_bullets), not prose paragraphs;
  * short single-thought conclusions (Recommendation) stay as a labelled line (lead).
Always call ds.finalize_tables(doc) once before doc.save() (pagination: no split cells,
keep small tables + label/bullet blocks together).
"""


def lead(doc, label, text):
    """A bold inline label followed by a short prose sentence (use for one-line conclusions)."""
    p = doc.add_paragraph()
    p.add_run(label + "  ").bold = True
    p.add_run(text)
    return p


def bullets(doc, items):
    """Plain bullet list (native List Bullet style)."""
    for it in items:
        doc.add_paragraph(it, style="List Bullet")


def lead_bullets(doc, label, items):
    """A bold label on its own line, then a bullet list — the default for a finding's
    'Found / evidence / if-left-unaddressed / sequencing' facts."""
    doc.add_paragraph().add_run(label).bold = True
    for it in items:
        doc.add_paragraph(it, style="List Bullet")


def options_table(doc, rows, ds):
    """Options / ramifications table: rows = [(option, what-it-does, pros, cons/ramifications), ...].
    Pass the imported docx_style module as `ds`."""
    ds.styled_table(doc, ["Option", "What it does", "Pros", "Ramifications / cons"],
                    rows, widths=[3.0, 4.6, 4.0, 4.6], size=9)


def numbered(doc, items):
    """Numbered bold-lead list: items = [(heading, text), ...] → '1. Heading  text'."""
    for i, (h, t) in enumerate(items, 1):
        p = doc.add_paragraph()
        p.add_run(f"{i}. {h}  ").bold = True
        p.add_run(t)
