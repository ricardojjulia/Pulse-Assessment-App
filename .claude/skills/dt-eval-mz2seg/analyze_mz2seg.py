#!/usr/bin/env python3
"""MZ->Segments migration-plan analysis (spec stages 1-5).

Reads a /dt-eval-* run directory (dtctl probe cache) and emits the per-zone
disposition model defined in mz2seg-migration-plan-spec.md:

  Stage 1  A17 zones   -> dimension map (condition families)
  Stage 2  A6 segments -> native-dimension | bridge | static-pinned
  Stage 3  coverage    -> covered | bridged | uncovered per dimension
  Stage 4  B37 census  -> population join (optional; absent => provisional)
           B42 counter -> query-activity join (optional; absent => "unused"
                          falls back to a proxy and says so)
  Stage 5  A13-A16/A19 -> consumer census (blockers per zone)
  Stage 6  zone effectiveness + consolidation projection (see below)
  Stage 7  conversion blockers + alerting capability gaps (see below)
  Output   disposition per zone + rollups, as JSON (+ markdown summary)

Stage 6 exists because the migration is NOT zone-for-zone, and planning it that
way is the documented failure mode. A management zone is one definition per
*value*; a segment carries variables whose values come from a live query, so it
is one definition per *dimension* - an estate of dozens of zones across app /
stage / platform converges on three segments, not dozens. Before anything is
converted, every zone is judged on whether it earns a place in the target
model at all:

  - dead            zero population - the definition matches nothing today
  - unused          populated but nothing consumes it - delete rather than
                    convert (confirm with the owner first)
  - hygiene-only    no scoping intent, only agent/system-noise exclusions
  - duplicate       identical dimension+value signature to another zone
  - value-of-dim    one of N zones differing only in the VALUE of a shared
                    dimension - the whole family collapses into ONE segment
                    with a variable
  - effective       populated, consumed, and carrying a distinct dimension

The consolidation projection turns that into the number the plan leads with:
distinct dimensions, not zone count. Past roughly eight proposed segments the
design is converting values instead of dimensions and should be revisited.
                                    [MZ2POL-05 s2, ORGNZ-10 s5, ORGNZ-99 r46]

Query activity IS measured (since 2026-07-31): probe B42 reads
dt.sfm.server.management_zones.queries_counter, the platform's own per-zone
query counter, which is exactly the BPN's delete-rather-than-convert test. The
former "no probe surface" caveat is retired. Two limits survive: absence from
the census means "no queries observed in the window", never "unused" outright,
and self-monitoring retention is short - so the window is always named next to
the verdict. Population and consumers remain required; B42 strengthens the
'unused' verdict, it does not replace them.

Stage 6 encodes the constraints that make a conversion *not* one-to-one. Every
one is verified against docs.dynatrace.com (authoritative) and corroborated by
the Best Practice Notebooks (MZ2POL-05 segments implementation, MZ2POL-09
alerting migration, ORGNZ-08/10 segment mechanics) as further reading:

  - Segments cannot express exclusions. A zone shaped "broad rule minus
    exceptions" has to be restated positively.            [MZ2POL-05 s5.1]
  - Only dt.security_context / dt.cost.costcenter / dt.cost.product carry
    over to derived data (service metrics), so a segment that filters
    correctly on logs and spans can return empty on service metrics.
    (docs: segments upgrade guide)                         [MZ2POL-05 s5.2]
  - Segment includes support only "=" and "in()". On classic entity includes
    every property except entity.name is equals-only, and entity.name itself
    is documented for starts-with - so a CONTAINS/ENDS_WITH zone condition
    does not convert directly. (docs: segment limits)      [MZ2POL-05 s5.3]
  - Davis problems need an events include on event.kind = "DAVIS_PROBLEM";
    entity includes alone do not filter the problem feed.  [ORGNZ-10 s12]
  - An alerting profile's duration filter has no successor: "No longer
    supported. Currently there is no alternative to deliver problems that are
    active longer than X minutes." (docs: upgrade guide - alert notification)
                                                           [MZ2POL-09 s6.1]
  - OpsGenie / VictorOps / xMatters / Trello have no native connector; they
    migrate to a generic HTTP request. (same docs page)     [MZ2POL-09 s6.2]

Where BPN and docs disagree, docs win and the divergence is recorded in
field-notes.md rather than silently resolved.

Read-only over saved probe files; never talks to a tenant. Tenant data stays
in the (gitignored) run directory - this script and its committed docs carry
no tenant identifiers.

Usage:
  analyze_mz2seg.py <run-dir> [--json OUT.json] [--md OUT.md]
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------- probe I/O

# Probe files appear under three naming conventions across the family's runs
# ("A17-management-zones.json", "a17-management-zones.json",
#  "17-management-zones.json") - match by probe number under all three.
PROBE_PATTERNS = {
    "zones": ("A17-*", "a17-*", "17-*"),
    "segments": ("A6-segments*", "a06-segments*", "06-segments*"),
    "profiles": ("A14-*", "a14-*", "14-*"),
    "notifications": ("A15-*", "a15-*", "15-*"),
    "metric_events": ("A13-*", "a13-*", "13-*"),
    "auto_tags": ("A16-*", "a16-*", "16-*"),
    "population": ("B37-*", "b37-*"),
    "zone_queries": ("B42-*", "b42-*"),
    "iam_readiness": ("B47-*", "b47-*"),
    "source_tags": ("B38-*", "b38-*"),
    "classic_tag_keys": ("B5-*", "b5-*"),
    "buckets": ("A1-buckets*", "a01-buckets*", "01-buckets*"),
    # Dashboards: the CONTENT file first, and it is a different read from the
    # listing. `dtctl get dashboards` returns document METADATA only - no
    # tiles, no DQL - so a tag or management-zone reference inside a dashboard
    # is invisible to it (verified live 2026-08-27). `dtctl get dashboard <id>`
    # returns the full document including `content.tiles[].query`; fetching
    # each id turns 0.1 MB of metadata into 8.0 and 14.5 MB of real content
    # carrying 25 and 629 `tag(` references and 9 and 155 management-zone
    # references on the two reference tenants. Patterns are tried in order and
    # the first that matches wins, so the content file is preferred wherever it
    # was collected and the listing remains a valid fallback.
    "dashboards": ("A8-dashboards-content*", "A8-*", "a08-*", "08-*"),
    "workflows": ("A4-workflows*", "a04-workflows*", "04-workflows*"),
    # A44 legacy maintenance windows scope by `entityTags` - a structured
    # tag consumer, and one of the surfaces that proved a "nothing uses this
    # tag" verdict wrong on first contact with a real run.
    "maintenance_windows": ("A44-*", "a44-*", "44-*"),
    # Not a tag consumer - read only to widen the retire-verdict text gate.
    "ownership_teams": ("A18-*", "a18-*", "18-*"),
    # Classic-dashboard USAGE (not content). Reachable with the platform token
    # while their definitions are not, so it is what sizes the one consumer
    # surface the census cannot read - and, where no classic API token is
    # available at all, what makes the gap actionable by hand: check the
    # busiest twenty in the UI rather than all several hundred.
    "classic_dashboard_usage": ("B46b-*", "b46b-*"),
    "groups": ("A19-*", "a19-*", "19-*"),
    # B30 entity enrichment (reused tenant-eval cache) - positive evidence for
    # the access job's target surface: % of entities carrying dt.security_context.
    "enrichment": ("B30-*", "b30-*", "69-b30-*"),
}


class ProbeFileError(RuntimeError):
    """A probe's files exist but none of them is a readable probe payload.

    Raised rather than returned, because the alternative - reporting the probe
    as "not collected" - is indistinguishable from the probe never having run,
    and silently drops whatever that probe decides. See load_probe.
    """


# Diagnostics from the most recent analyze() run: stray files ignored, probes
# whose payload was unreadable, ambiguous matches. Surfaced in analysis.json
# so a run directory defect is auditable after the fact rather than living in
# whoever-ran-it's scrollback.
_PROBE_DIAGNOSTICS = []


def reset_probe_diagnostics():
    _PROBE_DIAGNOSTICS.clear()


def probe_diagnostics():
    return list(_PROBE_DIAGNOSTICS)


def _warn(message):
    _PROBE_DIAGNOSTICS.append(message)
    print(f"WARNING: {message}", file=sys.stderr)


def _classify_payload(data):
    """Recognize a dtctl probe payload. Returns (kind, rows).

    kind is "rows" (rows is the record list), "error" (the probe ran and the
    envelope says it failed - A19's 400 is the standing example), or
    "unrecognized" (this file is not a probe payload at all).

    Four shapes are accepted, covering the dtctl config API, the query API,
    and the hand-saved caches MANUAL-EXTRACTION.md tells operators to write:
      [...]                                        bare list
      {"kind": "records", "records": [...]}        raw query response
      {"ok": true, "result": [...]}                config envelope
      {"ok": true, "result": {"records": [...]}}   query envelope
    Anything else is unrecognized ON PURPOSE. The old code treated a dict with
    neither key as an empty result, which is how a keymap file sitting next to
    a census silently emptied the census.
    """
    if isinstance(data, list):
        return "rows", data
    if not isinstance(data, dict):
        return "unrecognized", None
    if isinstance(data.get("records"), list) and "result" not in data:
        return "rows", data["records"]          # raw, un-enveloped response
    if "ok" not in data and "result" not in data:
        return "unrecognized", None             # not an envelope at all
    if data.get("ok") is False:
        return "error", None
    result = data.get("result")
    if result is None:
        return "error", None
    if isinstance(result, dict):
        if "records" in result:
            rows = result["records"]
            return ("rows", rows) if isinstance(rows, list) else (
                "unrecognized", None)
        return "rows", [result]                 # single-object result
    if isinstance(result, list):
        return "rows", result
    return "unrecognized", None


def load_probe(run_dir: Path, probe: str):
    """Return the probe's rows, or None when the probe was not collected.

    None means "no file, or the probe ran and failed" - both are legitimately
    "not collected". It never means "a file was there and I could not read
    it": that raises ProbeFileError instead.

    The globs match on probe NUMBER (`B38-*`) and so also match anything else
    a run directory happens to hold under that prefix. The old implementation
    took whichever .json sorted first and trusted it, which failed three ways,
    all of them silent:

      1. `B38-keymap.json` sorts before `B38-tag-propagation.json`, has no
         `result` key, and so read as an empty result - the census reported
         itself uncollected while sitting right there (found live 2026-08-24).
      2. A stray file that DOES carry a `result` key was returned as the
         probe's own data. Worse than missing: wrong, and stated confidently.
      3. Any unparseable .json under the prefix aborted the whole analysis.

    So candidates are now RECOGNIZED rather than assumed: a file that is not a
    dtctl payload is skipped with a warning, an unparseable one is skipped
    with a warning, and only if nothing usable remains does this raise.
    """
    # Patterns are in PREFERENCE order (`A17-*` before `17-*`), so resolve
    # within the first pattern that yields anything rather than pooling them -
    # a run holding both spellings is not ambiguous, it is one preferred and
    # one legacy.
    unusable_all = []
    for pattern in PROBE_PATTERNS[probe]:
        candidates, errored, unusable = [], [], []
        for path in sorted(run_dir.glob(pattern)):
            if path.suffix != ".json":
                continue
            if path.stat().st_size == 0:
                unusable.append((path, "file is empty"))
                continue
            try:
                data = json.loads(path.read_text())
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                unusable.append((path, f"not valid JSON ({exc})"))
                continue
            kind, rows = _classify_payload(data)
            if kind == "rows":
                candidates.append((path, rows))
            elif kind == "error":
                errored.append(path)
            else:
                unusable.append((path, "not a dtctl probe payload"))

        unusable_all.extend(unusable)

        if len(candidates) > 1:
            # Unresolvable: two files under one prefix both look like this
            # probe's payload, and picking by sort order is how a stray file
            # gets reported as the probe's own data - wrong, and stated with
            # confidence. Nothing here can tell them apart, so refuse.
            raise ProbeFileError(
                f"probe {probe!r}: {len(candidates)} files in {run_dir} all "
                f"look like its payload -\n"
                + "\n".join(f"  - {p.name} ({len(r)} row(s))"
                            for p, r in candidates)
                + "\nRefusing to guess which is the probe. Keep one payload "
                  "per probe and name anything else out of its glob (aux-*).")

        if candidates:
            for path, reason in unusable:
                _warn(f"{probe}: ignoring {path.name} - {reason}. Using "
                      f"{candidates[0][0].name}.")
            return candidates[0][1]

        if errored:
            # The probe ran and reported failure. That IS "not collected",
            # and callers already footnote it (A19's 400 is the standing case).
            for path, reason in unusable:
                _warn(f"{probe}: ignoring {path.name} - {reason}. The probe "
                      f"itself reported an error ({errored[0].name}).")
            return None

    if unusable_all:
        raise ProbeFileError(
            f"probe {probe!r}: {len(unusable_all)} file(s) match its pattern "
            f"in {run_dir}, but none is a readable probe payload -\n"
            + "\n".join(f"  - {p.name}: {r}" for p, r in unusable_all)
            + "\nRefusing to report this probe as uncollected while its files "
              "are sitting there. Remove the file, fix it, or rename it out of "
              "the probe's glob (aux-*).")

    return None  # genuinely absent - nothing matched


# ------------------------------------------------- Stage 1: zone dimensions

# Condition families (spec section 4, stage 1). Each positive condition maps a
# zone onto a dimension; negated name-regex conditions are hygiene, not scope.
TAG_KEYS = re.compile(r"_TAGS$")
NAME_KEYS = re.compile(r"(_NAME|_DETECTED_NAME)$")
TECH_KEYS = {"SERVICE_TYPE", "SERVICE_TECHNOLOGY", "HOST_OS_TYPE",
             "CUSTOM_DEVICE_TECHNOLOGY", "PROCESS_GROUP_PREDEFINED_METADATA"}
NEGATED = re.compile(r"^NOT_")
SELECTOR_TAG = re.compile(r"tag\(\"([^\"]+)\"")
SELECTOR_HOST_GROUP = re.compile(r"hostGroupName\(|detectedName\(|HOST_GROUP")
SELECTOR_NAME = re.compile(r"entity[Nn]ame")
SELECTOR_EXT_TYPE = re.compile(r"type\(\"?([a-z0-9_]+):", re.IGNORECASE)


def classify_condition(cond: dict):
    """Return (family, dimension, detail) for one attributeRule condition."""
    key = cond.get("key", "")
    op = cond.get("operator", "")
    negated = bool(NEGATED.match(op))

    if key == "HOST_GROUP_ID":
        return ("entity-pin", "host-group", cond.get("entityId"))
    if key == "HOST_GROUP_NAME":
        return ("name-pattern", "host-group", cond.get("stringValue"))
    if TAG_KEYS.search(key):
        tag = cond.get("tag") or cond.get("stringValue") or ""
        prefix = tag.split(":", 1)[0] if tag else "(untyped)"
        family = "hygiene-exclusion" if negated else "tag-key"
        return (family, f"tag:{prefix}", tag)
    if key == "KUBERNETES_CLUSTER_NAME":
        return ("k8s-cloud", "k8s.cluster.name", cond.get("stringValue"))
    if NAME_KEYS.search(key):
        if negated:  # agent/system noise lists - hygiene, never scope
            return ("hygiene-exclusion", f"name:{key}", cond.get("stringValue"))
        return ("name-pattern", f"name:{key}", cond.get("stringValue"))
    if key in TECH_KEYS:
        return ("tech-refinement", f"tech:{key}", cond.get("stringValue"))
    return ("other", f"other:{key}", cond.get("stringValue") or cond.get("entityId"))


def zone_dimensions(zone_value: dict):
    """Reduce one zone to its scoping dimensions + hygiene/refinement residue."""
    dims, hygiene, refinements = set(), set(), set()
    for rule in zone_value.get("rules", []) or []:
        attr = rule.get("attributeRule")
        if attr:
            for cond in attr.get("conditions", []) or []:
                family, dim, _ = classify_condition(cond)
                if family == "hygiene-exclusion":
                    hygiene.add(dim)
                elif family == "tech-refinement":
                    refinements.add(dim)
                else:
                    dims.add(dim)
        selector = rule.get("entitySelector")
        if selector:
            matched = False
            for tag in SELECTOR_TAG.findall(selector):
                dims.add(f"tag:{tag.split(':', 1)[0]}")
                matched = True
            if SELECTOR_HOST_GROUP.search(selector):
                dims.add("host-group")
                matched = True
            ext = SELECTOR_EXT_TYPE.search(selector)
            if ext:  # extension-entity topology (ibmmq:, os:, ...) - E8 adjacency
                dims.add(f"ext-entity:{ext.group(1).lower()}")
                matched = True
            elif SELECTOR_NAME.search(selector) and not matched:
                dims.add("name-pattern:selector")
                matched = True
            if not matched:
                dims.add("selector:other")
    # Primary-dimension tier: when a zone scopes on a structural dimension
    # (entity-pin, tag key, k8s/cloud, extension type), its name patterns
    # narrow that population rather than define the boundary - demote them to
    # refinements so a covered zone isn't blocked by its own refinement.
    structural = {d for d in dims
                  if not d.startswith(("name:", "name-pattern"))}
    if structural:
        refinements |= (dims - structural)
        dims = structural
    return dims, hygiene, refinements


# ------------------------------- Stage 7 inputs: docs-verified constraints
#
# Every constant here is a documented platform constraint, not a heuristic.
# Sources verified 2026-07-29 against docs.dynatrace.com; BPN notebooks cited
# in the module docstring corroborate them as further reading.

# Only these keys carry over to derived data (service metrics) - segments
# UPGRADE GUIDE: "only keys will be carried over to derived data:
# dt.security_context, dt.cost.costcenter, and dt.cost.product".
# NOTE: ORGNZ-10 s3 additionally lists host group as propagating to service
# metrics; the docs page does not. Docs win - host-group dimensions are
# flagged verify-live rather than asserted either way (field-notes.md).
DERIVED_DATA_KEYS = {"dt.security_context", "dt.cost.costcenter",
                     "dt.cost.product"}

# Classic notification types with no native workflow connector - upgrade guide
# (alert notification): OpsGenie "currently not supported"; VictorOps,
# xMatters, Trello "currently not supported / Use HTTP request instead".
NO_NATIVE_CONNECTOR = {"OPS_GENIE", "OPSGENIE", "VICTOR_OPS", "VICTOROPS",
                       "XMATTERS", "X_MATTERS", "TRELLO"}

# Segment includes support "=" and "in()" only. On classic entity includes
# every property except entity.name is equals-only, and entity.name itself is
# documented for starts-with - so a zone condition doing contains/ends-with
# matching has no direct segment equivalent (segment limits reference).
UNCONVERTIBLE_OP = re.compile(r"CONTAINS|ENDS_WITH|ENDS-WITH", re.IGNORECASE)


def zone_blockers(zone_value: dict):
    """Conversion blockers for one zone - constraints that make it non-1:1."""
    found = {}
    for rule in zone_value.get("rules", []) or []:
        for cond in (rule.get("attributeRule") or {}).get("conditions", []) or []:
            key, op = cond.get("key", ""), cond.get("operator", "")
            negated = bool(NEGATED.match(op))
            # A negated NAME condition is agent/system-noise hygiene (already
            # handled in stage 1). A negated TAG or structural condition is
            # real scoping intent - "everything except team-X" - and segments
            # cannot express exclusions at all.
            if negated and not NAME_KEYS.search(key):
                found.setdefault("exclusion", []).append(key)
            if not negated and UNCONVERTIBLE_OP.search(op):
                found.setdefault("substring-match", []).append(f"{key} {op}")
    return {code: sorted(set(detail)) for code, detail in found.items()}


def alerting_gaps(profiles, notifications):
    """Capability regressions on the alerting leg of the cutover.

    Both are documented dead ends rather than design choices, so they change
    the SEQUENCE of the plan: delay-dependent profiles migrate last (their
    behaviour cannot be reproduced), and the four connectorless destinations
    become generic HTTP requests.
    """
    delayed = []
    for item in profiles or []:
        value = item.get("value") or {}
        worst = 0
        for rule in value.get("rules", []) or []:
            try:
                worst = max(worst, int(rule.get("delayInMinutes") or 0))
            except (TypeError, ValueError):
                continue
        if worst > 0:
            delayed.append({"name": value.get("name") or item.get("objectId"),
                            "delay_minutes": worst})
    connectorless = defaultdict(int)
    for item in notifications or []:
        kind = ((item.get("value") or {}).get("type") or "").upper()
        if kind.replace("-", "_") in NO_NATIVE_CONNECTOR:
            connectorless[kind] += 1
    return {
        "delay_dependent_profiles": sorted(delayed,
                                           key=lambda p: -p["delay_minutes"]),
        "connectorless_notifications": dict(connectorless),
        "profiles_read": len(profiles or []),
        "notifications_read": len(notifications or []),
    }


# --------------------------------------------- Stage 2: segment classification

NATIVE_FIELD = re.compile(
    r"isNotNull\((?P<field>[a-z0-9_.]+)\)", re.IGNORECASE)
BRIDGE_HINT = re.compile(r"\bparse\b.*\btags?\b|\bconcat\(", re.IGNORECASE | re.DOTALL)
STATIC_HINT = re.compile(r"^\s*data\b|\bdata\s+record\(", re.IGNORECASE | re.DOTALL)
# Legacy tag key a bridge segment re-renders, e.g. 'AppID:' inside a parse pattern.
BRIDGE_TAG_KEY = re.compile(r"'([A-Za-z0-9_.-]+):'")


def classify_segment(seg: dict):
    """Return (kind, covers) - kind in native|bridge|static; covers = dim keys."""
    variables = seg.get("variables") or {}
    query = variables.get("value") or ""
    name = seg.get("name", "")
    if not query:
        return ("static-pinned", set())
    if STATIC_HINT.search(query):
        keys = {f"tag:{k}" for k in BRIDGE_TAG_KEY.findall(query)}
        # Static records that enumerate tag values still bridge that tag key.
        for token in re.findall(r'"([A-Za-z0-9_.-]+):', query):
            keys.add(f"tag:{token}")
        return ("static-pinned", keys)
    if BRIDGE_HINT.search(query):
        return ("bridge", {f"tag:{k}" for k in BRIDGE_TAG_KEY.findall(query)})
    match = NATIVE_FIELD.search(query)
    field = match.group("field") if match else name.strip()
    covers = set()
    if field == "dt.host_group.id":
        covers = {"host-group"}
    elif field:
        covers = {field}
    return ("native-dimension", covers)


# ------------------------------------- Stage 1b: tag-dimension provenance
#
# The long-term foundation of the plan is tagging at source: segments, IAM
# and dashboards key on PRIMARY GRAIL TAGS (source-set, Smartscape-visible),
# while classic auto-tag rules (A16) compute tags that exist only on classic
# entities and retire with them. Every tag dimension therefore carries a
# provenance verdict - it decides whether the remediation is "author the
# segment" or "establish the source tag FIRST, then author the segment".

BRACKET_PREFIX = re.compile(r"^\[[^\]]+\]")


def tag_provenance(tag_dims, auto_tag_names, classic_keys, propagation,
                   fleet_size=0):
    """Classify each tag:* dimension by where the tag actually lives.

    propagation: {key: smartscape-host count} from B38 (candidate-key census),
    or None when B38 was not collected (verdicts then carry verify-live).
    A token presence (< 1% of the fleet) is NOT propagation - a handful of
    pilot hosts must not read as a usable foundation.
    """
    material = max(fleet_size // 100, 25)
    out = {}
    for dim, zones in tag_dims.items():
        key = dim[4:]
        entry = {"zones": zones}
        if key.startswith("["):
            entry["provenance"] = "context-imported"
            entry["path"] = ("native dimension (cloud/env metadata) - segment "
                            "on the metadata field, not the rendered tag")
            # A context-imported key is stored under its BARE name at source:
            # the zone filters on "[Environment]server_managed_by", the source
            # tag is "server_managed_by". Searching the rendered form returns
            # zero and reads as "not propagated" - a false negative on, in
            # practice, the estate's best-propagated tag. Record the
            # measurement against the bare key so the classification carries
            # its reach rather than discarding it. (2026-08-24: found live,
            # where the rendered form scored 0 and the bare key 94% of fleet.)
            if propagation is not None:
                hosts = propagation.get(key)
                if hosts is None:
                    hosts = propagation.get(BRACKET_PREFIX.sub("", key))
                if hosts:
                    entry["propagated_hosts"] = hosts
                    if hosts >= material:
                        entry["path"] = (
                            "native dimension already flowing at source - "
                            "segment on the metadata field (its bare key), "
                            "never the rendered tag string")
        elif propagation is not None:
            hosts = propagation.get(key)
            if hosts is None:
                entry["provenance"] = "unmeasured"
                entry["path"] = "extend the B38 candidate list and re-check"
            elif hosts >= material:
                entry["provenance"] = "source-propagated"
                entry["propagated_hosts"] = hosts
                entry["path"] = ("primary Grail tag already flowing - "
                                "segment-ready now; validate its coverage "
                                "matches the zones' intent")
            else:
                kind = ("classic auto-tag" if key in auto_tag_names
                        else "classic/manual tag")
                entry["provenance"] = f"{kind} - not propagated"
                if hosts:
                    entry["propagated_hosts"] = hosts  # token pilot presence
                entry["path"] = ("establish tagging at source (host tags / "
                                "K8s labels / OpenPipeline enrichment) BEFORE "
                                "the segment; the classic tag retires with "
                                "Gen2")
        else:
            kind = ("classic auto-tag" if key in auto_tag_names
                    else "classic/manual tag")
            entry["provenance"] = f"{kind} (propagation verify-live)"
            entry["path"] = "run B38 to confirm whether a source tag flows"
        if key in classic_keys and "source-propagated" not in entry["provenance"]:
            entry["classic_entity_tag"] = True  # visible on classic entities only
        out[dim] = entry
    return out


# ------------------------------ Stage 1c: auto-tag RULE disposition
#
# Stage 1b answers "where does this tag key live" for the keys a management
# zone happens to filter on. That is the smaller half of the tagging job. The
# classic auto-tagging rules are themselves Gen2 objects that have to be
# migrated or retired, and on a real estate most of them are invisible to
# Stage 1b: on the two reference tenants measured 2026-08-27, 178 and 347
# rules existed while only 21 and 53 produced a key any zone filtered on.
# 111 and 209 were referenced by nothing the run could read at all - those are
# retire-rather-than-migrate candidates that never reached a plan.
#
# So this stage inverts the question. Every rule gets a disposition of its own,
# from the rule BODY rather than its name, because the body is the source
# specification: `attributeRule.conditions[].key` says what the rule reads to
# decide the tag's value, and that is exactly what has to be re-established at
# source before a segment can replace it.
#
# Three mechanics of classic auto-tagging have NO segment equivalent, and each
# is a silent scope change if it is migrated without being noticed:
#
#   pgToHostPropagation / pgToServicePropagation - the rule matches a process
#     group and the tag lands on the host and the service as well. A segment
#     filter does not traverse the relationship; the replacement must state it
#     explicitly or its scope quietly shrinks to process groups alone.
#   valueFormat - the tag's VALUE is computed at tag time from a placeholder,
#     often with a regex ({Host:Environment:AppID/(APP-[0-9]*+)}). Segments
#     cannot compute; the value has to be produced at source or in
#     OpenPipeline before the segment can key on it.
#   entitySelector tag(...) - the rule reads ANOTHER classic tag. That is a
#     dependency cascade, and it is the single biggest hazard found on the
#     reference estate: 211 and 380 selector clauses chained on a tag, of
#     which 154 and 294 chained on one key that is itself at zero source
#     propagation. Re-source that key late and several hundred DOWNSTREAM
#     rules stop producing values, taking their consumers with them.

# Condition attribute -> what the rule actually reads. Decides whether the
# replacement is free (a native dimension already exists), blocked (it reads
# another tag), or real work (it reads a NAME, so no dimension exists at all
# and one has to be established at source). Anything absent from this map is
# reported as verify-live rather than guessed - the census behind it covered
# 42 distinct attributes across two large estates, but it is not the schema.
AUTOTAG_SOURCE_CLASS = {
    # Native dimensions - a segment filters on these today, no source work.
    "HOST_GROUP_ID": "native", "HOST_GROUP_NAME": "native",
    "KUBERNETES_CLUSTER_NAME": "native",
    "CLOUD_APPLICATION_NAMESPACE_NAME": "native",
    "HOST_PAAS_TYPE": "native", "HOST_OS_TYPE": "native",
    "HOST_HYPERVISOR_TYPE": "native",
    "PROCESS_GROUP_TECHNOLOGY": "native", "SERVICE_TECHNOLOGY": "native",
    "SERVICE_TYPE": "native",
    "CLOUD_FOUNDRY_ORG_NAME": "native", "OPENSTACK_REGION_NAME": "native",
    # Reads another tag - resolve THAT key before this rule can move.
    "HOST_TAGS": "chained-tag", "PROCESS_GROUP_TAGS": "chained-tag",
    "SERVICE_TAGS": "chained-tag", "BROWSER_MONITOR_TAGS": "chained-tag",
    "NETWORK_AVAILABILITY_MONITOR_TAGS": "chained-tag",
    # Matches on a detected or display NAME. No dimension exists behind it;
    # a real source tag has to be invented, agreed and applied.
    "HOST_NAME": "name-pattern", "HOST_DETECTED_NAME": "name-pattern",
    "PROCESS_GROUP_NAME": "name-pattern",
    "PROCESS_GROUP_DETECTED_NAME": "name-pattern",
    "PROCESS_GROUP_AZURE_HOST_NAME": "name-pattern",
    "SERVICE_NAME": "name-pattern", "SERVICE_DETECTED_NAME": "name-pattern",
    "SERVICE_WEB_SERVER_NAME": "name-pattern",
    "SERVICE_DATABASE_HOST_NAME": "name-pattern",
    "CUSTOM_DEVICE_NAME": "name-pattern",
    "CUSTOM_DEVICE_GROUP_NAME": "name-pattern",
    "WEB_APPLICATION_NAME": "name-pattern",
    "MOBILE_APPLICATION_NAME": "name-pattern",
    "BROWSER_MONITOR_NAME": "name-pattern",
    "HTTP_MONITOR_NAME": "name-pattern",
    "NETWORK_AVAILABILITY_MONITOR_NAME": "name-pattern",
    # Process/host detail - needs source enrichment, and the process-group
    # ones are process-group-BOUND, which is its own migration workstream.
    "PROCESS_GROUP_PREDEFINED_METADATA": "process-detail",
    "HOST_CUSTOM_METADATA": "process-detail",
    "CUSTOM_DEVICE_METADATA": "process-detail",
    "SERVICE_DATABASE_NAME": "process-detail",
    "SERVICE_WEB_CONTEXT_ROOT": "process-detail",
    "SERVICE_PORT": "process-detail", "HOST_IP_ADDRESS": "process-detail",
    "HOST_AIX_LOGICAL_CPU_COUNT": "process-detail",
    # A hard-coded entity id - rot-prone exactly as an entity-pinned zone is.
    "PROCESS_GROUP_ID": "entity-pin",
}

# PROCESS_GROUP_PREDEFINED_METADATA is only native when its dynamicKey is one
# of the Kubernetes ones; COMMAND_LINE_ARGS or EXE_PATH are not dimensions.
NATIVE_PG_METADATA = {"KUBERNETES_NAMESPACE", "KUBERNETES_CONTAINER_NAME"}

# entitySelector tag references: tag("Key:Value"), tag(~"Key:Value~"),
# tag(Key). Captures the KEY half only - the value is a value, the key is the
# dependency.
SELECTOR_TAG = re.compile(r'tag\(\s*~?"?\[?([^"~:,()\]]+)')


def _tag_key(raw):
    """Bare key from a 'Key:Value' tag string, context prefix preserved."""
    if not raw:
        return None
    return raw.split(":", 1)[0].strip() or None


def autotag_rule_facts(entry):
    """Everything the plan needs from one A16 rule object's BODY."""
    value = entry.get("value") or {}
    facts = {
        "key": value.get("name"),
        "clauses": 0,
        "entity_types": set(),
        "source_attributes": set(),
        "source_classes": set(),
        "depends_on": set(),
        "value_placeholders": set(),
        "pg_to_host": False,
        "pg_to_service": False,
        "host_to_pg": False,
        "disabled_clauses": 0,
    }
    for rule in value.get("rules") or []:
        facts["clauses"] += 1
        if rule.get("enabled") is False:
            facts["disabled_clauses"] += 1
        for placeholder in re.findall(r"\{([^}]+)\}", rule.get("valueFormat") or ""):
            facts["value_placeholders"].add(placeholder)
        selector = rule.get("entitySelector") or ""
        if selector:
            for match in SELECTOR_TAG.findall(selector):
                dep = _tag_key(match)
                if dep and dep != facts["key"]:
                    facts["depends_on"].add(dep)
            for etype in re.findall(r'type\(\s*~?"?([\w:]+)', selector):
                facts["entity_types"].add(etype.upper())
        attribute_rule = rule.get("attributeRule") or {}
        if attribute_rule:
            if attribute_rule.get("entityType"):
                facts["entity_types"].add(attribute_rule["entityType"])
            facts["pg_to_host"] |= bool(attribute_rule.get("pgToHostPropagation"))
            facts["pg_to_service"] |= bool(
                attribute_rule.get("pgToServicePropagation"))
            # The third direction, and the one most easily missed: a rule that
            # matches a HOST and pushes the tag down onto its process groups.
            facts["host_to_pg"] |= bool(
                attribute_rule.get("hostToPGPropagation"))
            for cond in attribute_rule.get("conditions") or []:
                attr = cond.get("key")
                if not attr:
                    continue
                facts["source_attributes"].add(attr)
                cls = AUTOTAG_SOURCE_CLASS.get(attr, "verify-live")
                if (attr == "PROCESS_GROUP_PREDEFINED_METADATA"
                        and cond.get("dynamicKey") in NATIVE_PG_METADATA):
                    cls = "native"
                facts["source_classes"].add(cls)
                if cls == "chained-tag":
                    dep = _tag_key(cond.get("tag"))
                    if dep and dep != facts["key"]:
                        facts["depends_on"].add(dep)
    return facts


# Surfaces whose tag references are read from a STRUCTURED field (so the count
# is exact) vs scanned as text (so it is a lower bound). The distinction is
# reported, because "no consumer found" is the verdict that RETIRES a rule and
# it must never rest on a surface that was not actually read.
#
# The structured forms below were not guessable - each was found by sampling
# five retire candidates against every probe in a real run and asking why a
# key the census called unreferenced appeared in four other files
# (2026-08-27). The first cut read only `tagFilter`, and would have told an
# operator to delete rules that maintenance windows and metric events were
# actively using:
#
#   tagFilter: ["Key:Value"]            alerting profiles
#   entityTags: ["Key:Value"]           maintenance windows
#   {key: "*_TAGS", tag: "Key:Value"}   management zones, auto-tag rules
#   {type: "TAG", value: "Key:Value"}   metric-event entity filters
#   entitySelector: 'tag("Key:Value")'  anywhere a selector is accepted
#
# Problem notifications are deliberately NOT a surface: their only tag
# reference is through the alerting profile they are attached to, which the
# profile surface already counts, and their displayName routinely CONTAINS a
# tag key as ordinary prose. Counting them would manufacture consumers.
STRUCTURED_SURFACES = ("zones", "profiles", "metric_events",
                       "maintenance_windows")
TEXT_SURFACES = ("segments", "dashboards", "workflows")


def structured_tag_keys(node, found):
    """Every tag KEY referenced by a settings object, by structured field.

    Recursive because the forms nest differently per schema and the depth is
    not fixed - a zone buries conditions under rules[].attributeRule, a metric
    event under queryDefinition.entityFilter.conditions.
    """
    if isinstance(node, dict):
        for field in ("tagFilter", "entityTags", "tags"):
            for raw in node.get(field) or []:
                # Three shapes across the surfaces: a "Key:Value" string
                # (alerting profiles, maintenance windows), a bare key when the
                # container is a map (workflow trigger filters iterate to their
                # keys), and a {context, key, value} object - which is how the
                # CLASSIC config API returns a dashboard's tag filter, both at
                # dashboard level and per tile.
                if isinstance(raw, dict):
                    key = _tag_key(raw.get("key"))
                elif isinstance(raw, str):
                    key = _tag_key(raw)
                else:
                    key = None
                if key:
                    found.add(key)
        if node.get("tag") and isinstance(node["tag"], str):
            key = _tag_key(node["tag"])
            if key:
                found.add(key)
        if node.get("type") == "TAG" and isinstance(node.get("value"), str):
            key = _tag_key(node["value"])
            if key:
                found.add(key)
        selector = node.get("entitySelector")
        if isinstance(selector, str):
            for match in SELECTOR_TAG.findall(selector):
                key = _tag_key(match)
                if key:
                    found.add(key)
        for child in node.values():
            structured_tag_keys(child, found)
    elif isinstance(node, list):
        for child in node:
            structured_tag_keys(child, found)
    return found


# A surface can only evidence a tag consumer if the extractor actually finds
# references on it. Two live defects on 2026-08-27, both invisible until a
# fresh collection was read rather than assumed:
#
#   `dtctl get dashboards` and `get workflows` return object METADATA only -
#   id, name, owner, trigger - with no tiles, no DQL, no task bodies (208 and
#   481 dashboards in ~0.1 MB). A surface that cannot carry a tag reference
#   cannot disagree with a retire verdict, and counting it as "read" claims a
#   coverage the read never had.
#
#   Segments carry their tag references inside a DQL string, as `Key:Value`
#   literals and parse patterns - `parse toString(tags), "ld('AppID:'…)"` -
#   never as `tag(…)`. The selector regex found ZERO on either tenant, so
#   segments had been reported as a read surface while contributing nothing.
#
# So capability is MEASURED, not declared: a surface that yields no reference
# at all, for any key, is inconclusive - either it genuinely holds none or the
# extractor cannot read it, and this cannot tell which. Erring toward
# inconclusive only widens the stated caveat; it never shortens the retire list.


# Keys whose STRING values are DQL (or carry it). A tag reference lives in a
# query; a dashboard also carries tile titles, markdown notes and descriptions,
# and scanning those manufactures consumers - `KPMC` was counted as a consumer
# of the tag `KPMC` because a markdown tile opened with the heading "KPMC:".
# Restricting the literal scan to query text drops that without losing a single
# genuine reference: every real hit on both reference tenants was inside a
# query (`tag("AppID:APP-507")`, `in(entity_tags, "k8ns:...")`,
# `concat("epims_group:", app)`, `not(in(tags, "infra_send_alert:true"))`).
DQL_BEARING_FIELDS = ("query", "dql", "value", "expression")


def dql_text(node, out):
    """Concatenated DQL-bearing strings from a settings/document object.

    Falls back to the whole object when it holds no such field, so a surface
    whose schema this does not know is scanned rather than silently skipped -
    over-scanning costs a false consumer, under-scanning costs a deletion.
    """
    if isinstance(node, dict):
        for key, val in node.items():
            if key in DQL_BEARING_FIELDS and isinstance(val, str):
                out.append(val)
            else:
                dql_text(val, out)
    elif isinstance(node, list):
        for child in node:
            dql_text(child, out)
    return out


def literal_tag_keys(blob, known_keys):
    """Known tag keys appearing in a free-text payload (DQL, descriptions).

    Targeted rather than pattern-based: a segment's DQL names its tag key as an
    ordinary string, so there is no syntax to match on - but the key set IS
    known, which turns an unsolvable parse into a lookup.

    Matches the `key:` form ONLY, which is the tag key/value syntax itself, and
    is how every genuine reference on both reference tenants was written:
    `tag("AppID:APP-507")` · `parse toString(tags), "ld:t'sal_..._threshold:'"`
    · `concat("epims_group:", app)` · `in(entity_tags, "k8ns:kp-hpbio-...")` ·
    `not(in(tags, "infra_send_alert:true"))`. A bare quoted `"key"` was tried
    first and matched tile TITLES - a dashboard tile called "KPMC" is not a
    consumer of the tag `KPMC` - so the quoted forms are gone. A key-only
    reference with no value (`tag("Ping")`) is still caught, by the structured
    selector pass rather than here.
    """
    found = set()
    for key in known_keys:
        if not key or len(key) < 3:
            continue  # a two-character key matches everything; not evidence
        if f'{key}:' in blob:
            found.add(key)
    return found


def classic_dashboard_filters(run_dir):
    """Per-dashboard filter rows from the opt-in classic ReadConfig audit.

    Read directly rather than through load_probe: the audit is written by
    .dt-eval-common/collect_classic_evidence.py and is NOT a dtctl envelope -
    it is one object holding five named sections - so load_probe correctly
    refuses it as "not a probe payload".

    Classic dashboards are the one consumer surface no platform token can
    reach: they live in a separate store, `dtctl get dashboards` returns only
    platform documents, and `dt.entity.dashboard` is not an entity type. They
    are also heavily used - 154 and 430 distinct classic dashboards opened in
    30 days on the two reference tenants, one of them 14,138 times by 52
    people - so their absence from the consumer census is material.

    Returns None when the audit has not been run, which must read as "not
    checked", never as "no classic dashboard uses this tag".
    """
    for name in ("classic-evidence.json", "aux-classic-evidence.json"):
        path = run_dir / name
        if not path.exists():
            continue
        try:
            evidence = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        section = (evidence or {}).get("dashboards")
        if not isinstance(section, dict) or section.get("detail") is None:
            continue
        return [{"value": row} for row in section["detail"]]
    return None


def tag_consumer_census(zones, profiles, metric_events, windows, segments,
                        dashboards, workflows, classic_dashboards=None,
                        known_keys=()):
    """Per tag KEY, who references it - across every surface that can.

    Returns (counts, surfaces, text_index), where `surfaces` is
    {"read": [...], "inconclusive": [...]}. `read` names only the probes that
    loaded AND yielded at least one tag reference: an absent probe must read as
    "not checked", and a payload that yielded nothing as "returned nothing to
    check" - never as "no consumers", or a retire verdict is being drawn from a
    file that could not have disagreed with it.

    Alerting profiles are the surface Stage 5's consumer census misses
    entirely - it counts only profiles bound by `managementZone`, while a
    profile may equally filter by `tagFilter`, and thousands do (4,829 and
    7,402 tagFilter entries on the two reference tenants). A profile that
    filters on a classic tag is a consumer of the tagging layer whether or not
    a zone is involved, and it breaks the same way when the tag retires.
    """
    counts = defaultdict(lambda: defaultdict(int))
    surfaces = {"read": [], "inconclusive": []}
    text_index = {}
    known_keys = set(known_keys)

    # Every surface gets BOTH passes. The structured pass is exact; the literal
    # pass catches keys named in free text (a segment's DQL, a workflow's
    # description) that no schema-shaped extractor can see.
    for name, payload in (("zones", zones), ("profiles", profiles),
                          ("metric_events", metric_events),
                          ("maintenance_windows", windows),
                          ("segments", segments), ("dashboards", dashboards),
                          ("workflows", workflows),
                          ("classic_dashboards", classic_dashboards)):
        if payload is None:
            continue
        text_index[name] = json.dumps(payload)
        hits = 0
        for item in payload:
            found = structured_tag_keys(item.get("value") or item, set())
            queries = dql_text(item, [])
            found |= literal_tag_keys(
                "\n".join(queries) if queries else json.dumps(item),
                known_keys)
            for key in found:
                counts[key][name] += 1
                hits += 1
        surfaces["read" if hits else "inconclusive"].append(name)

    return counts, surfaces, text_index


def widen_text_index(text_index, run_dir, extra_probes):
    """Add probes that are NOT tag consumers to the retire-verdict text gate.

    Problem notifications and ownership teams cannot filter by tag, so they are
    never counted as consumers - but a key appearing in one is still a reason
    to read before deleting, and both were among the files that falsified this
    stage's first retire list.
    """
    for name in extra_probes:
        payload = load_probe(run_dir, name)
        if payload is not None:
            text_index[name] = json.dumps(payload)
    return text_index


def autotag_disposition(auto_tags, consumers, surfaces, propagation,
                        fleet_size=0, text_scan_keys=None, text_index=None):
    """Per classic auto-tagging RULE: what happens to it, and in what order.

    The verdict ladder, most decisive first:

      no-measured-consumer  no surface read by this run references the key
                            in a structured filter field, AND the key appears
                            nowhere in those probes as text - retire rather
                            than migrate (owner confirmation still required;
                            the surfaces read are named)
      consumer-unclassified no structured reference, but the key DOES appear
                            as text in a probe - read those objects before
                            retiring anything. This tier exists because the
                            first cut of this stage called 111 rules retirable
                            on one tenant, and a sample of five found four of
                            them named in maintenance windows, metric events
                            and zones through reference forms the extractor
                            did not yet read (2026-08-27). A retire verdict
                            gets the stricter test
      already-sourced       B38 shows the key flowing at source - the rule is
                            redundant, the segment can key on the source today
      blocked-on-tag        the rule reads another classic tag that is itself
                            unresolved - that key is the predecessor task
      native-field          every source attribute is a native dimension -
                            segment directly, retire the rule, no source work
      re-source             reads names/tags/process detail - a primary Grail
                            tag has to be established BEFORE the segment
      verify-live           an attribute outside the classification census

    Hazard flags are orthogonal to the verdict: a native-field rule with
    pgToHostPropagation is still a scope change if migrated naively.
    """
    material = max(fleet_size // 100, 25)
    text_scan_keys = set(text_scan_keys or ())
    out = {}
    for entry in auto_tags or []:
        facts = autotag_rule_facts(entry)
        key = facts["key"]
        if not key:
            continue
        used = {s: n for s, n in (consumers.get(key) or {}).items() if n}
        hosts = (propagation or {}).get(key)
        sourced = hosts is not None and hosts >= material
        blockers = sorted(
            dep for dep in facts["depends_on"]
            if not ((propagation or {}).get(dep, 0) >= material))

        if not used:
            # Second gate before anything is called retirable: a loose text
            # search of the same probes. A hit is not proof of consumption
            # (a profile named after an application contains the app's tag
            # key as prose), which is exactly why it downgrades the verdict
            # to "go read these" rather than resolving it either way.
            # Deliberately a BARE substring over every probe the run loaded,
            # including surfaces (problem notifications, ownership teams) that
            # are not structured tag consumers. A short or generic key will
            # match as prose and land here rather than on the retire list -
            # which is the correct direction to be wrong in. The gate's only
            # job is to stop a delete recommendation, never to confirm one.
            mentions = sorted(name for name, blob in (text_index or {}).items()
                              if key in blob)
            if mentions:
                verdict = "consumer-unclassified"
                path = ("no structured filter references the key, but it "
                        "appears as text in " + ", ".join(mentions)
                        + " - read those objects before retiring the rule. A "
                        "name that merely contains the key is not a consumer; "
                        "a reference form this analysis does not parse is. "
                        "Only reading them tells you which")
            else:
                verdict = "no-measured-consumer"
                path = ("retire rather than migrate - the key appears in no "
                        "structured filter and nowhere as text across the "
                        "surfaces read ("
                        + (", ".join(surfaces["read"]) or "none") + "). "
                        "Confirm with the tag's owner, and against any surface "
                        "this run did not read, before deleting")
        elif sourced:
            verdict = "already-sourced"
            path = ("a primary Grail tag of the same key already flows at "
                    f"source ({hosts} hosts) - build the segment on the source "
                    "tag now and retire the rule; the rule is duplicating work")
        elif blockers:
            verdict = "blocked-on-tag"
            path = ("reads " + ", ".join(f"`{b}`" for b in blockers[:3])
                    + (" and others" if len(blockers) > 3 else "")
                    + " - those keys are the predecessor task; re-source them "
                    "first or this rule stops producing values when they retire")
        elif facts["source_classes"] and facts["source_classes"] <= {"native"}:
            verdict = "native-field"
            path = ("every condition reads a native dimension "
                    f"({', '.join(sorted(facts['source_attributes']))}) - "
                    "segment on that field directly and retire the rule; no "
                    "source-tagging work required")
        elif "verify-live" in facts["source_classes"]:
            verdict = "verify-live"
            path = ("condition attribute outside the classification census - "
                    "read the rule and classify it by hand")
        elif facts["source_classes"]:
            verdict = "re-source"
            path = ("reads "
                    + ", ".join(sorted(facts["source_classes"] - {"native"}))
                    + " - establish the primary Grail tag at source (host tags "
                    "/ K8s labels / OpenPipeline enrichment) BEFORE the segment")
        else:
            verdict = "verify-live"
            path = ("selector-only rule with no attribute conditions - read "
                    "the selector and classify it by hand")

        hazards = []
        if facts["pg_to_host"]:
            hazards.append("pg-to-host-propagation")
        if facts["pg_to_service"]:
            hazards.append("pg-to-service-propagation")
        if facts["host_to_pg"]:
            hazards.append("host-to-pg-propagation")
        if facts["value_placeholders"]:
            hazards.append("computed-value")
        if "entity-pin" in facts["source_classes"]:
            hazards.append("entity-pinned")

        record = {
            "verdict": verdict,
            "path": path,
            "clauses": facts["clauses"],
            "consumers": used,
            "consumers_total": sum(used.values()),
            "entity_types": sorted(facts["entity_types"]),
            "source_attributes": sorted(facts["source_attributes"]),
            "source_classes": sorted(facts["source_classes"]),
            "depends_on": sorted(facts["depends_on"]),
            "blocked_on": blockers,
            "hazards": hazards,
        }
        if facts["value_placeholders"]:
            record["value_placeholders"] = sorted(facts["value_placeholders"])
        if facts["disabled_clauses"]:
            record["disabled_clauses"] = facts["disabled_clauses"]
        if hosts is not None:
            record["propagated_hosts"] = hosts
        if key in text_scan_keys:
            record["consumer_evidence"] = "text-scan"
        out[key] = record
    return out


def autotag_rollup(disposition, surfaces):
    """Estate-level shape of the auto-tagging layer, plus the cascade roots.

    `cascade_roots` is the number the plan leads with: the keys other rules
    chain on, ordered by how many rules stop working if that key is retired
    before it is re-sourced. On the reference estate one key carried 154 and
    294 dependent clauses while sitting at zero source propagation - a
    dependency the zone-by-zone view cannot see at all.
    """
    if not disposition:
        return None
    verdicts = defaultdict(int)
    hazards = defaultdict(int)
    dependents = defaultdict(set)
    for key, rec in disposition.items():
        verdicts[rec["verdict"]] += 1
        for hazard in rec["hazards"]:
            hazards[hazard] += 1
        for dep in rec["depends_on"]:
            dependents[dep].add(key)
    # Resolution ORDER, not just a list. A rule that reads another tag cannot
    # be re-sourced before the tag it reads, so the worklist is a topological
    # layering of the dependency graph: layer 0 is everything that depends on
    # nothing unresolved and can start immediately, layer N waits on N-1.
    # Cycles are reported rather than broken - two rules that read each other
    # have no valid order, and a human has to decide which one becomes the
    # source of truth. Silently emitting one of them first would be a plan
    # that cannot be executed.
    pending = {k: {d for d in r["depends_on"] if d in disposition}
               for k, r in disposition.items()}
    layers, guard = [], 0
    while pending and guard < 50:
        guard += 1
        ready = sorted(k for k, deps in pending.items()
                       if not (deps & pending.keys()))
        if not ready:
            break
        layers.append(ready)
        for k in ready:
            pending.pop(k)
    cycles = sorted(pending)

    roots = sorted(
        ({"key": dep,
          "dependent_rules": len(rules),
          "sourced": (disposition.get(dep, {}).get("propagated_hosts")),
          "self_verdict": disposition.get(dep, {}).get("verdict",
                                                       "not-an-auto-tag")}
         for dep, rules in dependents.items()),
        key=lambda r: -r["dependent_rules"])
    return {
        "rules_total": len(disposition),
        "verdicts": dict(verdicts),
        "hazards": dict(hazards),
        "surfaces_read": surfaces["read"],
        # Loaded, but the payload carried no tag-bearing construct at all, so
        # it could not have disagreed with a retire verdict. Reported beside
        # the surfaces that were never collected, not beside the ones that were.
        "surfaces_inconclusive": surfaces["inconclusive"],
        "cascade_roots": roots[:10],
        "resolution_layers": [{"layer": i, "rules": len(keys), "keys": keys}
                              for i, keys in enumerate(layers)],
        "dependency_cycles": cycles,
        "retire_candidates": sorted(
            k for k, r in disposition.items()
            if r["verdict"] == "no-measured-consumer"),
        "unclassified_consumers": sorted(
            k for k, r in disposition.items()
            if r["verdict"] == "consumer-unclassified"),
    }


# ----------------------------------- Architecture inputs: buckets + delivery

def bucket_posture(buckets):
    """Grail bucket posture - the storage layer of the target architecture.

    An all-default bucket estate means no retention differentiation, no
    bucket-level access boundaries, and no query pruning - worth surfacing in
    the plan's architecture guidance (buckets complement segments: buckets
    prune what a query SCANS, segments filter what a user SEES).
    """
    if buckets is None:
        return None
    custom = [b for b in buckets
              if not (b.get("bucketName") or "").startswith("default")]
    return {
        "total": len(buckets),
        "custom": len(custom),
        "custom_names": [b.get("bucketName") for b in custom],
        "custom_log_buckets": sum(1 for b in custom
                                  if b.get("table") == "logs"),
    }


def delivery_consolidation(notifications):
    """Collapse classic notifications to distinct delivery targets.

    The anti-1:1-migration number: profiles/notifications must never be
    ported one-for-one to workflows - group by where the notification
    actually goes (recipient set / endpoint) and parameterize by problem
    metadata instead.
    """
    if notifications is None:
        return None
    targets, email_sets, webhook_urls = set(), set(), set()
    by_type = defaultdict(int)
    for item in notifications:
        value = item.get("value", {})
        kind = value.get("type") or "?"
        by_type[kind] += 1
        if kind == "EMAIL":
            email = value.get("emailNotification") or {}
            key = tuple(sorted((email.get("recipients") or [])
                               + (email.get("ccRecipients") or [])
                               + (email.get("bccRecipients") or [])))
            email_sets.add(key)
            targets.add(("EMAIL", key))
        elif kind == "WEBHOOK":
            url = (value.get("webhookNotification") or {}).get("url") or "?"
            webhook_urls.add(url)
            targets.add(("WEBHOOK", url))
        else:
            targets.add((kind, json.dumps(value, sort_keys=True)[:80]))
    return {
        "notifications": len(notifications),
        "by_type": dict(by_type),
        "distinct_targets": len(targets),
        "email_recipient_sets": len(email_sets),
        "webhook_endpoints": len(webhook_urls),
    }


# --------------------------------------------------- Stage 5: consumer census

def consumer_census(zones_by_id, profiles, notifications, metric_events):
    """Per-zone consumer counts: MZ-bound profiles + their notification chains."""
    consumers = defaultdict(lambda: {"profiles": 0, "notifications": 0,
                                     "metric_events": 0})
    profile_zone = {}
    for item in profiles or []:
        value = item.get("value", {})
        mz = value.get("managementZone")
        if mz and mz in zones_by_id:
            profile_zone[item.get("objectId")] = mz
            consumers[mz]["profiles"] += 1
    for item in notifications or []:
        profile = (item.get("value") or {}).get("alertingProfile")
        mz = profile_zone.get(profile)
        if mz:
            consumers[mz]["notifications"] += 1
    for item in metric_events or []:
        blob = json.dumps(item.get("value", {}))
        if "managementZone" in blob:
            for mz in zones_by_id:
                if mz in blob:
                    consumers[mz]["metric_events"] += 1
    return consumers


# ----------------------------- Stage 5b: which job is each zone doing?
#
# A management zone does up to three distinct jobs, and they migrate to three
# different places. Picking the wrong target "produces either a security gap
# or a lot of unnecessary IAM work" (MZ2POL-05 s1):
#
#   restrict who may READ    -> IAM policy + boundary on dt.security_context
#   scope what a user SEES   -> segment
#   decide who gets PAGED    -> problem-triggered workflow
#
# The heuristic: if removing the zone would let someone see data they are not
# allowed to see, it is doing the access job; if it would only make dashboards
# noisy, it is doing the filter job. Estates hold far more of the second kind
# than teams expect - which is exactly why the plan must not treat every zone
# as a segment to build.

def zone_access_bindings(groups):
    """Zone ids/names referenced by an IAM group's permissions.

    Returns None when the group surface was not readable (A19 commonly 403s or
    requires a search term). None is NOT "no bindings" - it means the access
    job could not be measured, and the caller must say so rather than defaulting
    every zone to the filter job. Replacing an access-bearing zone with a
    segment alone is a security regression, so this distinction is load-bearing.
    """
    if not groups:
        return None
    bound = set()
    for group in groups:
        blob = json.dumps(group)
        for match in re.finditer(r'"managementZone(?:Id)?"\s*:\s*"?([^",}]+)',
                                 blob):
            bound.add(match.group(1).strip())
    return bound


def zone_jobs(zone, access_bound, classic_roles_present=None):
    """Classify one zone by the jobs it is doing -> its migration targets.

    When A19 (IAM groups) is unreadable, B47's platform IAM-readiness snapshot
    is a SECOND, INDEPENDENT read of group permissions. It proves whether
    classic role bindings exist at all - it does NOT say which zones they
    scope. So it upgrades the verdict from "unknown" to "classic roles present,
    scope unresolved", which is measured and nameable; it never releases a
    retirement. Retirements stay blocked in both cases.
    """
    jobs = []
    if (zone.get("consumers") or {}).get("profiles"):
        jobs.append("alerting")
    if access_bound is None:
        jobs.append("access-classic-roles-present" if classic_roles_present
                    else "access-unknown")
    elif zone["id"] in access_bound or zone["name"] in access_bound:
        jobs.append("access")
    if zone.get("population") or not jobs:
        jobs.append("filter")
    return jobs


JOB_TARGETS = {
    "access": "IAM policy + boundary on dt.security_context",
    "access-unknown": "access binding not readable - verify before retiring",
    # Reaches the customer-facing table verbatim, so it names the finding, not
    # the probe that produced it (CLAUDE.md: no probe IDs in external copy).
    "access-classic-roles-present": ("classic role bindings confirmed present; "
                                     "zone scope unresolved - verify before "
                                     "retiring"),
    "filter": "Segment",
    "alerting": "Problem-triggered workflow",
}


# ------------------------- Stage 6: zone effectiveness + consolidation
#
# The stage that stops the plan being a 1:1 port. A zone earns a place in the
# target model only if it is populated, consumed, and carries a dimension some
# other zone does not already carry. Everything else either disappears or
# collapses into a variable on a shared segment.

# Past this many proposed segments the design is converting values rather than
# dimensions (MZ2POL-05 s2: "usually three to eight"; ORGNZ-10 s5).
SEGMENT_SPRAWL_GATE = 8


def zone_effectiveness(zones, population_collected, query_window=None):
    """Judge every zone, then project how many segments actually replace them.

    Sets zone["effectiveness"] in place and returns the estate rollup. The
    value-of-dimension family is the important one: N zones that differ only
    in the VALUE of a shared dimension are ONE segment with a variable, so
    they must never be counted as N migrations.
    """
    by_signature = defaultdict(list)
    for zone in zones:
        by_signature[tuple(sorted(zone["dimensions"]))].append(zone)

    verdicts = defaultdict(int)
    for zone in zones:
        dims = zone["dimensions"]
        pop, consumers = zone.get("population"), zone.get("consumers") or {}
        consumed = any(consumers.values())
        family = by_signature[tuple(sorted(dims))]
        if not dims:
            verdict = "hygiene-only" if zone.get("hygiene") else "no-dimension"
        elif population_collected and pop == 0:
            # Absence from the census IS the measurement once B37 has run.
            verdict = "dead"
        elif population_collected and pop and not consumed:
            # B42: a populated, consumer-less zone that is still being QUERIED
            # is not unused - something outside the config-side census (a
            # classic dashboard filter, an external integration passing a zone
            # parameter) is using it. Retiring it on the old proxy would have
            # broken that consumer silently.
            queries = zone.get("query_count")
            verdict = "effective" if queries else "unused"
        elif len(family) > 1:
            # Same dimension signature as at least one other zone: the family
            # is one segment with a variable, not len(family) migrations.
            verdict = "value-of-dimension"
        else:
            verdict = "effective"
        zone["effectiveness"] = verdict
        verdicts[verdict] += 1

    # What actually gets built: one segment per distinct dimension carried by
    # a zone worth keeping. Dead/unused/hygiene zones contribute nothing.
    keep = [z for z in zones
            if z["effectiveness"] in ("effective", "value-of-dimension")]
    proposed = sorted({d for z in keep for d in z["dimensions"]})
    families = {sig: len(members)
                for sig, members in by_signature.items()
                if len(members) > 1 and sig}
    return {
        "verdicts": dict(verdicts),
        "zones_worth_keeping": len(keep),
        "proposed_segments": len(proposed),
        "proposed_dimensions": proposed,
        "largest_value_family": max(families.values(), default=0),
        "value_families": len(families),
        "sprawl_warning": len(proposed) > SEGMENT_SPRAWL_GATE,
        "population_measured": population_collected,
        "query_activity_measured": query_window is not None,
        "query_activity_window": query_window,
        "queried_no_consumers": sum(
            1 for z in zones
            if z.get("query_count") and not any(
                (z.get("consumers") or {}).values())),
    }


# ----------------------------------------------------------- Stage 4 + rollup

def dispose(zone, coverage, consumers, population, query_measured=False):
    """Assign the spec's four-bucket disposition for one zone.

    `query_measured` says B42 ran, which changes one answer materially. Before
    B42 there was no way to tell a populated-but-unwanted zone from a
    populated-and-relied-on one, so anything populated and uncovered fell to
    "build-then-retire" — build a segment, then retire the zone. That was the
    safe default when usage was unknowable.

    It is now knowable, and the default is wrong: a zone that is populated, has
    no consumers AND shows no query activity is one nobody looks at. Building a
    segment for it is pure waste — the correct move is to retire it. Live on a
    54-zone estate this changed 32 of 42 build-then-retire rows, cutting the
    proposed build work by roughly three quarters.

    The HARD RULE is unaffected: every retire disposition stays conditional on
    the access check, because a zone nobody QUERIES may still GRANT something.
    """
    covered = zone["dimensions"] and all(
        coverage.get(d, "uncovered") in ("covered", "bridged")
        for d in zone["dimensions"])
    has_consumers = any(consumers.values())
    if population is None:  # B37 not yet collected - provisional plan
        if not zone["dimensions"] and not has_consumers:
            return "investigate"
        if covered and not has_consumers:
            return "retire-now (pending B37 population check)"
        return ("retire-after-cutover" if covered else "build-then-retire") \
            + " (pending B37)"
    populated = population > 0
    if not populated and not has_consumers:
        return "retire-now"
    if populated and not zone["dimensions"]:
        return "investigate"  # matches entities but no discernible dimension
    if covered:
        return "retire-after-cutover" if has_consumers else "retire-now"
    if populated:
        # Populated, uncovered, no consumers, and — where B42 ran — no queries
        # either. Nobody is using it; do not build a segment to replace it.
        if query_measured and not has_consumers and not zone.get("query_count"):
            return "retire-now (unused — no consumers, no query activity)"
        return "build-then-retire"
    return "investigate"


def analyze(run_dir: Path):
    reset_probe_diagnostics()
    zones_raw = load_probe(run_dir, "zones")
    segments_raw = load_probe(run_dir, "segments")
    if zones_raw is None:
        sys.exit(f"no zone probe (A17) found in {run_dir}")

    # Stage 1
    zones, zones_by_id = [], {}
    for item in zones_raw:
        value = item.get("value", {})
        dims, hygiene, refinements = zone_dimensions(value)
        zone = {"id": item.get("objectId"), "name": value.get("name"),
                "dimensions": sorted(dims), "hygiene": sorted(hygiene),
                "refinements": sorted(refinements),
                "blockers": zone_blockers(value)}
        zones.append(zone)
        zones_by_id[zone["id"]] = zone

    # Stage 2
    segments = []
    for seg in segments_raw or []:
        kind, covers = classify_segment(seg)
        segments.append({"name": seg.get("name"), "kind": kind,
                         "covers": sorted(covers)})

    # Stage 3 - coverage state per dimension seen in any zone
    dim_zone_count = defaultdict(int)
    for zone in zones:
        for dim in zone["dimensions"]:
            dim_zone_count[dim] += 1
    coverage = {}
    for dim in dim_zone_count:
        state = "uncovered"
        for seg in segments:
            if dim in seg["covers"] or (
                    dim.startswith("name:HOST_GROUP") and "host-group" in seg["covers"]):
                state = "covered" if seg["kind"] == "native-dimension" else "bridged"
                if state == "covered":
                    break
        # host-group name patterns ride the host-group entity dimension
        if dim == "host-group" or dim.startswith("name:HOST_GROUP"):
            if any("host-group" in s["covers"] and s["kind"] == "native-dimension"
                   for s in segments):
                state = "covered"
        coverage[dim] = state

    # Stage 4 (optional)
    population = {}
    unzoned_entities = None
    unzoned_breakdown = {}
    pop_raw = load_probe(run_dir, "population")
    pop_collected = pop_raw is not None
    if pop_raw is not None:
        for row in pop_raw:
            mz = row.get("mz") or row.get("managementZones")
            count = sum(int(row.get(k) or 0)
                        for k in ("Hosts", "PGs", "Services"))
            if mz:  # dtctl records carry counts as strings; a null mz row
                population[mz] = count  # = unzoned entities
            else:
                unzoned_entities = count
                unzoned_breakdown = {
                    "hosts": int(row.get("Hosts") or 0),
                    "process_groups": int(row.get("PGs") or 0),
                    "services": int(row.get("Services") or 0),
                }

    # Stage 4b (optional) - B42 zone query activity. The platform's own
    # per-zone query counter; keyed by zone NAME to match B37/A17. Absent =>
    # "unused" stays a proxy and the report says so.
    zone_queries, query_window = {}, None
    q_raw = load_probe(run_dir, "zone_queries")
    if q_raw is not None:
        # The probe RAN. A zero-row result is a measurement ("no zone was
        # queried in the window"), not an absent probe -- on a zero-zone tenant
        # it is the expected result, and reporting it as "not collected" would
        # understate a measured fact in a client document.
        for row in q_raw:
            name = (row.get("dt.management_zone.name")
                    or row.get("Management Zone") or row.get("name"))
            if not name:
                continue
            try:
                zone_queries[name] = int(float(row.get("total") or 0))
            except (TypeError, ValueError):
                zone_queries[name] = 0
            query_window = query_window or row.get("window")
        # B42 is specified at from:-7d in the probe catalog; the records
        # envelope carries no window field, so name the probe's fixed window
        # rather than emitting a vague placeholder. The SKILL requires the
        # window be stated next to every "unused" verdict -- "no query
        # activity in the probe window" tells a reader nothing.
        #
        # This default is set AFTER the loop, and only if no row supplied a
        # window. It used to be seeded with "the last 30 days" BEFORE the loop,
        # which made the `or` below dead code and stated a 30-day window over a
        # 7-day probe in every delivered plan -- overstating the evidence behind
        # every "no query activity" verdict by more than 4x (found 2026-08-26).
        # A zero-row result still lands here: the probe ran, and its window is
        # the probe's window.
        query_window = query_window or "the last 7 days"

    # Stage 1b - tag provenance (the tagging-at-source foundation)
    auto_tag_names = {(i.get("value") or {}).get("name")
                      for i in load_probe(run_dir, "auto_tags") or []}
    classic_keys = {r.get("key") for r in
                    load_probe(run_dir, "classic_tag_keys") or [] if r.get("key")}
    b38_raw = load_probe(run_dir, "source_tags")
    propagation, fleet = None, 0
    if b38_raw:
        propagation = {k: int(v) for k, v in b38_raw[0].items()
                       if k != "hosts" and v is not None}
        fleet = int(b38_raw[0].get("hosts") or 0)
    provenance = tag_provenance(
        {d: n for d, n in dim_zone_count.items() if d.startswith("tag:")},
        auto_tag_names, classic_keys, propagation, fleet)

    # Stage 1c - auto-tag RULE disposition. Stage 1b covers the keys a zone
    # filters on; this covers every rule on the tenant, most of which no zone
    # references. Loaded here (not in Stage 5) because the consumer census
    # spans surfaces Stage 5 does not read - notably alerting profiles bound
    # by `tagFilter` rather than by managementZone.
    auto_tag_objs = load_probe(run_dir, "auto_tags")
    tag_consumers, tag_surfaces, tag_text = tag_consumer_census(
        load_probe(run_dir, "zones"),
        load_probe(run_dir, "profiles"),
        load_probe(run_dir, "metric_events"),
        load_probe(run_dir, "maintenance_windows"),
        load_probe(run_dir, "segments"),
        load_probe(run_dir, "dashboards"),
        load_probe(run_dir, "workflows"),
        classic_dashboard_filters(run_dir),
        known_keys={(o.get("value") or {}).get("name")
                    for o in auto_tag_objs or []})
    # A key seen ONLY on a text-scanned surface carries a weaker evidence
    # grade than one read from a structured filter field, and the record says
    # so rather than presenting both as the same measurement.
    text_only = {k for k, c in tag_consumers.items()
                 if not any(c.get(s) for s in STRUCTURED_SURFACES)}
    widen_text_index(tag_text, run_dir, ("notifications", "ownership_teams",
                                        "groups"))
    autotags = autotag_disposition(auto_tag_objs, tag_consumers, tag_surfaces,
                                   propagation, fleet, text_only, tag_text)
    autotag_summary = autotag_rollup(autotags, tag_surfaces)
    # Usage of the surface the census could not read. Only meaningful while
    # classic dashboards are unread: it turns "a tag used only by a classic
    # dashboard would be on the retire list" from a caveat into a worklist.
    if autotag_summary and "classic_dashboards" not in tag_surfaces["read"]:
        usage = load_probe(run_dir, "classic_dashboard_usage")
        if usage:
            def _n(row, key):
                try:
                    return int(row.get(key) or 0)
                except (TypeError, ValueError):
                    return 0
            autotag_summary["classic_dashboard_usage"] = {
                "dashboards": len(usage),
                "opens": sum(_n(r, "opens") for r in usage),
                "max_users_on_one": max((_n(r, "users") for r in usage),
                                        default=0),
                "busiest": [
                    {"id": r.get("details.page_dashboard_id"),
                     "opens": _n(r, "opens"), "users": _n(r, "users")}
                    for r in usage[:20]],
            }

    # Stage 5 + architecture inputs
    notifications = load_probe(run_dir, "notifications")
    consumers = consumer_census(zones_by_id, load_probe(run_dir, "profiles"),
                                notifications,
                                load_probe(run_dir, "metric_events"))
    delivery = delivery_consolidation(notifications)
    grail_buckets = bucket_posture(load_probe(run_dir, "buckets"))
    gaps = alerting_gaps(load_probe(run_dir, "profiles"), notifications)

    # Disposition + rollups
    for zone in zones:
        zone["consumers"] = dict(consumers.get(zone["id"], {}))
        # Once the census ran, absence from it IS the measurement: zero
        # population - only a missing B37 makes population unknown.
        pop = population.get(zone["name"], 0) if population else None
        zone["population"] = pop
        # None (not 0) when B42 was not collected - the verdict logic keys on
        # falsy-vs-measured, so an absent probe must never read as "0 queries".
        zone["query_count"] = (zone_queries.get(zone["name"], 0)
                               if query_window else None)
        zone["disposition"] = dispose(zone, coverage,
                                      zone["consumers"] or {}, pop,
                                      query_measured=query_window is not None)

    # Stage 5b - job classification. Runs after population + consumers are
    # attached; both feed the verdict.
    access_bound = zone_access_bindings(load_probe(run_dir, "groups"))
    # B47 - the platform's daily IAM-readiness snapshot. Only consulted when
    # A19 is unreadable, and only ever to say "classic role bindings exist",
    # never to resolve which zone a binding scopes.
    classic_roles_present = None
    iam_raw = load_probe(run_dir, "iam_readiness")
    if iam_raw:
        try:
            classic_roles_present = int(
                float(iam_raw[0].get("classic_groups") or 0)) > 0
        except (TypeError, ValueError):
            classic_roles_present = None
    job_rollup = defaultdict(int)
    for zone in zones:
        zone["jobs"] = zone_jobs(zone, access_bound, classic_roles_present)
        for job in zone["jobs"]:
            job_rollup[job] += 1
    # Corroborating context for the access job's TARGET surface (never a
    # substitute for the IAM read): share of entities already carrying
    # dt.security_context (B30, reused tenant-eval cache). 0% means the
    # policy boundary the access job migrates onto does not exist yet -
    # which raises the stakes on verifying zone bindings, since zones are
    # then the ONLY access mechanism in place.
    sec_ctx_pct = None
    enrich = load_probe(run_dir, "enrichment")
    if enrich:
        row = enrich[0]
        for key in ("sec_pct", "security_context_pct"):
            if row.get(key) is not None:
                try:
                    sec_ctx_pct = float(row[key])
                except (TypeError, ValueError):
                    pass
                break

    # Stage 6 - effectiveness runs AFTER population + consumers are attached,
    # since both are inputs to the verdict.
    effectiveness = zone_effectiveness(zones, pop_collected, query_window)

    # Estate-level blocker rollup: which constraints are in play, and where.
    blocker_rollup = defaultdict(list)
    for zone in zones:
        for code in zone["blockers"]:
            blocker_rollup[code].append(zone["name"])
    # A tag dimension that is not one of the three derived-data keys cannot
    # follow the data into service metrics - a segment built on it filters
    # logs and spans correctly and can come back empty on metrics.
    derived_risk = sorted({d for z in zones for d in z["dimensions"]
                           if d.startswith("tag:")
                           and d.split(":", 1)[1] not in DERIVED_DATA_KEYS})
    # Zones with alerting consumers were giving someone a filtered problem
    # view; the replacing segment needs an events include or the problem feed
    # will not filter at all.
    problem_view_zones = sorted(z["name"] for z in zones
                                if (z.get("consumers") or {}).get("profiles"))

    buckets = defaultdict(int)
    # Zone-weighted coverage (population-weighted once B37 is joined): a zone
    # counts as covered when every dimension it scopes on is covered/bridged.
    # Unweighted per-dimension % would let a long tail of one-zone tag keys
    # drown the estate's real shape.
    def coverage_rollup(weight_of):
        states = defaultdict(int)
        for zone in zones:
            weight = weight_of(zone)
            if not zone["dimensions"]:
                states["no-dimension"] += weight
                continue
            seen = {coverage[d] for d in zone["dimensions"]}
            if seen <= {"covered"}:
                states["covered"] += weight
            elif seen <= {"covered", "bridged"}:
                states["bridged"] += weight
            else:
                states["uncovered"] += weight
        scoped = max(sum(v for k, v in states.items() if k != "no-dimension"), 1)
        return {
            "pct": round(100 * (states["covered"] + states["bridged"]) / scoped),
            "pct_native_only": round(100 * states["covered"] / scoped),
            "states": dict(states),
        }

    for zone in zones:
        buckets[zone["disposition"]] += 1
    # Two coverage bases, both reported: by zone count ("how many zones are
    # ready") and by population ("how many scoped entities are") - on real
    # estates a few uncovered mega-zones make these diverge sharply, and the
    # divergence itself is a finding.
    by_zone = coverage_rollup(lambda z: 1)
    by_population = (coverage_rollup(lambda z: z["population"] or 0)
                     if population else None)
    # CEILING CHECK (CLAUDE.md): the population base is zone MEMBERSHIPS, not
    # distinct entities - `managementZones` is an array, so an entity in three
    # zones contributes three times and the base routinely exceeds the estate's
    # entity count. B30's entity total is the physical ceiling; the ratio
    # between them is the estate's zone-overlap factor, which is itself a
    # finding (heavy overlap is the strongest argument that the target model is
    # not one-segment-per-zone). Reported so the % is never labelled a share of
    # entities.
    population_base = None
    if population:
        memberships = sum(population.values())
        entities = None
        enrich = load_probe(run_dir, "enrichment")
        if enrich:
            entities = int(enrich[0].get("total") or 0) or None
        population_base = {
            "unit": "zone memberships",
            "memberships": memberships,
            "unzoned_entities": unzoned_entities,
            "entity_ceiling": entities,
            "overlap_factor": (round(memberships / entities, 2)
                               if entities else None),
            "zones_with_population": len(population),
        }
    total_consumers = sum(sum(c.values()) for c in consumers.values())

    return {
        "zones_total": len(zones),
        "segments": segments,
        "dimension_coverage": {
            dim: {"state": coverage[dim], "zones": dim_zone_count[dim]}
            for dim in sorted(dim_zone_count, key=dim_zone_count.get,
                              reverse=True)},
        "coverage_by_zone_count": by_zone,
        "coverage_by_population": by_population,
        # Run-directory defects found while loading (stray files
        # ignored, ambiguous matches). Empty on a clean run.
        "probe_diagnostics": probe_diagnostics(),
        "population_base": population_base,
        "tag_provenance": provenance,
        "auto_tags": autotags,
        "auto_tag_summary": autotag_summary,
        "b38_collected": propagation is not None,
        # Fleet size behind the propagation census, so the report can
        # quote "N of M hosts" instead of a qualitative "a handful".
        "propagation": ({"hosts": fleet} if propagation is not None
                        else None),
        "effectiveness": effectiveness,
        "jobs": {
            "counts": dict(job_rollup),
            "access_measured": access_bound is not None,
            "classic_roles_present": classic_roles_present,
            "security_context_entity_pct": sec_ctx_pct,
            "targets": JOB_TARGETS,
        },
        "conversion_blockers": {
            "exclusion_zones": blocker_rollup.get("exclusion", []),
            "substring_match_zones": blocker_rollup.get("substring-match", []),
            "derived_data_dimensions": derived_risk,
            "problem_view_zones": problem_view_zones,
        },
        "alerting_gaps": gaps,
        "delivery_consolidation": delivery,
        "bucket_posture": grail_buckets,
        "consumers_to_rehome": total_consumers,
        "b37_collected": pop_collected,
        "unzoned_entities": unzoned_entities,
        "unzoned_breakdown": unzoned_breakdown,
        "dispositions": dict(buckets),
        "zones": zones,
    }


def to_markdown(report: dict) -> str:
    lines = ["# MZ -> Segments disposition summary", ""]
    lines.append(f"- Zones: **{report['zones_total']}**")
    bz = report["coverage_by_zone_count"]
    lines.append(f"- Dimensional coverage by zone count: **{bz['pct']}%** "
                 f"({bz['pct_native_only']}% native; remainder bridged)")
    bp = report["coverage_by_population"]
    if bp:
        lines.append(f"- Dimensional coverage by population: **{bp['pct']}%** "
                     f"({bp['pct_native_only']}% native) - divergence from the "
                     "zone-count figure means the biggest zones are the "
                     "uncovered ones")
    lines.append(f"- Consumers to rehome: **{report['consumers_to_rehome']}**")
    lines.append(f"- Population census (B37): "
                 f"{'joined' if report['b37_collected'] else 'NOT collected - dispositions provisional'}")
    eff = report.get("effectiveness")
    if eff:
        lines += ["", "## Zone effectiveness - the migration is NOT 1:1", ""]
        v = eff["verdicts"]
        n_seg = eff["proposed_segments"]
        lines.append(f"- {report['zones_total']} zones -> "
                     f"**{eff['zones_worth_keeping']} worth keeping** -> "
                     f"**{n_seg} segment{'' if n_seg == 1 else 's'}** "
                     "(one per dimension, values become variables)")
        for verdict in ("effective", "value-of-dimension", "unused", "dead",
                        "hygiene-only", "no-dimension"):
            if v.get(verdict):
                lines.append(f"  - {verdict}: **{v[verdict]}**")
        if eff["value_families"]:
            lines.append(f"- {eff['value_families']} value-families collapse "
                         f"into one segment each (largest holds "
                         f"{eff['largest_value_family']} zones)")
        if eff["sprawl_warning"]:
            lines.append(f"- **Segment sprawl warning**: "
                         f"{eff['proposed_segments']} proposed segments exceeds "
                         f"the ~{SEGMENT_SPRAWL_GATE} guideline - the design is "
                         "converting values instead of dimensions; revisit "
                         "before authoring")
        if not eff["population_measured"]:
            lines.append("- Population not collected: dead/unused verdicts "
                         "cannot be assigned, so this is a floor, not a total")
        if eff.get("query_activity_measured"):
            window = eff.get("query_activity_window") or "the probe window"
            lines.append(f"- Zone *query activity* measured over {window} "
                         "(B42): an 'unused' verdict means no queries were "
                         "observed in that window, not that the zone is "
                         "unused in the abstract - a zone serving a quarterly "
                         "review reads silent on a short window")
        else:
            lines.append("- Zone *query activity* not collected this run (B42 "
                         "absent): population and consumers are the only "
                         "evidence for 'is anyone using this', so an 'unused' "
                         "verdict is a proxy, not a measurement")
    jobs = report.get("jobs")
    if jobs:
        lines += ["", "## Which job is each zone doing?", ""]
        for job, count in sorted(jobs["counts"].items(), key=lambda kv: -kv[1]):
            lines.append(f"- {job}: **{count}** -> {jobs['targets'][job]}")
        if not jobs["access_measured"]:
            lines.append("- **IAM group bindings were not readable**, so the "
                         "access job could not be measured. Do NOT retire a "
                         "zone on the assumption it is filter-only: replacing "
                         "an access-bearing zone with a segment alone is a "
                         "security regression (a segment changes what is "
                         "shown, never what is permitted)")
            if jobs.get("classic_roles_present"):
                lines.append("- The platform IAM-readiness snapshot (B47) "
                             "confirms groups **are** still bound to classic "
                             "RBAC roles. That makes the access job measured "
                             "in existence but unresolved in scope - it does "
                             "not say which zones those bindings cover, so "
                             "every retirement stays blocked until the "
                             "bindings are read directly")
            elif jobs.get("classic_roles_present") is False:
                lines.append("- The platform IAM-readiness snapshot (B47) "
                             "shows **no** groups on classic RBAC roles, "
                             "which lowers - but does not eliminate - the "
                             "likelihood that these zones carry an access "
                             "job. Verify directly before retiring")
        sec_pct = jobs.get("security_context_entity_pct")
        if sec_pct is not None:
            lines.append(
                f"- Corroborating context (B30): **{sec_pct:g}%** of entities "
                "carry dt.security_context"
                + (" - the policy boundary the access job migrates onto does "
                   "not exist yet, so zones are currently the ONLY access "
                   "mechanism; verify bindings before ANY retirement"
                   if sec_pct == 0 else
                   " - the security-context boundary is partially "
                   "established; align zone access migration with it"))
    lines += ["", "## Dispositions", ""]
    for bucket, count in sorted(report["dispositions"].items(),
                                key=lambda kv: -kv[1]):
        lines.append(f"- {bucket}: **{count}**")
    cb = report.get("conversion_blockers") or {}
    if any(cb.values()):
        lines += ["", "## Conversion blockers (constraints, not preferences)", ""]
        if cb.get("exclusion_zones"):
            lines.append(f"- **Exclusion-shaped: {len(cb['exclusion_zones'])} "
                         "zones** - segments cannot express exclusions; each "
                         "must be restated positively")
        if cb.get("substring_match_zones"):
            lines.append(f"- **Substring matching: "
                         f"{len(cb['substring_match_zones'])} zones** - segment "
                         "includes offer = and in() only; on classic entities "
                         "only entity.name takes a starts-with wildcard")
        if cb.get("derived_data_dimensions"):
            lines.append(f"- **Derived-data gap: "
                         f"{len(cb['derived_data_dimensions'])} tag dimensions** "
                         "- only dt.security_context / dt.cost.costcenter / "
                         "dt.cost.product reach service metrics, so these "
                         "segments can filter logs and spans correctly and "
                         "return empty on metrics")
        if cb.get("problem_view_zones"):
            lines.append(f"- **Problem views: {len(cb['problem_view_zones'])} "
                         "zones** - the replacing segment needs an events "
                         'include on event.kind = "DAVIS_PROBLEM"; entity '
                         "includes alone do not filter the problem feed")
    gaps = report.get("alerting_gaps") or {}
    if gaps.get("delay_dependent_profiles") or gaps.get("connectorless_notifications"):
        lines += ["", "## Alerting capability gaps (documented dead ends)", ""]
        delayed = gaps.get("delay_dependent_profiles") or []
        if delayed:
            lines.append(f"- **{len(delayed)} delay-dependent profiles** "
                         "(duration filter) - no successor exists in the "
                         "workflow model; sequence these LAST and tell the "
                         "on-call teams before cutover, not after")
        for kind, count in sorted((gaps.get("connectorless_notifications") or {}).items()):
            lines.append(f"- **{count} {kind} notifications** - no native "
                         "connector; migrates to a generic HTTP request")
    dc = report.get("delivery_consolidation")
    if dc:
        lines += ["", "## Alerting delivery consolidation (never migrate 1:1)", ""]
        lines.append(f"- {dc['notifications']} classic notifications "
                     f"({', '.join(f'{n} {t}' for t, n in sorted(dc['by_type'].items(), key=lambda kv: -kv[1]))}) "
                     f"-> **{dc['distinct_targets']} distinct delivery targets**")
        lines.append(f"- {dc['by_type'].get('EMAIL', 0)} email notifications -> "
                     f"{dc['email_recipient_sets']} recipient sets; "
                     f"{dc['by_type'].get('WEBHOOK', 0)} webhooks -> "
                     f"{dc['webhook_endpoints']} endpoint(s) - each endpoint is "
                     "ONE parameterized workflow, not N copies")
    bp = report.get("bucket_posture")
    if bp:
        lines += ["", "## Bucket posture (storage layer of the target architecture)", ""]
        lines.append(f"- {bp['total']} buckets, **{bp['custom']} custom** "
                     f"({bp['custom_log_buckets']} custom log buckets)")
        if bp["custom"] < 5:
            lines.append("- Effectively default-only: no retention "
                         "differentiation, no bucket-level access boundaries, "
                         "no query-scan pruning - candidate for bucket design "
                         "alongside the segment rollout")
    if report["tag_provenance"]:
        lines += ["", "## Tag provenance (the tagging-at-source worklist)", ""]
        order = {"source-propagated": 0, "context-imported": 1}
        for dim, e in sorted(report["tag_provenance"].items(),
                             key=lambda kv: (order.get(kv[1]["provenance"], 2),
                                             -kv[1]["zones"])):
            extra = (f", {e['propagated_hosts']} hosts"
                     if "propagated_hosts" in e else "")
            lines.append(f"- `{dim}` ({e['zones']} zones{extra}) - "
                         f"**{e['provenance']}** - {e['path']}")
    summary = report.get("auto_tag_summary")
    if summary:
        lines += ["", "## Classic auto-tagging rules (Stage 1c - rule disposition)", ""]
        lines.append(f"- **{summary['rules_total']}** classic auto-tagging "
                     "rules on the tenant. Surfaces read for consumers: "
                     + (", ".join(summary["surfaces_read"]) or "none")
                     + (" · returned no tag-bearing content: "
                        + ", ".join(summary["surfaces_inconclusive"])
                        if summary.get("surfaces_inconclusive") else ""))
        for verdict in ("no-measured-consumer", "already-sourced",
                        "blocked-on-tag", "native-field", "re-source",
                        "verify-live"):
            if summary["verdicts"].get(verdict):
                lines.append(f"  - {verdict}: **{summary['verdicts'][verdict]}**")
        if summary["hazards"]:
            lines.append("- Mechanics with no segment equivalent: "
                         + ", ".join(f"{k} ({v})" for k, v
                                     in sorted(summary["hazards"].items())))
        roots = [r for r in summary["cascade_roots"] if r["dependent_rules"] > 1]
        if roots:
            lines += ["", "### Dependency cascade - re-source these keys FIRST", ""]
            for root in roots[:8]:
                state = ("source-propagated"
                         if root["sourced"] else "NOT propagated at source")
                lines.append(f"- `{root['key']}` - **{root['dependent_rules']} "
                             f"rules** chain on it - {state} "
                             f"({root['self_verdict']})")
            lines.append("  Retiring or failing to re-source one of these "
                         "silently empties every rule that reads it, and the "
                         "consumers of those rules with it.")
        if summary.get("resolution_layers"):
            lines += ["", "### Re-sourcing order (dependency layers)", ""]
            for layer in summary["resolution_layers"][:6]:
                head = ", ".join(f"`{k}`" for k in layer["keys"][:6])
                more = ("" if layer["rules"] <= 6
                        else f" (+{layer['rules'] - 6} more)")
                lines.append(f"- Layer {layer['layer']}: "
                             f"**{layer['rules']} "
                             f"rule{'' if layer['rules'] == 1 else 's'}** - "
                             f"{head}{more}")
            extra = len(summary["resolution_layers"]) - 6
            if extra > 0:
                lines.append(f"- ...and {extra} further layers")
        if summary.get("dependency_cycles"):
            lines.append(f"- **{len(summary['dependency_cycles'])} rules sit "
                         "in a dependency cycle** and have no valid ordering - "
                         "someone has to choose which becomes the source of "
                         "truth: "
                         + ", ".join(f"`{k}`" for k
                                     in summary["dependency_cycles"][:6]))
    ats = report.get("auto_tags") or {}
    if ats:
        lines += ["", "### Auto-tag rules by consumer weight", ""]
        for key, rec in sorted(ats.items(),
                               key=lambda kv: (-kv[1]["consumers_total"],
                                               kv[0]))[:25]:
            used = ", ".join(f"{n} {s}" for s, n
                             in sorted(rec["consumers"].items())) or "no consumer found"
            haz = (" [" + ", ".join(rec["hazards"]) + "]") if rec["hazards"] else ""
            plural = "" if rec["clauses"] == 1 else "s"
            lines.append(f"- `{key}` ({rec['clauses']} clause{plural}; {used}) - "
                         f"**{rec['verdict']}**{haz} - {rec['path']}")
    lines += ["", "## Dimension map (zones per dimension)", ""]
    for dim, info in report["dimension_coverage"].items():
        lines.append(f"- `{dim}` - {info['zones']} zones - {info['state']}")
    lines += ["", "## Segments", ""]
    for seg in report["segments"]:
        covers = ", ".join(seg["covers"]) or "-"
        lines.append(f"- {seg['name']} ({seg['kind']}) -> {covers}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--json", type=Path, help="write full report JSON")
    parser.add_argument("--md", type=Path, help="write markdown summary")
    args = parser.parse_args()

    try:
        report = analyze(args.run_dir)
    except ProbeFileError as exc:
        # A run-directory defect, not a stack trace worth reading. The message
        # already names the files and what to do about them.
        sys.exit(f"ERROR: {exc}")
    if args.json:
        args.json.write_text(json.dumps(report, indent=2))
    markdown = to_markdown(report)
    if args.md:
        args.md.write_text(markdown)
    print(markdown)


if __name__ == "__main__":
    main()
