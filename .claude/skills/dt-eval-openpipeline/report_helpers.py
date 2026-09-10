"""report_helpers.py — document-building helpers for the OpenPipeline report.

Import alongside the shared ../.dt-eval-common/docx_style.py in a build script
(paths relative to this skill directory as the working directory):

    import sys
    sys.path.insert(0, "../.dt-eval-common")
    import docx_style as ds
    from report_helpers import lead, bullets, lead_bullets, numbered, scale_stat_line

House-format rules these enforce (output-spec.md):
  * findings lead with a summary table (`ds.scorecard_table`) then per-item detail;
  * multi-fact content is BULLETS (`lead_bullets`), not prose paragraphs;
  * short single-thought conclusions (Recommendation) stay a labelled line (`lead`).

Always call `ds.finalize_tables(doc)` once before `doc.save()`.

The first four mirror `/dt-eval-prob`'s helpers deliberately — same house format, so
the two reports read as one family. The rest are this skill's own.
"""


def lead(doc, label, text):
    """A bold inline label followed by a short prose sentence (one-line conclusions)."""
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


def numbered(doc, items):
    """Numbered bold-lead list: items = [(heading, text), ...] → '1. Heading  text'."""
    for i, (h, t) in enumerate(items, 1):
        p = doc.add_paragraph()
        p.add_run(f"{i}. {h}  ").bold = True
        p.add_run(t)


def scale_stat_line(n_authored, routing_entries, scopes_covered, scopes_total=8):
    """The cover's scale line (output-spec.md §1).

    A grade with no scale behind it invites the reader to over-read a small number —
    "C" means something different across 30 pipelines than across 3. This is why the
    cover carries the estate size next to the score, not only in the body.

    A `None` count means NOT ESTABLISHED and must never render as `0`. On the
    adoption_not_assessable gate the pipeline inventory is precisely the thing that
    could not be read, and a cover reading "0 customer-authored pipelines" beside a
    notice explaining the count is unavailable asserts the false zero the gate exists
    to prevent — and contradicts its own body two paragraphs later (live 2026-08-26,
    on a tenant whose single pipeline had moved 3.9 billion records that week).
    """
    def count(value, noun):
        if value is None:
            return f"{noun}: not established"
        return f"{value} {noun}"

    scopes = ("signal-type scopes: not established" if scopes_covered is None
              else f"{scopes_covered} of {scopes_total} signal-type scopes configured")
    return (f"{count(n_authored, 'customer-authored pipelines')} · "
            f"{count(routing_entries, 'routing entries')} · {scopes}")


# Diagnoses (diagnose_pipelines.py) that resolve `adoption_not_assessable` to a
# TOOLING limitation rather than an access one. dtctl reads the settings-object
# API; the OpenPipeline app reads /platform/openpipeline/v1/configurations/<scope>,
# for which dtctl implements no verb. The 403 those probes return therefore says
# "this surface does not expose these objects to this tool", NOT "your identity
# lacks access" -- the same user opens the same pipelines in the browser.
TOOLING_GAP_DIAGNOSES = frozenset({
    "dtctl_cannot_read_this_surface",
    "dtctl_cannot_read_this_surface_partial",
    "scope_or_pagination",
    "partial_overlap_unexplained",
    "pipeline_read_errored",
})

# The one not-assessable diagnosis that IS an access statement: the routing
# tables themselves would not read. Nothing downstream can be attempted, and
# unlike the pipeline objects there is no second surface to export from.
ACCESS_GAP_DIAGNOSES = frozenset({"routing_unreadable"})


def gated_notice(n_authored, adoption_floor, reason=None, diagnosis=None):
    """The cover notice for a gated run (output-spec.md §1).

    A gated tenant is "not applicable yet", never "scored 0" — reporting a zero would
    rank a tenant that has not started below every tenant that has. The wording stays
    in the customer's terms and states the finding rather than the machinery.

    `reason` is scoring.NoCompositeError's machine key and it changes the sentence,
    because the two gates mean opposite things to a customer:

      below_adoption_floor    the tenant genuinely has not built enough — the
                              default wording below.
      adoption_not_assessable the pipelines exist and could not be READ. Reusing
                              the below-floor wording here reports a permissions
                              gap as a configuration gap, which is the failure
                              SKILL.md's second honesty rule exists to prevent
                              ("a permissions gap is never a configuration
                              defect"). Live 2026-08-25: two tenants carrying
                              16.3B and 82.5B records through working pipelines
                              would each have been told they had built nothing.

    `diagnosis` splits `adoption_not_assessable` further, and the split matters
    as much as the first one did. **Not-assessable has two causes that call for
    opposite actions from the customer**, and until 2026-08-26 one sentence
    served both:

      a TOOLING gap   the definitions live on a surface this review's
                      command-line tooling cannot reach. Access is not the
                      problem and a permission grant changes nothing — the same
                      person opens the same pipelines in the browser. The fix is
                      an export. Telling this customer "the access available for
                      this review" sends them to raise a grant request that
                      cannot help, which is exactly what happened on a live
                      engagement (v1.37.0's correction) and what
                      diagnose_pipelines.py's `remedy` field already refuses to
                      say. The cover was still saying it.

      an ACCESS gap   the routing tables themselves would not read. Here the
                      access wording is true and stays.

    `diagnosis` defaults to None, and the unknown case gets wording that asserts
    NEITHER — because the observed cause is overwhelmingly the tooling gap, and a
    notice that guesses "access" is the failure this branch exists to stop.

    `reason` defaults to None so existing callers keep the below-floor wording,
    and a `diagnosis` passed alongside the below-floor reason is ignored: a
    genuinely unbuilt tenant has nothing unreadable to explain.
    """
    if reason == "adoption_not_assessable":
        if diagnosis in TOOLING_GAP_DIAGNOSES:
            # The v1.37.0 correction, on the cover. This must not read as an
            # access limitation: the remedy is an export, not a grant.
            return ("The pipeline configuration in this environment is held on a surface "
                    "this review's tooling cannot retrieve, so no health verdict is given. "
                    "This is not a limitation of anyone's access and no permission change "
                    "is needed — the same pipelines open normally in the OpenPipeline app. "
                    "Exporting the pipeline and routing definitions from that app completes "
                    "the review; the findings below describe what was measured without them.")
        if diagnosis in ACCESS_GAP_DIAGNOSES:
            # The genuine case, and the only one where naming access is honest.
            return ("The routing configuration in this environment could not be read with the "
                    "access available for this review, so no health verdict is given. The "
                    "findings below describe what was readable and the access needed to "
                    "complete the review.")
        # Cause not established. Say what is true — the configuration was not
        # retrieved — and claim nothing about why.
        return ("The pipeline configuration in this environment could not be retrieved by this "
                "review, so no health verdict is given. The findings below describe what was "
                "measured and what is needed to complete the review.")
    return ("This tenant has not yet built enough OpenPipeline configuration for a "
            "health verdict. The findings below describe the current state and the "
            "path to adoption.")


def ownership_note(n_authored, extension_pipelines):
    """The sentence that must precede every count in the body.

    Every number in this report rests on the customer-authored subset. A reader who
    meets "2 of 30 pipelines are unrouted" without knowing what 30 excludes cannot
    evaluate it — and platform defaults read as customer debt if the split is missing.
    """
    if not extension_pipelines:
        return (f"All {n_authored} pipelines in scope were authored by your team; no "
                f"platform-default pipelines were found to exclude.")
    return (f"{n_authored} pipelines were authored by your team and are assessed below. "
            f"A further {extension_pipelines} ship with Dynatrace extensions and are "
            f"managed by the platform — they are excluded from every count in this "
            f"report and are not a consolidation target.")


def disposition_table(doc, rows, ds):
    """The worklist table (output-spec.md §2), grouped by scope.

    rows = [(scope, item, disposition, detail), ...]. A family never spans two
    data-type scopes, so a table that mixes them invites a merge that cannot work.
    """
    ds.styled_table(doc, ["Scope", "Item", "Disposition", "Detail"], rows,
                    widths=[2.0, 4.0, 3.0, 7.2], size=9)


def bucket_table(doc, rows, ds):
    """Where records actually land: rows = [(bucket, records, share), ...].

    Kept separate from the disposition table because it is evidence, not action —
    it belongs under the finding it supports, where the reader meets the number.
    """
    ds.styled_table(doc, ["Bucket", "Records (24h)", "Share"], rows,
                    widths=[7.0, 4.6, 3.0], size=9)
