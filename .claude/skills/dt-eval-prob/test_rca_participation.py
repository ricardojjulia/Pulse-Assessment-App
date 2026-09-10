"""Self-tests for rca_participation.py — the C-rcrel classifier.

The regression these pin: the superseded classifier read an ABSENT merge flag as
"merging allowed" and emitted an `rca_capable` verdict from it, reporting 100%
capable on two live estates whose streams measured 0.0% mergeable. Both estate
shapes are covered, because a fix that only handles the newly-observed one would
silently break the reference shape it was originally written for.

Run: python3 test_rca_participation.py
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rca_participation as rp

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILURES.append(name)


def detector(title="d", enabled=True, props=None, object_id="OBJ"):
    return {"objectId": object_id,
            "value": {"title": title, "enabled": enabled,
                      "eventTemplate": {"properties": [{"key": k, "value": v}
                                                       for k, v in (props or {}).items()]}}}


CUSTOM = {rp.TYPE_KEY: "CUSTOM_ALERT"}


# ── 1. The regression itself: absence must never read as "capable" ───────────
print("absence is unknown, never capable")
# A detector with NO flags and no event type — configuration establishes nothing.
v = rp.classify(detector(props={}))
check("no flags, no type -> unknown", v["verdict"] == rp.UNKNOWN, v["verdict"])
check("no 'capable' verdict exists at all", "capable" not in rp.VERDICTS)
check("classify never returns an rca_capable key", "rca_capable" not in v)
# The precise old-bug shape: absent merge flag on a custom-alert detector.
v = rp.classify(detector(props=CUSTOM))
check("absent flags + CUSTOM_ALERT -> not_capable_by_type",
      v["verdict"] == rp.NOT_CAPABLE_BY_TYPE, v["verdict"])
check("absence is not recorded as an explicit opt-out",
      v["merging_disabled_explicitly"] is False and v["rootcause_irrelevant_explicitly"] is False)


# ── 2. Reference estate shape (2026-07-28): explicit opt-out on ~98% ─────────
print("\nreference estate — explicit event-template opt-out")
ref = ([detector(f"r{i}", props={**CUSTOM, rp.MERGE_KEY: "false"}) for i in range(1254)]
       + [detector(f"r{i}", props={**CUSTOM, rp.MERGE_KEY: "true"}) for i in range(1)]
       + [detector(f"r{i}", props=CUSTOM) for i in range(21)])
s, _ = rp.summarize(ref)
check("explicit opt-outs counted", s["merging_disabled_explicitly"] == 1254, s)
check("explicit opt-outs verdicted not_capable", s["not_capable_explicit"] == 1254, s)
check("the 22 without an opt-out still fall to by-type (they emit CUSTOM_ALERT)",
      s["not_capable_by_type"] == 22, s)
check("nothing lands in unknown on this shape", s["unknown"] == 0, s)
check("lower bound is the total, not the explicit count", s["not_capable_total"] == 1276, s)
check("basis names the explicit opt-out", s["basis"] == "explicit event-template opt-out", s)


# ── 3. Live estate shape (2026-08-03): zero flags set, all CUSTOM_ALERT ──────
print("\nlive estate — zero flags set, exclusion by alert type")
live = [detector(f"l{i}", props=CUSTOM) for i in range(572)]
s, _ = rp.summarize(live)
check("zero explicit opt-outs found", s["merging_disabled_explicitly"] == 0, s)
check("all classified not_capable_by_type", s["not_capable_by_type"] == 572, s)
check("THE REGRESSION: not reported as capable", s["not_capable_total"] == 572, s)
check("lower bound is 100.0, not 0.0", s["not_capable_pct_lower_bound"] == 100.0, s)
check("basis names the alert type", s["basis"] == "emitted alert type", s)
check("summary carries no rca_capable key", "rca_capable" not in s)


# ── 4. Enabled-only scoping ──────────────────────────────────────────────────
print("\nenabled-only scoping")
mixed = ([detector("on", enabled=True, props=CUSTOM)] * 3
         + [detector("off", enabled=False, props=CUSTOM)] * 7)
s, _ = rp.summarize(mixed)
check("scored counts enabled only", s["scored"] == 3, s)
check("population still reported", s["detectors"] == 10 and s["enabled"] == 3, s)
s_all, _ = rp.summarize(mixed, enabled_only=False)
check("--all widens the denominator", s_all["scored"] == 10, s_all)


# ── 5. Either flag alone is sufficient for not_capable ───────────────────────
print("\neither explicit flag is sufficient")
v = rp.classify(detector(props={rp.RCREL_KEY: "false"}))
check("rootcause_relevant false alone -> not_capable", v["verdict"] == rp.NOT_CAPABLE, v["verdict"])
v = rp.classify(detector(props={rp.MERGE_KEY: "false"}))
check("merging false alone -> not_capable", v["verdict"] == rp.NOT_CAPABLE, v["verdict"])
# String values, not booleans — a real config carries "false", never False.
v = rp.classify(detector(props={rp.MERGE_KEY: False}))
check("boolean False is not the string 'false' (would be a parse bug upstream)",
      v["merging_disabled_explicitly"] is False, v)


# ── 6. A non-excluded alert type stays unknown, not capable ──────────────────
print("\nnon-excluded alert types")
v = rp.classify(detector(props={rp.TYPE_KEY: "RESOURCE_CONTENTION"}))
check("unrecognized type -> unknown (still not 'capable')", v["verdict"] == rp.UNKNOWN, v["verdict"])


# ── 7. The reportable phrase never reads as an all-clear ─────────────────────
print("\nthe reportable phrase")
s, _ = rp.summarize([detector(props={rp.TYPE_KEY: "RESOURCE_CONTENTION"})])
p = rp.phrase(s)
check("a silent result says 'could not be established'", "could not be established" in p, p)
check("a silent result explicitly denies being clean", "not a clean result" in p, p)
s, _ = rp.summarize(live)
p = rp.phrase(s)
check("a positive result is phrased as a lower bound", p.startswith("At least "), p)


# ── 8. CLI works on a saved dump in either envelope shape ────────────────────
print("\nCLI over a saved dump")
with tempfile.TemporaryDirectory() as td:
    p = Path(td) / "dump.json"
    p.write_text(json.dumps({"ok": True, "result": live}))
    out = subprocess.run([sys.executable, str(Path(__file__).parent / "rca_participation.py"), str(p)],
                         capture_output=True, text=True)
    check("CLI exits 0", out.returncode == 0, out.stderr[:200])
    got = json.loads(out.stdout)
    check("CLI reports the lower bound", got["not_capable_total"] == 572, got)
    p.write_text(json.dumps(live))          # bare list, no envelope
    out = subprocess.run([sys.executable, str(Path(__file__).parent / "rca_participation.py"), str(p)],
                         capture_output=True, text=True)
    check("CLI accepts a bare list too", json.loads(out.stdout)["not_capable_total"] == 572)


print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
    sys.exit(1)
print("all rca_participation self-tests passed")
