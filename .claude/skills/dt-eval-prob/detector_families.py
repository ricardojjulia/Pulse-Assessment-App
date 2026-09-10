#!/usr/bin/env python3
"""detector_families.py — the executable authority for custom-detector consolidation.

probes.md §3 items 3, 4b and 4f specify four ways custom detectors duplicate each
other. Until this file existed they were prose only, executed as ad-hoc jq/python
per engagement — so two runs against the same tenant could group differently
depending on how the normalization got written that day. The composite has had
`noise_scoring.py` as its single authority since v1.17; the family groupings had
nothing. This is that.

Four groupings, in increasing order of what they find:

  exact_objects   (title, query, threshold, condition)   — literal clones, same name
  exact_rules     (query, threshold, condition)          — §3 item 3, TITLE-BLIND
  drift_families  (query) where thresholds differ        — §3 item 4b
  policy_clusters (the policy envelope, QUERY-BLIND)     — §3 item 4f

**The title-blind step is not cosmetic.** On a reference estate of 4,500
detectors, including the title found 50 families / 100 objects; dropping it found
249 / 647. The sprawl pattern is per-cluster and per-workload clones, which have
different names by construction — keying on the name hides exactly the thing you
are looking for.

**policy_clusters is the one that reframes the estate, and it is the only
grouping that ignores the query.** The other three ask "which detectors watch the
same thing the same way." This one asks "how many distinct alerting POLICIES
exist, regardless of what each watches" — condition, threshold, sample counts,
window, missing-data handling, merge behavior, severity, target. On that same
estate: 4,098 of 4,500 detectors (91.1%) collapse into 95 policies, the largest
carrying 874. That is not 4,500 alerting decisions; it is 95 decisions
copy-pasted as a migration ran metric-by-metric.

**Policy is mergeable; routing is usually not — and this tool refuses to
conflate them.** Detectors in one policy cluster routinely carry hundreds of
distinct notification destinations by design (per-team ServiceNow assignment
groups, per-owner recipient lists). Collapsing a cluster into one settings object
would silently repoint every one of them. So each cluster reports its routing
divergence and a `policy_only` verdict: templatize the policy fields, leave
routing attached per detector. A cluster is only flagged `fully_mergeable` when
its routing fields are genuinely uniform, or are driven by `{placeholder}`
substitution that survives a merge.

**Redaction interacts with this and the interaction is dangerous.** `redact.py`
replaces every `opc_email_recipients` value with one constant marker, so on a
redacted file — which is what SKILL.md's protocol writes to disk — a distinct-
recipient count collapses to 1 and reads as "routing is uniform, safe to merge":
the exact inversion of the truth. This module detects the marker and reports
`None` with a stated reason rather than a wrong number. See REDACTION_NOTE.

Stdlib-only. Run with any python3:

    python3 detector_families.py runs/<id>/C-davis-detectors.json --json families.json
    python3 detector_families.py --self-test
"""

import argparse
import json
import re
import sys
from collections import defaultdict

# Fields whose value decides WHERE a notification goes. Divergence here blocks a
# merge; divergence in anything else does not.
DESTINATION_FIELDS = ("opc_email_recipients", "dt_routing_grp")
# Fields that ride along as ticket metadata. Divergence here is worth reporting
# but does not by itself block a merge.
METADATA_FIELDS = ("dt_asset_tag", "dt_source_application")
ROUTING_FIELDS = DESTINATION_FIELDS + METADATA_FIELDS

# `{placeholder}` resolves a property from a query-result field at event time, so
# a field using it survives a merge — one settings object still produces
# per-record destinations. A literal string does not.
_PLACEHOLDER = re.compile(r"\{[^}]+\}")

# A FLAT marker collapses every value to one string, so distinct counts taken on it
# are meaningless. An ALIASED marker (***REDACTED_EMAIL_<8hex>***, redact.email_alias)
# preserves distinctness by design — those files are fully analyzable.
_REDACTION_ALIAS = re.compile(r"\*\*\*REDACTED_[A-Z_]+_[0-9a-f]{8}\*\*\*")
_REDACTION_MARKER = re.compile(r"\*\*\*REDACTED_[A-Z_]+\*\*\*")


def _is_flat_redaction(value):
    """True only for the OLD flat marker — an alias is not a blocker."""
    return bool(_REDACTION_MARKER.search(value)) and not _REDACTION_ALIAS.search(value)

REDACTION_NOTE = (
    "FLAT-redacted input: distinct-value counts for this field are not computable. "
    "The old flat marker collapses every value to one string, so a count here would "
    "read as 'routing is uniform' when the opposite may be true. Re-collect with a "
    "current redact.py — it now writes per-value aliases "
    "(***REDACTED_EMAIL_<8hex>***) that preserve distinctness without exposing an "
    "address, so aliased files are fully analyzable. Until then treat routing "
    "divergence as UNKNOWN and do not merge on this evidence."
)

DEFAULT_MIN_CLUSTER = 5


def _norm(s):
    """Whitespace-normalize a query expression (§3 item 4b's grouping key)."""
    return re.sub(r"\s+", " ", s or "").strip()


def _inputs(value):
    return {p["key"]: p["value"] for p in value.get("analyzer", {}).get("input", [])}


# The analyzer input list carries the detector's query under EITHER key, and which
# one appears varies by detector, not by tenant — both shapes coexist in a single
# fleet. Reading only `query.expression` (as this module did until 2026-08-11) sends
# every `query`-keyed detector to the empty string, where they group together into
# one enormous bogus family: live on a 899-detector tenant, 853 detectors collapsed
# into a single reported "clone family with threshold drift" while the real answer
# was 31 families over 67 objects. Groupings 3 and 4b are both wrong when this
# happens; 4f (policy clusters) is query-blind and unaffected.
QUERY_KEYS = ("query", "query.expression")


def _query(inputs):
    """The detector's query text, from whichever input key carries it."""
    for k in QUERY_KEYS:
        v = inputs.get(k)
        if v:
            return v
    return ""


def _props(value):
    return {p["key"]: p["value"]
            for p in value.get("eventTemplate", {}).get("properties", [])}


def load(path):
    """Read a detector dump. Tolerates `{"result": [...]}` or a bare list, and
    elements that are either `{objectId, value}` or a bare settings value."""
    with open(path) as f:
        raw = json.load(f)
    items = raw.get("result", raw) if isinstance(raw, dict) else raw
    out = []
    for i, x in enumerate(items or []):
        value = x.get("value", x) if isinstance(x, dict) else None
        if value is None:
            continue
        out.append({"objectId": x.get("objectId", f"#{i}") if isinstance(x, dict) else f"#{i}",
                    "value": value})
    return out


def policy_key(value):
    """The policy envelope — everything that decides HOW an alert behaves, and
    nothing about WHAT it watches. Deliberately query-blind."""
    i, p = _inputs(value), _props(value)
    return (
        i.get("alertCondition"), i.get("threshold"),
        i.get("violatingSamples"), i.get("dealertingSamples"),
        i.get("slidingWindow"), i.get("alertOnMissingData"),
        p.get("dt.davis.is_merging_allowed"), p.get("dt_severity"),
        p.get("dt_alert_target"),
    )


def _routing_divergence(members):
    """Per-field distinct-value and placeholder counts across a cluster.

    Returns {field: {distinct, placeholder_using, redacted}} where `distinct` is
    None when the field was redacted — never a misleading 1.
    """
    out = {}
    for field in ROUTING_FIELDS:
        values = [_props(m["value"]).get(field) for m in members]
        present = [v for v in values if v]
        redacted = any(_is_flat_redaction(v) for v in present)
        out[field] = {
            "distinct": None if redacted else len(set(present)),
            "populated": len(present),
            "placeholder_using": sum(1 for v in present if _PLACEHOLDER.search(v)),
            "redacted": redacted,
        }
    return out


def _merge_verdict(divergence):
    """Can this cluster collapse into ONE settings object without repointing a
    notification?

    Only when every DESTINATION field is either uniform or fully placeholder-
    driven. Metadata divergence does not block. Redaction forces `unknown` —
    refusing is the whole point of the redaction guard.
    """
    for field in DESTINATION_FIELDS:
        d = divergence[field]
        if d["redacted"]:
            return "unknown", f"{field} is redacted — divergence not computable"
        if d["distinct"] is None or d["distinct"] <= 1:
            continue
        if d["placeholder_using"] == d["populated"]:
            continue  # every value is dynamic; a merge preserves per-record routing
        return "policy_only", (
            f"{field} carries {d['distinct']} distinct static values — merging "
            f"would repoint notifications. Templatize the policy fields only.")
    return "fully_mergeable", "destination fields are uniform or placeholder-driven"


# Destination tokens that name a NON-PRODUCTION target. Matched against the
# `dt_alert_target` value, not guessed from the detector title.
#
# This is a census with a flag, deliberately NOT a verdict. Whether a
# non-production destination is wrong depends entirely on which environment the
# detector lives in — the same value that is a finding on a production tenant is
# the correct setting on a lower one, and this module cannot tell which it is
# looking at. So it reports the split, marks the non-production share, and
# leaves the judgment to the analyst, exactly as _merge_verdict refuses a
# verdict on a redacted destination rather than guessing.
#
# Live 2026-08-10, a production tenant: 2,202 of 4,500 detectors (48.9%)
# resolved to a UAT destination and 6 to the production one. Nothing else in
# the battery could see it — D4 reads the notification-integration layer, which
# this routing bypasses entirely, and the per-detector delivery flags only ask
# whether a destination EXISTS, never which one it is.
NONPROD_TARGET_TOKENS = ("uat", "dev", "test", "stage", "staging", "qa", "sandbox", "nonprod")


def _alert_target_split(detectors):
    """Census of `dt_alert_target` values, with the non-production share flagged."""
    split = defaultdict(int)
    for d in detectors:
        split[_props(d["value"]).get("dt_alert_target") or "(none)"] += 1
    nonprod = {t: n for t, n in split.items()
               if any(tok in t.lower() for tok in NONPROD_TARGET_TOKENS)}
    total = len(detectors)
    return {
        "by_target": dict(sorted(split.items(), key=lambda kv: -kv[1])),
        "distinct_targets": len(split),
        "nonprod_targeted": sum(nonprod.values()),
        "nonprod_targeted_share": (round(100.0 * sum(nonprod.values()) / total, 1)
                                   if total else None),
        "nonprod_targets": dict(sorted(nonprod.items(), key=lambda kv: -kv[1])),
        "note": ("Whether a non-production destination is correct depends on the environment "
                 "these detectors live in — confirm with the integration owner rather than "
                 "reading the share as a defect."),
    }


def _missing_data(detectors):
    """`alertOnMissingData` census — who stays silent when their source dies.

    A detector with missing-data alerting off does not fire when its input stops
    arriving; it simply has nothing to evaluate. That is right for a performance
    threshold and backwards for a security or audit condition, where absence of
    data IS the signal. An unset value behaves as disabled, so the two are
    counted together as `not_alerting` and reported separately underneath —
    conflating them would hide that nobody made a decision at all.
    """
    enabled = disabled = unset = 0
    for d in detectors:
        v = _inputs(d["value"]).get("alertOnMissingData")
        if v is None or v == "":
            unset += 1
        elif str(v).lower() == "true":
            enabled += 1
        else:
            disabled += 1
    total = len(detectors)
    return {
        "alerting_on_missing_data": enabled,
        "not_alerting": disabled + unset,
        "explicitly_disabled": disabled,
        "unset": unset,
        "not_alerting_share": round(100.0 * (disabled + unset) / total, 1) if total else None,
    }


def capacity(objects, max_objects):
    """Fleet size against the schema's own declared per-environment maximum.

    `max_objects` comes from `dtctl describe settings-schema
    builtin:davis.anomaly-detectors` on the tenant being reviewed — never from a
    remembered documentation figure. The two disagree: a live read on two
    tenants (2026-08-10) returned 4,500 where a general doc figure of 1,000 had
    been assumed, which turns "4.5x over an unenforced cap" into "at 100% of the
    ceiling" — a different finding with a different remediation. Grading follows
    the tenant-review limit-proximity bands (>=90% attention, >=75% opportunity).
    """
    if not max_objects:
        return {"objects": objects, "max_objects": None, "pct": None, "status": "unknown",
                "note": "the schema's declared maximum was not read on this tenant"}
    pct = round(100.0 * objects / max_objects, 1)
    status = "attention" if pct >= 90 else "opportunity" if pct >= 75 else "healthy"
    return {"objects": objects, "max_objects": max_objects, "pct": pct, "status": status,
            "headroom": max_objects - objects}


def analyze(detectors, min_cluster=DEFAULT_MIN_CLUSTER):
    """All four groupings plus the per-detector routing/provenance flags."""
    exact_objects, exact_rules, by_query, policies = (defaultdict(list) for _ in range(4))

    for d in detectors:
        v = d["value"]
        i = _inputs(v)
        title = v.get("title") or v.get("description")
        q, thr, cond = _norm(_query(i)), i.get("threshold"), i.get("alertCondition")
        exact_objects[(title, q, thr, cond)].append(d)
        exact_rules[(q, thr, cond)].append(d)
        by_query[q].append(d)
        policies[policy_key(v)].append(d)

    # An empty query is not a grouping key — it means the query could not be read,
    # and every unreadable detector lands in the same bucket looking like a family.
    # That is exactly how the `query`-key defect produced a confident wrong answer,
    # so the query-keyed groupings must declare how much of the fleet they could
    # actually see rather than reporting silently.
    unreadable = len(by_query.get("", []))
    coverage = {
        "detectors": len(detectors),
        "query_unreadable": unreadable,
        "query_readable_pct": round(100.0 * (len(detectors) - unreadable) / len(detectors), 1)
        if detectors else 0.0,
        "keys_seen": sorted({k for d in detectors for k in _inputs(d["value"]) if k in QUERY_KEYS}),
    }
    # Drop the unreadable bucket from every query-keyed grouping — an unread query
    # is missing evidence, never a match. `q` is the 2nd element of the exact_objects
    # key and the 1st of exact_rules.
    by_query.pop("", None)
    for k in [k for k in exact_objects if not k[1]]:
        exact_objects.pop(k)
    for k in [k for k in exact_rules if not k[0]]:
        exact_rules.pop(k)

    def families(groups, predicate=lambda m: len(m) > 1):
        fam = {k: m for k, m in groups.items() if predicate(m)}
        return {"families": len(fam), "objects": sum(len(m) for m in fam.values()), "_groups": fam}

    drift = {k: m for k, m in by_query.items()
             if len(m) > 1 and len({_inputs(x["value"]).get("threshold") for x in m}) > 1}

    clusters = []
    for key, members in sorted(policies.items(), key=lambda kv: -len(kv[1])):
        if len(members) < min_cluster:
            continue
        div = _routing_divergence(members)
        verdict, why = _merge_verdict(div)
        cond, thr, vs, ds, win, amd, merge, sev, target = key
        clusters.append({
            "size": len(members),
            "policy": {"alertCondition": cond, "threshold": thr, "violatingSamples": vs,
                       "dealertingSamples": ds, "slidingWindow": win,
                       "alertOnMissingData": amd, "merging_allowed": merge,
                       "severity": sev, "alert_target": target},
            "label": (f"{cond} {thr}, {vs}/{ds} samples, {win}min, "
                      f"missing-data-alert={amd}, merge={merge}, sev {sev}, -> {target}"),
            "routing_divergence": div,
            "merge_verdict": verdict,
            "merge_note": why,
        })

    clustered = sum(c["size"] for c in clusters)
    small = {k: m for k, m in policies.items() if len(m) < min_cluster}

    flags = defaultdict(list)
    provenance = defaultdict(int)
    for d in detectors:
        p = _props(d["value"])
        target = p.get("dt_alert_target") or ""
        title = d["value"].get("title") or d["value"].get("description")
        if not target:
            flags["no_alert_target"].append(title)
        if not p.get("dt_severity"):
            flags["no_severity"].append(title)
        if target.startswith("snow_") and not any(p.get(f) for f in
                                                  ("dt_routing_grp", "dt_asset_tag",
                                                   "dt_source_application")):
            flags["snow_no_routing_metadata"].append(title)
        provenance[p.get("opc_migration_source") or "native"] += 1

    snow_bound = sum(1 for d in detectors
                     if (_props(d["value"]).get("dt_alert_target") or "").startswith("snow_"))

    # Is the property-driven routing convention in use here AT ALL?
    #
    # `dt_alert_target`/`dt_severity` are an event-template convention a migrated
    # rule library brings with it — they are NOT how Dynatrace routes by default.
    # A tenant using the native path (alerting profiles bound to notification
    # integrations) carries neither property, and every delivery flag below then
    # fires on every detector: "700 of 700 fire but notify no one", on an estate
    # whose alerting works correctly through profiles.
    #
    # Live 2026-08-10, two tenants: 700 of 700 and 114 of 114 carried no
    # `dt_alert_target`, while both had alerting profiles and notification
    # integrations configured and delivering. Reporting that as a delivery defect
    # would have been the most consequential wrong finding in the review — the
    # inverse of the truth, on the customer's most sensitive subject.
    #
    # So the flags are reported ONLY where the convention is actually in use, and
    # `convention_in_use: false` says why they are absent. Same discipline as
    # _merge_verdict refusing a verdict on a redacted field: no evidence is
    # reported as no evidence, never as a finding.
    with_target = sum(1 for d in detectors if _props(d["value"]).get("dt_alert_target"))
    convention = bool(with_target)

    return {
        "total": len(detectors),
        "alert_target_split": _alert_target_split(detectors),
        "missing_data": _missing_data(detectors),
        "exact_objects": {k: v for k, v in families(exact_objects).items() if k != "_groups"},
        "query_coverage": coverage,
        "exact_rules": {k: v for k, v in families(exact_rules).items() if k != "_groups"},
        "drift_families": {"families": len(drift),
                           "objects": sum(len(m) for m in drift.values())},
        "policy_clusters": {
            "min_cluster": min_cluster,
            "clusters": len(clusters),
            "detectors_in_clusters": clustered,
            "share_in_clusters": round(100.0 * clustered / len(detectors), 1) if detectors else 0.0,
            "small_clusters": len(small),
            "detectors_in_small_clusters": sum(len(m) for m in small.values()),
            "detail": clusters,
        },
        "delivery_flags": {
            "convention_in_use": convention,
            "detectors_carrying_alert_target": with_target,
            "no_alert_target": len(flags["no_alert_target"]) if convention else None,
            "no_severity": len(flags["no_severity"]) if convention else None,
            "snow_bound": snow_bound,
            "snow_no_routing_metadata": len(flags["snow_no_routing_metadata"]) if convention else None,
            "snow_no_routing_metadata_share": (
                round(100.0 * len(flags["snow_no_routing_metadata"]) / snow_bound, 1)
                if snow_bound else None),
            "_samples": ({k: v[:5] for k, v in flags.items()} if convention else {}),
            "note": (None if convention else
                     "No detector carries the dt_alert_target property, so this tenant does not "
                     "use property-driven routing — delivery runs through alerting profiles and "
                     "notification integrations instead. The per-detector delivery flags do not "
                     "apply and are reported as not applicable rather than as defects."),
        },
        "provenance": dict(provenance),
        "redaction_note": REDACTION_NOTE if any(
            c["merge_verdict"] == "unknown" for c in clusters) else None,
    }


def _summary(r):
    lines = [f"detectors: {r['total']}", ""]
    lines.append("Consolidation groupings (probes.md §3):")
    for label, key in (("3   exact rules (title-blind)", "exact_rules"),
                       ("    exact objects (title-inclusive)", "exact_objects"),
                       ("4b  clone families w/ threshold drift", "drift_families")):
        g = r[key]
        lines.append(f"  {label:<38} {g['families']:>4} families, {g['objects']:>5} objects")
    qc = r["query_coverage"]
    if qc["query_unreadable"]:
        lines += [
            f"      NOTE: groupings 3 and 4b saw {qc['query_readable_pct']}% of the fleet — "
            f"{qc['query_unreadable']} detector(s) had no readable query and are excluded",
            f"            (query input keys present: {', '.join(qc['keys_seen']) or 'none'})",
        ]
    pc = r["policy_clusters"]
    lines += [
        f"  {'4f  policy clusters (query-blind)':<38} {pc['clusters']:>4} clusters, "
        f"{pc['detectors_in_clusters']:>5} detectors ({pc['share_in_clusters']}%)",
        f"      + {pc['small_clusters']} clusters under {pc['min_cluster']} "
        f"covering {pc['detectors_in_small_clusters']}",
        "",
        "Largest policy clusters:",
    ]
    for c in pc["detail"][:6]:
        lines.append(f"  {c['size']:>5}  {c['merge_verdict']:<16} {c['label']}")
    ats = r["alert_target_split"]
    lines += ["", "Alert-target split (where each detector sends its alert):"]
    for target, n in list(ats["by_target"].items())[:8]:
        share = round(100.0 * n / r["total"], 1) if r["total"] else 0.0
        lines.append(f"  {target:<34} {n:>6}  ({share}%)")
    if ats["nonprod_targeted"]:
        lines.append(f"  -> non-production destinations     {ats['nonprod_targeted']:>6}"
                     f"  ({ats['nonprod_targeted_share']}%) - confirm this is intended")

    md = r["missing_data"]
    lines += ["", "Missing-data alerting:",
              f"  alerts when the source stops       {md['alerting_on_missing_data']}",
              f"  stays silent                       {md['not_alerting']}"
              f" ({md['not_alerting_share']}%)"
              f"  [{md['explicitly_disabled']} disabled, {md['unset']} unset]"]

    if r.get("capacity"):
        cap = r["capacity"]
        lines += ["", "Capacity against the declared maximum:"]
        lines.append(f"  {cap['objects']} of {cap['max_objects']} "
                     f"({cap['pct']}%) - {cap['status']}"
                     if cap["max_objects"] else f"  {cap['note']}")

    df = r["delivery_flags"]
    if not df.get("convention_in_use", True):
        lines += ["", "Delivery-chain flags: not applicable",
                  "  " + df["note"]]
    else:
        lines += ["", "Delivery-chain flags:",
              f"  fires with no destination set yet  {df['no_alert_target']}",
              f"  no severity set                    {df['no_severity']}",
              f"  ServiceNow-bound                   {df['snow_bound']}",
              f"  ...of which no routing metadata    {df['snow_no_routing_metadata']}"
              f" ({df['snow_no_routing_metadata_share']}%)"]
    lines += ["", "Provenance:"]
    for src, n in sorted(r["provenance"].items(), key=lambda kv: -kv[1]):
        lines.append(f"  {src:<34} {n}")
    if r["redaction_note"]:
        lines += ["", "WARNING: " + r["redaction_note"]]
    return "\n".join(lines)


def _self_test():
    """Synthetic fixtures. Each asserts one grouping finds what the others miss —
    the property that made §3 item 4b necessary in the first place."""
    def det(title, q, thr, cond="ABOVE", target="email", recips=None, sev="2",
            missing="false", qkey="query.expression"):
        props = [{"key": "dt.davis.is_merging_allowed", "value": "false"}]
        if target:
            props.insert(0, {"key": "dt_alert_target", "value": target})
        if sev is not None:
            props.insert(0, {"key": "dt_severity", "value": sev})
        if recips:
            props.append({"key": "opc_email_recipients", "value": recips})
        inputs = [{"key": qkey, "value": q},
                  {"key": "threshold", "value": thr},
                  {"key": "alertCondition", "value": cond},
                  {"key": "violatingSamples", "value": "3"},
                  {"key": "dealertingSamples", "value": "2"},
                  {"key": "slidingWindow", "value": "5"}]
        if missing is not None:
            inputs.append({"key": "alertOnMissingData", "value": missing})
        return {"objectId": title, "value": {
            "title": title,
            "analyzer": {"input": inputs},
            "eventTemplate": {"properties": props}}}

    fails = []

    def check(label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{detail and '  — ' + detail}")
        if not ok:
            fails.append(label)

    # Title-blindness: same rule, different names.
    r = analyze([det("cpu_a", "timeseries x", "80"), det("cpu_b", "timeseries x", "80")], 2)
    check("title-blind grouping finds renamed clones",
          r["exact_rules"]["objects"] == 2 and r["exact_objects"]["objects"] == 0,
          f"rules={r['exact_rules']['objects']} objects={r['exact_objects']['objects']}")

    # Drift: identical query, different thresholds — invisible to exact grouping.
    r = analyze([det("a", "timeseries y", "80"), det("b", "timeseries y", "3000")], 2)
    check("drift grouping finds what exact grouping misses",
          r["drift_families"]["objects"] == 2 and r["exact_rules"]["objects"] == 0)

    # The query lives under EITHER input key, and reading only one silently sends
    # every other detector to the empty string, where they group into one giant
    # bogus family. Live 2026-08-11: 853 of 899 detectors used `query`, and the
    # module reported a single 853-object "clone family with threshold drift" while
    # the real answer was 31 families over 67 objects.
    r = analyze([det("a", "timeseries y", "80", qkey="query"),
                 det("b", "timeseries y", "3000", qkey="query")], 2)
    check("the `query` input key is read, not just `query.expression`",
          r["drift_families"]["objects"] == 2,
          f"drift={r['drift_families']['objects']} (0 means the key was ignored)")

    # ...and both shapes coexist in one fleet, so a mixed dump must still group.
    r = analyze([det("a", "timeseries y", "80", qkey="query"),
                 det("b", "timeseries y", "3000", qkey="query.expression")], 2)
    check("both query key shapes group together in one fleet",
          r["drift_families"]["objects"] == 2,
          f"drift={r['drift_families']['objects']}")

    # An unreadable query is missing evidence, never a match — detectors whose query
    # cannot be read must be excluded and declared, not silently grouped.
    unreadable = [{"objectId": f"u{i}", "value": {
        "title": f"u{i}",
        "analyzer": {"input": [{"key": "threshold", "value": "1"},
                               {"key": "alertCondition", "value": "ABOVE"}]},
        "eventTemplate": {"properties": []}}} for i in range(4)]
    r = analyze(unreadable, 2)
    qc = r["query_coverage"]
    check("unreadable queries are excluded from query-keyed groupings and declared",
          r["exact_rules"]["objects"] == 0 and r["drift_families"]["objects"] == 0
          and qc["query_unreadable"] == 4 and qc["query_readable_pct"] == 0.0,
          f"rules={r['exact_rules']['objects']} drift={r['drift_families']['objects']} "
          f"unreadable={qc['query_unreadable']}")

    # Policy clusters: different queries, one policy — invisible to all query-keyed groupings.
    ds = [det(f"d{i}", f"timeseries m{i}", "0") for i in range(6)]
    r = analyze(ds, 5)
    check("policy clustering finds what every query-keyed grouping misses",
          r["policy_clusters"]["detectors_in_clusters"] == 6
          and r["exact_rules"]["objects"] == 0 and r["drift_families"]["objects"] == 0)

    # Merge verdict: divergent static destinations block a full merge.
    ds = [det(f"d{i}", f"timeseries m{i}", "0", recips=f"team{i}@x.com") for i in range(6)]
    v = analyze(ds, 5)["policy_clusters"]["detail"][0]
    check("divergent static routing blocks a full merge", v["merge_verdict"] == "policy_only")

    # ...but placeholder-driven destinations survive one.
    ds = [det(f"d{i}", f"timeseries m{i}", "0", recips="{team_owner}") for i in range(6)]
    v = analyze(ds, 5)["policy_clusters"]["detail"][0]
    check("placeholder-driven routing permits a full merge",
          v["merge_verdict"] == "fully_mergeable")

    # Delivery flags apply ONLY where the property convention is in use. A tenant
    # routing through alerting profiles carries no dt_alert_target at all, and the
    # flags would otherwise fire on every detector — "700 of 700 notify no one" on
    # an estate whose alerting works (live 2026-08-10, two tenants).
    ds = [det(f"n{i}", f"timeseries m{i}", "0", target="", sev=None) for i in range(6)]
    df = analyze(ds, 5)["delivery_flags"]
    check("no routing convention => delivery flags are not applicable, not defects",
          df["convention_in_use"] is False and df["no_alert_target"] is None
          and df["no_severity"] is None and "alerting profiles" in df["note"],
          f"convention={df['convention_in_use']} no_target={df['no_alert_target']}")
    ds = [det(f"y{i}", f"timeseries m{i}", "0", target="snow_uat") for i in range(6)]
    df = analyze(ds, 5)["delivery_flags"]
    check("convention in use => flags are reported as before",
          df["convention_in_use"] is True and df["no_alert_target"] == 0,
          f"convention={df['convention_in_use']} carrying={df['detectors_carrying_alert_target']}")

    # Alert-target census: the destination split, and the non-production flag.
    # D4 reads the notification-integration layer, which property-driven routing
    # bypasses entirely — nothing else in the battery sees this.
    ds = ([det(f"p{i}", f"timeseries m{i}", "0", target="snow_prod1") for i in range(2)]
          + [det(f"u{i}", f"timeseries n{i}", "0", target="snow_uat") for i in range(6)]
          + [det("x", "timeseries z", "0", target="")])
    ats = analyze(ds, 5)["alert_target_split"]
    check("alert-target census splits by destination",
          ats["by_target"]["snow_uat"] == 6 and ats["by_target"]["snow_prod1"] == 2
          and ats["by_target"]["(none)"] == 1,
          f"targets={ats['by_target']}")
    check("non-production destinations are flagged as a share, not a verdict",
          ats["nonprod_targeted"] == 6 and ats["nonprod_targeted_share"] == 66.7
          and "confirm" in ats["note"],
          f"{ats['nonprod_targeted']} ({ats['nonprod_targeted_share']}%)")

    # Missing-data census: unset must count as not-alerting, and be reported apart.
    ds = ([det(f"a{i}", f"timeseries m{i}", "0", missing="false") for i in range(3)]
          + [det("b", "timeseries y", "0", missing="true")]
          + [det("c", "timeseries z", "0", missing=None)])
    md = analyze(ds, 5)["missing_data"]
    check("missing-data census counts unset as silent, reported separately",
          md["alerting_on_missing_data"] == 1 and md["not_alerting"] == 4
          and md["explicitly_disabled"] == 3 and md["unset"] == 1,
          f"enabled={md['alerting_on_missing_data']} silent={md['not_alerting']} "
          f"(disabled={md['explicitly_disabled']} unset={md['unset']})")

    # Capacity: graded against the tenant's OWN declared maximum, never a doc figure.
    check("capacity at the ceiling grades attention",
          capacity(4500, 4500)["pct"] == 100.0
          and capacity(4500, 4500)["status"] == "attention")
    check("capacity well under the ceiling grades healthy",
          capacity(1207, 4500)["status"] == "healthy"
          and capacity(1207, 4500)["headroom"] == 3293)
    check("capacity refuses a verdict with no declared maximum read",
          capacity(4500, None)["status"] == "unknown")

    # A FLAT marker must force `unknown`, never a misleading "uniform".
    ds = [det(f"d{i}", f"timeseries m{i}", "0", recips="***REDACTED_EMAIL***") for i in range(6)]
    v = analyze(ds, 5)["policy_clusters"]["detail"][0]
    check("flat-redacted routing yields UNKNOWN, never 'safe to merge'",
          v["merge_verdict"] == "unknown"
          and v["routing_divergence"]["opc_email_recipients"]["distinct"] is None)

    # An ALIASED marker preserves distinctness, so the file is fully analyzable —
    # this is what redact.email_alias bought: the analysis runs on the file the
    # protocol already writes, instead of needing the unredacted stream.
    ds = [det(f"d{i}", f"timeseries m{i}", "0", recips=f"***REDACTED_EMAIL_{i:08x}***")
          for i in range(6)]
    v = analyze(ds, 5)["policy_clusters"]["detail"][0]
    check("aliased redaction stays analyzable",
          v["routing_divergence"]["opc_email_recipients"]["distinct"] == 6
          and v["merge_verdict"] == "policy_only",
          f"distinct={v['routing_divergence']['opc_email_recipients']['distinct']}, "
          f"verdict={v['merge_verdict']}")

    # Delivery flags.
    ds = [det("a", "timeseries m", "0", target="snow_uat"), det("b", "timeseries m", "0", target="")]
    r = analyze(ds, 5)["delivery_flags"]
    check("delivery flags count snow-without-routing and no-target",
          r["snow_no_routing_metadata"] == 1 and r["no_alert_target"] == 1)

    print(f"\n{'All checks pass.' if not fails else str(len(fails)) + ' FAILED'}")
    return 0 if not fails else 1


def main():
    ap = argparse.ArgumentParser(description="Custom-detector consolidation analysis")
    ap.add_argument("detectors", nargs="?", help="C-davis-detectors.json from probes.md §3")
    ap.add_argument("--min-cluster", type=int, default=DEFAULT_MIN_CLUSTER,
                    help=f"minimum policy-cluster size to report (default {DEFAULT_MIN_CLUSTER})")
    ap.add_argument("--json", help="write the full result (including per-cluster detail) here")
    ap.add_argument("--max-objects", type=int,
                    help="the schema's declared per-environment maximum, from "
                         "`dtctl describe settings-schema builtin:davis.anomaly-detectors`. "
                         "Read it live on the tenant — a remembered documentation figure has "
                         "already been wrong by 4.5x (see capacity()).")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        return _self_test()
    if not a.detectors:
        ap.error("give a detector JSON file (or --self-test)")

    result = analyze(load(a.detectors), a.min_cluster)
    if a.max_objects:
        result["capacity"] = capacity(result["total"], a.max_objects)
    print(_summary(result))
    if a.json:
        with open(a.json, "w") as f:
            json.dump(result, f, indent=1)
        print(f"\nwrote {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
