#!/usr/bin/env python3
"""Self-tests for the Managed configuration-export analyzer.

Every fixture here is SYNTHETIC and built in a temp directory. That is not a
convenience — a real configuration export is customer data and can never be
committed (CLAUDE.md: never commit tenant data), so the regression cover for
this analyzer has to be constructed. Real exports are for validating the
method, not for testing the code.

Each test is either one of the five traps the method is built around (keep
failing = the trap is still caught) or the precondition gate.

Run: .venv/bin/python test_analyze_export.py
"""

import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

import analyze_export as a

_TMP = Path(tempfile.mkdtemp(prefix="dt-m2s-test-"))


# ------------------------------------------------------------------ fixtures --
def build_export(directory, env_name, env_uuid="e" * 8, cluster="c" * 8,
                 types=None, dashboards=None, extensions_=None,
                 version="1.300.0.20260101-000000", filename=None):
    """Write one synthetic export .zip and return its path.

    `types` is {config_type: [payload dict, ...]} — one .json per payload.
    `dashboards` is a list of real dashboard names, rendered into config.yaml
    the way Monaco does (the payload keeps the {{.name}} template).
    """
    types = dict(types or {})
    if dashboards:
        types.setdefault("dashboard", [{"name": "{{.name}}"} for _ in dashboards])
    for name, cfg in (extensions_ or {}).items():
        types[f"extension-{name}"] = [cfg]

    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tf:
        def add(path, data):
            raw = data.encode() if isinstance(data, str) else data
            info = tarfile.TarInfo(path)
            info.size = len(raw)
            tf.addfile(info, io.BytesIO(raw))

        add("exportMetadata.json", json.dumps({
            "environments": [{"name": env_name, "uuid": env_uuid}],
            "clusterUuid": cluster, "productVersion": version,
            "monacoVersion": "2.9.1"}))
        root = f"export/project_{env_uuid}"
        # An explicit directory entry: a real export always HAS the project
        # directory, and a fixture with no configuration types would otherwise
        # produce a tar with nothing under it and no project dir on extraction.
        dir_info = tarfile.TarInfo(root)
        dir_info.type = tarfile.DIRTYPE
        dir_info.mode = 0o755
        tf.addfile(dir_info)
        for ctype, payloads in types.items():
            for i, payload in enumerate(payloads):
                add(f"{root}/{ctype}/{ctype}-{i}.json", json.dumps(payload))
        if dashboards:
            configs = "\n".join(
                f"  - id: dash-{i}\n    config:\n      name: {n!r}\n      template: dash-{i}.json"
                for i, n in enumerate(dashboards))
            add(f"{root}/dashboard/config.yaml", f"configs:\n{configs}\n")

    path = Path(directory) / (filename or f"{env_name}_configurationExport-20260101.zip")
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("exportFile.tar.gz", tar_buf.getvalue())
    return path


def estate(name, **envs):
    """Build a directory of exports. `envs` is {env_name: build_export kwargs}."""
    d = _TMP / name
    d.mkdir(parents=True, exist_ok=True)
    for env_name, kwargs in envs.items():
        build_export(d, env_name, env_uuid=f"{env_name}-uuid", **kwargs)
    return str(d)


# ---------------------------------------------------------------- the method --
def test_baseline_subtraction_removes_the_platform_default_floor():
    # Every environment ships 5 objects of this type; PROD built 7 more. The
    # floor is 5, so only PROD's 7 are customer-built and the shells are zero.
    d = estate("floor",
               prod={"types": {"builtinalerting.profile": [{}] * 12}},
               staging={"types": {"builtinalerting.profile": [{}] * 5}},
               dev={"types": {"builtinalerting.profile": [{}] * 5}})
    res = a.analyze(d)
    built = {r["env_name"]: r["built_objects"] for r in res["environments"].values()}
    assert built == {"prod": 7, "staging": 0, "dev": 0}, built
    # The raw count is the number that would have been reported without this.
    assert res["in_scope"]["raw_objects"] == 22
    assert res["in_scope"]["built_objects"] == 7


def test_concentration_is_the_number_that_reframes_the_scope():
    d = estate("conc",
               prod={"types": {"builtinmanagement-zones": [{}] * 100}},
               staging={"types": {"builtinmanagement-zones": [{}] * 12}},
               dev={"types": {"builtinmanagement-zones": [{}] * 10}})
    res = a.analyze(d)
    c = res["concentration"]
    assert c["environment"] == "prod"
    # floor 10 -> prod 90, staging 2, dev 0 -> 90/92
    assert c["share_pct"] == 98, c


def test_small_estate_is_refused_not_warned():
    d = estate("small",
               prod={"types": {"builtinalerting.profile": [{}] * 9}},
               dev={"types": {"builtinalerting.profile": [{}] * 4}})
    try:
        a.analyze(d)
    except a.SmallEstateError as exc:
        assert "2" in str(exc) and ">=3" in str(exc), str(exc)
    else:
        raise AssertionError("two environments must be REFUSED, not silently analyzed")


def test_small_estate_override_marks_the_result_invalid():
    d = estate("small2",
               prod={"types": {"builtinalerting.profile": [{}] * 9}},
               dev={"types": {"builtinalerting.profile": [{}] * 4}})
    res = a.analyze(d, allow_small_estate=True)
    assert res["small_estate"] is True
    assert res["baseline_valid"] is False, "an override must not produce a usable result"


# ----------------------------------------------------------------- the traps --
def test_trap1_byte_identical_exports_are_detected():
    d = Path(_TMP / "dupes")
    d.mkdir(parents=True, exist_ok=True)
    payload = build_export(d, "prod", env_uuid="prod-uuid",
                           types={"builtinalerting.profile": [{}] * 6}).read_bytes()
    # the same file, re-downloaded and renamed twice — six environments that are one
    for name in ("staging", "dev"):
        (d / f"{name}_configurationExport-20260101.zip").write_bytes(payload)
    res = a.analyze(str(d))
    assert res["duplicate_export_groups"], "identical exports were not detected"
    assert len(res["duplicate_export_groups"][0]) == 3


def test_trap3_entity_references_are_deduped_across_yaml_and_json():
    # The SAME reference appears in the payload twice and would also appear in
    # config.yaml. Counting raw matches roughly doubles the figure.
    ref = "id_SERVICE_1E02C49FB24C5A20"
    d = estate("refs",
               prod={"types": {"builtinalerting.profile": [
                   {"scope": ref, "copy": ref, "also": ref},
                   {"scope": ref}]}},
               staging={}, dev={})
    res = a.analyze(d)
    # four textual occurrences of one unique (type, id) -> 1
    assert res["in_scope"]["entity_refs"] == 1, res["in_scope"]["entity_refs"]
    assert res["in_scope"]["entity_refs_by_type"] == {"SERVICE": 1}


def test_trap4_platform_feature_flags_do_not_swamp_the_disabled_count():
    disabled = [{"enabled": False} for _ in range(2000)]
    d = estate("disabled",
               prod={"types": {"builtinoneagent.features": disabled,
                               "builtinalerting.profile": [{"enabled": False}] * 3}},
               staging={}, dev={})
    res = a.analyze(d)
    # 3, not 2003 — the order-of-magnitude error this trap exists to prevent
    assert res["in_scope"]["disabled_objects"] == 3, res["in_scope"]["disabled_objects"]


def test_trap5_dashboard_names_come_from_config_yaml_not_the_payload():
    names = ["Payments Overview", "Payments Overview-cloned", "Bob's dashboard", "home"]
    d = estate("dash", prod={"dashboards": names}, staging={}, dev={})
    res = a.analyze(d)
    flagged = {i["name"] for i in res["dashboard_cleanup"]["sample"]}
    assert res["dashboard_cleanup"]["total"] == 4
    # the payload says {{.name}}; if that were read, nothing would match
    assert "Payments Overview-cloned" in flagged
    assert "Bob's dashboard" in flagged
    assert "home" in flagged
    assert "Payments Overview" not in flagged, "a real, in-use name must not be flagged"
    assert res["dashboard_cleanup"]["share_pct"] == 75


def test_classic_extension_configured_nowhere_is_a_retire_signal():
    ext = {"extensionId": "custom.remote.python.thing", "enabled": True, "properties": {}}
    d = estate("ext",
               prod={"extensions_": {"thing": ext}},
               staging={"extensions_": {"thing": ext}},
               dev={"extensions_": {"thing": ext}})
    res = a.analyze(d)
    x = res["classic_extensions"]["thing"]
    assert len(x["environments"]) == 3
    assert x["configured_anywhere"] is False, "enabled everywhere, configured nowhere"


def test_sample_is_capped_at_five():
    names = [f"test-{i}" for i in range(20)]
    d = estate("cap", prod={"dashboards": names}, staging={}, dev={})
    res = a.analyze(d)
    assert res["dashboard_cleanup"]["flagged"] == 20
    assert len(res["dashboard_cleanup"]["sample"]) == 5, "a sample is a sample"


def test_trap7_monaco_mis_split_type_is_flagged_not_reported_as_a_type():
    """The `HOD` case, from a real export (values here are synthetic).

    Monaco matched the trailing substring `HOD-<hex>` inside
    `APPLICATION_METHOD-<hex>`, left `APPLICATION_MET` as literal text, and
    named the placeholder `id_HOD_<hex>`. Reporting "1 HOD entity reference" is
    unauditable and hides the real fact.
    """
    mangled = "APPLICATION_MET{{ .extractedIDs.id_HOD_1234567890ABCDEF }}"
    d = estate("trap7",
               prod={"types": {"dashboard": [{"markdown": mangled}],
                               "builtinalerting.profile": [
                                   {"scope": "id_SERVICE_00AA11BB22CC33DD"}]}},
               staging={}, dev={})
    res = a.analyze(d)
    s = res["in_scope"]
    # The reference is REAL — only its label is wrong, so the total keeps it.
    assert s["entity_refs"] == 2, s["entity_refs"]
    # ...but it must not appear as an entity type.
    assert s["entity_refs_by_type"] == {"SERVICE": 1}, s["entity_refs_by_type"]
    assert s["entity_refs_unrecognized"] == {"HOD": 1}, s["entity_refs_unrecognized"]


def test_an_unfamiliar_type_is_flagged_never_dropped():
    # Dynatrace adds entity types. Silently discarding a real one would be a
    # worse failure than surfacing an unfamiliar one, so the known set only flags.
    d = estate("newtype",
               prod={"types": {"builtinalerting.profile": [
                   {"scope": "id_SOME_FUTURE_TYPE_0F0F0F0F0F0F0F0F"}]}},
               staging={}, dev={})
    res = a.analyze(d)
    assert res["in_scope"]["entity_refs"] == 1, "an unfamiliar type must still be COUNTED"
    assert res["in_scope"]["entity_refs_by_type"] == {}
    assert sum(res["in_scope"]["entity_refs_unrecognized"].values()) == 1


def test_known_types_are_not_flagged():
    refs = {f"t{i}": [{"scope": f"id_{t}_{i:016X}"}]
            for i, t in enumerate(["HOST", "SERVICE", "PROCESS_GROUP", "VCENTER",
                                   "APPLICATION_METHOD", "ENVIRONMENT_ACTIVE_GATE",
                                   "HOST_GROUP", "CUSTOM_DEVICE", "SERVICE_METHOD"])}
    d = estate("known", prod={"types": refs}, staging={}, dev={})
    res = a.analyze(d)
    assert res["in_scope"]["entity_refs_unrecognized"] == {}, \
        res["in_scope"]["entity_refs_unrecognized"]
    assert len(res["in_scope"]["entity_refs_by_type"]) == 9
def test_dashboard_cleanup_counts_objects_not_distinct_names():
    """The units-mismatch regression.

    Every fixture in this file used DISTINCT dashboard names, so a deduplicated
    numerator over a raw denominator passed the whole suite. On the first real
    estate it understated the finding 2.6x — 22 of 133 reported where the truth
    was 59 of 133 — because one environment held 19 dashboards named "Home" and
    14 named "Config", and they collapsed to two.
    """
    names = ["Home"] * 5 + ["Config"] * 3 + ["Payments Overview", "Latency SLO"]
    d = estate("units", prod={"dashboards": names}, staging={}, dev={})
    res = a.analyze(d)
    c = res["dashboard_cleanup"]
    assert c["total"] == 10, c["total"]
    # 5 Home + 3 Config = 8 objects, NOT 2 distinct names
    assert c["flagged"] == 8, f"counted distinct names, not objects: {c['flagged']}"
    assert c["share_pct"] == 80, c["share_pct"]
    # ...while the sample stays deduplicated: five DISTINCT examples are more
    # useful to a reader than five identical ones.
    assert [i["name"] for i in c["sample"]] == ["Config", "Home"], c["sample"]


def test_a_name_carried_by_many_dashboards_is_surfaced():
    # "19 dashboards named Home" is a finding in its own right — nobody renamed
    # them — and it is the kind of concrete, auditable claim a report needs.
    d = estate("repeat", prod={"dashboards": ["Home"] * 19 + ["Config"] * 14},
               staging={}, dev={})
    res = a.analyze(d)
    top = res["dashboard_cleanup"]["most_repeated"]
    assert top[0]["name"] == "Home" and top[0]["count"] == 19, top
    assert top[1]["name"] == "Config" and top[1]["count"] == 14, top


def test_a_single_export_can_borrow_a_floor_measured_elsewhere():
    """One environment cannot baseline itself, but it can use a measured floor.

    The floor is a property of the platform build, so a set of siblings on the
    same cluster and version can supply it. The borrowing is recorded in
    `floor_source` so a reader can challenge it.
    """
    ref = estate("floorref",
                 a1={"types": {"builtinalerting.profile": [{}] * 5}},
                 a2={"types": {"builtinalerting.profile": [{}] * 5}},
                 a3={"types": {"builtinalerting.profile": [{}] * 6}})
    floor, meta = a.measure_floor(ref)
    assert meta["environment_count"] == 3
    assert meta["objects_per_environment"] == 5

    solo = estate("solo", prod={"types": {"builtinalerting.profile": [{}] * 40}})
    res = a.analyze(solo, imported_floor=(floor, meta))
    # 40 - 5 = 35 customer-built, from ONE export — impossible without the import
    assert res["in_scope"]["built_objects"] == 35, res["in_scope"]["built_objects"]
    assert res["baseline_valid"] is True
    assert res["floor_source"]["environment_count"] == 3


def test_a_floor_reference_set_is_itself_gated():
    # The imported floor must come from a set big enough to HAVE a floor —
    # otherwise the import just launders an invalid number into a valid-looking one.
    ref = estate("badref", a1={"types": {"builtinalerting.profile": [{}] * 5}},
                 a2={"types": {"builtinalerting.profile": [{}] * 9}})
    try:
        a.measure_floor(ref)
    except a.SmallEstateError:
        return
    raise AssertionError("a 2-environment floor reference must be REFUSED")


def test_without_an_imported_floor_a_single_export_is_still_refused():
    solo = estate("solo2", prod={"types": {"builtinalerting.profile": [{}] * 40}})
    try:
        a.analyze(solo)
    except a.SmallEstateError:
        return
    raise AssertionError("one export with no imported floor must still be refused")


def test_floor_is_assembled_across_environments_not_copied_from_one():
    # Different environments supply the minimum for different types, so the
    # floor total sits BELOW any single environment's own total. This is why
    # the method needs several environments rather than one small one.
    d = estate("assembled",
               a1={"types": {"x": [{}] * 2, "y": [{}] * 9}},   # total 11
               a2={"types": {"x": [{}] * 9, "y": [{}] * 3}},   # total 12
               a3={"types": {"x": [{}] * 7, "y": [{}] * 7}})   # total 14
    floor, meta = a.measure_floor(d)
    assert floor == {"x": 2, "y": 3}
    assert meta["objects_per_environment"] == 5, "floor must be below every env total (11/12/14)"


def test_concentration_is_not_computed_for_a_single_environment():
    # "Production holds 100% of customer-built configuration" is a tautology,
    # and on a page it reads as a finding.
    ref = estate("cref", a1={"types": {"t": [{}] * 5}}, a2={"types": {"t": [{}] * 5}},
                 a3={"types": {"t": [{}] * 5}})
    floor, meta = a.measure_floor(ref)
    solo = estate("csolo", prod={"types": {"t": [{}] * 40}})
    res = a.analyze(solo, imported_floor=(floor, meta))
    assert res["in_scope"]["built_objects"] == 35
    assert res["concentration"] is None, res["concentration"]


def test_floor_provenance_compares_like_with_like():
    # The transferability guard compares the floor's cluster/version against the
    # analyzed set's. Recording a TRUNCATED uuid in one and a full uuid in the
    # other made it fire on every legitimate import.
    ref = estate("pref", a1={"types": {"t": [{}] * 5}}, a2={"types": {"t": [{}] * 5}},
                 a3={"types": {"t": [{}] * 5}})
    _, meta = a.measure_floor(ref)
    solo = estate("psolo", prod={"types": {"t": [{}] * 9}})
    res = a.analyze(solo, imported_floor=a.measure_floor(ref))
    assert meta["clusters"] == res["clusters"], (meta["clusters"], res["clusters"])
    assert meta["product_versions"] == res["product_versions"]
    assert all(len(c) == 8 for c in meta["clusters_short"])


# ------------------------------------------------------------------- safety --
def test_exports_never_claim_host_or_licensing_data():
    d = estate("nohosts", prod={}, staging={}, dev={})
    res = a.analyze(d)
    assert "host units" in res["not_in_exports"]
    assert "DDU consumption" in res["not_in_exports"]


def test_a_tar_member_escaping_the_extract_root_is_refused():
    d = _TMP / "evil"
    d.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        info = tarfile.TarInfo("../../escaped.json")
        data = b"{}"
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    with zipfile.ZipFile(d / "evil_configurationExport-20260101.zip", "w") as zf:
        zf.writestr("exportFile.tar.gz", buf.getvalue())
    work = tempfile.mkdtemp(prefix="dt-m2s-evil-")
    try:
        try:
            a.extract(str(d), work)
        except (ValueError, tarfile.TarError):
            return  # refused, on any interpreter
        # Python >=3.12 filter="data" may neutralize rather than raise; assert
        # nothing escaped either way.
        assert not os.path.exists(os.path.join(work, "escaped.json"))
        assert not os.path.exists("/tmp/escaped.json")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    failures = 0
    try:
        for name, fn in sorted(globals().items()):
            if name.startswith("test_") and callable(fn):
                try:
                    fn()
                    print(f"PASS {name}")
                except Exception as exc:
                    failures += 1
                    print(f"FAIL {name}: {exc}")
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
    sys.exit(1 if failures else 0)
