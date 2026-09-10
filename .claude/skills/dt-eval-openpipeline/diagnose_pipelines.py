#!/usr/bin/env python3
"""The A21<->A22 join assertion and its 3-step diagnosis, executable.

WHY THIS EXISTS
---------------
`builtin:openpipeline.<scope>.pipelines` returns `{"ok":true,"result":[]}` in BOTH
of these situations, and they mean opposite things:

  * the tenant genuinely has no customer-authored pipelines   -> below_adoption_floor
  * every pipeline object is withheld by object-level sharing  -> adoption_not_assessable

Only a direct read of a pipeline the routing table NAMES tells them apart: that
returns `403 No read share for object` when the objects exist but this surface
will not serve them.

READ THE 403 CAREFULLY -- it is NOT a statement about the user's permissions.
`dtctl get settings` reaches the settings-object api. The OpenPipeline app reads
`/platform/openpipeline/v1/configurations/<scope>`, which dtctl implements no verb
for, and the scope that endpoint needs (`openpipeline:configurations:read`) is
typically already granted. So the same user who gets a 403 here can open the same
pipelines in the browser. Corrected 2026-08-26, after this module's first version
reported it as a read-share denial and a live engagement drafted an access request
that would not have helped. The remedy is an export, not a grant.
SKILL.md has required exactly this check since the skill shipped, as a procedure
an analyst performs. A procedure is a rule someone has to remember, and the cost
of forgetting is not a missing number -- it is the WRONG GATE. `n_authored=0`
tells a customer "you have not built enough OpenPipeline configuration"; live on
2026-08-25 that sentence would have gone to two tenants moving 16.3B and 82.5B
records a week through working pipelines.

So this module performs the join and the diagnosis mechanically and prints the
value to hand to `--n-authored`. It is read-only: `dtctl get` and `dtctl query`
only, per the skill's hard rule.

WHAT IT CANNOT DO
-----------------
It cannot turn "not assessable" into a number. When the objects are withheld the
answer is still the gate -- the point is to reach the gate *for the right reason*,
with the evidence recorded. The B51 self-monitoring read is collected as
corroboration and gives a measured FLOOR on the live pipeline count, but a floor
is not the configured inventory (a configured-but-idle pipeline processes nothing
and so never appears), and it deliberately does not release the gate.

USAGE
    python3 diagnose_pipelines.py --context <ctx> [--scopes logs,bizevents,...]
                                  [--json out.json] [--window 7d]

EXIT CODES
    0  a determinate count -- pass the printed integer to --n-authored
    2  not assessable      -- pass `not-assessable` to --n-authored
    1  the diagnosis itself failed (dtctl unreachable, bad context)
"""

import argparse
import json
import re
import subprocess
import sys

SCOPES = ("logs", "bizevents", "events", "events.security",
          "davis.problems", "davis.events", "events.sdlc", "metrics")

# `403 No read share for object` is the signature that decides this whole module.
# Match the SHAPE, not a full sentence -- the wording has drifted before and a
# too-strict match would silently fall through to "genuinely empty", which is the
# failure this exists to prevent.
_DENIED = re.compile(r"no read share|not shared|forbidden|\b403\b", re.I)
# A platform-supplied pipeline is never customer-authored; the ownership partition
# in SKILL.md Phase 2 is mandatory before any count means anything.
_PLATFORM_PREFIXES = ("com.dynatrace.",)


def _dtctl(args, timeout=180):
    """Run a read-only dtctl command, returning (ok, parsed_or_none, raw_stderr)."""
    try:
        p = subprocess.run(["dtctl", *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, None, f"{type(e).__name__}: {e}"
    raw = p.stdout or ""
    try:
        j = json.loads(raw)
    except ValueError:
        return False, None, (p.stderr or raw)[:400]
    if j.get("ok") is False:
        return False, j, (j.get("error") or {}).get("message", "")
    return True, j, p.stderr or ""


def _rows(j):
    r = (j or {}).get("result")
    if isinstance(r, list):
        return r
    if isinstance(r, dict) and "records" in r:
        return r.get("records") or []
    return []


def read_routing(ctx, scope):
    """Referenced pipeline ids from a scope's routing table, plus entry stats."""
    ok, j, err = _dtctl(["get", "settings", "--schema",
                         f"builtin:openpipeline.{scope}.routing",
                         "--scope", "environment", "--context", ctx, "-o", "json"])
    if not ok:
        return {"scope": scope, "readable": False, "error": err[:200],
                "referenced": [], "entries": 0, "enabled": 0}
    refs, entries, enabled = [], 0, 0
    for obj in _rows(j):
        for e in ((obj.get("value") or {}).get("routingEntries") or []):
            entries += 1
            if e.get("enabled"):
                enabled += 1
            pid = e.get("pipelineId")
            if pid and pid not in refs:
                refs.append(pid)
    return {"scope": scope, "readable": True, "referenced": refs,
            "entries": entries, "enabled": enabled}


def read_pipelines(ctx, scope):
    """Readable pipeline objects for a scope, partitioned by ownership."""
    ok, j, err = _dtctl(["get", "settings", "--schema",
                         f"builtin:openpipeline.{scope}.pipelines",
                         "--scope", "environment", "--context", ctx, "-o", "json"])
    if not ok:
        return {"scope": scope, "readable": False, "error": err[:200],
                "ids": [], "authored": 0, "platform": 0}
    ids, authored, platform = [], 0, 0
    for obj in _rows(j):
        oid = obj.get("objectId")
        if oid:
            ids.append(oid)
        ext = str((obj.get("value") or {}).get("externalId") or "")
        if ext.startswith(_PLATFORM_PREFIXES):
            platform += 1
        else:
            authored += 1
    return {"scope": scope, "readable": True, "ids": ids,
            "authored": authored, "platform": platform}


def probe_object(ctx, pipeline_id):
    """Step 1 of the diagnosis: does a NAMED pipeline read back, or is it withheld?"""
    ok, j, err = _dtctl(["get", "settings", pipeline_id, "--context", ctx, "-o", "json"])
    if ok:
        return {"pipeline_id": pipeline_id, "verdict": "readable"}
    msg = err or ((j or {}).get("error") or {}).get("message", "")
    verdict = "denied" if _DENIED.search(msg or "") else "error"
    return {"pipeline_id": pipeline_id, "verdict": verdict, "message": (msg or "")[:220]}


def read_groups(ctx, scope):
    """Step 2: pipeline groups. An empty result proves NOTHING and is recorded as such."""
    ok, j, _ = _dtctl(["get", "settings", "--schema",
                       f"builtin:openpipeline.{scope}.pipeline-groups",
                       "--scope", "environment", "--context", ctx, "-o", "json"])
    return {"scope": scope, "readable": ok, "objects": len(_rows(j)) if ok else None}


def metric_floor(ctx, window="7d"):
    """B51 corroboration: pipelines that PROCESSED records. A floor, never the inventory."""
    q = (f"timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-{window}, "
         "by:{pipeline_id, configuration} | fieldsAdd total = arraySum(records) "
         "| fields configuration, pipeline_id, total | sort total desc")
    ok, j, err = _dtctl(["query", q, "--context", ctx, "-o", "json"], timeout=300)
    if not ok:
        return {"readable": False, "error": (err or "")[:200]}
    live = []
    for r in _rows(j):
        pid = str(r.get("pipeline_id") or "")
        if pid and pid != "default":
            live.append({"pipeline_id": pid,
                         "configuration": r.get("configuration"),
                         "records": int(r.get("total") or 0)})
    return {"readable": True, "live_custom_pipelines": len(live), "pipelines": live,
            "window": window,
            "caveat": "counts pipelines that processed records in the window - a FLOOR on the "
                      "configured inventory, never the whole of it; does not release the gate"}


def diagnose(ctx, scopes=SCOPES, window="7d"):
    routing = [read_routing(ctx, s) for s in scopes]
    pipelines = [read_pipelines(ctx, s) for s in scopes]

    referenced = {p for r in routing for p in r["referenced"]}
    readable_ids = {i for p in pipelines for i in p["ids"]}
    authored = sum(p["authored"] for p in pipelines if p["readable"])
    overlap = referenced & readable_ids

    out = {
        "context": ctx,
        "scopes": list(scopes),
        "routing": routing,
        "pipelines": pipelines,
        "referenced_pipeline_ids": len(referenced),
        "readable_pipeline_objects": len(readable_ids),
        "customer_authored_readable": authored,
        "overlap": len(overlap),
    }

    # --- the assertion, then the 3-step diagnosis, in the documented order -----
    if referenced and not overlap:
        out["assertion"] = "FAILED: zero overlap between routed and readable pipelines"
        probes = [probe_object(ctx, pid) for pid in sorted(referenced)[:3]]
        out["step1_object_read"] = probes
        if any(p["verdict"] == "denied" for p in probes):
            # CORRECTED 2026-08-26. The 403 comes from the SETTINGS-OBJECT api,
            # which is not the surface the OpenPipeline app reads. The app uses
            # /platform/openpipeline/v1/configurations/<scope>, dtctl implements no
            # verb for it (`dtctl get apis` maps that base path to preview-processor
            # only), and the scope it needs -- openpipeline:configurations:read --
            # is typically ALREADY granted. So a 403 here says "this surface does
            # not expose these objects to this tool", NOT "your identity lacks
            # access": the same user reading the same objects in the browser
            # succeeds. Naming it a read-share denial sent a live engagement to
            # request an access grant that would not have helped.
            out["diagnosis"] = "dtctl_cannot_read_this_surface"
            out["verdict"] = "not-assessable"
            out["remedy"] = (
                "Not an access problem. Export the definitions from the OpenPipeline "
                "app (or GET /platform/openpipeline/v1/configurations/<scope>) and "
                "re-run the analysis against the exported JSON. Confirm before "
                "escalating: if the app shows the pipelines to the same user, no "
                "permission change is required.")
        else:
            out["step2_pipeline_groups"] = [read_groups(ctx, s) for s in scopes]
            if any(p["verdict"] == "error" for p in probes):
                out["diagnosis"] = "pipeline_read_errored"
                out["verdict"] = "not-assessable"
            else:
                # Named pipelines read back individually but not as a list: a
                # scope or pagination artifact, not a permissions one.
                out["diagnosis"] = "scope_or_pagination"
                out["verdict"] = "not-assessable"
    elif referenced and len(overlap) < len(referenced):
        out["assertion"] = "PARTIAL: some routed pipelines are not readable"
        missing = sorted(referenced - readable_ids)
        out["step1_object_read"] = [probe_object(ctx, pid) for pid in missing[:3]]
        if any(p["verdict"] == "denied" for p in out["step1_object_read"]):
            out["diagnosis"] = "dtctl_cannot_read_this_surface_partial"
            out["verdict"] = "not-assessable"
            out["remedy"] = (
                "Not an access problem -- see the note on the full-denial branch. "
                "Export the definitions from the OpenPipeline app and re-run against "
                "the exported JSON.")
        else:
            out["diagnosis"] = "partial_overlap_unexplained"
            out["verdict"] = "not-assessable"
    elif not referenced and not readable_ids:
        # Nothing routes anywhere and nothing reads back. Genuinely unbuilt: the
        # routing tables were READABLE and carry no custom pipeline references,
        # so there is nothing being withheld.
        readable_routing = all(r["readable"] for r in routing)
        out["assertion"] = "no custom pipeline referenced by any routing table"
        out["diagnosis"] = "genuinely_unbuilt" if readable_routing else "routing_unreadable"
        out["verdict"] = 0 if readable_routing else "not-assessable"
    else:
        out["assertion"] = "OK: every routed pipeline is readable"
        out["diagnosis"] = "complete"
        out["verdict"] = authored

    out["metric_floor"] = metric_floor(ctx, window)
    fl = out["metric_floor"]
    if (out["verdict"] == 0 and fl.get("readable")
            and fl.get("live_custom_pipelines", 0) > 0):
        # The routing tables read clean and referenced nothing, yet the platform's
        # own counters show customer pipelines processing records. Something is
        # invisible to the configuration reads; do NOT report "unbuilt".
        out["diagnosis"] = "contradicted_by_throughput"
        out["verdict"] = "not-assessable"
        out["contradiction"] = (
            f"routing referenced no custom pipeline, but {fl['live_custom_pipelines']} "
            "customer-authored pipeline(s) processed records in the window")
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Mechanically perform the A21<->A22 join assertion and its 3-step "
                    "diagnosis, and print the value to pass to --n-authored.")
    ap.add_argument("--context", required=True)
    ap.add_argument("--scopes", default=",".join(SCOPES))
    ap.add_argument("--window", default="7d", help="B51 corroboration window")
    ap.add_argument("--json", help="write the full evidence here")
    ap.add_argument("--quiet", action="store_true", help="print only the --n-authored value")
    a = ap.parse_args()

    scopes = tuple(s.strip() for s in a.scopes.split(",") if s.strip())
    try:
        out = diagnose(a.context, scopes, a.window)
    except Exception as e:                                    # noqa: BLE001
        print(f"diagnosis failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=1)

    v = out["verdict"]
    if a.quiet:
        print(v)
    else:
        print(f"assertion : {out['assertion']}")
        print(f"diagnosis : {out['diagnosis']}")
        print(f"routed pipeline ids: {out['referenced_pipeline_ids']}  "
              f"readable objects: {out['readable_pipeline_objects']}  "
              f"overlap: {out['overlap']}")
        fl = out["metric_floor"]
        if fl.get("readable"):
            print(f"throughput floor   : {fl['live_custom_pipelines']} customer-authored "
                  f"pipeline(s) processed records in the last {fl['window']}")
            for p in fl["pipelines"][:5]:
                print(f"    {p['records']:>15,}  {p['configuration']}  {p['pipeline_id']}")
        if "contradiction" in out:
            print(f"CONTRADICTION: {out['contradiction']}")
        print()
        print(f"--n-authored {v}")
        if v == "not-assessable":
            print("  (the pipeline inventory could not be established; this is the "
                  "adoption_not_assessable gate, NOT below_adoption_floor)")
    return 2 if v == "not-assessable" else 0


if __name__ == "__main__":
    sys.exit(main())
