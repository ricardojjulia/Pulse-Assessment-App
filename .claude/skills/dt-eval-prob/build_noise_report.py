#!/usr/bin/env python3
"""Noise-reduction report builder — structure only, ZERO canned content.

This skill had no committed report builder until 2026-08-10. Every run
hand-wrote one in the session scratchpad and threw it away, which is exactly how
the enforcement drifted: a run shipped customer-facing editions in the INTERNAL
diagnostic voice and omitted output-spec §5b's required capacity framing, and
nothing caught either, because there was no builder for the rules to live in.
Disposable code was producing client deliverables.

Same contract as the shared `build_reports.py` scaffold: the structure is here,
every number and every sentence comes from a per-run content module written
fresh from that run's evidence, and a missing required field RAISES rather than
shipping a placeholder. Never reintroduce content literals into this file.

Usage:
  python3 build_noise_report.py <run_dir> <content.py> [--external] [--internal]

The content module lives in the SESSION SCRATCHPAD (it holds tenant data — never
commit it) and defines CONTENT, a dict with:

  burden_line        str                  cover stat line (problems/day, custom share, RCA rate)
  exec_summary       [str, ...]           paragraphs
  baseline_prose     [str, ...]
  baseline_table     [[measure, value, what_it_says], ...]
  rag                (healthy, opportunity, attention)
  scorecard          [{area, measured, status, action}, ...]
  drivers            [{title, status, what, why, evidence, action, means,
                       consequence, reproduction, talk_track}, ...]
  routing_warning    str                  the policy-vs-routing callout (§5b)
  delivery_meaning   str                  (§5c)
  provenance_meaning str
  capacity           {objects, cap, pct, status, text} | None   (§5b capacity framing)
  change_plan_lead   str
  change_plan_rows   [[when, change, environment, effect], ...]
  verification       [[label, query, note], ...]
  not_assessed       [str, ...]
  references         [str, ...]

VOICE: the customer edition is scanned under `detailed`, which since 2026-08-10
enforces report-audiences.md's substitution table. Write customer copy as
opportunity/efficiency, keep the diagnostic vocabulary for `talk_track` (internal
only) — the scan will fail the build otherwise, which is the point.
"""
import argparse
import importlib.util
import json
import pathlib
import sys
import tempfile

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parent / ".dt-eval-common"))

import docx_style  # noqa: E402
from docx_style import (scorecard_table, finding_section, rag_summary,  # noqa: E402
                        pillar_bar_chart, code_block, callout, finalize_tables,
                        render_gauge_png, para)
from report_builder import ReportBuilder, supersede_previous  # noqa: E402
from build_reports import resolve_output_root  # noqa: E402
from verify_docx import scan_docx  # noqa: E402
from report_helpers import lead_bullets  # noqa: E402



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


REQUIRED = ("burden_line", "exec_summary", "baseline_prose", "baseline_table", "rag",
            "scorecard", "drivers", "routing_warning", "delivery_meaning",
            "provenance_meaning", "change_plan_lead", "change_plan_rows",
            "verification", "not_assessed", "references")
REQUIRED_DRIVER = ("title", "status", "what", "why", "evidence", "action",
                   "means", "consequence", "reproduction")


def _req(content, key):
    value = content.get(key)
    if value is None or value == "" or value == [] or value == {}:
        raise MissingContentError(
            f"required content field {key!r} is missing or empty. Write it from this run's "
            f"evidence — this builder contains no content.")
    return value


def load_content(path, tenant=None):
    """Load CONTENT from a per-run module.

    Accepts either the content dict directly, or a dict keyed by tenant — an
    engagement covering several tenants keeps one module rather than one file per
    tenant, and picking the wrong tenant's narrative is precisely the mistake a
    keyed lookup prevents.
    """
    spec = importlib.util.spec_from_file_location("prob_content", str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    content = module.CONTENT
    if tenant and tenant in content and isinstance(content[tenant], dict):
        return content[tenant]
    if tenant and not any(k in content for k in REQUIRED):
        raise MissingContentError(
            f"content module has no entry for tenant {tenant!r} and is not a content dict "
            f"itself (keys: {sorted(content)[:6]}) — a build must never fall back to another "
            f"tenant's narrative.")
    return content


class NoiseReport(ReportBuilder):
    def __init__(self, run_dir, content, grades=False):
        super().__init__(pathlib.Path(run_dir), resolve_output_root(),
                         docx_style_module=docx_style)
        self.c = content
        # Owner rule 2026-08-25: the customer edition carries no effectiveness
        # score, grade badge, gauge or score meter unless this run was explicitly
        # asked for a graded one. The internal edition is graded either way —
        # docx_style.grades_enabled(internal, grades) is what decides.
        self.grades = grades
        for key in REQUIRED:
            _req(content, key)
        for d in content["drivers"]:
            for key in REQUIRED_DRIVER:
                if not d.get(key):
                    raise MissingContentError(
                        f"driver {d.get('title', '<untitled>')!r} is missing {key!r} — a driver "
                        f"that stops at a count is unfinished (SKILL.md core directive).")
        self.f = json.loads((self.run_dir / "findings.json").read_text())
        fam = self.run_dir / "C-detector-families.json"
        self.fam = json.loads(fam.read_text()) if fam.exists() else None

    def build(self, internal):
        m, c = self.f["meta"], self.c
        graded = docx_style.grades_enabled(internal, self.grades)
        doc = docx_style.new_report_doc(internal=internal)

        gauge = pathlib.Path(tempfile.gettempdir()) / f"gauge-{self.meta.tenant}-prob.png"
        if graded:
            render_gauge_png(m["effectiveness"], str(gauge))
        docx_style.cover_page(
            doc, self.meta.customer, self.meta.tenant_url,
            round(m["effectiveness"]), m["grade"],
            title="Dynatrace Problem Noise Reduction",
            subtitle=("Dynatrace internal — not for customer distribution" if internal else None),
            internal=internal, requested_by=self.meta.requested_by,
            date=self.cover_date,
            grades=self.grades,
            gauge_path=str(gauge) if graded and gauge.exists() else None)
        para(doc, c["burden_line"], size=10, italic=True)
        if internal:
            self._add_internal_notice(doc)
        doc.add_page_break()

        doc.add_heading("Executive summary", level=1)
        for p in c["exec_summary"]:
            doc.add_paragraph(p)

        if internal:
            self._score_composition(doc, m)
        else:
            doc.add_heading("How to read this report", level=1)
            doc.add_paragraph(
                "Status legend: ✅ = Healthy, 💡 = Opportunity, ⚠️ = Needs attention. Items not "
                "assessed in this review are listed in the appendix. Every reduction figure is "
                "directional and should be re-measured after each change — figures tagged as "
                "counted come from the problem records themselves, figures tagged as derived are "
                "estimates with the method stated.")

        self._baseline(doc, m, graded)
        doc.add_page_break()
        self._drivers(doc, internal)
        doc.add_page_break()
        self._consolidation(doc)
        doc.add_page_break()
        self._change_plan(doc)
        self._remeasuring(doc)
        self._appendix(doc)
        finalize_tables(doc)

        audience = "internal" if internal else "external"
        out = self._build_output_path("noise-reduction", audience=audience)
        # supersede=False: a document that has not cleared the scan must never
        # displace the last good edition (report_builder._save_document contract).
        self._save_document(doc, out, supersede=False)
        profile = "internal" if internal else "detailed"
        findings = scan_docx(out, profile, subject=[self.meta.customer, self.meta.tenant],
                             grades=self.grades)
        if findings:
            lines = "\n  ".join(f"[{f['pattern']}] {f['text']}" for f in findings)
            raise RuntimeError(
                f"Pre-delivery scan FAILED (profile {profile}) for {out}:\n  {lines}\n"
                f"Fix the content (or a false-firing scanner pattern in verify_docx.py) — never "
                f"reword a correct sentence to appease the scanner.")
        supersede_previous(out)
        return out

    # ---- sections ---------------------------------------------------------

    def _score_composition(self, doc, m):
        doc.add_heading("Score composition", level=1)
        t = doc.add_table(rows=1, cols=5)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("Pillar", "Weight", "Score", "Contribution", "Basis")):
            t.rows[0].cells[i].text = h
        for name, key, w, basis in (
            ("Signal quality", "signal_quality", 0.40,
             "100 x Problem Usefulness Index over the full window"),
            ("Native-detection adoption", "native_adoption", 0.30,
             "100 x (1 - custom-alert share)"),
            ("Detector tuning", "detector_tuning", 0.30,
             "area rollup; at-recommendation 100 / at-default 50 / actively-noisy 0"),
        ):
            r = t.add_row().cells
            r[0].text, r[1].text = name, f"{int(w * 100)}%"
            r[2].text, r[3].text = f"{m[key]:.1f}", f"{m[key] * w:.1f}"
            r[4].text = basis
        para(doc, f"Composite = {m['effectiveness']} ({m['grade']}). "
                  f"Confidence {m['confidence']}: {m['confidence_basis']}.", size=9)
        para(doc, f"Area weighting within the detector-tuning pillar: "
                  f"{m.get('area_weighting', 'equal')}", size=9)

    def _baseline(self, doc, m, graded=True):
        doc.add_heading("Noise baseline", level=1)
        for p in self.c["baseline_prose"]:
            doc.add_paragraph(p)
        t = doc.add_table(rows=1, cols=3)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("Measure", "Value", "What it says")):
            t.rows[0].cells[i].text = h
        for row in self.c["baseline_table"]:
            cells = t.add_row().cells
            for i, value in enumerate(row):
                cells[i].text = str(value)
        doc.add_paragraph()
        components = {"Signal quality": m["signal_quality"],
                      "Native-detection adoption": m["native_adoption"],
                      "Detector tuning": m["detector_tuning"]}
        if graded:
            # grades=True rather than self.grades: `graded` already resolved the
            # audience (internal is always graded), and the helper must not
            # re-derive it from a flag that only speaks for the customer edition.
            pillar_bar_chart(doc, components,
                             title="Alerting effectiveness by component",
                             grades=True)
        else:
            # Ungraded edition: the same three components, read qualitatively.
            # The shape of the answer survives; the scores do not.
            docx_style.para(doc, "Alerting effectiveness by component",
                            size=11, bold=True, color=docx_style.DT_BLUE)
            docx_style.pillar_summary_table(doc, components, grades=False)
            doc.add_paragraph()
        healthy, opportunity, attention = self.c["rag"]
        rag_summary(doc, healthy, opportunity, attention,
                    title="Detector tuning status across assessed areas")

    def _drivers(self, doc, internal):
        doc.add_heading("Noise drivers", level=1)
        scorecard_table(doc, self.c["scorecard"])
        doc.add_paragraph()
        for d in self.c["drivers"]:
            finding_section(doc, d["title"], d["status"], d["what"], d["why"],
                            d["evidence"], d["action"], means=d["means"],
                            consequence=d["consequence"], reproduction=d["reproduction"])
            if internal and d.get("talk_track"):
                doc.add_heading("Talk-track and expansion hooks", level=3)
                for line in _as_lines(d["talk_track"], d["title"], "talk_track"):
                    doc.add_paragraph(line, style="List Bullet")

    def _consolidation(self, doc):
        """output-spec §5b/§5c/§5d — required whenever the detector analysis ran."""
        fam, c = self.fam, self.c
        if not fam:
            return
        pc = fam["policy_clusters"]
        doc.add_heading("The consolidation picture", level=1)
        doc.add_paragraph(
            f"{pc['detectors_in_clusters']:,} of {fam['total']:,} detectors "
            f"({pc['share_in_clusters']}%) resolve to {pc['clusters']} distinct alerting "
            f"policies. The opportunity is templating: every detector in a group watches a "
            f"different metric and is individually right, so this is not duplication to delete "
            f"— it is {pc['clusters']} reusable policies currently maintained as up to "
            f"{pc['detail'][0]['size']:,} separate edits each.")
        doc.add_paragraph(
            f"Three other groupings were computed for comparison: identical rule text finds "
            f"{fam['exact_rules']['families']} groups covering {fam['exact_rules']['objects']}; "
            f"identical query text with differing thresholds finds "
            f"{fam['drift_families']['families']} groups covering "
            f"{fam['drift_families']['objects']}. Both are worth acting on and both are an order "
            f"of magnitude smaller, because they ask which detectors watch the same thing rather "
            f"than which ones decide the same way.")
        doc.add_paragraph()
        t = doc.add_table(rows=1, cols=4)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("Members", "Policy envelope", "Consolidation verdict",
                               "Distinct notification destinations")):
            t.rows[0].cells[i].text = h
        for cl in pc["detail"][:5]:
            rd = cl["routing_divergence"].get("opc_email_recipients", {})
            cells = t.add_row().cells
            cells[0].text = f"{cl['size']:,}"
            cells[1].text = cl["label"]
            cells[2].text = {"policy_only": "Template the policy fields; keep routing per detector",
                             "fully_mergeable": "Fully consolidatable",
                             "unknown": "Not determinable from this evidence"}.get(
                                 cl["merge_verdict"], cl["merge_verdict"])
            n = rd.get("distinct")
            cells[3].text = (f"{n} across {rd.get('populated', 0)} populated, "
                             f"{rd.get('placeholder_using', 0)} using placeholders"
                             if n is not None else "not determinable")
        doc.add_paragraph()
        callout(doc, c["routing_warning"], title="Policy consolidates; routing usually does not")

        cap = c.get("capacity")
        if cap:
            doc.add_heading("Capacity against the declared maximum", level=2)
            lead_bullets(doc, "Measured", [
                f"{cap['objects']:,} custom detectors configured.",
                f"Declared per-environment maximum on this environment: {cap['cap']:,}.",
                f"Utilization: {cap['pct']}%.",
            ])
            doc.add_paragraph(cap["text"])

        ats = fam.get("alert_target_split")
        if ats:
            doc.add_heading("Where alerts are routed", level=2)
            t = doc.add_table(rows=1, cols=3)
            t.style = "Light Grid Accent 1"
            for i, h in enumerate(("Destination", "Detectors", "Share")):
                t.rows[0].cells[i].text = h
            for target, n in list(ats["by_target"].items())[:8]:
                cells = t.add_row().cells
                cells[0].text = str(target)
                cells[1].text = f"{n:,}"
                cells[2].text = f"{round(100.0 * n / fam['total'], 1)}%"
            doc.add_paragraph()
            doc.add_paragraph(ats["note"])

        md = fam.get("missing_data")
        if md:
            doc.add_heading("Alerting when a data source stops", level=2)
            lead_bullets(doc, "Measured", [
                f"{md['alerting_on_missing_data']:,} detectors alert when their input stops "
                f"arriving.",
                f"{md['not_alerting']:,} ({md['not_alerting_share']}%) do not — "
                f"{md['explicitly_disabled']:,} with the option switched off and "
                f"{md['unset']:,} with it unset, which behaves the same way.",
            ])
            doc.add_paragraph(
                "This is the right setting for a performance threshold, where a quiet period "
                "genuinely means nothing happened. For a security, audit, or compliance "
                "condition the opportunity is the reverse: absence of data is itself the signal, "
                "so enabling it on that subset closes a gap without adding volume elsewhere.")

        doc.add_heading("Where alerts arrive with routing information", level=2)
        df = fam["delivery_flags"]
        # A tenant routing through alerting profiles carries no per-detector
        # destination property, and detector_families reports the flags as not
        # applicable rather than firing them on every detector. Rendering them
        # anyway would print "0 detectors carry no destination" at best and crash
        # on None at worst — either way it would state something untrue.
        if not df.get("convention_in_use", True):
            doc.add_paragraph(df.get("note") or self.c["delivery_meaning"])
        else:
            lead_bullets(doc, "Measured", [
                f"{df['snow_bound']:,} detectors route to a service-management destination, and "
                f"{df['snow_no_routing_metadata']:,} of them "
                f"({df['snow_no_routing_metadata_share']}%) carry no routing group, asset tag, or "
                f"source application.",
                f"{df['no_alert_target']} detector(s) carry no destination, so no automation is "
                f"wired to act on them.",
                f"{df['no_severity']} detector(s) carry no severity for the receiving system to "
                f"triage on.",
            ])
            doc.add_paragraph(self.c["delivery_meaning"])
            samples = (df.get("_samples") or {}).get("snow_no_routing_metadata") or []
            if samples:
                doc.add_paragraph("Five of the detectors concerned:")
                for s in samples[:5]:
                    doc.add_paragraph(s, style="List Bullet")

        doc.add_heading("Where this detector set came from", level=2)
        prov = fam["provenance"]
        total = sum(prov.values())
        ported = total - prov.get("native", 0)
        doc.add_paragraph(
            f"{ported:,} of {total:,} detectors ({100.0 * ported / total:.1f}%) carry a property "
            f"naming a single prior monitoring product as their source. {c['provenance_meaning']}")

    def _change_plan(self, doc):
        doc.add_heading("Priority action plan", level=1)
        doc.add_paragraph(self.c["change_plan_lead"])
        t = doc.add_table(rows=1, cols=4)
        t.style = "Light Grid Accent 1"
        for i, h in enumerate(("When", "Change", "Environment", "Expected effect")):
            t.rows[0].cells[i].text = h
        for row in self.c["change_plan_rows"]:
            cells = t.add_row().cells
            for i, value in enumerate(row):
                cells[i].text = str(value)

    def _remeasuring(self, doc):
        doc.add_heading("Verify these findings yourself", level=1)
        doc.add_paragraph(
            "Every driver above carries the query that produced its numbers, directly beneath "
            "the measurement it supports. Run one again after a change and the comparison is "
            "like for like. The items below have no single driver to sit under.")
        for label, query, note in self.c["verification"]:
            head = doc.add_paragraph(style="List Bullet 2")
            head.add_run(f"{label}:").bold = True
            head.paragraph_format.keep_with_next = True
            if query:
                code_block(doc, query)
            if note:
                doc.add_paragraph(note, style="List Bullet 3")

    def _appendix(self, doc):
        self._add_appendix(
            doc,
            not_assessed=self.c["not_assessed"],
            references=self.c["references"],
            disclaimer="Community tool, not officially supported by Dynatrace. Estimated "
                       "reductions are directional, never a promise — re-measure after "
                       "each change.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dir")
    ap.add_argument("content", help="per-run content module defining CONTENT (scratchpad only)")
    ap.add_argument("--external", action="store_true")
    ap.add_argument("--internal", action="store_true")
    ap.add_argument("--grades", action="store_true",
                    help="carry the effectiveness score, grade and gauge on the "
                         "EXTERNAL edition too. Off by default — grades are never "
                         "automatically included on a customer-facing document; ask "
                         "for this only when the engagement asked for a graded one. "
                         "The internal edition is graded either way.")
    a = ap.parse_args()
    if not (a.external or a.internal):
        ap.error("choose at least one of --external / --internal")

    tenant = pathlib.Path(a.run_dir).name.rsplit('-', 3)[0]
    report = NoiseReport(a.run_dir, load_content(pathlib.Path(a.content), tenant),
                         grades=a.grades)
    built = []
    if a.external:
        built.append(("External", report.build(internal=False)))
    if a.internal:
        built.append(("Internal", report.build(internal=True)))
    # Verify-after-write: re-stat from disk before claiming success.
    for label, path in built:
        if not pathlib.Path(path).exists():
            sys.exit(f"ERROR: {label} report missing on re-stat: {path}")
        print(f"✅ {label}: {path}")


if __name__ == "__main__":
    main()
