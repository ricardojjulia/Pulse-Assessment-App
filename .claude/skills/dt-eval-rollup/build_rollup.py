#!/usr/bin/env python3
"""Cross-skill executive rollup builder.

Given a customer + tenantId, discovers which of the five sibling /dt-eval-*
skills have a DELIVERED report for that tenant (a .docx actually present in
the output tree — never an in-progress or undelivered run), reads each one's
`headline` block from its own run.json (synthesized by `runlog.py finalize`
when a skill's build step passes `--skill`/`--confidence` — see
`.dt-eval-common/runlog.py`'s `_synthesize_headline`), and assembles a
side-by-side dashboard.

This is deliberately NOT a blended score. The five headlines are
incommensurable — Overall Configuration Score vs. Alerting Effectiveness vs.
Migration Completeness % vs. Overall Effective Score vs. mz2seg's ungraded
coverage % — combining them into one number would invent a precision this
repo's own hard rules forbid (CLAUDE.md: never let a number stand in for the
actions; report-audiences.md: no peer benchmarks, no blended figures). The
rollup shows N separate numbers, side by side, never one.

v1 scope (deliberate, per the design doc this shipped from): headline only —
score/grade/confidence/as-of date and a pointer to the full report. No parsed
"top actions" — those live in each skill's own report; extracting them back
out of docx prose is explicitly out of scope for v1.

Usage:
  build_rollup.py "Acme Corp" abc12345 [--tenant-url URL] \\
      [--skills tenant,prob,gen3,consumption,mz2seg,openpipeline] \\
      [--audience external|internal|both] [--date YYYY-MM-DD] \\
      [--requested-by EMAIL]
"""
import argparse
import datetime
import glob
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent               # .../dt-eval-rollup
SKILLS_DIR = HERE.parent                              # .claude/skills
COMMON = SKILLS_DIR / ".dt-eval-common"
sys.path.insert(0, str(COMMON))

import docx_style                                      # noqa: E402
import runlog                                           # noqa: E402
from report_builder import (next_version_number, resolve_customer_dir,  # noqa: E402
                            resolve_delivery_dir,
                            supersede_previous, save_scan_supersede)


# skill key -> the filename substring that identifies its delivered .docx
# (confirmed against each skill's own SKILL.md filename convention) and the
# human-readable column label for the dashboard table.
SKILLS = {
    "tenant":      {"filename_match": "technical-configuration-review",
                     "column": "Tenant Configuration Review"},
    "prob":        {"filename_match": "noise-reduction",
                     "column": "Problem/Alert Noise"},
    "gen3":        {"filename_match": "gen3-migration-progress",
                     "column": "Gen3 Migration Progress"},
    "consumption": {"filename_match": "effective-consumption",
                     "column": "Effective Consumption"},
    "mz2seg":      {"filename_match": "mz2seg-migration-plan",
                     "column": "Segments Migration Plan"},
    # `filename_match` is a hard constraint on the skill's report stem, not a
    # label: _skill_delivered_dates() globs current/*<filename_match>*.docx, and
    # _find_run_json() resolves SKILLS_DIR/f"dt-eval-{key}"/runs/... — so the
    # key must match the skill's directory name exactly. Rename either and this
    # skill silently vanishes from the dashboard with no error anywhere.
    "openpipeline": {"filename_match": "OpenPipeline",
                     "column": "OpenPipeline Health"},
}

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _output_root():
    return runlog._output_root()


def _skill_delivered_dates(tenant, skill_key, audience):
    """Delivered dates for ONE skill under this tenant, matched by filename.

    `runlog.find_delivered_reports()` answers "was ANYTHING delivered for
    this tenant on this date" across all five skills at once — exactly right
    for the compare-rule it was built for, but a rollup needs to know WHICH
    skill each delivery belongs to, so this re-globs scoped to one skill's
    filename convention.

    Layout is <root>/<customer>/current/ — no tenant or internal/
    subdirectory; both are encoded in the filename
    (<tenantId>-<reportname>-<date>(vN).<ext>, "[INTERNAL ONLY]-" prefixed for
    an internal edition). audience="external" only matches filenames WITHOUT
    that prefix (customer-facing editions). audience="internal" matches BOTH —
    an internal edition still proves the tenant was assessed (the same
    reasoning `find_delivered_reports` already applies), so an Internal
    Rollup (itself a Dynatrace-facing document) may cite it even when no
    external edition exists yet. An External Rollup never does — the
    customer-facing rollup cannot reference a report marked not for customer
    distribution.
    """
    root = _output_root()
    if not root or not os.path.isdir(root):
        return []
    match = SKILLS[skill_key]["filename_match"]
    dates = set()
    # Every `current/` at ANY depth: a customer may keep its tenants side by
    # side (<customer>/current/) or split them (<customer>/<tenant>/current/).
    # A one-level glob saw only the flat half, and the rollup would then report
    # a delivered sibling as never delivered — the one thing it exists to read.
    for path in glob.glob(os.path.join(root, "**", "current", f"*{match}*.docx"),
                          recursive=True):
        name = os.path.basename(path)
        is_internal = name.startswith("[INTERNAL ONLY]-")
        stem = name[len("[INTERNAL ONLY]-"):] if is_internal else name
        if not stem.startswith(tenant + "-"):
            continue
        if audience == "external" and is_internal:
            continue
        date_match = _DATE_RE.search(stem)
        if date_match:
            dates.add(date_match.group(0))
    return sorted(dates, reverse=True)


def _find_run_json(tenant, date, skill_key):
    """<skill>/runs/<tenant>-<date>/run.json — we already know which skill
    from the caller, so this is a direct lookup rather than runlog.find's
    cross-skill search."""
    candidate = SKILLS_DIR / f"dt-eval-{skill_key}" / "runs" / f"{tenant}-{date}" / "run.json"
    return candidate if candidate.exists() else None


def gather_headlines(tenant, skills, audience):
    """Returns (rows, not_assessed).

    `rows` — one dict per skill with a usable headline, ready for the
    dashboard table. `not_assessed` — human-readable lines for every
    requested skill that could NOT contribute a row, and why. Nothing is
    silently dropped: a skill with no delivered report, a delivered report
    whose run state is missing, or a run that predates the headline contract
    all produce an explicit line rather than just disappearing from the
    table (the same no-silent-caps discipline this repo applies everywhere
    counted claims are involved).
    """
    rows, not_assessed = [], []
    for key in skills:
        column = SKILLS[key]["column"]
        dates = _skill_delivered_dates(tenant, key, audience)
        if not dates:
            not_assessed.append(f"{column} — not yet assessed for this tenant")
            continue
        newest = dates[0]
        run_json = _find_run_json(tenant, newest, key)
        # These two lines land in the customer-facing "not yet assessed" list,
        # so the operator instruction (a command, a pair of CLI flags) belongs
        # to the internal edition only - it is exactly the "no internal
        # machinery" rule, and it leaked here in delivered rollups before
        # 2026-08-24.
        internal = audience == "internal"
        if not run_json:
            line = (f"{column} — a report was delivered on {newest}, but its "
                    "recorded result could not be read, so no headline is "
                    "shown here; see that report directly")
            if internal:
                line += " (locate the run state for this tenant and date)"
            not_assessed.append(line)
            continue
        import json
        d = json.loads(run_json.read_text())
        headline = d.get("headline")
        if not headline:
            line = (f"{column} — the {newest} report predates the summary "
                    "format this page reads, so no headline is shown here; "
                    "see that report directly")
            if internal:
                line += (f" (re-finalize that run for the {key} skill, with a "
                         "confidence flag, to include it)")
            not_assessed.append(line)
            continue
        rows.append({**headline, "column": column, "delivered_date": newest})
    return rows, not_assessed


def _english_list(items):
    """"A", "A and B", "A, B and C" - captions read as prose, not as a list."""
    items = list(items)
    if len(items) <= 1:
        return items[0] if items else ""
    return f"{', '.join(items[:-1])} and {items[-1]}"


def build_rollup_doc(customer, tenant, tenant_url, rows, not_assessed, audience,
                     requested_by=None, grades=False):
    internal = (audience == "internal")
    # Owner rule 2026-08-25: grades are never automatically included on a
    # customer-facing document. This deliverable feels the rule most, because its
    # whole content IS other reviews' headlines — so the customer edition shows
    # each review's STATUS (the same ✅/💡/⚠️ band the summary bar below already
    # counted) instead of its value and letter. That is still the dashboard's job:
    # which reviews were delivered, where each one stands, how confident it is,
    # and where to read it in full. Pass --grades when the engagement asked for
    # the numbers themselves.
    graded = docx_style.grades_enabled(internal, grades)
    doc = docx_style.new_report_doc(internal=internal)
    subtitle = "Dynatrace internal — not for customer distribution" if internal else None
    docx_style.cover_page(
        doc, customer, tenant_url, overall=None, grade_letter=None,
        title="Dynatrace Executive Rollup", subtitle=subtitle, internal=internal,
        requested_by=requested_by,
        disclosure=(
            "This rollup assembles the headline result of each already-delivered "
            "Dynatrace review for this tenant. It does not recompute or re-derive "
            "any score — see each review's own report for full findings, method, "
            "and evidence."
        ),
    )
    docx_style.para(
        doc,
        "Each review below is scored on its own, independent scale — this page is "
        "a dashboard of separate headlines, never a blended score.",
        italic=True, size=10, color=docx_style.GREY,
    )
    doc.add_paragraph()

    healthy = opportunity = attention = 0
    if rows:
        headers = (["Review", "Headline", "Value", "Grade", "Confidence", "As of"]
                   if graded else
                   ["Review", "Headline", "Status", "Confidence", "As of"])
        table_rows = []
        for h in sorted(rows, key=lambda r: r["column"]):
            grade = h.get("grade")
            # NEVER render `no_grade_reason` into the Grade cell. It is
            # run-state prose written by whoever ran that skill's finalize, and
            # it is not written for a customer to read - the live case put
            # "deliberately not a grade - coverage % and retirable-now count,
            # see README.md" into a customer-facing table, repo filename and
            # all. The cell gets a marker; the explanation gets a footnote in
            # the report's own voice.
            grade_disp = grade or "Not graded"
            value = h.get("value")
            value_disp = "not stated" if value is None else f"{value:g}"
            confidence = h.get("confidence") or "not stated"
            if graded:
                table_rows.append([h["column"], h["label"], value_disp, grade_disp,
                                   confidence, h.get("as_of") or "—"])
            else:
                # Same band mapping the RAG bar below uses — read from
                # docx_style so the two cannot disagree. An ungraded review
                # (mz2seg) has no band and says so, exactly as it does in the
                # graded edition's Grade cell.
                if grade in docx_style.GRADE_COLORS:
                    icon, label, _ = docx_style.status_parts(
                        docx_style.grade_status(grade))
                    status_disp = f"{icon} {label}"
                else:
                    status_disp = "Not graded"
                table_rows.append([h["column"], h["label"], status_disp,
                                   confidence, h.get("as_of") or "—"])
            if grade in ("A", "B"):
                healthy += 1
            elif grade == "C":
                opportunity += 1
            elif grade == "D":
                attention += 1
            # grade is None (mz2seg's headline is deliberately ungraded, or a
            # confidence/grade simply wasn't recorded) -> excluded from the RAG
            # count, the same rule ⚪ items follow everywhere else in this repo:
            # never scored, never guessed.
        docx_style.styled_table(doc, headers, table_rows)
        ungraded = [h for h in sorted(rows, key=lambda r: r["column"])
                    if not h.get("grade")]
        if ungraded:
            names = _english_list([h["column"] for h in ungraded])
            one = len(ungraded) == 1
            docx_style.para(
                doc,
                f"{names} {'is' if one else 'are'} reported as a measurement "
                f"rather than a grade: {'its' if one else 'their'} headline "
                f"{'is' if one else 'are'} a coverage figure and a count of "
                "outstanding work, which track progress through a piece of "
                "work rather than the quality of a configuration. "
                f"{'It' if one else 'They'} {'was' if one else 'were'} "
                f"assessed in full and simply {'does' if one else 'do'} not "
                "reduce to a letter, so cannot be counted alongside the "
                "graded reviews.",
                size=9, italic=True, color=docx_style.GREY)
        doc.add_paragraph()
        graded = healthy + opportunity + attention
        exclusion = ""
        if ungraded:
            exclusion = (f"{_english_list([h['column'] for h in ungraded])} "
                         f"{'is' if len(ungraded) == 1 else 'are'} not graded "
                         "and not counted here")
        docx_style.rag_summary(doc, healthy, opportunity, attention,
                               title="Graded reviews at a glance",
                               noun=("graded review" if graded == 1
                                     else "graded reviews"),
                               exclusion_note=exclusion)

    if not_assessed:
        docx_style.para(doc, "Not yet assessed for this tenant:", bold=True, size=10)
        for line in not_assessed:
            doc.add_paragraph(line, style="List Bullet")
        doc.add_paragraph()

    docx_style.para(
        doc,
        "Each review's full findings, evidence, and sequenced remediation live in "
        "its own report — this page is a pointer, not a substitute.",
        size=9, italic=True, color=docx_style.GREY,
    )

    docx_style.finalize_tables(doc)
    docx_style.footer_disclaimer(doc, label="Executive Rollup")
    return doc


def build_output_path(output_root, customer, tenant, date, audience, reportname="executive-rollup"):
    """Mirrors report_builder.ReportBuilder._build_output_path, standalone —
    the rollup has no single run.json to hang a ReportMetadata object off of,
    since it reads across up to five of them.

    <output_root>/<customer>/current/ — no tenant or internal/ subdirectory;
    both are encoded in the filename (<tenant>-<reportname>-<date>(vN)<suffix>,
    "[INTERNAL ONLY]-" prefixed for audience="internal")."""
    # Same folder-resolution rule as every other builder: a customer typed
    # two ways must not split the delivery tree (report_builder.D9).
    output_dir = resolve_delivery_dir(output_root, customer, tenant)
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".docx"
    base_stem = f"{tenant}-{reportname}-{date}"
    stem = f"[INTERNAL ONLY]-{base_stem}" if audience == "internal" else base_stem
    version = next_version_number(output_dir, stem, suffix)
    while True:
        output_file = output_dir / f"{stem}(v{version}){suffix}"
        try:
            fd = os.open(output_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return output_file
        except FileExistsError:
            version += 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("customer")
    p.add_argument("tenant")
    p.add_argument("--tenant-url", default="")
    p.add_argument("--skills", default=",".join(SKILLS),
                   help="comma-separated subset of: " + ",".join(SKILLS))
    p.add_argument("--audience", choices=["external", "internal", "both"], default="both")
    p.add_argument("--date", help="override the rollup's own generation date "
                                  "(YYYY-MM-DD); default today")
    p.add_argument("--requested-by", help="dtctl auth whoami email, for the AI-disclosure line")
    p.add_argument("--grades", action="store_true",
                   help="carry each review's value and grade on the EXTERNAL edition "
                        "too. Off by default — grades are never automatically included "
                        "on a customer-facing document; without it the customer edition "
                        "shows each review's status band instead. The internal edition "
                        "always carries the values and grades.")
    a = p.parse_args()

    skills = [s.strip() for s in a.skills.split(",") if s.strip()]
    unknown = [s for s in skills if s not in SKILLS]
    if unknown:
        sys.exit(f"Unknown skill(s): {', '.join(unknown)} — choose from {', '.join(SKILLS)}")

    root = _output_root()
    if not root:
        sys.exit("No output root configured — set DT_EVAL_OUTPUT_DIR or "
                  ".dt-eval-common/output-config.json's default_output_root")

    date = a.date or datetime.date.today().isoformat()
    audiences = ["external", "internal"] if a.audience == "both" else [a.audience]

    for audience in audiences:
        rows, not_assessed = gather_headlines(a.tenant, skills, audience)
        if not rows and not not_assessed:
            print(f"[{audience}] nothing to report — no skills requested")
            continue
        doc = build_rollup_doc(a.customer, a.tenant, a.tenant_url, rows, not_assessed,
                               audience, a.requested_by, grades=a.grades)
        out = build_output_path(root, a.customer, a.tenant, date, audience)
        save_scan_supersede(doc, out,
                            "internal" if audience == "internal" else "rollup",
                            subject=[a.customer, a.tenant], grades=a.grades)
        print(f"[{audience}] {len(rows)} assessed, {len(not_assessed)} not yet assessed -> {out}")


if __name__ == "__main__":
    main()
