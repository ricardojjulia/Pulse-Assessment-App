#!/usr/bin/env python3
"""
build_ruleset.py — generate noise-ruleset.json from the Alerting Thresholds workbook.

The spreadsheet is the SOURCE OF TRUTH for the consultant's threshold opinions.
This script transcribes it into a machine-readable ruleset the Problem Noise skill
reads every run: each row becomes a rule mapped to its Dynatrace settings schema,
carrying default / suggested-prod / suggested-lower values plus a noise-risk tag.

Usage (from the repo root, with the repo venv):
    .venv/bin/python .claude/skills/dt-eval-prob/build_ruleset.py "/path/to/Alerting Thresholds.xlsx"
    # writes ./noise-ruleset.json next to this script

Re-run whenever the workbook changes. Nothing else edits noise-ruleset.json by hand.

FIELD-HINT VERIFICATION IS PER-FAMILY (see VERIFIED_FAMILIES). Families verified against
a live schema read (2026-07-28: kubernetes.node, kubernetes.pvc, services, and most of
kubernetes.workload) carry hints that matched the real keys; every other family's hint is
still a best-effort guess. Either way the skill resolves the real value path at runtime
(Phase 2 calibration reads the live schema JSON and matches by label) — a verified hint is
a strong seed, never a skipped step.
"""
import json
import os
import re
import sys

# ---- Area -> Dynatrace settings schema (confirmed present on a live tenant) ----
AREA_SCHEMA = {
    "Host":                 "builtin:anomaly-detection.infrastructure-hosts",
    "Disks":                "builtin:anomaly-detection.infrastructure-disks",
    "Web Applications":     "builtin:anomaly-detection.rum-web",
    "Services":             "builtin:anomaly-detection.services",
    "Database Services":    "builtin:anomaly-detection.databases",
    "Kubernetes Cluster":   "builtin:anomaly-detection.kubernetes.cluster",
    "Kubernetes Node":      "builtin:anomaly-detection.kubernetes.node",
    "Kubernetes Namespace": "builtin:anomaly-detection.kubernetes.namespace",
    "Kubernetes Workload":  "builtin:anomaly-detection.kubernetes.workload",
    "Kubernetes PVCs":      "builtin:anomaly-detection.kubernetes.pvc",
}

# ---- Alert text -> field_hint + noise_risk ----
# noise_risk: high = a known top noise generator (also seen in a reference run's top problem
# titles); med = moderate; low = rarely noisy / usually off.
# Keyed by a normalized (lowercased, collapsed) alert string.
# K8s node/workload/pvc and services hints below are the LIVE-VERIFIED keys (2026-07-28
# schema read); the rest are unverified seeds — see VERIFIED_FAMILIES.
HINTS = {
    "detect host or monitoring connection lost problems": ("connectionLostDetection", "low"),
    "detect cpu saturation on host":                      ("cpuSaturation", "high"),
    "detect high system load":                            ("highSystemLoad", "med"),
    "detect high memory usage":                           ("highMemory", "high"),
    "detect high gc activity java":                       ("highGcActivity", "high"),
    "detect java out of memory problem":                  ("outOfMemory", "low"),
    "detect java out of threads problem":                 ("outOfThreads", "low"),
    "detect high number of dropped packets":              ("droppedPackets", "med"),
    "detect high number of network errors":               ("networkErrors", "med"),
    "detect high network utilization":                    ("highNetworkUtilization", "med"),
    "detect tcp connectivity problems for process":       ("connectivity", "low"),
    "detect high retransmission rate":                    ("highRetransmission", "med"),
    "detect slow-running disks":                          ("slowRunningDisks", "low"),
    "detect low inodes number available":                 ("lowInodes", "med"),
    "detect key performance metric degradations":         ("responseTimeDegradation", "med"),
    "detect key performance metric degradations slowest 10": ("responseTimeDegradationSlowest", "med"),
    "detect increases in javascript errors":              ("errorRateIncrease", "med"),
    "detect traffic drops":                               ("trafficDrop", "high"),
    "detect traffic spikes":                              ("trafficSpike", "low"),
    "detect response time degradations":                  ("responseTime", "high"),
    "detect response time degradations slowest 10":       ("responseTimeSlowest", "high"),
    "detect increases in failure rate":                   ("failureRate", "high"),
    "service load drops":                                 ("loadDrops", "med"),
    "service load spikes":                                ("loadSpikes", "low"),
    "database failed connects":                           ("failedConnections", "med"),
    "detect cluster readiness":                           ("readiness", "low"),
    "detect cluster cpu-request saturation":              ("cpuRequestSaturation", "low"),
    "detect cluster memory-request saturation":           ("memoryRequestSaturation", "low"),
    "detect cluster pod-saturation":                      ("podSaturation", "low"),
    "detect monitoring issues":                           ("monitoringIssues", "low"),
    "detect node readiness issues":                       ("readinessIssues", "low"),
    "detect problematic node conditions":                 ("nodeProblematicCondition", "med"),
    "detect node cpu-request saturation":                 ("cpuRequestsSaturation", "low"),
    "detect node memory-request saturation":              ("memoryRequestsSaturation", "low"),
    "detect node pod-saturation":                         ("podsSaturation", "low"),
    "detect namespace cpu-request quota saturation":      ("cpuRequestQuota", "low"),
    "detect namespace cpu-limit quota saturation":        ("cpuLimitQuota", "low"),
    "detect namespace memory-request quota saturation":   ("memoryRequestQuota", "low"),
    "detect namespace memory-limit quota saturation":     ("memoryLimitQuota", "low"),
    "detect namespace pod quota saturation":              ("podQuota", "low"),
    "detect container restarts":                          ("containerRestarts", "high"),
    "detect stuck depoyments":                            ("deploymentStuck", "med"),
    "detect stuck deployments":                           ("deploymentStuck", "med"),
    "detect pods stuck in pending":                       ("pendingPods", "high"),
    "detect pods stuck in terminating":                   ("podStuckInTerminating", "med"),
    "detect workloads without ready pods":                ("workloadWithoutReadyPods", "med"),
    "detect workoads with non-ready pods":                ("nonReadyPods", "low"),
    "detect workloads with non-ready pods":               ("nonReadyPods", "low"),
    "detect memory usage saturation":                     ("highMemoryUsage", "low"),
    "detect cpu usage saturation":                        ("highCpuUsage", "low"),
    "detect high cpu throttling":                         ("highCpuThrottling", "low"),
    "detect out-of-memory kills":                         ("oomKills", "med"),
    "detect job failure events":                          ("jobFailureEvents", "med"),
    "detect pod backoff events":                          ("podBackoffEvents", "high"),
    "detect pod eviction events":                         ("podEvictionEvents", "med"),
    "detect pod preemption events":                       ("podPreemption", "low"),
    "detect low disk space mib":                          ("lowDiskSpaceCritical", "low"),
}

# Area-scoped hints for alerts whose normalized text COLLIDES across areas.
# norm() strips "(%)"/"(MiB)" parentheses, so the Disks "Detect low disk space"
# and the Kubernetes PVC "Detect low disk space (%)" normalize to the same
# string — a flat HINTS literal silently keeps only the last entry (this bit:
# the generated N13 Disks rule carried the PVC hint). Keyed by
# (normalized area, normalized alert); resolve_hint() consults this first.
AREA_HINTS = {
    ("disks", "detect low disk space"):           ("lowDiskSpace", "high"),
    ("kubernetes pvcs", "detect low disk space"): ("lowDiskSpaceCriticalPercentage", "med"),
}


# Per-family field_hint verification state, emitted into meta.field_hints_verified.
# true = every hint in the family matched a live schema read (2026-07-28).
VERIFIED_FAMILIES = {
    "builtin:anomaly-detection.kubernetes.node": True,
    "builtin:anomaly-detection.kubernetes.pvc": True,
    "builtin:anomaly-detection.kubernetes.workload":
        "partial — N52 (nonReadyPods) and N60 (podPreemption) not covered by the 2026-07-28 read",
    "builtin:anomaly-detection.services": True,
}

# Live-verified value shapes (2026-07-28), emitted into meta.value_shapes so
# Phase-2 calibration does not rediscover them each run.
VALUE_SHAPES = {
    "_note": ("Live-verified value shapes (2026-07-28) so Phase-2 calibration does not "
              "have to rediscover them each run."),
    "kubernetes_family": {
        "shape": {"<detectorKey>": {"enabled": True, "configuration": {
            "threshold": 5, "observationPeriodInMinutes": 5, "samplePeriodInMinutes": 5}}},
        "note": ("Consistent across kubernetes.node/workload/namespace/pvc; 'threshold' "
                 "present on some detectors only."),
    },
    "services": {
        "shape": {
            "responseTime": {"enabled": True, "detectionMode": "auto", "autoDetection": {
                "responseTimeAll": {"degradationMilliseconds": 200, "degradationPercent": 50},
                "responseTimeSlowest": {"slowestDegradationMilliseconds": 1000,
                                        "slowestDegradationPercent": 100},
                "overAlertingProtection": {"minutesAbnormalState": 1, "requestsPerMinute": 10}}},
            "failureRate": {"enabled": True, "detectionMode": "auto", "autoDetection": {
                "absoluteIncrease": 5, "relativeIncrease": 50,
                "overAlertingProtection": {"minutesAbnormalState": 5, "requestsPerMinute": 10}}},
            "loadDrops": {"enabled": False}, "loadSpikes": {"enabled": False}},
        "note": ("builtin:anomaly-detection.services nests fixed/auto config under "
                 "detectionMode + autoDetection; the slowest-10% read lives at "
                 "responseTime.autoDetection.responseTimeSlowest, and the load keys are "
                 "plural (loadDrops/loadSpikes)."),
    },
}


def norm(s):
    s = ("" if s is None else str(s)).strip().lower()
    s = re.sub(r"[()%/,]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def resolve_hint(area, alert):
    """(field_hint, noise_risk) for a workbook row — area-scoped entries win.

    AREA_HINTS disambiguates alerts whose normalized text collides across
    areas; everything else falls through to the flat HINTS seed map.
    """
    scoped = AREA_HINTS.get((norm(area), norm(alert)))
    if scoped:
        return scoped
    return HINTS.get(norm(alert), (None, "med"))


def classify_change(default, sug_prod, sug_lower):
    """Derive a change_type and noise_lever by comparing default to the suggestion.

    change_type: keep_default | loosen | disable | enable | tune
    noise_lever: reduce (fewer alerts) | coverage (more alerts, intentional) | neutral
    """
    d = norm(default)
    p = norm(sug_prod)
    if not p:  # no prod suggestion -> keep as is
        return "keep_default", "neutral"
    if "disabled" in p and "disabled" not in d:
        return "disable", "reduce"
    if "disabled" in d and ("automatic" in p or "enabled" in p):
        return "enable", "coverage"
    if "disabled" in d and "disabled" in p:
        return "keep_default", "neutral"
    # both are thresholds/settings that differ -> a tuning change; treat as noise-reduce
    # (the workbook's prod suggestions consistently loosen defaults to cut noise)
    return "loosen", "reduce"


def main():
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl required: .venv/bin/pip install openpyxl (or re-run ./setup.sh)")

    if len(sys.argv) < 2:
        sys.exit("usage: build_ruleset.py '<Alerting Thresholds.xlsx>'")
    xlsx = sys.argv[1]
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb["Threshold"] if "Threshold" in wb.sheetnames else wb.worksheets[0]

    rows = list(ws.iter_rows(values_only=True))
    header = [str(c).strip() if c else "" for c in rows[0]]
    # expected: Area | Alert | Default | Suggested Prod | Suggested Lower | Actual Prod | Actual Lower | Notes

    rules = []
    current_area = None
    rid = 0
    for r in rows[1:]:
        cells = list(r) + [None] * (8 - len(r))
        area, alert, default, sug_prod, sug_lower, act_prod, act_lower, notes = cells[:8]
        if area and str(area).strip():
            current_area = str(area).strip()
        if not alert or not str(alert).strip():
            continue
        alert = str(alert).strip()
        schema = AREA_SCHEMA.get(current_area, None)
        hint, risk = resolve_hint(current_area, alert)
        change_type, lever = classify_change(default, sug_prod, sug_lower)
        rid += 1
        rules.append({
            "id": f"N{rid:02d}",
            "area": current_area,
            "alert": alert,
            "schema": schema,
            "field_hint": hint,          # UNVERIFIED seed — resolve at runtime
            "default": (str(default).strip() if default else None),
            "suggested_prod": (str(sug_prod).strip() if sug_prod else None),
            "suggested_lower": (str(sug_lower).strip() if sug_lower else None),
            "ref_actual_prod": (str(act_prod).strip() if act_prod else None),
            "ref_actual_lower": (str(act_lower).strip() if act_lower else None),
            "ref_notes": (str(notes).strip() if notes else None),
            "change_type": change_type,
            "noise_lever": lever,
            "noise_risk": risk,
        })

    out = {
        "meta": {
            "source_workbook": os.path.basename(xlsx),
            "generated_by": "build_ruleset.py",
            "field_hints_verified": {
                "_note": ("Per-family. true = every hint in the family matched a live "
                          "schema read (2026-07-28); false = still the unverified "
                          "build_ruleset.py seed. Runtime label-resolution (SKILL.md "
                          "Phase 2) still applies to every family — a verified hint is "
                          "a strong seed, not a skipped step."),
                **{schema: VERIFIED_FAMILIES.get(schema, False)
                   for schema in sorted({r["schema"] for r in rules})},
            },
            "value_shapes": VALUE_SHAPES,
            "schema_ids_verified_on": "a live tenant",
            "rule_count": len(rules),
            "resolution_contract": (
                "Recommended prod value = suggested_prod if set, else ref_actual_prod if it "
                "differs from default (a realized recommendation), else keep default. "
                "Recommended lower value = suggested_lower if set, else ref_actual_lower if it "
                "differs from default, else the prod recommendation. field_hint verification is per-family "
                "(meta.field_hints_verified); unverified families are search seeds. Either way "
                "the skill reads the live schema JSON at runtime and matches by label "
                "to find the real value path before reporting an Actual or proposing a change."
            ),
            "environment_scoping": (
                "prod vs lower is decided per host group / segment (Phase 2). Apply suggested_prod "
                "to production-scoped entities and suggested_lower to non-prod. Many Kubernetes "
                "workload detectors are intentionally disabled in lower environments (see "
                "ref_actual_lower)."
            ),
            "columns_legend": {
                "default": "Dynatrace out-of-box value",
                "suggested_prod": "consultant-recommended production value (blank = keep default)",
                "suggested_lower": "consultant-recommended non-prod value (blank = keep default)",
                "ref_actual_prod": "reference tenant's realized prod value (illustrative)",
                "ref_actual_lower": "reference tenant's realized non-prod value (illustrative)",
                "change_type": "keep_default | loosen | disable | enable | tune",
                "noise_lever": "reduce | coverage | neutral",
                "noise_risk": "high | med | low (likelihood this detector is a noise source)",
            },
        },
        "rules": rules,
    }

    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "noise-ruleset.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {dest} — {len(rules)} rules across {len(set(r['area'] for r in rules))} areas")


def self_test():
    """Stdlib-only regression test (no xlsx needed): run with --self-test."""
    import ast as _ast
    import collections as _collections

    # The collision that bit: Disks vs Kubernetes PVC "Detect low disk space".
    assert resolve_hint("Disks", "Detect low disk space") == ("lowDiskSpace", "high")
    assert resolve_hint("Kubernetes PVCs", "Detect low disk space (%)") == \
        ("lowDiskSpaceCriticalPercentage", "med")
    assert resolve_hint("Kubernetes PVCs", "Detect low disk space (MiB)") == \
        ("lowDiskSpaceCritical", "low")
    # Flat-map fallthrough and the unknown-alert default.
    assert resolve_hint("Host", "Detect CPU saturation on host") == ("cpuSaturation", "high")
    assert resolve_hint("Host", "no such alert") == (None, "med")

    # Guard against the bug class itself: no duplicate keys may reappear in the
    # HINTS literal (a Python dict literal keeps only the last entry, silently).
    tree = _ast.parse(open(__file__, encoding="utf-8").read())
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Assign) and getattr(node.targets[0], "id", "") == "HINTS":
            keys = [_ast.literal_eval(k) for k in node.value.keys]
            dupes = [k for k, c in _collections.Counter(keys).items() if c > 1]
            assert not dupes, f"duplicate HINTS keys (later entries silently win): {dupes}"
    print("build_ruleset self-test OK")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        self_test()
    else:
        main()
