#!/usr/bin/env python3
"""Measure a Dynatrace Managed estate from its configuration exports.

Input : a directory of per-environment configuration export .zip files
Output: a console report, an optional JSON result the report author reads, and
        an optional CSV inventory

Each .zip carries exportFile.tar.gz, which unpacks to a Monaco project:

    exportMetadata.json          environment name, uuid, cluster uuid, product version
    export/manifest.yaml
    export/project_<env-uuid>/
        <config-type>/
            config.yaml          Monaco declarations — REAL object names live here
            <id>.json            the payload; names are templated as {{.name}}

THE CORE TECHNIQUE — baseline subtraction. A raw object count is meaningless:
roughly 980 objects per environment are platform defaults that ship with every
tenant, so counting them makes a near-empty environment look substantial. For
each configuration type, the MINIMUM count across all environments is the
default floor; everything above that floor was built by a human. On the estate
this method was developed against, that turned ~7,900 raw objects into ~2,000
customer-built and showed that a single environment held about three quarters
of them — which reframed a nine-environment program as a one-environment
migration with a tail of shells.

    HARD PRECONDITION: >=3 environments. With one or two, the floor is
    indistinguishable from that environment's own content and the method is
    invalid. The gate is enforced, not advised (--allow-small-estate to
    override for inspection, which marks the result unusable for reporting).

Read-only. This tool never contacts a tenant and never writes to one.

Usage:
    analyze_export.py <export-dir> [--json out.json] [--csv out.csv]
                      [--scope-exclude test] [--allow-small-estate]
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import zipfile

#: Entity references appear as Monaco placeholders: id_SERVICE_1E02C49FB24C5A20
ENTITY_RX = re.compile(r"id_([A-Z][A-Z_]*?)_([A-F0-9]{16})\b")

#: Entity types Dynatrace actually defines. Used ONLY to FLAG an odd one, never
#: to drop it: Dynatrace adds entity types, and silently discarding a real one
#: would be a worse failure than surfacing an unfamiliar one for a human to
#: check. See `entity_refs` for the artifact that made this necessary.
KNOWN_ENTITY_TYPES = {
    "HOST", "HOST_GROUP", "PROCESS", "PROCESS_GROUP", "PROCESS_GROUP_INSTANCE",
    "SERVICE", "SERVICE_METHOD", "SERVICE_METHOD_GROUP", "SERVICE_INSTANCE",
    "APPLICATION", "APPLICATION_METHOD", "APPLICATION_METHOD_GROUP",
    "CUSTOM_APPLICATION", "MOBILE_APPLICATION", "DEVICE_APPLICATION_METHOD",
    "SYNTHETIC_TEST", "SYNTHETIC_TEST_STEP", "SYNTHETIC_LOCATION", "HTTP_CHECK",
    "HTTP_CHECK_STEP", "EXTERNAL_SYNTHETIC_TEST", "EXTERNAL_SYNTHETIC_TEST_STEP",
    "CUSTOM_DEVICE", "CUSTOM_DEVICE_GROUP", "MULTIPROTOCOL_MONITORED_ENTITY",
    "VCENTER", "VIRTUALMACHINE", "ESXI_HOST", "DATACENTER", "HYPERVISOR",
    "ENVIRONMENT", "ENVIRONMENT_ACTIVE_GATE", "DISK", "NETWORK_INTERFACE", "SWITCH",
    "CONTAINER_GROUP", "CONTAINER_GROUP_INSTANCE", "DOCKER_CONTAINER_GROUP",
    "KUBERNETES_CLUSTER", "KUBERNETES_NODE", "KUBERNETES_SERVICE",
    "CLOUD_APPLICATION", "CLOUD_APPLICATION_INSTANCE", "CLOUD_APPLICATION_NAMESPACE",
    "QUEUE", "QUEUE_INSTANCE", "RELATIONAL_DATABASE_SERVICE", "DYNAMO_DB_TABLE",
    "EC2_INSTANCE", "EBS_VOLUME", "ELASTIC_LOAD_BALANCER", "AUTO_SCALING_GROUP",
    "AWS_LAMBDA_FUNCTION", "AWS_APPLICATION_LOAD_BALANCER", "AWS_NETWORK_LOAD_BALANCER",
    "S3BUCKET", "SQS_QUEUE", "AZURE_VM", "AZURE_APP_SERVICE", "AZURE_FUNCTION_APP",
    "AZURE_SQL_DATABASE", "GCP_ZONE", "GOOGLE_COMPUTE_ENGINE", "OPENSTACK_VM",
    "GEOLOCATION", "GEOLOC_SITE", "SOFTWARE_COMPONENT", "OS",
}

#: Configuration types that are platform defaults in such volume they drown the
#: signal. Excluded ONLY from the disabled-object count, never from the baseline
#: arithmetic — see TRAP 4.
NOISE_TYPES = {"builtinoneagent.features", "builtinattribute-allow-list",
               "builtinmetric.metadata"}

#: Dashboard names that indicate an abandoned, cloned or personal artifact.
RETIRE_RX = re.compile(
    r"(-cloned|-OLD\b|\bold\b|\bcopy\b|\btest\b|\btemp\b|demo|\bpoc\b|sandbox"
    r"|deprecat|unused)", re.I)
PERSONAL_RX = re.compile(r"\b\w+'s\b", re.I)
DEFAULT_NAMES = {"home", "config", "dashboard"}

#: Types whose counts are reported individually because each one is a named
#: workstream in the migration, not just an object total.
TRACKED_TYPES = {
    "dashboards": "dashboard",
    "mgmt_zones": "builtinmanagement-zones",
    "alerting_profiles": "builtinalerting.profile",
    "pg_bound_settings": "builtinhost.process-groups.monitoring-state",
    "notifications": "builtinproblem.notifications",
}

MIN_ENVIRONMENTS = 3


class SmallEstateError(RuntimeError):
    """Fewer than MIN_ENVIRONMENTS exports — baseline subtraction is invalid."""


# ---------------------------------------------------------------- extraction --
def _safe_extract_tar(tar: tarfile.TarFile, dest: str) -> None:
    """Extract a tar without letting a crafted member escape `dest`.

    `filter="data"` is the right answer and arrived in Python 3.12. The original
    implementation fell back to a bare `extractall()` on older interpreters,
    which is exactly the unsafe path — an export zip is customer-supplied input
    and is not trusted here just because it came from a Dynatrace cluster.
    """
    try:
        tar.extractall(dest, filter="data")
        return
    except TypeError:
        pass  # < 3.12 — fall through to the manual check
    root = os.path.realpath(dest)
    for member in tar.getmembers():
        target = os.path.realpath(os.path.join(dest, member.name))
        if not (target == root or target.startswith(root + os.sep)):
            raise ValueError(f"refusing unsafe tar member path: {member.name!r}")
        if member.issym() or member.islnk():
            raise ValueError(f"refusing link member in export tar: {member.name!r}")
    tar.extractall(dest)


def extract(zip_dir: str, work: str) -> tuple[dict[str, str], list[list[str]]]:
    """Unpack every export zip. Returns ({label: project_root}, duplicate_groups)."""
    zips = sorted(f for f in os.listdir(zip_dir) if f.endswith(".zip"))
    if not zips:
        sys.exit(f"no .zip files in {zip_dir}")

    # TRAP 1 — exports are frequently re-downloaded and renamed rather than
    # re-run. Byte-identical zips mean you are analyzing ONE environment N
    # times, and every per-environment figure downstream is fiction. Six
    # byte-identical files were once presented as six environments.
    digests: dict[str, list[str]] = {}
    for z in zips:
        with open(os.path.join(zip_dir, z), "rb") as fh:
            digests.setdefault(hashlib.sha256(fh.read()).hexdigest(), []).append(z)
    duplicate_groups = [g for g in digests.values() if len(g) > 1]

    roots: dict[str, str] = {}
    for z in zips:
        label = re.sub(r"_configurationExport.*|\.zip$", "", z).lstrip("_")
        dest = os.path.join(work, label)
        os.makedirs(dest, exist_ok=True)
        with zipfile.ZipFile(os.path.join(zip_dir, z)) as zf:
            zf.extractall(dest)
        inner = os.path.join(dest, "exportFile.tar.gz")
        if os.path.exists(inner):
            with tarfile.open(inner) as tf:
                _safe_extract_tar(tf, os.path.join(dest, "x"))
        projects = [p for p in _list_dirs(os.path.join(dest, "x", "export"))
                    if os.path.basename(p).startswith("project_")]
        if projects:
            roots[label] = projects[0]
    return roots, duplicate_groups


def _list_dirs(path: str) -> list[str]:
    # TRAP 2 — glob.glob() silently skips dot-directories and returns zero
    # matches rather than an error. os.listdir never skips.
    return ([os.path.join(path, d) for d in sorted(os.listdir(path))]
            if os.path.isdir(path) else [])


def metadata(work: str, label: str) -> dict:
    with open(os.path.join(work, label, "x", "exportMetadata.json")) as fh:
        m = json.load(fh)
    env = m["environments"][0]
    return {"env_name": env["name"], "env_uuid": env["uuid"],
            "cluster_uuid": m.get("clusterUuid", ""),
            "product_version": m.get("productVersion", ""),
            "monaco_version": m.get("monacoVersion", "")}


# ------------------------------------------------------------------ counting --
def type_census(project: str) -> collections.Counter:
    c: collections.Counter = collections.Counter()
    for t in sorted(os.listdir(project)):
        d = os.path.join(project, t)
        if os.path.isdir(d):
            c[t] = len([f for f in os.listdir(d) if f.endswith(".json")])
    return c


def entity_refs(project: str) -> dict[str, set]:
    """Entities referenced by hard-coded ID, deduplicated, by entity type.

    TRAP 3 — every reference appears in BOTH config.yaml and the .json payload,
    so counting raw matches roughly doubles the figure. One environment read as
    135 hard-coded references when it actually held 28. Dedup on (type, id).

    Why it matters: a hard-coded entity ID is a migration defect. Every one of
    them breaks if entity IDs change at the move, which sizes a remediation
    workstream that is usually in nobody's plan. (Conditional on the cutover
    method — `oneagentctl --set-server` preserves entity IDs; only a reinstall
    breaks them. See m2s-source-errata.md E5.)

    TRAP 7 — MONACO MIS-SPLITS SOME REFERENCES, AND THE TYPE IS THE CASUALTY.
    Monaco's own ID extraction can match a trailing SUBSTRING of an entity ID
    and name the placeholder after it. A real export carried

        APPLICATION_MET{{ .extractedIDs.id_HOD_<16-hex> }}

    where the source text was `APPLICATION_METHOD-<16-hex>`: Monaco matched
    `HOD-<hex>`, leaving `APPLICATION_MET` as literal text and inventing an
    entity type called `HOD`. Reporting that faithfully is not good enough —
    "1 HOD entity reference" is unauditable, it dies at the first "which one?",
    and it HIDES the real fact, which is an APPLICATION_METHOD reference sitting
    in mangled dashboard markdown.

    So the TOTAL is unchanged (the reference is real; only its label is wrong)
    and the per-type breakdown is split: recognized types are reported as types,
    anything else is surfaced separately for a human to verify. The known set
    only ever flags — never drops — because Dynatrace adds entity types.
    """
    out: dict[str, set] = collections.defaultdict(set)
    for root, _, files in os.walk(project):
        for f in files:
            path = os.path.join(root, f)
            try:
                with open(path, encoding="utf-8", errors="ignore") as fh:
                    txt = fh.read()
            except OSError:
                continue
            for etype, eid in ENTITY_RX.findall(txt):
                out[etype].add(eid)
    return out


def disabled_objects(project: str) -> tuple[int, collections.Counter]:
    """Configuration objects explicitly switched off.

    TRAP 4 — builtinoneagent.features contributes roughly 2,000 disabled
    feature flags per environment. Those are platform defaults, not customer
    decisions. Including them inflated one headline from 346 to 2,320: an
    order-of-magnitude error in the direction that makes the finding look
    more impressive, which is the direction that gets a report believed.
    """
    n, by_type = 0, collections.Counter()
    for t in sorted(os.listdir(project)):
        if t in NOISE_TYPES:
            continue
        d = os.path.join(project, t)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, f)) as fh:
                    cfg = json.load(fh)
            except (ValueError, OSError):
                continue
            if isinstance(cfg, dict) and cfg.get("enabled") is False:
                n += 1
                by_type[t] += 1
    return n, by_type


def dashboard_names(project: str) -> list[str]:
    """Real dashboard names.

    TRAP 5 — the .json payload says "name": "{{.name}}"; Monaco templates it
    out. The actual name is the `name:` under each entry in config.yaml, and a
    naive regex over that YAML also picks up nested keys. Parse it.
    """
    path = os.path.join(project, "dashboard", "config.yaml")
    if not os.path.exists(path):
        return []
    try:
        import yaml
    except ImportError:
        print("  note: PyYAML absent — dashboard names not read "
              "(the cleanup finding will be unavailable)", file=sys.stderr)
        return []
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            doc = yaml.safe_load(fh) or {}
    except Exception:
        return []
    return [c["config"]["name"] for c in doc.get("configs", [])
            if isinstance((c.get("config") or {}).get("name"), str)]


def extensions(project: str) -> list[dict]:
    """Extensions, flagged for the classic (Extensions 1.0) framework.

    Monaco exports classic extensions under `extension-<name>/`. Extensions 2.0
    are not managed through that endpoint, so presence here is a strong EF1
    signal — and EF1 support ended 30 September 2025, which makes an enabled
    classic extension a retirement decision rather than a migration item.
    """
    found = []
    for t in sorted(os.listdir(project)):
        if not t.startswith("extension-"):
            continue
        for f in sorted(os.listdir(os.path.join(project, t))):
            if not f.endswith(".json"):
                continue
            try:
                with open(os.path.join(project, t, f)) as fh:
                    cfg = json.load(fh)
            except (ValueError, OSError):
                continue
            props = cfg.get("properties", {}) or {}
            found.append({
                "name": t.replace("extension-", ""),
                "extension_id": cfg.get("extensionId", ""),
                "enabled": cfg.get("enabled"),
                "configured": bool(props.get("url") or props.get("auth_user")),
                "classic_framework": True,
            })
    return found


def default_floor(census: dict[str, collections.Counter],
                  types: set, allow_small_estate: bool = False) -> dict[str, int]:
    """The platform-default floor: the per-type MINIMUM across environments.

    Assembled, not copied — different environments supply the minimum for
    different types, so the floor total sits BELOW any single environment's own
    total. On a nine-environment reference estate the floor came to 982
    objects/env while the smallest environment carried 1,000.

    Monotonic: adding an environment can only lower a minimum, never raise it.
    The floor is therefore always an OVER-estimate of the platform default and
    customer-built is always an UNDER-estimate — the method errs toward claiming
    less customer configuration than exists, which is the right direction for a
    number handed to a client.
    """
    if len(census) < MIN_ENVIRONMENTS and not allow_small_estate:
        raise SmallEstateError(
            f"a default floor needs >={MIN_ENVIRONMENTS} environments, got "
            f"{len(census)}. With one, the floor IS that environment's own content "
            f"and every customer-built figure is identically zero by construction; "
            f"with two it is the smaller estate's content, and agreement between "
            f"two environments cannot be distinguished from coincidence. Supply "
            f"more exports, use --floor-from to import a floor measured elsewhere "
            f"on the same cluster and version, or pass --allow-small-estate to "
            f"inspect the arithmetic anyway (the result is marked unusable and "
            f"must not reach a deliverable).")
    return {t: min(census[e][t] for e in census) for t in types}


def customer_built(census: dict[str, collections.Counter],
                   allow_small_estate: bool = False) -> dict[str, int]:
    """Separate customer-built configuration from platform defaults.

    For each configuration type the MINIMUM count across all environments is
    the default floor; anything above it was built by a human.

    Raises SmallEstateError below MIN_ENVIRONMENTS. This is a gate rather than
    a warning because the failure is silent and flattering: with two
    environments the floor is the smaller one's own content, so the larger
    environment's "customer-built" figure is really just the difference between
    two estates, and it looks like a perfectly plausible number.
    """
    if not census:
        return {}
    types = set().union(*(set(c) for c in census.values()))
    floor = default_floor(census, types, allow_small_estate)
    return apply_floor(census, floor)


def apply_floor(census: dict[str, collections.Counter],
                floor: dict[str, int]) -> dict[str, int]:
    """Customer-built per environment against an already-measured floor."""
    types = set(floor) | set().union(*(set(c) for c in census.values()))
    return {e: sum(max(0, census[e][t] - floor.get(t, 0)) for t in types)
            for e in census}


# ------------------------------------------------------------------ analysis --
def measure_floor(zip_dir: str, allow_small_estate: bool = False) -> tuple[dict, dict]:
    """Measure a platform-default floor from a reference set of exports.

    Lets a set too small to baseline itself — a single production export, most
    often — borrow a floor measured from siblings on the SAME cluster and
    product version. That is not an assumption: the floor is a property of the
    platform build, and the borrowing is stated in the result so a reader can
    challenge it. Verify the cluster and version match before relying on it;
    `analyze` records both for exactly that purpose.
    """
    work = tempfile.mkdtemp(prefix="dt-m2s-floor-")
    try:
        roots, _ = extract(zip_dir, work)
        if not roots:
            sys.exit(f"no Monaco projects found in the floor reference set {zip_dir}")
        census = {metadata(work, l)["env_name"]: type_census(p) for l, p in roots.items()}
        types = set().union(*(set(c) for c in census.values()))
        floor = default_floor(census, types, allow_small_estate)
        meta = {"environment_count": len(census),
                "environments": sorted(census),
                "objects_per_environment": sum(floor.values()),
                "config_types": len(types),
                # FULL uuids: the transferability check compares these against the
                # analyzed set's, and comparing a truncated prefix to a full uuid
                # made the guard fire on every legitimate import. A guard that
                # cries wolf is a guard the operator learns to skip.
                "clusters": sorted({metadata(work, l)["cluster_uuid"] for l in roots}),
                "clusters_short": sorted({metadata(work, l)["cluster_uuid"][:8] for l in roots}),
                "product_versions": sorted({metadata(work, l)["product_version"] for l in roots})}
        return floor, meta
    finally:
        shutil.rmtree(work, ignore_errors=True)


def analyze(zip_dir: str, scope_exclude: str | None = None,
            allow_small_estate: bool = False,
            imported_floor: tuple | None = None) -> dict:
    """Measure every export in `zip_dir`. Returns the structured result."""
    work = tempfile.mkdtemp(prefix="dt-m2s-export-")
    try:
        roots, duplicate_groups = extract(zip_dir, work)
        if not roots:
            sys.exit("no Monaco projects found inside the exports")

        rows, census = {}, {}
        for label, project in roots.items():
            meta = metadata(work, label)
            census[label] = type_census(project)
            refs = entity_refs(project)
            dis, dis_by_type = disabled_objects(project)
            rows[label] = {
                **meta,
                # Total counts EVERY reference — a mis-typed one is still a real
                # reference (TRAP 7). Only the label is in doubt, so only the
                # breakdown is split.
                "entity_refs": sum(len(v) for v in refs.values()),
                "entity_refs_by_type": {k: len(v) for k, v in sorted(refs.items())
                                        if k in KNOWN_ENTITY_TYPES},
                "entity_refs_unrecognized": {k: len(v) for k, v in sorted(refs.items())
                                             if k not in KNOWN_ENTITY_TYPES},
                "disabled_objects": dis,
                "disabled_by_type": dict(dis_by_type),
                "dashboard_names": dashboard_names(project),
                "raw_objects": sum(census[label].values()),
                "extensions": extensions(project),
                **{key: census[label].get(t, 0) for key, t in TRACKED_TYPES.items()},
            }

        small_estate = len(census) < MIN_ENVIRONMENTS
        if imported_floor:
            floor, floor_meta = imported_floor
            built = apply_floor(census, floor)
            # The floor came from a set that HAS enough environments, so the
            # analyzed set being small no longer invalidates the result.
            small_estate = False
        else:
            floor_meta = None
            built = customer_built(census, allow_small_estate)
        for label in rows:
            rows[label]["built_objects"] = built.get(label, 0)
            name = rows[label]["env_name"]
            rows[label]["in_scope"] = not (
                scope_exclude and scope_exclude.lower() in name.lower())

        in_scope = [r for r in rows.values() if r["in_scope"]]
        total_built = sum(r["built_objects"] for r in in_scope)
        concentration = None
        # A single environment trivially holds 100% of its own configuration.
        # That is not a finding, it is a tautology, and "Production holds 100%"
        # on a page reads as one — so it is not computed at all below two.
        if total_built and len(in_scope) > 1:
            top = max(in_scope, key=lambda r: r["built_objects"])
            concentration = {
                "environment": top["env_name"],
                "objects": top["built_objects"],
                "share_pct": round(100 * top["built_objects"] / total_built),
            }

        ref_totals: collections.Counter = collections.Counter()
        unrecognized_totals: collections.Counter = collections.Counter()
        for r in in_scope:
            ref_totals.update(r["entity_refs_by_type"])
            unrecognized_totals.update(r["entity_refs_unrecognized"])

        all_names = [(r["env_name"], n) for r in in_scope for n in r["dashboard_names"]]
        # PER OBJECT, not per distinct name. Two dashboards both named "Config"
        # are two cleanup candidates, and the denominator counts objects — so a
        # deduplicated numerator over a raw denominator is a units mismatch that
        # UNDERSTATES the finding. It did, by 2.6x on the first real estate: 22
        # of 133 (17%) reported where the truth was 59 of 133 (44%), because one
        # environment held 19 dashboards named "Home" and 14 named "Config" and
        # they collapsed to two. The sample stays deduplicated — five DISTINCT
        # examples tell the reader more than five identical ones.
        flagged = [(e, n) for e, n in all_names
                   if RETIRE_RX.search(n) or PERSONAL_RX.search(n)
                   or n.strip().lower() in DEFAULT_NAMES]
        repeated = collections.Counter(flagged)

        ext_index: dict[str, dict] = {}
        for r in rows.values():
            for x in r["extensions"]:
                e = ext_index.setdefault(
                    x["name"], {"extension_id": x["extension_id"],
                                "environments": [], "configured_anywhere": False})
                e["environments"].append(r["env_name"])
                e["configured_anywhere"] |= bool(x["configured"])

        return {
            "environments": rows,
            "environment_count": len(rows),
            "clusters": sorted({r["cluster_uuid"] for r in rows.values() if r["cluster_uuid"]}),
            "product_versions": sorted({r["product_version"] for r in rows.values()}),
            "duplicate_export_groups": duplicate_groups,
            "small_estate": small_estate,
            "baseline_valid": not small_estate,
            "floor_source": floor_meta or {"basis": "measured from the analyzed set itself"},
            "in_scope": {
                "environment_count": len(in_scope),
                "built_objects": total_built,
                "raw_objects": sum(r["raw_objects"] for r in in_scope),
                "entity_refs": sum(r["entity_refs"] for r in in_scope),
                "entity_refs_by_type": dict(ref_totals.most_common()),
                "entity_refs_unrecognized": dict(unrecognized_totals.most_common()),
                "disabled_objects": sum(r["disabled_objects"] for r in in_scope),
                **{key: sum(r[key] for r in in_scope) for key in TRACKED_TYPES},
            },
            "concentration": concentration,
            "dashboard_cleanup": {
                "total": len(all_names),
                "flagged": len(flagged),
                "share_pct": round(100 * len(flagged) / len(all_names)) if all_names else None,
                "sample": [{"environment": e, "name": n}
                           for e, n in sorted(set(flagged))[:5]],
                # A name carried by many dashboards is its own finding: nobody
                # renamed them. Ordered by count so the report can name the worst.
                "most_repeated": [{"environment": e, "name": n, "count": c}
                                  for (e, n), c in repeated.most_common(5) if c > 1],
            },
            "classic_extensions": ext_index,
            "not_in_exports": ["host units", "DEM units", "DDU consumption",
                               "entity counts", "licensing"],
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


# -------------------------------------------------------------------- report --
def print_report(res: dict) -> None:
    if res["duplicate_export_groups"]:
        print("!! IDENTICAL EXPORTS DETECTED — these are the same file renamed:")
        for group in res["duplicate_export_groups"]:
            print("     " + "\n     ".join(group))
        print("!! Re-export before trusting any per-environment figure.\n")

    fs = res.get("floor_source") or {}
    if fs.get("environment_count"):
        print(f"Default floor IMPORTED from {fs['environment_count']} environment(s) "
              f"({', '.join(fs['environments'])}) — {fs['objects_per_environment']} objects/env, "
              f"cluster {'/'.join(fs.get('clusters_short') or fs['clusters'])}, "
              f"version {'/'.join(fs['product_versions'])}.")
        print("State this basis in the deliverable: the floor is measured, not assumed,\n"
              "but it is measured somewhere other than the environment being reported.\n")

    if res["small_estate"]:
        print(f"!! {res['environment_count']} environment(s) — below the {MIN_ENVIRONMENTS} "
              f"needed for baseline subtraction. Customer-built figures below are "
              f"NOT VALID and must not reach a deliverable.\n")

    print(f"{res['environment_count']} environments | {len(res['clusters'])} cluster(s) "
          f"| version(s): {', '.join(res['product_versions']) or 'unknown'}\n")

    hdr = (f"{'environment':<20}{'built':>7}{'raw':>7}{'entIDs':>8}{'dash':>6}"
           f"{'MZ':>4}{'alert':>7}{'PGset':>7}{'off':>6}  scope")
    print(hdr)
    print("-" * len(hdr))
    rows = res["environments"]
    for label in sorted(rows, key=lambda l: -rows[l]["built_objects"]):
        r = rows[label]
        print(f"{r['env_name'][:20]:<20}{r['built_objects']:>7}{r['raw_objects']:>7}"
              f"{r['entity_refs']:>8}{r['dashboards']:>6}{r['mgmt_zones']:>4}"
              f"{r['alerting_profiles']:>7}{r['pg_bound_settings']:>7}"
              f"{r['disabled_objects']:>6}  {'in' if r['in_scope'] else 'out'}")
    s = res["in_scope"]
    print("-" * len(hdr))
    print(f"{'IN SCOPE TOTAL':<20}{s['built_objects']:>7}{s['raw_objects']:>7}"
          f"{s['entity_refs']:>8}{s['dashboards']:>6}{s['mgmt_zones']:>4}"
          f"{s['alerting_profiles']:>7}{s['pg_bound_settings']:>7}"
          f"{s['disabled_objects']:>6}")

    c = res["concentration"]
    if c:
        print(f"\nConcentration: {c['environment']} holds {c['share_pct']}% of in-scope "
              f"customer-built configuration ({c['objects']} of {s['built_objects']}).")

    if s["entity_refs_by_type"]:
        print("\nHard-coded entity references by type (in scope):")
        for t, n in s["entity_refs_by_type"].items():
            print(f"  {n:>5}  {t}")

    if s["entity_refs_unrecognized"]:
        total = sum(s["entity_refs_unrecognized"].values())
        print(f"\n!! {total} reference(s) carry a type this tool does not recognize "
              f"— VERIFY before reporting a per-type figure:")
        for t, n in s["entity_refs_unrecognized"].items():
            print(f"  {n:>5}  {t}")
        print("   These ARE counted in the total above — the reference is real, only its")
        print("   label is in doubt. The usual cause is Monaco matching a trailing")
        print("   substring of an entity ID and naming the placeholder after it (e.g.")
        print("   APPLICATION_METHOD-<hex> extracted as `id_HOD_<hex>`). Open the object")
        print("   and read the surrounding text before naming the type in a deliverable.")
        print("   The other possibility is a genuine entity type newer than this tool.")

    d = res["dashboard_cleanup"]
    if d["total"]:
        print(f"\nDashboard cleanup candidates: {d['flagged']} of {d['total']} "
              f"({d['share_pct']}%) are default-named, marked, or personal")
        for item in d["sample"]:
            print(f"  {item['environment']:<18} {item['name'][:60]}")
        for item in d.get("most_repeated", []):
            print(f"  !! {item['count']} dashboards named {item['name']!r} "
                  f"in {item['environment']} — nobody renamed them")

    if res["classic_extensions"]:
        print("\nClassic (Extensions 1.0) extensions:")
        for name, x in res["classic_extensions"].items():
            state = ("configured somewhere" if x["configured_anywhere"]
                     else "CONFIGURED NOWHERE — retire, do not migrate")
            print(f"  {name} ({x['extension_id']}) — in "
                  f"{len(x['environments'])}/{res['environment_count']} environments, {state}")

    print("\nNOTE: configuration exports contain NO host, entity or licensing data.")
    print("      Host units must come from the Managed cluster console or the tenant")
    print("      API. Where unavailable they are not-assessable — appendix only,")
    print("      never substituted with a default.")


def write_csv(res: dict, path: str) -> None:
    cols = ["env_name", "env_uuid", "cluster_uuid", "product_version", "in_scope",
            "built_objects", "raw_objects", "entity_refs", "dashboards", "mgmt_zones",
            "alerting_profiles", "pg_bound_settings", "notifications", "disabled_objects"]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols + ["host_units", "DEM_units", "DDU"])
        w.writeheader()
        for r in res["environments"].values():
            w.writerow({**{c: r[c] for c in cols},
                        "host_units": "NOT IN EXPORT",
                        "DEM_units": "NOT IN EXPORT",
                        "DDU": "NOT IN EXPORT"})


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("zip_dir", help="directory of per-environment export .zip files")
    ap.add_argument("--json", help="write the structured result here (the report author reads this)")
    ap.add_argument("--csv", help="write a per-environment inventory CSV here")
    ap.add_argument("--scope-exclude", default=None,
                    help="substring; environments whose NAME contains it are marked out of scope")
    ap.add_argument("--floor-from", metavar="DIR",
                    help="measure the platform-default floor from the exports in DIR "
                         "instead of from the analyzed set. For a set too small to "
                         "baseline itself (a single production export). DIR must hold "
                         ">=3 exports from the SAME cluster and product version — both "
                         "are recorded in the result so the borrowing can be challenged.")
    ap.add_argument("--allow-small-estate", action="store_true",
                    help="run baseline subtraction below the 3-environment minimum. "
                         "The result is marked invalid and must not reach a deliverable.")
    args = ap.parse_args()

    try:
        imported = measure_floor(args.floor_from) if args.floor_from else None
        res = analyze(args.zip_dir, args.scope_exclude, args.allow_small_estate, imported)
    except SmallEstateError as exc:
        sys.exit(f"REFUSED: {exc}")

    if imported:
        fm = res["floor_source"]
        if len(fm["clusters"]) > 1 or len(fm["product_versions"]) > 1:
            print("!! The imported floor spans more than one cluster or product version — "
                  "it is not a single platform baseline. Do not use this result.\n")
        elif fm["clusters"] != res["clusters"] or fm["product_versions"] != res["product_versions"]:
            print(f"!! IMPORTED FLOOR MISMATCH — floor measured on cluster "
                  f"{fm['clusters']} / version {fm['product_versions']}, analyzed set is on "
                  f"{res['clusters']} / {res['product_versions']}. A floor is only "
                  f"transferable within one platform build.\n")

    print_report(res)
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(res, fh, indent=2, sort_keys=True)
        print(f"\nJSON written: {args.json}")
    if args.csv:
        write_csv(res, args.csv)
        print(f"CSV written: {args.csv}")


if __name__ == "__main__":
    main()
