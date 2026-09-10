#!/usr/bin/env python3
"""The decision table in diagnose_pipelines.py, pinned.

Every branch here corresponds to a way the pipeline read can come back, and the
one that matters most is the pair at the top: an empty list and a withheld list
are the SAME bytes on the wire (`{"ok":true,"result":[]}`) and opposite findings.
Getting that wrong does not lose a number, it picks the wrong gate -- and the
wrong gate tells a customer with working pipelines that they have built nothing.
"""

import sys
import diagnose_pipelines as d

ROUTING_ONE_REF = {"ok": True, "result": [
    {"value": {"routingEntries": [
        {"enabled": True, "matcher": "true", "pipelineId": "PIPE-A"}]}}]}
ROUTING_EMPTY = {"ok": True, "result": [{"value": {"routingEntries": []}}]}
PIPES_EMPTY = {"ok": True, "result": []}
PIPES_WITH_A = {"ok": True, "result": [{"objectId": "PIPE-A", "value": {}}]}
DENIED = {"ok": False, "error": {"message": 'get settings object "PIPE-A": API error (403): '
                                            "No read share for object with id PIPE-A"}}
NO_METRICS = {"ok": True, "result": {"records": []}}


def _fake(handlers):
    """Route a dtctl argv to a canned response by shape."""
    def run(args, timeout=180):
        if args[0] == "query":
            return handlers.get("metrics", (True, NO_METRICS, ""))
        if "--schema" in args:
            schema = args[args.index("--schema") + 1]
            if schema.endswith(".routing"):
                return handlers.get("routing", (True, ROUTING_EMPTY, ""))
            if schema.endswith(".pipelines"):
                return handlers.get("pipelines", (True, PIPES_EMPTY, ""))
            if schema.endswith(".pipeline-groups"):
                return (True, {"ok": True, "result": []}, "")
        return handlers.get("object", (True, {"ok": True, "result": {}}, ""))
    return run


def _with(handlers, scopes=("logs",)):
    original = d._dtctl
    d._dtctl = _fake(handlers)
    try:
        return d.diagnose("ctx", scopes)
    finally:
        d._dtctl = original


def test_withheld_objects_are_not_assessable_not_zero():
    """The whole point. Empty list + a routed id that 403s = not-assessable."""
    out = _with({"routing": (True, ROUTING_ONE_REF, ""),
                 "pipelines": (True, PIPES_EMPTY, ""),
                 "object": (False, DENIED, DENIED["error"]["message"])})
    assert out["diagnosis"] == "dtctl_cannot_read_this_surface", out["diagnosis"]
    assert "not an access problem" in out.get("remedy", "").lower(), \
        "the remedy must say this is not a permissions problem - the first version of "\
        "this module sent a live engagement to request a grant that would not have helped"
    assert out["verdict"] == "not-assessable", out["verdict"]
    assert out["verdict"] != 0, "a withheld inventory must never be spelled as zero"


def test_genuinely_unbuilt_is_zero_not_not_assessable():
    """The mirror case must still resolve to a real count, or the gate is useless."""
    out = _with({"routing": (True, ROUTING_EMPTY, ""),
                 "pipelines": (True, PIPES_EMPTY, "")})
    assert out["diagnosis"] == "genuinely_unbuilt", out["diagnosis"]
    assert out["verdict"] == 0, out["verdict"]


def test_clean_overlap_returns_the_authored_count():
    out = _with({"routing": (True, ROUTING_ONE_REF, ""),
                 "pipelines": (True, PIPES_WITH_A, "")})
    assert out["diagnosis"] == "complete", out["diagnosis"]
    assert out["verdict"] == 1, out["verdict"]


def test_platform_pipelines_do_not_count_as_authored():
    """The ownership partition is mandatory before any count means anything."""
    pipes = {"ok": True, "result": [
        {"objectId": "PIPE-A", "value": {"externalId": "com.dynatrace.extension.foo"}}]}
    out = _with({"routing": (True, ROUTING_ONE_REF, ""), "pipelines": (True, pipes, "")})
    assert out["verdict"] == 0, "an extension-default pipeline is not customer-authored"


def test_throughput_contradicting_an_unbuilt_verdict_flips_it():
    """Routing reads clean and references nothing, yet pipelines are processing.

    Something is invisible to the configuration reads, so "unbuilt" is not a
    safe conclusion even though every read succeeded.
    """
    metrics = {"ok": True, "result": {"records": [
        {"pipeline_id": "pipeline_live_1", "configuration": "logs", "total": "12345"}]}}
    out = _with({"routing": (True, ROUTING_EMPTY, ""),
                 "pipelines": (True, PIPES_EMPTY, ""),
                 "metrics": (True, metrics, "")})
    assert out["diagnosis"] == "contradicted_by_throughput", out["diagnosis"]
    assert out["verdict"] == "not-assessable", out["verdict"]
    assert "contradiction" in out


def test_unreadable_routing_never_reads_as_unbuilt():
    out = _with({"routing": (False, {"ok": False, "error": {"message": "boom"}}, "boom"),
                 "pipelines": (True, PIPES_EMPTY, "")})
    assert out["verdict"] == "not-assessable", out["verdict"]


def test_denial_matcher_tolerates_wording_drift():
    """The 403 sentence has changed before; a brittle match falls through to 'unbuilt'."""
    for msg in ("API error (403): No read share for object with id X",
                "object is not shared with this identity",
                "403 Forbidden"):
        assert d._DENIED.search(msg), f"must recognise a denial phrased as {msg!r}"
    assert not d._DENIED.search("settings object not found"), \
        "a genuine not-found must NOT be read as a denial"


def test_verdict_maps_onto_the_scoring_sentinel():
    """Whatever this prints has to be a legal --n-authored value."""
    import scoring
    assert scoring.n_authored_arg("not-assessable") is None
    assert scoring.n_authored_arg("0") == 0
    assert scoring.n_authored_arg("3") == 3


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    print(f"\n{'OK' if not failures else 'FAILED'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
