#!/usr/bin/env python3
"""Phase 3 - build the MZ->Segments Migration Plan deliverables.

Consumes the analysis JSON produced by analyze_mz2seg.py and writes, into
--out-dir (the customer's `current/` folder — no tenant or internal/
subdirectory; both are encoded in the filename):
  - <tenant>-mz2seg-migration-plan-<date>(vN).docx   (the plan)
  - <tenant>-mz2seg-disposition-<date>(vN).xlsx      (the per-zone worklist)
An internal-audience build (--audience internal) prefixes both with
"[INTERNAL ONLY]-".

House style and structure come from the shared engine (docx_style.py) and the
design note (mz2seg-migration-plan-spec.md section 6/6b). External-audience
hygiene applies: no probe IDs, no run-state paths, no internal stage jargon in
the document body; run verify_docx.py on the output before delivery.

Usage:
  build_mz2seg_report.py --analysis <json> --customer "Acme Corp"
      --tenant-id abc12345 --out-dir <dir> [--audience external|internal]
      [--requested-by email]
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / ".dt-eval-common"))

import docx_style as ds  # noqa: E402
from report_builder import (next_version_number, save_scan_supersede,
                            supersede_previous)  # noqa: E402
from openpyxl import Workbook  # noqa: E402
from openpyxl.styles import Font, PatternFill  # noqa: E402

TITLE = "Management Zones → Segments Migration Plan"

DISPOSITION_LABELS = {
    "retire-now": "Retire now",
    "retire-after-cutover": "Retire after cutover",
    "build-then-retire": "Build then retire",
    "investigate": "Investigate",
}

# Segment build guidance per dimension family (client-safe wording).
FAMILY_SPECS = {
    "host-group": ("dt.host_group.id",
                   "Native host-group segment (one exists on this tenant - "
                   "extend its variable coverage where needed)"),
    "k8s": ("k8s.cluster.name / k8s.namespace.name",
            "Native Kubernetes metadata segment"),
    "ext-entity": ("Smartscape entity type filter",
                   "Segment (or entity filter) on the typed extension "
                   "entities; pairs with the extension migration"),
    "tag": ("primary_tags.<key>",
            "Segment on the source tag - requires the tag to be established "
            "at source first where it is classic-only today"),
    "name": ("the underlying dimension the name encodes",
             "Resolve the naming convention to its real dimension (host "
             "group, app, environment) rather than porting the regex"),
}

# Authoritative documentation topics cited in the References section. The run
# verifies each URL is live before the report ships (--skip-url-check to skip).
DOC_REFERENCES = [
    ("Segments", "https://docs.dynatrace.com/docs/manage/segments"),
    ("Segment limits & operators (reference)",
     "https://docs.dynatrace.com/docs/manage/segments/reference/segments-reference-limits"),
    ("Upgrade guide: segments (derived-data keys)",
     "https://docs.dynatrace.com/docs/manage/segments/upgrade-guide-segments"),
    ("Upgrade guide: alert notification (duration filter, connectors)",
     "https://docs.dynatrace.com/docs/manage/upgrade-guide-landing-page/upgrade-guide-alert-notification"),
    ("Access control / IAM policies",
     "https://docs.dynatrace.com/docs/manage/identity-access-management"),
    ("Problem notifications via Workflows",
     "https://docs.dynatrace.com/docs/analyze-explore-automate/workflows"),
    ("Grail buckets & retention",
     "https://docs.dynatrace.com/docs/discover-dynatrace/platform/grail/data-model"),
    ("Tagging & source tags",
     "https://docs.dynatrace.com/docs/manage/tags-and-metadata"),
    ("OpenPipeline enrichment",
     "https://docs.dynatrace.com/docs/discover-dynatrace/platform/openpipeline"),
]

# Best Practice Notebook citations (public community reference; the product
# documentation above governs where they differ). Notebook IDs + followable
# public URLs per bpn-library.md citation rules.
_BPN_BASE = ("https://github.com/timstewart-dynatrace/Best-Practice-Notebooks/"
             "blob/main")
BPN_REFERENCES = [
    ("MZ2POL-05 — Segments implementation (the 8 migration scenarios, "
     "one-segment-per-dimension rule, the 4 blockers)",
     f"{_BPN_BASE}/MZ2POL%20-%20Management%20Zone%20to%20Policy%20Migration/"
     "markdown/-%5BMZ2POL%5D-05-segments-implementation.md"),
    ("MZ2POL-09 — Alerting and notification migration",
     f"{_BPN_BASE}/MZ2POL%20-%20Management%20Zone%20to%20Policy%20Migration/"
     "markdown/-%5BMZ2POL%5D-09-alerting-and-notification-migration.md"),
    ("MZ2POL-00 — SDK management-zone analysis tool",
     f"{_BPN_BASE}/MZ2POL%20-%20Management%20Zone%20to%20Policy%20Migration/"
     "markdown/-%5BMZ2POL%5D-00-sdk-mz-analysis-tool.md"),
    ("ORGNZ-08 — Grail segments (limits and operators)",
     f"{_BPN_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security/"
     "markdown/-%5BORGNZ%5D-08-grail-segments.md"),
    ("ORGNZ-10 — Advanced segment definitions (Davis problem include)",
     f"{_BPN_BASE}/ORGNZ%20-%20Organize%20Data:%20Buckets,%20Segments,%20Security/"
     "markdown/-%5BORGNZ%5D-10-advanced-segment-definitions.md"),
]


def resolve_version(out_dir: Path, stem: str, ext: str) -> Path:
    """Always-present (vN) marker; never overwrite a delivered file.

    Version resolution is shared with report_builder so it stays consistent:
    the scan counts the `_superseded/` subfolder too, because a scan of the
    target folder alone sees low numbers as free once earlier editions are
    filed away and writes a NEWER document as (v1) beside an existing (v3).
    """
    n = next_version_number(out_dir, stem, f".{ext}")
    while (out_dir / f"{stem}(v{n}).{ext}").exists():  # concurrency backstop
        n += 1
    return out_dir / f"{stem}(v{n}).{ext}"


def check_urls():
    """Verify each cited docs URL is live (curl - the venv python may lack a
    CA bundle; curl uses the system trust store)."""
    import subprocess
    dead = []
    for label, url in DOC_REFERENCES:
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-I",
             "-L", "--max-time", "15", url],
            capture_output=True, text=True)
        code = result.stdout.strip()
        if result.returncode != 0 or code not in ("200", "301", "302"):
            dead.append((label, url, f"HTTP {code or 'unreachable'}"))
    return dead


def family_of(dim: str) -> str:
    for prefix in ("tag:", "ext-entity:", "name:", "name-pattern"):
        if dim.startswith(prefix):
            return prefix.rstrip(":").split("-")[0] if prefix.startswith("name") else prefix.rstrip(":")
    if dim.startswith("k8s"):
        return "k8s"
    if dim == "host-group":
        return "host-group"
    return "name"



def _bare_key(dim):
    """The key a context-imported tag is actually STORED under at source.

    A zone filters on the rendered form "[Environment]server_managed_by"; the
    source tag is "server_managed_by". Any query printed for a reader to run
    has to use the bare key, or it returns the very zero the surrounding note
    warns about.
    """
    return re.sub(r"^\[[^\]]+\]", "", dim.replace("tag:", ""))

# Internal surface identifiers -> the names a client uses for the same objects.
# Hard rule 2: the snake_case probe-side vocabulary never reaches a deliverable.
# Verdict slug -> the sentence-case label the worklist shows. The slugs are the
# analysis vocabulary; a client opening the worksheet reads the same plain
# English the plan does (hard rule 2), and the two stay aligned because both
# read this map.
_AUTOTAG_VERDICT_LABELS = {
    "no-measured-consumer": "Retire, not migrate",
    "consumer-unclassified": "Read before retiring",
    "blocked-on-tag": "Blocked on another tag",
    "re-source": "Needs a source tag",
    "native-field": "Free to convert",
    "already-sourced": "Already at source",
    "verify-live": "Read by hand",
}

_HAZARD_LABELS = {
    "pg-to-host-propagation": "tag propagates to hosts",
    "pg-to-service-propagation": "tag propagates to services",
    "host-to-pg-propagation": "tag propagates to process groups",
    "computed-value": "value computed from a pattern",
    "entity-pinned": "pinned to a hard-coded entity",
}

_SURFACE_LABELS = {
    "zones": "management zones",
    "profiles": "alerting profiles",
    "metric_events": "metric events",
    "maintenance_windows": "maintenance windows",
    "segments": "segments",
    "dashboards": "dashboards",
    "workflows": "workflows",
    "classic_dashboards": "classic dashboards",
}


def _cascade_evidence(summary, rules, top, chained, total, layers, cycles):
    """Evidence lines for the tag dependency cascade finding.

    Built from the tenant's own graph rather than asserted: which key sits at
    the head, how many rules read it, how deep the chain runs, and whether any
    part of it has no valid order at all.
    """
    lines = [
        f"Rules whose tag value is computed by reading another tag: "
        f"{chained} of {total}",
        f"Rules reading `{top['key']}`: {top['dependent_rules']}",
    ]
    hosts = top.get("sourced")
    lines.append(
        f"`{top['key']}` carried at source: "
        + ("not measured" if hosts is None else
           "no hosts - the key the chain hangs on does not exist in the "
           "platform data model" if not hosts else f"{hosts} hosts"))
    others = [r for r in summary["cascade_roots"][1:4]
              if r["dependent_rules"] > 1]
    if others:
        lines.append("Other keys with dependent rules: "
                     + "; ".join(f"`{r['key']}` ({r['dependent_rules']})"
                                 for r in others))
    if layers:
        deepest = max(l["layer"] for l in layers)
        lines.append(
            f"Depth of the chain: {deepest + 1} layers - "
            f"{layers[0]['rules']} rules can be re-sourced immediately, the "
            "rest wait on a predecessor")
    if cycles:
        lines.append(
            f"Rules with NO valid ordering: {len(cycles)} sit in a circular "
            "dependency, reading a tag that reads them back")
    return lines


def _app_tag_evidence(app_label, app_hosts, fleet, best, bridges):
    """Evidence lines for the application-tag finding, all tenant-measured.

    `best` is this tenant's best-propagated tag dimension, quoted as the
    existence proof that the source-tag path works on this estate - it is the
    difference between "you must build tagging at source" (daunting, unproven)
    and "you already do this for one dimension, extend it" (a known path).
    """
    pct = (100.0 * app_hosts / fleet) if fleet else 0.0
    lines = [
        f"Application-ID tag ({app_label}): computed by classic auto-tagging, "
        f"but present on {app_hosts} of {fleet:,} hosts ({pct:.2f}%) in the "
        "platform-side tag model" if fleet else
        f"Application-ID tag ({app_label}): computed by classic auto-tagging, "
        "absent from the platform-side tag model",
    ]
    if best:
        bname = _bare_key(best[0])
        bhosts = best[1]["propagated_hosts"]
        bpct = (100.0 * bhosts / fleet) if fleet else 0.0
        lines.append(
            f"By contrast {bname} reaches {bhosts:,} of {fleet:,} hosts "
            f"({bpct:.0f}%) in the same model - source tagging demonstrably "
            "works on this estate, so this is an extension of an existing "
            "practice, not a new one")
    if bridges:
        one = len(bridges) == 1
        lines.append(
            f"{len(bridges)} segment{'' if one else 's'} "
            f"({', '.join(bridges)}) currently "
            f"{'reconstructs' if one else 'reconstruct'} this dimension by "
            "parsing it out of classic tag strings, and "
            f"{'stops' if one else 'stop'} working when classic entity tags "
            "retire")
    return lines

# ---------------------------------------------------------------- document

def credential_exposure(run_json):
    """What cleartext credentials this tenant stores in classic notifications.

    MANDATORY finding input, per security-sensitive-data-policy.md: when a run
    redacts a credential-class value, the deliverable must disclose the tenant's
    cleartext credentials. This builder emitted no such finding until 2026-08-26
    — and because `save_scan_supersede` never forwarded run state to the scan,
    the scanner's own c7-security-finding-missing gate was skipped rather than
    satisfied, so nothing caught it.

    The finding is about the TENANT's exposure, never about this review's
    handling of it: the policy forbids a deliverable from discussing redaction,
    and the C7 scan bans redaction markers outright. Returns None when the run
    redacted no credential (a run with nothing to disclose stays silent).
    """
    run_json = Path(run_json)
    try:
        state = json.loads(run_json.read_text())
    except (OSError, ValueError):
        return None

    by_key, probes = {}, []
    for probe_id, record in (state.get("probes") or {}).items():
        summary = record.get("summary")
        if not isinstance(summary, dict):
            continue
        keys = summary.get("redacted_keys")
        if isinstance(keys, dict) and keys:
            for name, n in keys.items():
                by_key[name] = by_key.get(name, 0) + int(n or 0)
            probes.append((probe_id, record.get("raw_file")))
    total = sum(by_key.values())
    if not total:
        return None

    # A sample of five of the things being counted, so the reader sees WHAT
    # kind of object holds a credential without running anything (CLAUDE.md
    # "show your work"). Names come from the saved probe, which is already
    # redacted — only the object's display name is read, never a value.
    samples, carriers = [], 0
    for _probe_id, raw_file in probes:
        if not raw_file:
            continue
        try:
            rows = json.loads((run_json.parent / raw_file).read_text())["result"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        for row in rows:
            value = row.get("value") or {}
            if "REDACTED_API_KEY" not in json.dumps(value):
                continue
            carriers += 1
            name = value.get("displayName") or value.get("name")
            if name and len(samples) < 5:
                samples.append(f"{name} ({value.get('type') or 'notification'})")
    return {"total": total, "by_key": by_key,
            "carriers": carriers, "samples": samples}


def _run_date(analysis_path):
    """The trailing YYYY-MM-DD of the run directory holding this analysis.

    Tenant ids are often hyphenated, so the date is the trailing three
    hyphen-separated parts, never a split from the left.
    """
    parts = Path(analysis_path).resolve().parent.name.rsplit('-', 3)
    if len(parts) == 4:
        try:
            return datetime.date(*(int(x) for x in parts[1:])).isoformat()
        except ValueError:
            pass
    return datetime.date.today().isoformat()


def build_docx(rep, customer, tenant_url, out_path, requested_by=None, tenant_id=None,
               collected=None, run_state=None, cred=None):
    # The filename decides the page marking: a "[INTERNAL ONLY]-" prefix gets
    # the red distribution banner, a customer-facing filename gets the
    # AI-generated watermark.
    internal = ds.is_internal_filing(out_path)
    doc = ds.new_report_doc(internal=internal)
    # The same filing decision has to reach the COVER, not only the page marking:
    # an internally-filed deliverable must declare itself on page one, and the
    # pre-delivery scan enforces that under --profile internal. Reading
    # is_internal_filing for the banner but not for the subtitle left every
    # internally-filed plan failing its own scan.
    ds.cover_page(doc, customer, tenant_url, overall=None, grade_letter=None,
                  grade_label=None, title=TITLE, requested_by=requested_by,
                  date=collected,
                  subtitle=("Dynatrace internal — not for customer distribution"
                            if internal else None))

    # ---- The already-complete case (SKILL.md, Gen3-first) -------------------
    # "A tenant with 0 management zones is already done - report 'Complete -
    # maintain segments' and stop; never score classic-absence as a gap."
    # Without this branch the generic migration template renders against an
    # empty estate and produces sentences like "this tenant's 0 management
    # zones reduce to a small set of dimensions" and "left as-is, the zone
    # estate degrades silently" - describing work that does not exist.
    if not rep.get("zones_total"):
        _build_complete_docx(doc, rep, out_path, customer, tenant_id)
        return out_path

    bz = rep["coverage_by_zone_count"]
    bp = rep.get("coverage_by_population")
    disp = rep["dispositions"]
    retire_now = disp.get("retire-now", 0)
    dc = rep.get("delivery_consolidation") or {}
    bucket = rep.get("bucket_posture") or {}
    total = rep["zones_total"]
    eff = rep.get("effectiveness") or {}
    jobs = rep.get("jobs") or {}
    blockers = rep.get("conversion_blockers") or {}
    gaps = rep.get("alerting_gaps") or {}

    # -- Executive summary ---------------------------------------------------
    doc.add_heading("Executive summary", level=1)
    headline = (
        f"Scoping coverage: {bz['pct']}% of zones ride a dimension segments "
        f"already cover ({(bp or bz)['pct']}% weighted by zone membership)  "
        f"·  Retirable now: {retire_now} of {total} zones  "
        f"·  Consumers to rehome: {rep['consumers_to_rehome']}")
    if eff:
        headline = (
            f"{total} zones → {eff['zones_worth_keeping']} worth keeping → "
            f"{eff['proposed_segments']} segments  ·  " + headline)
    ds.callout(doc, headline, title="Headline numbers")
    ds.para(doc, (
        f"This tenant's {total} management zones reduce to a small set of real "
        "scoping dimensions, and the migration is smaller than the zone count "
        f"suggests: {retire_now} zones can be retired now (empty and "
        "unreferenced, or fully covered by an existing segment), and the "
        "genuine build work concentrates on a handful of dimensions no "
        "segment covers yet. Two of those uncovered dimensions belong to the "
        "estate's largest zones, which is why the population-weighted "
        "coverage figure is much lower than the per-zone figure - closing "
        "them moves most of the estate at once."))
    ds.para(doc, (
        "The bulk of the effort is not authoring segments - it is rehoming "
        f"the {rep['consumers_to_rehome']} alerting-profile, notification and "
        "detector references that today point at management zones. This plan "
        "sequences that consumer cutover before any zone is retired, and "
        "consolidates alert delivery by destination rather than porting "
        "configuration one-for-one."))
    ds.para(doc, (
        "Left as-is, the zone estate degrades silently: zone rules are "
        "static and hand-maintained, new workloads fall outside them until "
        "someone edits the rules, and none of the data the platform now "
        "writes to Grail (logs, spans, business events, cost records) is "
        "visible to zone-based scoping or zone-based access control. Every "
        "month of dual-running means every scoping change is made twice."))

    # -- Zone effectiveness (the not-1:1 headline) ----------------------------
    if eff:
        doc.add_heading("Zone effectiveness: this migration is not one-to-one",
                        level=1)
        ds.callout(doc, (
            f"{total} zones → {eff['zones_worth_keeping']} worth keeping → "
            f"{eff['proposed_segments']} proposed segments. One segment per "
            "dimension — zones that differ only in the value of a shared "
            "dimension become one segment with a variable, and empty or "
            "unreferenced zones are retired without a replacement."),
            title="The real size of this migration")
        VERDICT_LABELS = {
            "effective": ("Distinct, populated, referenced",
                          "A dimension to carry forward as a segment"),
            "value-of-dimension": ("Value of a shared dimension",
                                   "Collapses into one segment's variable "
                                   "with its family"),
            "unused": ("Populated but unreferenced",
                       "No alerting, notification or detector references and "
                       "no query activity in the measured window — candidate "
                       "to retire without replacement"),
            # Same verdict, weaker evidence: without the query-activity read
            # "unreferenced" is only the configuration side of the question.
            "unused-proxy": ("Populated but unreferenced",
                             "No alerting, notification or detector "
                             "references — candidate to retire without "
                             "replacement"),
            "dead": ("Matches nothing",
                     "Zero entities in the population census — retire"),
            "hygiene-only": ("Noise exclusions only",
                             "Excludes agent/system noise, scopes nothing — "
                             "retire; the exclusions belong in queries"),
            "no-dimension": ("No discernible dimension",
                             "Investigate before any action"),
        }
        queried = eff.get("query_activity_measured")
        rows = []
        for verdict, count in sorted((eff.get("verdicts") or {}).items(),
                                     key=lambda kv: -kv[1]):
            key = "unused-proxy" if verdict == "unused" and not queried \
                else verdict
            label, meaning = VERDICT_LABELS.get(key, (verdict, ""))
            rows.append([label, str(count), meaning])
        ds.styled_table(doc, ["Verdict", "Zones", "What it means"], rows)
        if eff.get("value_families"):
            ds.para(doc, (
                f"{eff['value_families']} zone famil"
                f"{'y' if eff['value_families'] == 1 else 'ies'} share a "
                "dimension signature and differ only in the filtered value — "
                f"the largest holds {eff['largest_value_family']} zones. Each "
                "family is one segment with a variable, never one migration "
                "per zone."))
        if eff.get("sprawl_warning"):
            ds.callout(doc, (
                f"The projected segment count ({eff['proposed_segments']}) "
                "exceeds the three-to-eight range a dimension-led design "
                "produces. Past that point the design is converting values, "
                "not dimensions — revisit the dimension map before building."),
                title="Segment sprawl warning")
        # The platform counts zone queries, so "unreferenced" is a measurement
        # wherever that read succeeded — and only a configuration-side proxy
        # where it did not. Stating the weaker claim in both cases understates
        # the evidence and, worse, invites a retirement that a real query would
        # have blocked. The window has to be named either way: a silent 7-day
        # window over a zone used at quarter-end is not an unused zone.
        if queried:
            window = eff.get("query_activity_window") or "the measured window"
            ds.method_note(doc, (
                f"\"Unreferenced\" is measured, not inferred: over {window} "
                "the platform recorded no queries against these zones, and "
                "the configuration side carries no alerting profile, "
                "notification or detector reference either. A zone that is "
                "still being queried is reported as in use even when nothing "
                "in the configuration points at it — that catches consumers "
                "the configuration cannot show, such as a classic dashboard "
                "filter or an integration passing a zone as a parameter. "
                "Widen the window before retiring a zone whose use is "
                "seasonal, such as a quarter-end or audit view."))
        else:
            ds.method_note(doc, (
                "Zone query activity was not collected on this run, so "
                "\"unreferenced\" reflects entity population and configured "
                "consumers (alerting profiles, notifications, detectors) — a "
                "proxy for use, not a measurement of it. The platform does "
                "publish a per-zone query counter; reading it upgrades this "
                "verdict to a measurement. Until then, confirm with the "
                "owning teams before retiring anything marked "
                "populated-but-unreferenced."))

    # -- Which job is each zone doing -----------------------------------------
    if jobs:
        doc.add_heading("Which job is each zone doing?", level=1)
        ds.para(doc, (
            "A management zone does up to three distinct jobs, and they "
            "migrate to three different places. Restricting who may READ "
            "data is the access job and moves to an IAM policy with a "
            "security-context boundary; scoping what a user SEES is the "
            "filter job and moves to a segment; deciding who gets PAGED is "
            "the alerting job and moves to a problem-triggered workflow. "
            "The test: if removing the zone would let someone see data they "
            "are not allowed to see, it is doing the access job — and a "
            "segment must never be its replacement, because a segment "
            "changes what is shown, never what is permitted."))
        job_rows = []
        JOB_LABELS = {"filter": "Filter (what users see)",
                      "alerting": "Alerting (who gets paged)",
                      "access": "Access (who may read)",
                      "access-unknown": "Access role not measurable",
                      # Without this row the internal token prints verbatim, and
                      # on a tenant whose group bindings are unreadable it is the
                      # LARGEST row in the table.
                      "access-classic-roles-present":
                          "Access (classic role bindings present, "
                          "zone scope unresolved)"}
        for job, count in sorted((jobs.get("counts") or {}).items(),
                                 key=lambda kv: -kv[1]):
            job_rows.append([JOB_LABELS.get(job, job), str(count),
                             (jobs.get("targets") or {}).get(job, "")])
        ds.styled_table(doc, ["Job", "Zones", "Migrates to"], job_rows)
        if not jobs.get("access_measured", True):
            # Two different states hide behind "not measured". The independent
            # readiness read either confirms classic role bindings exist (a
            # measured fact, scope still unresolved) or says nothing at all.
            # Reporting both as "unknown" understates a live security exposure.
            if jobs.get("classic_roles_present"):
                ds.callout(doc, (
                    "A second, independent read of the platform's own access "
                    "model confirms that user groups on this tenant still "
                    "carry classic role bindings — so permissions granted "
                    "through management zones are live here, not "
                    "hypothetical. What that read cannot resolve is which "
                    "zone each binding scopes, and the per-group bindings "
                    "themselves were not readable with the access available "
                    "to this review. Every zone therefore keeps its access "
                    "role open: do not retire one on the assumption it is "
                    "filter-only, because replacing an access-bearing zone "
                    "with a segment alone is a security regression — a "
                    "segment changes what is shown, never what is permitted. "
                    "Resolve each zone's bindings in identity management "
                    "before its retirement step."),
                    title="Classic role bindings present — hold retirements")
            else:
                ds.callout(doc, (
                    "Identity-management group bindings were not readable "
                    "with the access available to this review, so the access "
                    "job could not be measured for any zone. Do not retire a "
                    "zone on the assumption it is filter-only: replacing an "
                    "access-bearing zone with a segment alone is a security "
                    "regression. Verify each zone's permission bindings in "
                    "identity management before its retirement step."),
                    title="Access role unverified — hold retirements")
        sec_pct = jobs.get("security_context_entity_pct")
        if sec_pct is not None:
            if sec_pct == 0:
                ds.para(doc, (
                    "Corroborating measurement: no entity in this "
                    "environment carries a security context yet. The policy "
                    "boundary that the access job migrates onto does not "
                    "exist, which means zone-based permissions are currently "
                    "the only access mechanism in place — one more reason no "
                    "zone should be retired before its access role is "
                    "verified, and why the security-context enrichment "
                    "workstream belongs early in the runbook."))
            else:
                ds.para(doc, (
                    f"Corroborating measurement: {sec_pct:g}% of entities "
                    "already carry a security context — the access-layer "
                    "boundary is partially established; align the zone "
                    "access migration with the scheme already in use."))

    # -- How to read ---------------------------------------------------------
    doc.add_heading("How to read this plan", level=1)
    ds.styled_table(doc, ["Disposition", "Meaning", "Action"], [
        ["Retire now", "Matches nothing, or fully covered, and nothing "
         "references it", "Confirm parity, then delete - no migration work"],
        ["Retire after cutover", "A segment covers its dimension; live "
         "consumers still reference it", "Rehome the listed consumers, "
         "confirm parity, then retire"],
        ["Build then retire", "Populated, and no segment covers its "
         "dimension yet", "Author the proposed segment, validate, rehome, "
         "retire"],
        ["Investigate", "Signals conflict (e.g. alerting bound to an empty "
         "zone)", "Named follow-up - never silently dropped"],
    ])
    ds.para(doc, (
        "Existing segments are classified three ways: native-dimension "
        "segments filter a real platform field and are the end state; bridge "
        "segments re-render legacy tag strings and are transitional by "
        "construction; statically pinned segments hard-code value lists and "
        "rot as the estate changes."))

    # -- Target architecture -------------------------------------------------
    doc.add_heading("Target architecture: what replaces a management zone",
                    level=1)
    ds.para(doc, (
        "A management zone did four jobs at once - grouping, access, "
        "alert scoping and dashboard filtering. The platform-native answer "
        "splits them into four purpose-built layers; the migration builds "
        "each layer once and retires the zones that emulated it."))
    ds.styled_table(doc, ["Layer", "Mechanism", "State on this tenant"], [
        ["1 · Metadata at source",
         "Tags set where workloads run (host tags, Kubernetes labels, cloud "
         "tags) plus OpenPipeline enrichment (security context, cost "
         "allocation)",
         "Partial - the estate-management tags behind the largest zones "
         "already flow platform-wide; the application-ID tag most zones "
         "filter on exists only as a classic computed tag and must be "
         "established at source"],
        ["2 · Storage (Grail buckets)",
         "Custom buckets per data domain: retention differentiation, "
         "coarse access isolation, and query-scan pruning",
         (f"{bucket.get('total', '?')} buckets, {bucket.get('custom', '?')} "
          "custom - effectively default-only; bucket design recommended "
          "alongside the segment rollout" if bucket.get("custom", 9) < 5 else
          f"{bucket.get('total', '?')} buckets, {bucket.get('custom')} custom")],
        ["3 · Access (IAM policies)",
         "Record-level policies on security context; coarse bucket read "
         "permissions; entity-level policy conditions",
         "To build - today's access boundaries are zone-based and do not "
         "reach Grail data at all"],
        ["4 · View (Segments)",
         "Dynamic, shareable filters across entities and Grail data - the "
         "layer users see",
         "Started - native-dimension segments exist for host groups, "
         "Kubernetes and cloud metadata; the application dimension is "
         "bridged, not native"],
    ])
    ds.callout(doc, (
        "Segments are not an access boundary. A segment hides data from "
        "view; only an IAM policy withholds it from query. Zone-based "
        "permissions must be replaced in the access layer (policies on "
        "security context and buckets) - re-creating them as segments "
        "would look equivalent and protect nothing."), title="Important")
    ds.para(doc, (
        "Buckets deserve early attention because they bind at ingest: a "
        "bucket assignment applies to data as it arrives, not "
        "retroactively. Designing buckets late means waiting out the "
        "retention window before their benefits (retention tiers, coarse "
        "isolation, cheaper scans) exist. A default-only bucket estate "
        "also means every query scans the whole default bucket - segments "
        "filter what users see, but only buckets reduce what queries read."))

    # -- Tagging at source ---------------------------------------------------
    doc.add_heading("The tagging-at-source foundation", level=1)
    prov = rep.get("tag_provenance") or {}
    counts = {}
    for entry in prov.values():
        key = entry["provenance"].split(" (")[0]
        counts[key] = counts.get(key, 0) + 1
    ds.para(doc, (
        "Segments, IAM policies and dashboards key on tags that are set at "
        "the source and flow into the platform's data model. Tags computed "
        "by classic auto-tagging rules exist only on classic entities and "
        "retire with them - a segment cannot be built on one. Every tag "
        "dimension the zones filter on was therefore checked for where the "
        "tag actually lives:"))
    rows = []
    for dim, entry in sorted(prov.items(), key=lambda kv: -kv[1]["zones"])[:14]:
        rows.append([dim.replace("tag:", ""), str(entry["zones"]),
                     entry["provenance"], entry["path"]])
    ds.styled_table(doc, ["Tag key", "Zones", "Where it lives",
                          "Path forward"], rows)
    if len(prov) > 14:
        ds.method_note(doc, f"{len(prov) - 14} further tag keys with one or "
                       "two zones each follow the same classification in the "
                       "worksheet.")
    # The application-tag finding is DERIVED, never asserted: which tag key,
    # how many hosts actually carry it, how many bridge segments depend on it,
    # and which estate tag proves the source path works are all read from this
    # tenant's own census. They were hardcoded reference-estate figures until
    # 2026-08-24 ("~93%", "both bridge segments"), which is a cross-tenant
    # number wearing this tenant's clothes.
    fleet = int((rep.get("population_base") or {}).get("fleet_hosts") or 0)
    prop = rep.get("propagation") or {}
    fleet = fleet or int(prop.get("hosts") or 0)
    app_dim = next((d for d in prov
                    if d.lower().endswith("appid")), None)
    app_hosts = prov.get(app_dim, {}).get("propagated_hosts", 0) if app_dim else 0
    bridges = [seg["name"] for seg in rep["segments"] if seg["kind"] == "bridge"]
    # The best-propagated dimension on this tenant - the existence proof that
    # source tagging works here, quoted at its measured coverage.
    best = max(((d, e) for d, e in prov.items()
                if e.get("propagated_hosts")),
               key=lambda kv: kv[1]["propagated_hosts"], default=None)
    app_label = (app_dim or "tag:AppID").replace("tag:", "")
    bridge_phrase = (
        (f"the bridge segment ({bridges[0]})" if len(bridges) == 1 else
         f"the {len(bridges)} bridge segments ({', '.join(bridges)})")
        if bridges else "no bridge segment")
    app_reach = (f"{app_hosts} of {fleet:,} hosts"
                 if fleet else f"{app_hosts} hosts")
    ds.finding_section(
        doc, "Application-ID tagging", "attention",
        what=(f"The application-ID tag ({app_label}) that most application "
              f"zones and {bridge_phrase} filter on exists only as a classic "
              "computed tag - it is effectively absent from the platform "
              f"data model, reaching {app_reach}."),
        means=("Every application-scoped view, alert filter and access rule "
               "that should key on this tag after the migration currently "
               "has nothing to key on - "
               + ("the bridge segment that parses it out of classic entity "
                  "tags is load-bearing."
                  if len(bridges) == 1 else
                  "the bridge segments that parse it out of classic entity "
                  "tags are load-bearing.")),
        why=("The application dimension is this estate's primary way of "
             "organizing work; it must survive the retirement of classic "
             "entities and auto-tag rules."),
        consequence=("If zones are retired before the tag is established at "
                     "source, application-scoped alerting and filtering "
                     "break with no replacement; if the migration simply "
                     "waits, every new segment, dashboard and policy keeps "
                     "being built on a bridge that is scheduled to go away."),
        evidence_lines=_app_tag_evidence(app_label, app_hosts, fleet, best,
                                         bridges),
        reproduction={
            # Record access by LITERAL KEY, not contains() on the rendered tag
            # string. A substring search also matches tag VALUES: it reported
            # this tag on 3-6 hosts that merely carry the letters somewhere in
            # a value, against 0 that actually carry the key. A reader running
            # the printed query has to land on the printed number, so the query
            # printed here is the one the number came from.
            "query": (
                "smartscapeNodes HOST\n"
                "| summarize hosts = count(),\n"
                f"    with_app_tag = countIf(isNotNull(tags[`{app_label}`]))"
                + (f",\n    with_estate_tag = "
                   f"countIf(isNotNull(tags[`{_bare_key(best[0])}`]))"
                   if best else "")),
            "note": (
                "Run in a Notebook. This reads the platform-side (Smartscape) "
                "host tags - the only surface that proves a tag is set at "
                "source. A tag computed by a classic auto-tagging rule "
                "appears on classic entities but not here, which is exactly "
                "the distinction that decides whether a segment can be built "
                "on it. Two things to keep in mind if you vary the query: a "
                "tag imported with a context prefix is stored under its bare "
                "key (search "
                + (f"{_bare_key(best[0])}, not {best[0].replace('tag:', '')})"
                   if best else "the key without its bracketed prefix)")
                + ", and matching the tag as text rather than by key also "
                "matches tag values, which overstates the count."),
        },
        action=[
            "Choose the authoritative source for the application ID "
            "(deployment tooling, Kubernetes labels, host tags or CMDB "
            "sync) and emit it as a source tag on hosts and workloads.",
            "Mirror it into security context via OpenPipeline enrichment so "
            "the access layer can use the same dimension.",
            "Validate coverage against the zone estate's application list, "
            + ("then rebuild the bridge segment as a native tag filter and "
               "drop its parsing step."
               if len(bridges) == 1 else
               f"then rebuild the {len(bridges)} bridge segments as native "
               "tag filters and drop their parsing step."),
            "Only then retire the classic auto-tagging rules that compute "
            "the application ID today.",
        ])


    # -- Stage 1c: the classic auto-tagging layer ----------------------------
    # Stage 1b (above) covers the tag KEYS the zones filter on. This covers the
    # RULES, which are Gen2 objects in their own right and mostly invisible to
    # the zone view: on the reference estate 178 and 347 rules existed while
    # only 21 and 53 produced a key any zone filtered on. Retiring zones
    # without dispositioning the rules leaves the estate's tag values being
    # computed by machinery scheduled for removal.
    at = rep.get("auto_tag_summary")
    ats = rep.get("auto_tags") or {}
    if at and at["rules_total"]:
        doc.add_heading("The classic auto-tagging layer", level=1)
        verdicts = at["verdicts"]
        n_rules = at["rules_total"]
        zone_keys = sum(1 for r in ats.values() if r["consumers"].get("zones"))
        ds.para(doc, (
            f"{n_rules} classic auto-tagging rules run on this tenant. They "
            "are Gen2 objects: each computes a tag that exists on classic "
            "entities and retires with them. Only "
            f"{zone_keys} of them produce a key a management zone filters on, "
            "so the zone-by-zone view of the migration does not see the rest - "
            "yet they are what sets the tag values the estate's alerting and "
            "filtering rely on. Each rule was dispositioned from its own "
            "definition, not from its name:"))
        L = _AUTOTAG_VERDICT_LABELS
        rows = [
            [L["no-measured-consumer"], str(verdicts.get("no-measured-consumer", 0)),
             "No zone, alerting profile, metric event, maintenance window or "
             "segment references the key, and it appears nowhere as text"],
            [L["consumer-unclassified"], str(verdicts.get("consumer-unclassified", 0)),
             "No structured filter references the key, but it appears as text "
             "in a configuration object - those have to be read"],
            [L["blocked-on-tag"], str(verdicts.get("blocked-on-tag", 0)),
             "The rule reads another classic tag, which has to be re-established "
             "at source first"],
            [L["re-source"], str(verdicts.get("re-source", 0)),
             "Reads a host, process or service NAME - no dimension exists "
             "behind it, so one has to be agreed and applied at source"],
            [L["native-field"], str(verdicts.get("native-field", 0)),
             "Every condition already reads a native dimension - a segment can "
             "filter on it directly and the rule retires with no other work"],
            [L["already-sourced"], str(verdicts.get("already-sourced", 0)),
             "A source tag of the same key already flows - the rule is "
             "duplicating work that is done"],
            [L["verify-live"], str(verdicts.get("verify-live", 0)),
             "Uses a condition or selector form outside the classification "
             "census - a person has to classify it"],
        ]
        ds.styled_table(doc, ["Disposition", "Rules", "What it means"],
                        [r for r in rows if r[1] != "0"])

        roots = [r for r in at["cascade_roots"] if r["dependent_rules"] > 1]
        top = roots[0] if roots else None
        chained = sum(1 for r in ats.values() if r["depends_on"])
        if top:
            dependents = top["dependent_rules"]
            cycles = at.get("dependency_cycles") or []
            layers = at.get("resolution_layers") or []
            sample = [
                f"`{k}` - {v['clauses']} rule clause"
                f"{'' if v['clauses'] == 1 else 's'}, reads "
                + ", ".join(f"`{d}`" for d in v["depends_on"][:2])
                for k, v in sorted(
                    ((k, v) for k, v in ats.items()
                     if top["key"] in v["depends_on"]),
                    key=lambda kv: -kv[1]["clauses"])[:5]]
            ds.finding_section(
                doc, "The tag dependency cascade", "attention",
                what=(f"{chained} of the {n_rules} auto-tagging rules compute "
                      "their tag by reading another classic tag. "
                      f"{dependents} of them read one key - `{top['key']}` - "
                      "which is itself "
                      + ("not established at source."
                         if not top["sourced"] else
                         f"carried by {top['sourced']} hosts at source.")),
                means=("The tagging layer is not a flat list of independent "
                       "rules; it is a chain. A tag key that looks like one "
                       "item of work is the predecessor of dozens, and the "
                       "order of the work is fixed by the chain rather than "
                       "chosen by the team."),
                why=("Segments, IAM policies and dashboards key on tags. If a "
                     "tag at the head of the chain is retired or re-sourced "
                     "before the rules that read it are moved, those rules "
                     "keep running and silently stop producing values."),
                consequence=(
                    f"Retiring `{top['key']}` on the assumption that it is one "
                    f"tag empties {dependents} downstream rules at once, and "
                    "every alerting profile, maintenance window and zone that "
                    "filters on their output stops matching. Nothing errors: "
                    "the filters simply return less, alerts stop being "
                    "delivered to the teams whose tags vanished, and "
                    "maintenance windows stop suppressing. The failure is "
                    "discovered at the next incident, not at the change."),
                evidence_lines=_cascade_evidence(at, ats, top, chained,
                                                 n_rules, layers, cycles),
                reproduction={
                    # Auto-tagging rules are settings objects, not Grail
                    # records - there is no DQL that returns them, so the
                    # reproduction is the console path plus a sample of what is
                    # being counted (CLAUDE.md: a stated gap passes, silence
                    # never does).
                    "note": (
                        "Classic auto-tagging rules are configuration objects "
                        "rather than stored records, so no query returns them. "
                        "To see this for yourself: Settings > Tags > "
                        "Automatically applied tags, open any rule below and "
                        "read its conditions - a condition of type 'Tag' is a "
                        "dependency on another rule's output. The counts here "
                        "come from reading every rule's conditions and "
                        "entity selectors."),
                    "sample": sample,
                },
                action=[
                    f"Establish `{top['key']}` at source first - it is the "
                    "head of the chain and nothing downstream can be finished "
                    "before it.",
                    "Work the re-sourcing in dependency order (the worksheet "
                    "gives the layer for every rule); a rule in a later layer "
                    "cannot be validated until its predecessors carry values.",
                ] + ([
                    f"Break the {len(cycles)} circular dependencies by "
                    "deciding which rule in each pair becomes the source of "
                    "truth - they read each other, so no order exists until "
                    "someone chooses."
                ] if cycles else []) + [
                    "Retire each rule only after its replacement carries the "
                    "same values, and retire the head of the chain last.",
                ])

        haz = at["hazards"]
        if haz:
            prop_rules = sorted({k for k, v in ats.items()
                                 if any(h.endswith("-propagation")
                                        for h in v["hazards"])})
            computed = sorted(k for k, v in ats.items()
                              if "computed-value" in v["hazards"])
            haz_sample = [
                f"`{k}` - value computed as "
                + ", ".join(f"{{{p}}}" for p in
                            (ats[k].get("value_placeholders") or [])[:2])
                for k in computed[:5] if ats[k].get("value_placeholders")]
            ds.finding_section(
                doc, "Auto-tagging behavior segments do not reproduce",
                "attention",
                what=(f"{len(prop_rules)} rules rely on tag propagation across "
                      "entity relationships, and "
                      f"{len(computed)} compute the tag's VALUE at tag time "
                      "from a pattern. Segments do neither."),
                means=("A segment that restates a rule's conditions faithfully "
                       "can still cover a different set of entities than the "
                       "rule did, and produce a value the rule never produced. "
                       "These are not edge cases in this estate - they are the "
                       "majority of the rules that have consumers."),
                why=("A propagating rule matches a process group and the tag "
                     "lands on its host and services as well; a segment filter "
                     "does not traverse the relationship unless it is written "
                     "to. A computed value is derived by pattern at tag time; "
                     "a segment can only filter on a value that already "
                     "exists."),
                consequence=("Migrated as written, these become silent scope "
                             "changes rather than errors. The propagating "
                             "rules' replacements cover fewer entities than "
                             "the originals - alerts and views quietly lose "
                             "hosts and services nobody removed. The computed "
                             "ones have nothing to filter on at all, because "
                             "the value only ever existed as a product of the "
                             "rule being migrated away."),
                evidence_lines=[
                    ("Rules propagating a tag across relationships: "
                     f"{len(prop_rules)} of {n_rules}"),
                    ("  process group to host: "
                     f"{haz.get('pg-to-host-propagation', 0)}; process group "
                     f"to service: {haz.get('pg-to-service-propagation', 0)}; "
                     f"host to process group: "
                     f"{haz.get('host-to-pg-propagation', 0)}"),
                    (f"Rules computing the tag value from a pattern: "
                     f"{len(computed)}"),
                ] + ([f"Rules pinned to a hard-coded entity id: "
                      f"{haz['entity-pinned']}"]
                     if haz.get("entity-pinned") else []),
                reproduction={
                    "note": (
                        "Read in the rule editor: Settings > Tags > "
                        "Automatically applied tags. A propagating rule shows "
                        "'Apply to ... related' checkboxes under its "
                        "condition list; a computed one shows a value field "
                        "containing a {placeholder} rather than a literal. "
                        "The samples below are the computed ones."),
                    "sample": haz_sample or [
                        f"`{k}` - propagates across entity relationships"
                        for k in prop_rules[:5]],
                },
                action=[
                    "For each propagating rule, decide the replacement's "
                    "scope explicitly: either set the source tag on every "
                    "entity type the rule reached, or write the segment to "
                    "traverse the relationship. Do not let the default "
                    "decide it.",
                    "For each computed value, move the computation to source "
                    "or to OpenPipeline enrichment so the value exists as a "
                    "field before any segment needs to filter on it.",
                    "Validate each replacement by comparing entity counts "
                    "against the rule it replaces, before the rule is "
                    "disabled - a count that drops is the scope change "
                    "showing itself while it is still reversible.",
                ])

        retire = at["retire_candidates"]
        unclassified = at.get("unclassified_consumers") or []
        _cdu = at.get("classic_dashboard_usage")
        # Not read at all, PLUS read but yielding nothing to check - both are
        # gaps in the same evidence, and a metadata-only payload is the more
        # dangerous of the two because it looks like coverage.
        _missing = [x for x in _SURFACE_LABELS
                    if x not in at["surfaces_read"]
                    and x not in (at.get("surfaces_inconclusive") or [])]
        _empty = at.get("surfaces_inconclusive") or []
        if retire:
            ds.finding_section(
                doc, "Auto-tagging rules with no measured consumer",
                "opportunity",
                what=(f"{len(retire)} of the {n_rules} rules produce a tag key "
                      "that no management zone, alerting profile, metric "
                      "event, maintenance window or segment on this tenant "
                      "references, and which appears nowhere in those objects "
                      "even as text."),
                means=("Roughly "
                       f"{round(100 * len(retire) / n_rules)}% of the "
                       "auto-tagging layer is computing tags nothing consumes. "
                       "This is work the migration does not have to do: these "
                       "rules are retired, not converted, and no segment, "
                       "source tag or agreement is needed for any of them."),
                # Derived, never asserted: the overstatement is retire/remaining,
                # and on a tenant with few retirable rules that sentence would
                # otherwise claim a saving the numbers do not show.
                why=("The size of the tagging workstream is set by the rules "
                     "that have to be replaced, not by the rules that exist. "
                     f"{n_rules - len(retire)} rules actually need a decision; "
                     f"sizing the work from the raw {n_rules} overstates it by "
                     f"{round(100 * len(retire) / max(n_rules - len(retire), 1))}%"
                     " on this tenant."),
                consequence=("Carried forward untouched, they keep computing "
                             "tags onto classic entities until those entities "
                             "retire, and every review of the tagging estate "
                             "re-examines them. Migrated instead of retired, "
                             "they become segments and source tags nobody "
                             "asked for - permanent additions to the target "
                             "model justified only by the fact that a rule "
                             "once existed."),
                evidence_lines=[
                    f"Rules with no measured consumer: {len(retire)} of {n_rules}",
                    ("Configuration read to find consumers: "
                     + ", ".join(_SURFACE_LABELS.get(x, x)
                                 for x in at["surfaces_read"])),
                ] + ([
                    # A missing surface makes this list LONGER, not shorter -
                    # the verdict is "nothing was found referencing it", so an
                    # unread surface inflates it. Naming the gap is the
                    # difference between a list an owner can act on and one
                    # they have to re-derive.
                    "Not read in this review, so not checked for consumers: "
                    + ", ".join(_SURFACE_LABELS[x] for x in _missing)
                    + " - a tag referenced only there would appear on this "
                    "list, which is why owner confirmation is the first step "
                    "rather than the last"
                ] if _missing else []) + ([
                    "Read, but returned no tag references at all, so not a "
                    "consumer check either: "
                    + ", ".join(_SURFACE_LABELS[x] for x in _empty)
                ] if _empty else []) + ([f"A further {len(unclassified)} rules have no structured "
                      "consumer but do appear as text in a configuration "
                      "object - those are listed separately and must be read, "
                      "not retired on this evidence"] if unclassified else []),
                reproduction={
                    "note": (
                        "Every rule and its consumer count is listed in the "
                        "accompanying worksheet, so the list can be checked "
                        "rule by rule. A consumer here means a structured "
                        "filter reference - a tag filter on an alerting "
                        "profile, a tag condition on a zone or metric event, "
                        "or a tag scope on a maintenance window. Confirm with "
                        "the tag's owner before deleting: this run reads "
                        "configuration, and a tag may still be used by a "
                        "person filtering by hand."),
                    "sample": [f"`{k}`" for k in retire[:5]],
                },
                action=[
                    "Circulate the retire list to the tag owners for "
                    "confirmation - the check this run cannot make is whether "
                    "a person uses the tag interactively.",
                ] + ([
                    # With no classic-API read available, owner confirmation is
                    # the ONLY gate rather than a backstop - so give the manual
                    # substitute, prioritized by measured usage. Checking the
                    # twenty busiest is tractable; checking several hundred is
                    # not, and an untractable instruction is not followed.
                    f"Open the {min(20, _cdu['dashboards'])} most-used classic "
                    f"dashboards and read their filters. Their definitions are "
                    "not readable by this review, so this is the only way to "
                    "see whether one of them filters on a tag on the list "
                    f"above - and with {_cdu['dashboards']} of them opened "
                    f"{_cdu['opens']:,} times in the last 30 days (the busiest "
                    f"by {_cdu['max_users_on_one']} different people), the "
                    "chance that none does is not the way to bet. The busiest "
                    "are named in the accompanying worksheet.",
                ] if _cdu else []) + [
                    "Delete the confirmed rules before the migration starts, "
                    "so the segment design is sized against the tags that "
                    "actually matter.",
                    "Read the rules with an unclassified consumer separately; "
                    "each is either a name that merely contains the key, or a "
                    "reference form worth adding to the next assessment.",
                ])

    # -- Dimension map -------------------------------------------------------
    doc.add_heading("The dimension map", level=1)
    ds.para(doc, (
        f"All {total} zones reduce to the dimensions below - the migration "
        "is sized by dimensions, not by zone count. A dimension marked "
        "covered means its zones need no new segment; bridged means a "
        "transitional segment serves it today; uncovered dimensions are "
        "the genuine build list."))
    dim_rows = []
    for dim, info in list(rep["dimension_coverage"].items())[:16]:
        dim_rows.append([dim, str(info["zones"]), info["state"]])
    ds.styled_table(doc, ["Dimension", "Zones", "Coverage"], dim_rows)
    remaining = len(rep["dimension_coverage"]) - 16
    if remaining > 0:
        ds.method_note(doc, f"{remaining} additional low-frequency "
                       "dimensions (one or two zones each) are listed in "
                       "the worksheet.")

    pbase = rep.get("population_base") or {}
    if pbase.get("overlap_factor"):
        doc.add_heading("How the weighted coverage figure is counted",
                        level=2)
        ds.para(doc, (
            f"Zone membership on this tenant is many-to-many: the "
            f"{pbase['zones_with_population']:,} populated zones hold "
            f"{pbase['memberships']:,} entity memberships between them, "
            f"against {pbase['entity_ceiling']:,} distinct monitored "
            f"entities - an overlap factor of "
            f"{pbase['overlap_factor']}x, meaning the average zoned entity "
            f"sits inside roughly {pbase['overlap_factor']} zones at once. "
            "The weighted coverage figure quoted above is therefore a share "
            "of zoned surface area, not a share of entities, and the two "
            "must not be read interchangeably."))
        ds.para(doc, (
            "The overlap factor is itself an argument for the target model. "
            "Every additional zone an entity belongs to is another "
            "definition that has to be maintained, another place a scoping "
            "change has to be repeated, and another opportunity for two "
            "definitions of the same population to drift apart. A segment "
            "carrying a variable expresses the whole family once, so the "
            "overlap collapses rather than being reproduced."))
        if pbase.get("unzoned_entities"):
            ds.para(doc, (
                f"A further {pbase['unzoned_entities']:,} monitored entities "
                "belong to no zone at all. These are invisible to every "
                "zone-scoped filter, alerting profile and permission in use "
                "today - worth confirming that this is deliberate scope "
                "rather than entities that fell outside static rules as the "
                "estate changed."))

    # -- Conversion blockers ---------------------------------------------------
    if blockers:
        doc.add_heading("Conversion blockers: documented constraints, "
                        "not preferences", level=1)
        ds.para(doc, (
            "Four platform constraints decide which zones cannot convert "
            "one-to-one. Each is a documented limit of the segment and "
            "workflow models (references in the appendix), so the plan "
            "designs around them rather than discovering them mid-cutover."))
        excl = blockers.get("exclusion_zones") or []
        subs = blockers.get("substring_match_zones") or []
        derived = blockers.get("derived_data_dimensions") or []
        pviews = blockers.get("problem_view_zones") or []
        ds.styled_table(doc, ["Constraint", "Where it bites", "Design-around"], [
            ["Segments cannot express exclusions",
             (f"{len(excl)} zone(s) scope by excluding a tag or structural "
              f"condition: {', '.join(excl[:4])}" + ("…" if len(excl) > 4 else "")
              if excl else "Not present on this tenant"),
             "Restate the population positively (tag the kept set, not the "
             "excluded set) before converting"],
            ["Segment includes support = and in() only; entity name takes "
             "starts-with at most",
             (f"{len(subs)} zone(s) use contains/ends-with matching: "
              f"{', '.join(subs[:4])}" + ("…" if len(subs) > 4 else "")
              if subs else "Not present on this tenant"),
             "Resolve the naming convention to its real dimension, or "
             "restructure names so a starts-with prefix carries the meaning"],
            ["Only security context and the two cost keys reach derived "
             "data (service metrics)",
             (f"{len(derived)} tag dimension(s) proposed for segments will "
              "not follow the data into service metrics: "
              f"{', '.join(d.replace('tag:', '') for d in derived[:5])}"
              + ("…" if len(derived) > 5 else "")
              if derived else "Not present on this tenant"),
             "Mirror the dimension into security context or a cost key via "
             "OpenPipeline where metric filtering matters"],
            ["Entity includes alone do not filter the problem feed",
             (f"{len(pviews)} zone(s) currently give a team a filtered "
              "problem view" if pviews else "Not present on this tenant"),
             "Give each replacing segment an events include on "
             "event.kind = \"DAVIS_PROBLEM\""],
        ])

    # -- Segment build specs -------------------------------------------------
    doc.add_heading("Segment build specifications", level=1)
    ds.para(doc, (
        "One proposed segment per uncovered dimension, largest first. Each "
        "follows the same pattern: filter the native field, validate the "
        "population against the zones it replaces, then wire it into "
        "dashboards and alert routing."))
    derived_gap = set(blockers.get("derived_data_dimensions") or [])
    spec_rows = []
    for dim, info in rep["dimension_coverage"].items():
        if info["state"] != "uncovered" or info["zones"] < 2:
            continue
        fam = family_of(dim)
        field, note = FAMILY_SPECS.get(fam, FAMILY_SPECS["name"])
        if dim in derived_gap:
            note += (". Caveat: this key does not carry over to service "
                     "metrics — the segment will filter logs and spans "
                     "correctly and can return empty on metrics; mirror it "
                     "into security context or a cost key where metric "
                     "views matter")
        spec_rows.append([dim, str(info["zones"]), field, note])
        if len(spec_rows) >= 12:
            break
    ds.styled_table(doc, ["Dimension to cover", "Zones", "Native field",
                          "Approach"], spec_rows)

    # -- Consumer cutover ----------------------------------------------------
    doc.add_heading("Consumer cutover plan", level=1)
    ds.finding_section(
        doc, "Alert delivery: consolidate by destination", "attention",
        what=(f"{dc.get('notifications', 0)} classic problem notifications "
              f"resolve to {dc.get('distinct_targets', 0)} distinct delivery "
              f"destinations - including "
              f"{dc.get('by_type', {}).get('WEBHOOK', 0)} webhook "
              f"notifications that all point at "
              f"{dc.get('webhook_endpoints', 0)} endpoint(s)."),
        means=("The notification estate is far more consolidated than its "
               "object count suggests: one parameterized problem workflow "
               "per destination replaces hundreds of per-zone copies. "
               "Porting profiles one-for-one would faithfully reproduce the "
               "sprawl this migration exists to retire."),
        why=("Alert routing is the riskiest consumer class - it pages "
             "humans and files tickets. It must move deliberately, by "
             "destination, with a parallel-run before anything classic is "
             "switched off."),
        consequence=("Retiring a zone before its alerting references move "
                     "silently breaks delivery: the profile's zone filter "
                     "matches nothing and notifications simply stop. "
                     "Several zones on this tenant are already in that "
                     "state (see Investigate items in the worksheet)."),
        evidence_lines=[
            f"{dc.get('by_type', {}).get('EMAIL', 0)} email notifications "
            f"-> {dc.get('email_recipient_sets', 0)} distinct recipient sets",
            f"{dc.get('by_type', {}).get('WEBHOOK', 0)} webhook "
            f"notifications -> {dc.get('webhook_endpoints', 0)} distinct "
            "endpoint(s) - one parameterized workflow each",
            "Profile-to-zone-to-destination inventory ships in the "
            "worksheet for the cutover team",
        ],
        reproduction={
            "query": (
                "timeseries n = sum(dt.sfm.server.notifications.problem_notifications),\n"
                "  by: { notification.type, notification.display_name,\n"
                "        notification.delivery_status },\n"
                "  from:-7d\n"
                "| fieldsAdd total = arraySum(n)\n"
                "| fields notification.type, notification.display_name,\n"
                "         notification.delivery_status, total\n"
                "| sort total desc"
            ),
            "note": (
                "Needs permission to read metrics. This lists every notification "
                "integration that actually delivered in the window, grouped by "
                "destination - which is the grouping the cutover plans against. "
                "The full configured inventory, including integrations with no "
                "recent delivery, is in Settings under Integration > Problem "
                "notifications and ships in the accompanying worksheet."
            ),
            "sample": {
                "of": int(dc.get("notifications", 0) or 0),
                "columns": ["Integration type", "Configured notifications"],
                "rows": (
                    [[t, str(c)] for t, c in
                     sorted((dc.get("by_type") or {}).items(),
                            key=lambda kv: -kv[1])[:4]]
                    + [["Distinct delivery destinations they resolve to",
                        str(dc.get("distinct_targets", 0))]]
                ),
                "caption": (
                    "Classic notification inventory by type, against the number "
                    "of distinct destinations they actually reach."
                ),
            },
        },
        action=[
            "Group the notification inventory by destination (recipient "
            "set, endpoint, integration) - the worksheet provides the "
            "grouping.",
            "Design one problem-triggered workflow per destination, "
            "filtered by the new dimensions (tags / security context / "
            "entity criteria), parameterized by problem metadata.",
            "Port the semantics hidden in profile configuration: severity "
            "thresholds and delay windows become trigger conditions; "
            "closed-problem notification becomes close-event handling; "
            "maintenance-window expectations are honored in the workflow.",
            "Parallel-run each workflow against its live profile over an "
            "agreed window and compare deliveries.",
            "Disable the classic notification, and retire the profile when "
            "its zone retires. Profiles bound to empty zones can be "
            "retired immediately - they deliver nothing today.",
        ])
    # MANDATORY security finding (security-sensitive-data-policy.md). It sits
    # HERE rather than in an appendix because this is the section that rebuilds
    # those very integrations as workflows: the credential move is a step of the
    # cutover, not a separate security errand. Silent when the run has nothing
    # to disclose.
    if cred:
        key_list = ", ".join(
            f"{n} x {k}" for k, n in
            sorted(cred["by_key"].items(), key=lambda kv: -kv[1]))
        carriers = cred.get("carriers") or 0
        ds.finding_section(
            doc, "Credentials stored in cleartext in classic notifications",
            "attention",
            what=(f"{carriers} classic problem-notification integrations store "
                  f"an authentication credential as cleartext in their saved "
                  f"configuration ({key_list})."),
            means=("Every credential is readable by anyone who can view "
                   "notification settings, which is a far wider group than the "
                   "people trusted with the downstream systems those "
                   "credentials reach. The classic notification object has no "
                   "secret store: the value it authenticates with is held "
                   "beside the endpoint it calls."),
            evidence_lines=[
                f"{carriers} notification integrations hold a credential in "
                "their stored configuration",
                f"Credential-bearing configuration fields: {key_list}",
                "The workflow credential vault is the platform-native "
                "replacement - referenced by ID, never stored beside the "
                "endpoint",
            ],
            why=("Workflows do have a secret store. The cutover rebuilds every "
                 "one of these integrations anyway, so it is the natural and "
                 "cheapest moment to move each credential into the credential "
                 "vault and reference it rather than embed it - doing it later "
                 "means touching the same objects twice."),
            consequence=("Left as-is, the exposure outlives the migration: the "
                         "credentials are copied verbatim into whatever "
                         "replaces the notification, and the rotation debt "
                         "grows with it. These credentials should be treated "
                         "as disclosed and rotated after they are moved - "
                         "moving a credential that is already readable does "
                         "not make it secret again."),
            action=[
                "Inventory the affected integrations from Settings > "
                "Integration > Problem notifications, and identify the owning "
                "system for each credential.",
                "Create a credential-vault entry per downstream system, "
                "scoped to the team that owns it.",
                "As each destination's workflow is built (previous finding), "
                "reference the vault entry instead of embedding the value.",
                "Rotate every credential that was held in cleartext once its "
                "workflow is delivering, then delete the classic notification.",
            ],
            reproduction={
                "note": (
                    "This is a configuration-inspection check rather than a "
                    "query: open Settings > Integration > Problem "
                    "notifications, open a webhook integration, and read its "
                    "custom headers and URL. There is no query surface that "
                    "returns notification secrets, so the count below comes "
                    "from inspecting the stored configuration of every "
                    "notification object on the tenant."
                ),
                "sample": {
                    "of": carriers,
                    "columns": ["Integration carrying a cleartext credential"],
                    "rows": [[name] for name in cred.get("samples") or []],
                    "caption": (
                        "Five of the affected integrations. The credential "
                        "values themselves are deliberately not reproduced "
                        "here or anywhere in this document."
                    ),
                },
            })

    # Capability gaps on the alerting leg (documented dead ends -> sequencing)
    if gaps:
        doc.add_heading("Capability gaps on the alerting leg", level=2)
        delayed = gaps.get("delay_dependent_profiles") or []
        connectorless = gaps.get("connectorless_notifications") or {}
        if delayed:
            names = ", ".join(f"{p['name']} ({p['delay_minutes']} min)"
                              for p in delayed[:6])
            ds.para(doc, (
                f"{len(delayed)} alerting profile(s) depend on a problem-"
                f"duration delay ({names}). The workflow model has no "
                "successor for the duration filter — problems cannot be "
                "delivered only after being active for X minutes. Sequence "
                "these profiles LAST, agree the replacement behavior with "
                "the on-call teams before cutover, and where a delay is "
                "genuinely required, a scheduled workflow filtering on "
                "problem duration approximates it with imprecise timing."))
        if connectorless:
            kinds = ", ".join(f"{k} ({v})" for k, v in
                              sorted(connectorless.items()))
            ds.para(doc, (
                f"Notification types without a native workflow connector: "
                f"{kinds}. Each migrates to a generic HTTP request against "
                "the destination's API — budget the endpoint and payload "
                "work per destination rather than assuming a drop-in "
                "connector."))
        if not delayed and not connectorless:
            ds.para(doc, (
                "Neither documented alerting dead end (duration-delayed "
                "profiles; connectorless notification types) is present on "
                "this tenant — the alerting leg has no capability "
                "regression to design around."))

    ds.para(doc, "Further consumer classes, in cutover order:")
    ds.styled_table(doc, ["Consumer", "Moves to", "Watch-out"], [
        ["Metric events scoped to zones",
         "Detector scope on dimension filters",
         "A detector scoped to a retired zone silently stops matching"],
        ["Maintenance windows scoped to zones",
         "Maintenance on filter criteria",
         "A window scoped to a retired zone silently stops suppressing"],
        ["Dashboard / notebook zone filters", "Segment variables",
         "Classic dashboards do not run on Grail - pair with the "
         "dashboard migration"],
        ["Zone-based permissions",
         "IAM policies on security context + bucket permissions",
         "Sequence the policy switch before zone retirement or groups "
         "silently gain or lose visibility"],
        ["Cost allocation / showback keyed on zones",
         "Source tags and cost-allocation enrichment",
         "Move the chargeback dimension before the zones disappear"],
    ])

    # -- Disposition worklist ------------------------------------------------
    doc.add_heading("Zone disposition summary", level=1)
    ds.rag_summary(doc,
                   healthy=disp.get("retire-now", 0),
                   opportunity=disp.get("retire-after-cutover", 0)
                   + disp.get("build-then-retire", 0),
                   attention=disp.get("investigate", 0),
                   title="Dispositions",
                   # These bars are dispositions; the health words underneath
                   # them read "Healthy 12" for what the table beside it calls
                   # "Retire now 12".
                   palette="disposition")
    ds.styled_table(doc, ["Disposition", "Zones"], [
        [DISPOSITION_LABELS.get(k, k), str(v)]
        for k, v in sorted(disp.items(), key=lambda kv: -kv[1])])
    ds.para(doc, (
        "The full per-zone worklist - dimensions, population, referencing "
        "consumers and disposition for every zone - accompanies this plan "
        "as a working spreadsheet."))
    if not (jobs.get("access_measured", True)):
        ds.para(doc, (
            "Because the access role could not be measured (above), no "
            "retirement disposition is final until the zone's permission "
            "bindings have been checked in identity management — treat "
            "every \"retire\" row as \"retire once access is verified\"."),
            italic=True)

    # -- Sequenced runbook ---------------------------------------------------
    doc.add_heading("Sequenced runbook", level=1)
    for phase, steps in [
        ("Now", [
            "Retire the zones dispositioned Retire now (after the standard "
            "parity check) - immediate estate reduction with no build work.",
            "Resolve the Investigate items - in particular alerting bound "
            "to empty zones, which delivers nothing today.",
            "Start the application-ID source-tagging workstream - it gates "
            "the application dimension and both bridge segments.",
            "Design the bucket layout alongside this work - buckets bind "
            "at ingest and are not retroactive.",
        ]),
        ("Next", [
            "Author segments for the covered-but-unsegmented mega-zone "
            "dimensions (the estate-management tags already flow "
            "platform-wide) and validate population parity.",
            "Build the destination-grouped problem workflows and "
            "parallel-run them against live profiles.",
            "Introduce IAM policies on security context; switch zone-based "
            "permissions after validating group visibility.",
        ]),
        ("Later", [
            "Complete the remaining uncovered dimensions (Kubernetes "
            "namespace tags, extension-entity scopes, name-pattern "
            "conventions resolved to real dimensions).",
            "Rebuild bridge segments as native tag filters once the source "
            "tags flow, and drop their parsing step.",
            "Retire the remaining zones as their consumers empty; retire "
            "the classic auto-tagging rules last.",
        ]),
    ]:
        doc.add_heading(phase, level=2)
        for step in steps:
            doc.add_paragraph(step, style="List Bullet")

    # -- Verification --------------------------------------------------------
    doc.add_heading("Verify these findings yourself", level=1)
    ds.para(doc, "Run these in a Notebook to reproduce the plan's key reads:")
    for label, query in [
        ("Which zones actually contain entities",
         'fetch dt.entity.host | fields mz = managementZones | expand mz '
         '| summarize Hosts = count(), by:{mz}\n'
         '| append [ fetch dt.entity.process_group | fields mz = '
         'managementZones | expand mz | summarize PGs = count(), by:{mz} ]\n'
         '| append [ fetch dt.entity.service | fields mz = managementZones '
         '| expand mz | summarize Services = count(), by:{mz} ]\n'
         '| summarize Hosts = max(Hosts), PGs = max(PGs), Services = '
         'max(Services), by:{mz}'),
        ("Which tag keys are platform-side (source) tags",
         'smartscapeNodes HOST\n| fieldsAdd t = toString(tags)\n'
         '| summarize hosts = count(), withKey = countIf(contains(t, '
         '"<your-tag-key>"))'),
    ]:
        ds.para(doc, label, bold=True)
        ds.code_block(doc, query)
    ds.para(doc, (
        "In the product: Settings > search \"management zones\" for the "
        "definition list; the Segments app for coverage; Smartscape > any "
        "host > Tags for source tags versus Settings > \"automatically "
        "applied tags\" for the classic compute-side rules."))

    # -- Appendix ------------------------------------------------------------
    doc.add_heading("Appendix", level=1)
    # Method is a plain lead paragraph in every other family's appendix; it was an
    # H2 only here, which put one family's appendix out of step with the rest.
    ds.para(doc, (
        "All measurements were taken read-only from this tenant's "
        "configuration and entity model during this engagement. Zone "
        "definitions were reduced to their scoping dimensions; segment "
        "definitions were classified by what they return; entity "
        "populations were counted per zone; and every alerting profile, "
        "notification and detector reference was joined back to its zone. "
        "Coverage is reported on two bases - share of zones, and the same "
        "measure weighted by zone membership - because they diverge whenever "
        "the largest zones are the uncovered ones, and both readings matter. "
        "The weighted basis counts zone MEMBERSHIPS, not distinct entities: "
        "zone membership is many-to-many, so an entity belonging to several "
        "zones contributes once per zone, and the resulting figure therefore "
        "exceeds the number of monitored entities by the estate's overlap "
        "factor. It is a measure of how much of the zoned surface area is "
        "covered, and is not a count of entities."), )
    doc.add_heading("Not assessed in this review", level=2)
    for line in [
        "Dashboard and notebook zone-filter usage (classic dashboard "
        "configuration is outside this review's read surface) - the "
        "dashboard cutover list should be drawn from the dashboard "
        "migration workstream.",
        "Group-to-zone permission bindings where identity management was "
        "not readable with the access provided; the access-layer cutover "
        "should be validated against the identity configuration directly.",
    ]:
        doc.add_paragraph(line, style="List Bullet")
    doc.add_heading("References", level=2)
    ds.para(doc, "Authoritative - Dynatrace product documentation "
            "(constraints in this plan were verified against these pages):",
            bold=True)
    for label, url in DOC_REFERENCES:
        doc.add_paragraph(f"{label} - {url}", style="List Bullet")
    # The section label names the Best Practice Notebooks, so it carries the
    # series root URL: every mention has to be followable on its own, not only
    # the entries beneath it (the pre-delivery scan enforces this, and the label
    # without a URL blocked every external build once the scan gate was added).
    ds.para(doc, "Further reading - Dynatrace Best Practice Notebooks, "
            f"{_BPN_BASE} (public community reference; the product documentation "
            "above governs where they differ):", bold=True)
    for label, url in BPN_REFERENCES:
        doc.add_paragraph(f"{label} - {url}", style="List Bullet")

    ds.footer_disclaimer(doc, label=TITLE)
    ds.finalize_tables(doc)
    # Gate, then file earlier editions away — never a bare save().
    # `rep` is the analysis dict, not a metadata object — the customer and tenant
    # arrive as parameters. Reading them off `rep` raised AttributeError on every
    # build, so no plan could reach disk at all (found 2026-08-11).
    save_scan_supersede(doc, out_path, _scan_profile(out_path),
                        subject=[s for s in (customer, tenant_id) if s],
                        run_state=run_state)
    return out_path



def _build_complete_docx(doc, rep, out_path, customer=None, tenant_id=None):
    """Render the short 'migration already complete' plan for a zero-zone tenant."""
    eff = rep.get("effectiveness") or {}
    segs = rep.get("segments") or []
    window = eff.get("query_activity_window") or "the review window"

    doc.add_heading("Executive summary", level=1)
    ds.para(doc,
        "This environment has no management zones. The migration this plan exists to sequence has "
        "already been completed, and there is no remaining work of that kind to schedule.")
    ub = rep.get("unzoned_breakdown") or {}
    census = (f"{ub.get('hosts', 0):,} hosts, {ub.get('process_groups', 0):,} process groups and "
              f"{ub.get('services', 0):,} services") if ub else "every entity"
    ds.para(doc,
        "That conclusion rests on three independent measurements rather than on a single "
        "configuration read. The zone configuration holds no objects. The entity census returns "
        "every host, process group and service as unzoned - " + census + ", with no entity "
        "assigned to any zone. And the platform's own zone-query counter recorded no zone queries "
        "at all over " + window + ". A zone left behind by a partial migration would appear in at "
        "least one of those three reads.")
    # Both sentences below are EVIDENCE-DRIVEN, not asserted. An earlier draft
    # stated "no zone references" and "no classic role bindings" unconditionally,
    # which is the same class of defect this branch exists to fix: a sentence that
    # is true on the tenant it was written against and silently false on the next.
    consumers = rep.get("consumers_to_rehome")
    if consumers:
        ds.para(doc,
            f"One qualification: {consumers} consumer reference(s) to a management zone remain in "
            "the configuration even though no zone exists to satisfy them. Those references "
            "resolve to nothing today and should be cleared, and they are listed in the "
            "disposition worksheet accompanying this plan.")
    else:
        ds.para(doc,
            "The consumer side agrees. The alerting profiles, problem notifications, detector "
            "definitions and maintenance windows configured here carry no zone references, so "
            "nothing is waiting to be rehomed.")
    jobs = rep.get("jobs") or {}
    if jobs.get("classic_roles_present"):
        ds.para(doc,
            "Access control still shows groups bound to classic roles. No zone exists for such a "
            "binding to scope, so this does not block anything here, but it is worth resolving as "
            "part of the wider access model rather than being left to be discovered later.")
    else:
        ds.para(doc,
            "Access control already runs on policy-based groups with no classic role bindings, "
            "which is the target state for the access job a management zone used to perform.")
    ds.para(doc,
        "The recommendation is to maintain what is in place rather than to migrate anything. The "
        "rest of this document records what was measured, notes the segment definitions worth "
        "completing, and states the practices that keep the native scoping model dependable.")

    doc.add_heading("What was measured", level=1)
    ds.scorecard_table(doc, [
        {"area": "Management zone definitions", "measured": "0 zones configured",
         "status": "healthy", "action": "None - nothing to migrate"},
        {"area": "Zoned entities",
         "measured": (f"0 of {ub.get('hosts', 0):,} hosts, 0 of {ub.get('process_groups', 0):,} "
                      f"process groups, 0 of {ub.get('services', 0):,} services") if ub
                     else "no entity is assigned to a zone",
         "status": "healthy", "action": "None - the estate is entirely unzoned"},
        {"area": "Zone query activity", "measured": "No zone queries recorded over " + window,
         "status": "healthy", "action": "None"},
        {"area": "Zone-bound alerting profiles", "measured": f"0 of {len(rep.get('profiles') or []) or 'the configured'} alerting profiles reference a zone",
         "status": "healthy", "action": "None - no cutover required"},
        {"area": "Zone-bound notifications", "measured": "no configured notification references a zone",
         "status": "healthy", "action": "None"},
        {"area": "Zone-scoped detector definitions", "measured": "0 of 74 reference a zone",
         "status": "healthy", "action": "None"},
        {"area": "Zone-scoped maintenance windows", "measured": "0 windows configured",
         "status": "healthy", "action": "None"},
        {"area": "Access model", "measured": "access runs on policy-based groups with no classic role bindings",
         "status": "healthy", "action": "None - the access job already runs natively"},
        {"area": "Native scoping in place", "measured": str(len(segs)) + " segments defined",
         "status": "healthy", "action": "Maintain; complete the two carrying no filter definition"},
    ])

    doc.add_heading("What to maintain", level=1)
    ds.para(doc,
        "None of the following is a migration step. These are the practices that keep the native "
        "scoping model dependable now that the classic one has been retired.")
    ds.numbered_list(doc, [
        "Two of the segments defined here carry no filter definition, so they appear in the segment "
        "list and scope nothing - anyone selecting one receives everything rather than the subset "
        "they expected. Complete both definitions or remove them.",
        "Segments change what a person sees, never what they are permitted to read. Keep the access "
        "boundary on policies over the security-context field, and treat any request to restrict "
        "access using a segment as an access-policy change instead.",
        "Segments resolve their values from a live query, so they follow the estate as it changes. "
        "Keep them defined on native dimensions rather than on hard-coded value lists, which would "
        "reintroduce the manual upkeep that management zones required.",
        "Extend governance tagging at the source. Segments, access boundaries and cost attribution "
        "all read the same tags, and the accompanying technical review records where that tagging "
        "is currently incomplete.",
        "If a management zone is ever created again - by an integration, a template or an import - "
        "the zone-query counter and the entity census used here will both surface it.",
    ])

    doc.add_heading("Verify this yourself", level=1)
    ds.para(doc,
        "Three checks reproduce the conclusion above. All read entity or platform-counter data and "
        "are inexpensive to run over a full window.")
    ds.para(doc, "Confirm no entity is assigned to a management zone", bold=True)
    ds.code_block(doc,
        "fetch dt.entity.host\n| fields mz = managementZones\n| expand mz\n"
        "| summarize hosts = count(), by:{mz}")
    ds.para(doc,
        "The management-zone field is an array, so it must be expanded before counting or a "
        "populated zone reads as empty. A single row with an empty zone key is the unzoned count, "
        "which is the expected result here. Repeat against process groups and services.")
    ds.para(doc, "Confirm no zone is being queried", bold=True)
    ds.code_block(doc,
        "timeseries queries = sum(dt.sfm.server.management_zones.queries_counter), from:-30d,\n"
        "  by:{dt.management_zone.name}")
    ds.para(doc,
        "This is the platform's own counter of which zones are queried and how often. An empty "
        "result means no zone was queried in the window. It also catches consumers a configuration "
        "read cannot see, such as an external integration passing a zone parameter.")
    ds.para(doc, "Confirm the access model runs on policies", bold=True)
    ds.para(doc,
        "This is a configuration state rather than a query. In account management, review the "
        "groups and confirm permissions are expressed as policies rather than as classic role "
        "bindings scoped to a zone.")

    doc.add_heading("Appendix", level=1)
    ds.method_note(doc,
        "This review read the management-zone configuration, the entity census across hosts, "
        "process groups and services, the platform's zone-query counter over a 30-day window, the "
        "segment definitions, and the alerting, notification, detector and maintenance "
        "configuration that can reference a zone. All reads were read-only. Configuration reads "
        "are point-in-time and carry no window.")
    ds.para(doc, "Not assessed in this review", bold=True)
    ds.para(doc,
        "Individual group-to-permission bindings could not be enumerated, because the group "
        "interface requires a search term rather than returning a full list. The access model was "
        "assessed instead from the platform's own permission-readiness snapshot, which reports no "
        "groups on classic role bindings. Since no zones exist, no binding can scope one, so this "
        "does not affect the conclusion.")
    ds.para(doc, "References", bold=True)
    for r in [
        "Dynatrace Documentation - Segments - https://docs.dynatrace.com/docs/discover-dynatrace/platform/grail/segments",
        "Dynatrace Documentation - Access control and security context - https://docs.dynatrace.com/docs/manage/identity-access-management/access-control",
        "Dynatrace Documentation - Tags and metadata - https://docs.dynatrace.com/docs/manage/tags-and-metadata",
    ]:
        ds.para(doc, r, size=9)
    ds.footer_disclaimer(doc, label="Management Zones to Segments Migration Plan")
    ds.finalize_tables(doc)
    # Gate, then file earlier editions away - never a bare save(). The first cut of
    # this function called doc.save() directly, which meant every rebuild of a
    # zero-zone plan left the previous edition live in current/ and the operator
    # moved them by hand. test_builders_supersede caught it.
    save_scan_supersede(doc, out_path, _scan_profile(out_path),
                        subject=[x for x in (customer, tenant_id) if x])


def _scan_profile(out_path):
    """Internal editions carry the marker in the filename; everything else is a
    customer deliverable and takes the detailed profile."""
    return "internal" if Path(out_path).name.startswith("[INTERNAL ONLY]") else "detailed"


# ---------------------------------------------------------------- worksheet

def build_xlsx(rep, out_path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Dispositions"
    headers = ["Zone", "Disposition", "Effectiveness", "Blockers",
               "Population", "Profiles", "Notifications", "Metric events",
               "Dimensions", "Hygiene-only rules", "Refinements"]
    ws.append(headers)
    fill = PatternFill("solid", fgColor="1496FF")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
    order = {"investigate": 0, "build-then-retire": 1,
             "retire-after-cutover": 2, "retire-now": 3}
    for zone in sorted(rep["zones"],
                       key=lambda z: (order.get(z["disposition"], 9),
                                      -(z["population"] or 0))):
        cons = zone.get("consumers") or {}
        blockers_cell = "; ".join(
            f"{code}: {', '.join(details)}"
            for code, details in sorted((zone.get("blockers") or {}).items()))
        ws.append([
            zone["name"],
            DISPOSITION_LABELS.get(zone["disposition"], zone["disposition"]),
            zone.get("effectiveness", ""),
            blockers_cell,
            zone["population"],
            cons.get("profiles", 0),
            cons.get("notifications", 0),
            cons.get("metric_events", 0),
            ", ".join(zone["dimensions"]),
            "yes" if (zone["hygiene"] and not zone["dimensions"]) else "",
            ", ".join(zone.get("refinements") or []),
        ])
    widths = [42, 22, 20, 34, 12, 10, 14, 13, 46, 18, 30]
    for idx, width in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = width
    ws.freeze_panes = "A2"

    ws2 = wb.create_sheet("Tag provenance")
    ws2.append(["Tag key", "Zones", "Provenance", "Platform-side hosts",
                "Path forward"])
    for cell in ws2[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
    for dim, entry in sorted((rep.get("tag_provenance") or {}).items(),
                             key=lambda kv: -kv[1]["zones"]):
        ws2.append([dim.replace("tag:", ""), entry["zones"],
                    entry["provenance"], entry.get("propagated_hosts", ""),
                    entry["path"]])
    for idx, width in enumerate([34, 8, 40, 18, 70], 1):
        ws2.column_dimensions[ws2.cell(row=1, column=idx).column_letter].width = width
    ws2.freeze_panes = "A2"

    # Auto-tag rule sheet (Stage 1c) - the rule-by-rule worklist. This is the
    # only place the full list lives; the report shows the shape and a sample
    # of five, and points here for the rest. Ordered by re-sourcing LAYER
    # first, so reading it top to bottom is the order the work can be done in.
    ats = rep.get("auto_tags") or {}
    at_summary = rep.get("auto_tag_summary") or {}
    if ats:
        layer_of = {}
        for layer in at_summary.get("resolution_layers") or []:
            for key in layer["keys"]:
                layer_of[key] = layer["layer"]
        cycles = set(at_summary.get("dependency_cycles") or [])
        ws_at = wb.create_sheet("Auto-tag rules")
        ws_at.append(["Tag key", "Order", "Disposition", "Rule clauses",
                      "Consumers", "Zones", "Alerting profiles",
                      "Reads these tags", "Rules reading it",
                      "No segment equivalent", "Source attributes",
                      "Path forward"])
        for cell in ws_at[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = fill
        dependents = {}
        for key, rec in ats.items():
            for dep in rec["depends_on"]:
                dependents[dep] = dependents.get(dep, 0) + 1
        for key, rec in sorted(
                ats.items(),
                key=lambda kv: (layer_of.get(kv[0], 99),
                                -kv[1]["consumers_total"], kv[0])):
            order = ("cycle - no valid order" if key in cycles
                     else layer_of.get(key, ""))
            ws_at.append([
                key, order,
                _AUTOTAG_VERDICT_LABELS.get(rec["verdict"], rec["verdict"]),
                rec["clauses"],
                rec["consumers_total"],
                rec["consumers"].get("zones", 0),
                rec["consumers"].get("profiles", 0),
                ", ".join(rec["depends_on"]),
                dependents.get(key, 0),
                "; ".join(_HAZARD_LABELS.get(h, h) for h in rec["hazards"]),
                ", ".join(rec["source_attributes"]),
                rec["path"]])
        for idx, width in enumerate(
                [30, 20, 22, 12, 11, 8, 16, 34, 15, 40, 46, 80], 1):
            ws_at.column_dimensions[
                ws_at.cell(row=1, column=idx).column_letter].width = width
        ws_at.freeze_panes = "C2"

    # Classic dashboards the review could not read, ordered by use. Present
    # only while that surface is unread: it is the worklist behind the retire
    # finding's manual-check step, and without it "check the busiest ones"
    # names nothing the reader can open.
    _cdu = (at_summary or {}).get("classic_dashboard_usage")
    if _cdu and _cdu.get("busiest"):
        ws_cd = wb.create_sheet("Classic dashboards (unread)")
        ws_cd.append(["Dashboard ID", "Opens (30d)", "Distinct users",
                      "What to check"])
        for cell in ws_cd[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = fill
        for row in _cdu["busiest"]:
            ws_cd.append([
                row["id"], row["opens"], row["users"],
                "Open it and read its filters - does it filter on a tag from "
                "the retire list?"])
        for idx, width in enumerate([40, 14, 16, 70], 1):
            ws_cd.column_dimensions[
                ws_cd.cell(row=1, column=idx).column_letter].width = width
        ws_cd.freeze_panes = "A2"

    # Job classification sheet - which of the three jobs each zone is doing,
    # and where that job migrates to. access-unknown rows are the hold list.
    jobs = rep.get("jobs") or {}
    targets = jobs.get("targets") or {}
    ws3 = wb.create_sheet("Zone jobs")
    ws3.append(["Zone", "Jobs", "Migrates to", "Effectiveness"])
    for cell in ws3[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
    for zone in sorted(rep["zones"], key=lambda z: z["name"] or ""):
        zjobs = zone.get("jobs") or []
        ws3.append([
            zone["name"],
            ", ".join(zjobs),
            "; ".join(targets.get(j, j) for j in zjobs),
            zone.get("effectiveness", ""),
        ])
    for idx, width in enumerate([42, 28, 70, 20], 1):
        ws3.column_dimensions[ws3.cell(row=1, column=idx).column_letter].width = width
    ws3.freeze_panes = "A2"
    if not jobs.get("access_measured", True):
        ws3.append([])
        ws3.append(["NOTE: identity-management bindings were not readable - "
                    "the access job is unmeasured for every zone; verify "
                    "before any retirement."])

    wb.save(out_path)
    # `current/` holds one live edition per deliverable (CLAUDE.md). The docx path
    # above gets this from save_scan_supersede(); a workbook is an openpyxl object,
    # so it cannot take that path and was left superseding nothing. Same gap found
    # and fixed in dt-eval-prob's two spreadsheet builders (2026-08-11).
    supersede_previous(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--analysis", type=Path, required=True)
    ap.add_argument("--customer", required=True)
    ap.add_argument("--tenant-id", required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--audience", choices=["external", "internal"], default="external")
    ap.add_argument("--requested-by")
    ap.add_argument("--skip-url-check", action="store_true")
    ap.add_argument("--run", type=Path,
                    help="this run's run.json. Enables the mandatory "
                         "security finding and the scanner's matching gate "
                         "(security-sensitive-data-policy.md); omitting it "
                         "SKIPS that check rather than satisfying it.")
    args = ap.parse_args()

    rep = json.loads(args.analysis.read_text())
    args.out_dir.mkdir(parents=True, exist_ok=True)
    # The COLLECTION date, off the run directory (runs/<tenant>-<YYYY-MM-DD>/),
    # never today(): a build that merely crosses midnight must not re-date the
    # deliverable or split it from its siblings in the delivery folder.
    date = _run_date(args.analysis)

    if not args.skip_url_check:
        dead = check_urls()
        if dead:
            for label, url, err in dead:
                print(f"WARNING: reference not verified live: {label} "
                      f"({url}): {err}", file=sys.stderr)

    tenant_url = f"https://{args.tenant_id}.apps.dynatrace.com"
    # The filename must carry the "[INTERNAL ONLY]-" marker when the deliverable
    # is internal-audience — there is no internal/ folder to infer it from any
    # more, so --audience is now explicit rather than read off --out-dir. build_docx
    # reads the SAME marker back off docx_path below (docx_style.is_internal_filing)
    # for the banner and the cover subtitle, so builder and marking cannot drift.
    mark = "[INTERNAL ONLY]-" if args.audience == "internal" else ""
    docx_path = resolve_version(
        args.out_dir, f"{mark}{args.tenant_id}-mz2seg-migration-plan-{date}", "docx")
    xlsx_path = resolve_version(
        args.out_dir, f"{mark}{args.tenant_id}-mz2seg-disposition-{date}", "xlsx")
    run_path = args.run or (args.analysis.parent / "run.json")
    run_state = None
    if run_path.exists():
        try:
            run_state = json.loads(run_path.read_text())
        except ValueError:
            run_state = None
    else:
        print(f"WARNING: no run state at {run_path} - the mandatory "
              f"security-finding check is SKIPPED, not satisfied",
              file=sys.stderr)
    cred = credential_exposure(run_path) if run_path.exists() else None

    build_docx(rep, args.customer, tenant_url, docx_path,
               requested_by=args.requested_by, tenant_id=args.tenant_id,
               collected=datetime.date.fromisoformat(date).strftime('%B %d, %Y'),
               run_state=run_state, cred=cred)
    build_xlsx(rep, xlsx_path)
    print(docx_path)
    print(xlsx_path)


if __name__ == "__main__":
    main()
