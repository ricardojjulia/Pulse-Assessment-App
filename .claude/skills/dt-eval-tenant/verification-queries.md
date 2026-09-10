# Self-service verification queries — client-runnable DQL per finding class

**Purpose:** every ⚠️/💡 finding in a delivered report gets a query the client can run themselves — in a Notebook, no special tooling — to reproduce the finding today and re-check it after remediation. This is a **mandatory report appendix** (SKILL.md Phase 5). Model: per check — *what it verifies → the DQL → how to read the result*.

**This file is also machine-read.** `.dt-eval-common/build_validation_notebook.py` generates the optional **Validation Notebook** deliverable straight from it — every `**V<n> — title**` heading becomes a section, its fenced DQL blocks become query sections, its `Read as:` line becomes the how-to-read text, and its GUI-map row becomes the see-it/change-it path. So: keep the heading form, keep a `Read as:` line, and give every new check either a DQL block or a GUI row — **a check with neither fails the notebook build**, by design. Internal shorthand in these cells (probe IDs, sibling `V` numbers, scoring acronyms, BPN codenames) is stripped by the builder and the strip is asserted, so it stays legal to write here.

**Rules:**
- **DQL-first, effect over config.** Where a finding came from a settings read (routing entries, default-mode, detector rules), give the client the query that verifies the *effect* in Grail — that's what they can run with `storage:*:read`, and it's what proves remediation worked. Only fall back to a read-only CLI one-liner when no Grail effect exists.
- **Client-safe:** no internal doc names, no evidence-file names, no dtctl context names. Cost guardrails stay in the query (2-min unscoped log windows).
- **Scopes line:** the pack states the read scopes needed (`storage:logs:read`, `storage:entities:read`, `storage:events:read`, `storage:metrics:read`, `storage:buckets:read`).

## The catalog (finding class → verification)

### Fully DQL (client can self-verify end to end)

**V1 — Log routing health / bucket population** (verifies routing findings + remediation)
```
fetch dt.system.buckets
| filter dt.system.table == "logs"
| fields bucket = dt.system.bucket, records, retentionDays = dt.system.retention_days
| sort records desc
```
```
fetch logs, bucket:"<your-bucket>", from:-24h | summarize records = count(), latest = max(timestamp)
```
```
fetch logs, from:-2m
| summarize total = count(),
    in_default = countIf(dt.system.bucket == "default_logs"),
    in_custom = countIf(dt.system.bucket != "default_logs")
```
Read as: ✅ records spread across purpose-built buckets, recent arrivals in each · ⚠️ big lifetime counts with 0/24 h (routing regressed) or ~100% in default_logs.

**V2 — Record-level access control + cost allocation (ABAC / FinOps tags)**
```
fetch logs, from:-2m
| summarize total = count(),
    null_security_context = countIf(isNull(dt.security_context)),
    null_costcenter = countIf(isNull(dt.cost.costcenter))
```
Read as: ✅ near-0% null · ⚠️ ~100% null = boundaries/chargeback have nothing to match. Billing side: `timeseries u = sum(dt.billing.logs.ingest.usage_by_costcenter), by:{costcenter}, from:-7d` — all-null costcenter = unattributed consumption.

**V3 — Detection: dead rule inputs + alert concentration**
```
metrics | filter startsWith(metric.key, "log.") | summarize log_metrics = count()
```
```
fetch dt.davis.problems, from:-24h
| filter event.category == "CUSTOM_ALERT"
| summarize alerts = count(), by:{event.name} | sort alerts desc | limit 10
```
Read as: log_metrics = 0 while alert rules query `log.*` = those rules are blind · one event.name dominating = a single rule owns the pager.

**V4 — Host monitoring mode (coverage ladder)**
```
fetch dt.entity.host | fieldsAdd mode = monitoringMode | summarize hosts = count(), by:{mode} | sort hosts desc
```
Read as: ✅ app hosts FULL_STACK · ⚠️ high INFRASTRUCTURE share on hosts running app code.

**V5 — What genuinely pages: top problems**
```
fetch dt.davis.problems, from:-24h | summarize n = count(), by:{event.name} | sort n desc | limit 10
```
Read as: compare the top names against what on-call actually works on; test/audit names at the top = noise displacing signal.

**V6 — Business events flowing?**
```
fetch bizevents, from:-1h | summarize events = count()
```
Read as: 0 = business analytics has no substrate.

**V7 — Synthetic coverage**
```
fetch dt.entity.synthetic_test | summarize browser_monitors = count()
fetch dt.entity.http_check | summarize http_monitors = count()
```
Read as: 0 + 0 = no outside-in availability signal.

**V8 — Tag hygiene at source (typos, duplicate concepts, missing keys)**
```
fetch dt.entity.host | expand tags | parse tags, "LD:key ':' LD:val"
| summarize hosts = count(), by:{key} | sort hosts desc | limit 30
```
Read as: typo'd keys, same concept under multiple keys, absent team/cost-center/environment keys = ownership routing and cost allocation can't key on tags.

**V9 — OneAgent version spread (fleet drift)**
```
fetch dt.entity.host, from:-5m
| fields id, installerVersion
| parse installerVersion, "INT PUNCT INT: version PUNCT INT"
| summarize hosts = count(), by:{version} | sort version desc
```
Read as: cohorts several versions behind = update process gap.

**V10 — ActiveGate fleet: zones + data loss (via self-monitoring metrics)**
```
timeseries cpu = avg(dt.sfm.active_gate.system.cpu_usage),
  by:{dt.active_gate.id, dt.network_zone.id}, from:-24h
| summarize gates = countDistinctExact(dt.active_gate.id), by:{dt.network_zone.id}
```
```
timeseries dropped = max(dt.sfm.active_gate.communication.messages.dropped, default:0),
  by:{dt.active_gate.id}, from:-24h
| fieldsAdd max_dropped = arrayMax(dropped) | fields dt.active_gate.id, max_dropped
```
Read as: all gates in `default` zone = no traffic-locality design · any dropped > 0 = data loss.

**V11 — K8s log enrichment + parsing quality (the healthy checks — for re-verification after changes)**
```
fetch logs, from:-2m
| summarize k8s = countIf(isNotNull(k8s.namespace.name)),
    k8s_missing_cluster = countIf(isNotNull(k8s.namespace.name) and isNull(k8s.cluster.name)),
    null_loglevel = countIf(isNull(loglevel))
```

**V12 — Security signal reachability (AppSec live or dark?)**
```
fetch security.events, from:-24h | summarize n = count(), by:{event.type} | sort n desc | limit 5
```
Read as: 0 with read access granted = runtime security is off (a real finding, not a permission gap); vulnerability/compliance finding types present = live.

**V13 — Real-user monitoring alive?**
```
fetch user.sessions, from:-24h | summarize sessions = count()
```
Per-application split (the application dimension is `frontend.name`, an array — `app.short_name`/`application.name` are null and read as "0 apps" on a live RUM estate):
```
fetch user.sessions, from:-24h | expand frontend.name
| summarize sessions = count(), by:{frontend.name} | sort sessions desc
```
Read as: 0 = no user-impact statement possible on any problem; baselines and experience SLOs only start accruing at enablement.

**V14 — Consumption mix (the cost side of the mode ladder)**
```
timeseries fullstack = sum(dt.billing.full_stack_monitoring.usage),
           infra = sum(dt.billing.infrastructure_monitoring.usage),
           fnd = sum(dt.billing.foundation_and_discovery.usage), from:-7d, interval:1d
```
Read as: compare spend mix against the V4 mode split — paying Full-Stack rates on hosts whose deep monitoring is off (or vice versa) is the first FinOps fix.

**V15 — Resource-saturation pressure (cheap — dedicated Davis event buckets)**
```
fetch events, from:-24h
| filter in(dt.system.bucket, {"default_davis_events", "default_davis_custom_events", "default_k8s_ops_events"})
| filter event.kind == "DAVIS_EVENT"
| summarize events = countDistinctApprox(event.id), by:{event.name} | sort events desc | limit 10
// countDistinctApprox: the Exact form hard-fails above 1M values (a large estate exceeds that in 24 h)
```
Read as: sustained CPU/memory/disk saturation events = genuine capacity pressure that should own the pager over static-threshold noise.

**V16 — Estate hygiene: unmonitored candidates and stale entities**
```
smartscapeNodes HOST
| fieldsAdd state = if(getEnd(lifetime) >= now() - 10m, "RUNNING", else: "INACTIVE")
| summarize hosts = count(), candidates = countIf(isMonitoringCandidate == true), by:{state}
```
Read as: candidates > 0 = discovered machines with no monitoring (coverage opportunity); large INACTIVE share = stale entities inflating estate counts.

**V17 — Log source coverage vs host inventory**
```
fetch logs, from:-5m | summarize hosts_shipping_logs = countDistinctExact(host.name)
```
Read as: compare with V4's host total — hosts running workloads but shipping no logs are invisible to log-based evidence (short-window undercount is possible; widen deliberately).

**V18 — Effective Consumption (automation follow-through, config-as-code share, self-service spread, problem usefulness, query engagement)**

Client-runnable KPIs from the behavioral tables (30-day windows; `dt.system.*` scans are large but cheap and need no log guardrail). The full per-KPI set and the OES rollup are in the importable notebook — point the customer there.
```
// Automation follow-through (WFR) — target >= 85%
fetch dt.system.events, from:now()-30d
| filter event.kind=="WORKFLOW_EVENT" and event.type=="WORKFLOW_EXECUTION" and dt.automation_engine.state.is_final==true
| dedup {dt.automation_engine.workflow_execution.id}, sort:{timestamp desc}
| summarize triggered=count(), completed=countIf(dt.automation_engine.state=="SUCCESS")
| fieldsAdd WFR_pct = round(100.0*toDouble(completed)/toDouble(triggered), decimals:1)
```
```
// Config ownership concentration (COC, HHI) — target <= 0.4 (lower = more distributed)
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNull(authentication.token) and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize changes=count(), by:{user.id}
| summarize COC = round(sum(changes*changes)/(sum(changes)*sum(changes)), decimals:3), participants=countDistinct(user.id)
```
```
// Config-as-code share (CCS) — target >= 0.7 (share of config changes driven by token/automation)
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize total=count(), tokenDriven=countIf(isNotNull(authentication.token))
| fieldsAdd CCS = round(toDouble(tokenDriven)/toDouble(total), decimals:3)
```
Read as: low WFR next to a large scheduled-workflow inventory = polling automation that mostly fails; high COC = a few admins own all config (self-service bottleneck); low CCS = configuration is changed by hand rather than through a reviewed pipeline, so changes are hard to reproduce (the opportunity is Terraform/Monaco/API-driven configuration). Requires the read scope for `dt.system.events` / `dt.davis.problems` / `dt.system.query_executions` — the customer's own credentials usually have it.

```
// CCS quality decomposition — is the token-driven share real config-as-code or integration churn?
fetch dt.system.events, from:now()-30d
| filter event.kind=="AUDIT_EVENT" and isNotNull(authentication.token) and isNotNull(details.dt.settings.object_summary)
| filterOut in(user.id, {"UNKNOWN","system"})
| summarize n=count(), days=countDistinct(toString(bin(timestamp,1d))), by:{user.id, schema=details.dt.settings.schema_id}
| sort n desc | limit 15
```
```
// Signal modernity + problem lifecycle — what fills the problem stream, and for how long
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| fieldsAdd dur_min = (toLong(event.end) - toLong(event.start))/60000000000.0
| summarize problems=count(), med_dur_min=round(median(dur_min),decimals:1), p90_dur_min=round(percentile(dur_min,90),decimals:1), by:{event.category}
| sort problems desc
```
```
// AI-tier health — Gen3 analyzers running, and how cleanly (warnings are degraded, not failed)
fetch dt.system.events, from:now()-30d
| filter event.kind=="ANALYZER_EXECUTION_EVENT"
| summarize runs=count(), warnings=countIf(dt.analyzer.result_status=="SUCCESSFUL_WITH_WARNINGS"), by:{name=dt.analyzer.name}
| sort runs desc
```
```
// Problem-title concentration — is the stream distinct incidents or the same rules breaching?
fetch dt.davis.problems, from:now()-30d
| dedup {display_id}, sort:{timestamp desc}
| summarize n=count(), by:{title=event.name}
| sort n desc | limit 20
```
```
// Metadata-strategy baseline — which tag-key families exist, at what coverage?
fetch dt.entity.host
| expand tags | parse tags, "LD:key ':' LD:val"
| summarize hosts = countDistinct(id), by:{key}
| sort hosts desc | limit 30
```
Read as: one token actor hammering 1–2 settings types daily = an integration writing operational state, not config-as-code (a high-volume `builtin:alerting.maintenance-window` writer is its own hygiene finding); a `CUSTOM_ALERT`-dominated problem stream = ported threshold alerts that Davis root-cause analysis cannot attach to (migrate detection to Davis anomaly detectors as Full-Stack coverage grows); a large analyzer warnings share = the AI tier runs degraded — open the flagged detectors and check their input metrics' history depth; a handful of problem titles owning most of the stream = the same static rules breaching repeatedly (the top titles are the tuning worklist), and severity-in-title prefixes reveal an imported rule library; the tag-key inventory should show application / organization / environment key families at high coverage, host groups defined, and segments filtering on those dimensions — the minimum metadata strategy every estate needs.

**V19 — Trace health: error rate, instrumentation mix, ingest waste** (spans; keep to 5-min windows)
```
fetch spans, from:-5m
| summarize total=count(), failed=countIf(request.is_failed==true),
    otel=countIf(isNotNull(otel.scope.name)), oneagent=countIf(isNull(otel.scope.name)),
    health_noise=countIf(contains(span.name,"health") or contains(span.name,"ping"))
```
```
fetch spans, from:-5m | filter span.kind=="server"
| summarize total=count(), failed=countIf(request.is_failed==true), by:{svc=coalesce(service.name, dt.entity.service)}
| fieldsAdd err_pct=round(100.0*failed/total,decimals:2) | sort total desc | limit 15
```
Read as: use `request.is_failed` (not `span.status_code`, which is null on most spans); a service with a high `err_pct` = the unhealthy tier; a large `health_noise` share = you are paying to store readiness pings.

**V20 — Database monitoring (from spans — no DB agent needed)**
```
fetch spans, from:-5m | filter isNotNull(db.system)
| summarize calls=count(), errors=countIf(request.is_failed==true), p95_ms=percentile(duration,95)/1000000.0, by:{db.system, db.namespace}
| sort calls desc | limit 20
```
Read as: the `db.system` list = every database technology in play; a `p95_ms` outlier = the slow tier. (`db.statement` is null unless statement capture is enabled.)

**V21 — OpenTelemetry ingestion & collector health**
```
fetch spans, from:-5m | filter isNotNull(otel.scope.name)
| summarize spans=count(), by:{telemetry.sdk.language} | sort spans desc
```
```
timeseries send_failed=sum(otelcol_exporter_send_failed_spans, default:0), queue=max(otelcol_exporter_queue_size, default:0), from:-1h
```
Read as: `send_failed > 0` = the collector is dropping telemetry (data loss); a growing `queue` = backpressure. If most spans are OTel and the collector is lossy, your primary ingestion path is losing data.

**V22 — Kubernetes right-sizing & reliability**
```
timeseries req=avg(dt.kubernetes.container.requests_cpu), use=avg(dt.kubernetes.container.cpu_usage), from:-20m, to:-5m, interval:15m, by:{k8s.namespace.name, k8s.workload.name}
| fieldsAdd r=arrayLast(req), u=arrayLast(use)
| fieldsAdd util_pct=if(r > 0, round(100.0*u/r, decimals:1), else: null), unbounded=isNull(r)
| fields k8s.namespace.name, k8s.workload.name, r, u, util_pct, unbounded | sort r desc | limit 20
```
Run the same query on `requests_memory` vs `memory_working_set` for the memory side — usually the larger reservation of the two.
```
timeseries oom=sum(dt.kubernetes.container.oom_kills), restarts=sum(dt.kubernetes.container.restarts), from:-24h, by:{k8s.namespace.name, k8s.workload.name}
| fieldsAdd tot_oom=arraySum(oom), tot_restarts=arraySum(restarts) | fields k8s.namespace.name, k8s.workload.name, tot_oom, tot_restarts | sort tot_oom desc | limit 15
```
Sanity check before acting on any reclaimable-capacity figure — what is requested cannot exceed what the nodes actually have:
```
timeseries requested=sum(dt.kubernetes.container.requests_cpu), from:-20m, to:-5m, interval:15m, by:{k8s.cluster.name}
| fieldsAdd cluster_cpu_requested=arrayLast(requested)
```
```
timeseries allocatable=sum(dt.kubernetes.node.cpu_allocatable), from:-20m, to:-5m, interval:15m, by:{k8s.cluster.name}
| fieldsAdd cluster_cpu_allocatable=arrayLast(allocatable)
```
Read as: `util_pct` far below 100 = reserved CPU that is not being used, so the scheduler cannot hand it to anything else (capacity to reclaim); `unbounded` = no request set at all — a separate issue from over-reservation, and not a utilization number; `oom_kills > 0` = memory limits too low (crashloop risk). If requested exceeds allocatable, the aggregation is wrong — investigate before acting on it. Requests are a point-in-time spec value rather than a rate, so the window is short and offset slightly (a trailing window can return nulls on ingest lag; that is lag, not absence). The first two queries return the top 20/15 by reservation, not the whole estate. Census with `fetch dt.entity.kubernetes_cluster/kubernetes_node/cloud_application/cloud_application_namespace | summarize count()`.

**V23 — Core Web Vitals & RUM experience**
```
fetch user.events, from:-24h | filter isNotNull(web_vitals.largest_contentful_paint)
| summarize views=count(),
    lcp_p75_ms=percentile(web_vitals.largest_contentful_paint,75)/1000000.0,
    inp_p75_ms=percentile(web_vitals.interaction_to_next_paint,75)/1000000.0,
    cls_p75=percentile(web_vitals.cumulative_layout_shift,75)
```
```
fetch user.sessions, from:-24h | filter dt.rum.user_type=="real_user"   // values are lowercase: real_user / robot / synthetic (third value verified 2026-07-29; its application.type is null)
| summarize sessions=count(), replay=countIf(characteristics.has_replay==true), err_sessions=countIf(error.count>0), crashed=countIf(error.has_crash==true)
```
Read as: LCP/INP are nanoseconds (÷1e6 for ms) — LCP ≤2500 ms / INP ≤200 ms / CLS ≤0.1 are "Good"; poor CWV = RUM enabled but experience not being acted on. `replay/sessions` = Session Replay coverage.

**V24 — Synthetic availability (metric-based)**
```
timeseries avail=avg(dt.synthetic.browser.availability), from:-24h, by:{dt.entity.synthetic_test}
| fieldsAdd a=round(arrayAvg(avail),decimals:2) | fields dt.entity.synthetic_test, a | sort a asc | limit 15
```
Read as: sort ascending to see the failing monitors first; a monitor < 100% while the service's spans look healthy = an outside-in path (DNS/TLS/CDN) failing. Run the twin on `dt.synthetic.http.availability`.

**V25 — SLO SLIs & coverage**
```
timeseries total=sum(dt.service.request.count), failures=sum(dt.service.request.failure_count), from:-24h, interval:1h
| fieldsAdd sli_pct=((arraySum(total)-arraySum(failures))/arraySum(total))*100
```
Read as: compute this for your top-traffic services, then compare the SLO count (`dtctl get slos` / SLO app) against the service count — reliability targets covering a single-digit % of services = most of the estate has no error budget.

**V26 — Application Security: vulnerability reachability triage**
```
fetch security.events, from:-24h | filter event.type=="VULNERABILITY_STATE_REPORT_EVENT"
| dedup {vulnerability.display_id}, sort:{timestamp desc} | filter event.status=="OPEN"
| summarize open=count(),
    internet_exposed=countIf(vulnerability.davis_assessment.exposure_status=="PUBLIC_NETWORK"),
    exploit_avail=countIf(vulnerability.davis_assessment.exploit_status=="AVAILABLE"),
    func_in_use=countIf(vulnerability.davis_assessment.vulnerable_function_status=="IN_USE"),
    by:{level=vulnerability.davis_assessment.level} | sort open desc
```
Read as: the must-fix list is the intersection (internet-exposed **and** exploit-available **and** function-in-use), not the raw critical count. RAP check: `event.type=="ATTACK_EVENT"` — zero rows on public services = runtime protection not blocking. Requires `storage:security.events:read`.

**V27 — Compliance posture by framework**
```
fetch security.events, from:-24h | filter event.type=="COMPLIANCE_FINDING"
| dedup {compliance.rule.id, compliance.result.object.name}, sort:{timestamp desc}
| summarize total=count(), failed=countIf(compliance.result.status.level=="FAILED"), by:{standard=compliance.standard.short_name}
| fieldsAdd fail_pct=round(100.0*failed/total,decimals:1) | sort failed desc | limit 12
```
Read as: focus on the framework you are regulated under (CIS/PCI DSS/HIPAA/GDPR/…); a rising `fail_pct` there is the audit-exposure signal.

**V28 — Davis efficacy (signal-to-problem compression)**
```
fetch dt.davis.events, from:-24h | summarize signals=count()
| append [ fetch dt.davis.problems, from:-24h | dedup {display_id} | summarize problems=count() ]
| summarize signals=max(signals), problems=max(problems) | fieldsAdd compression=round(toDouble(signals)/toDouble(problems),decimals:1)
```
Read as: high compression (many signals per problem) = Davis is correlating; a low ratio next to high alert volume = you're being paged on raw events, not root causes.

**V29 — Mobile crash rate** *(session value `dt.rum.application.type=="mobile"` verified live 2026-07-29 — lowercase, filter works as written; group by `expand frontend.name`, not `app.name`)*
```
fetch user.sessions, from:-24h | filter dt.rum.application.type=="mobile"
| summarize sessions=count(), crashed=countIf(error.has_crash==true), anr=sum(error.anr_count), by:{app=app.name}
| fieldsAdd crash_rate_pct=round(100.0*crashed/sessions,decimals:2) | sort sessions desc
```
Read as: `dt.entity.mobile_application` entities with zero sessions = the mobile agent shipped but is dark; a rising `crash_rate_pct` or ANR count = mobile reliability regressions.

**V30 — Enrichment ratio (ABAC + FinOps readiness across the foundation entities)**
```
fetch dt.entity.host | fieldsAdd t=toString(tags) | summarize total=count(), sec=countIf(contains(t,"security_context")), cc=countIf(contains(t,"costcenter")), prod=countIf(contains(t,"cost.product"))
| append [ fetch dt.entity.service | fieldsAdd t=toString(tags) | summarize total=count(), sec=countIf(contains(t,"security_context")), cc=countIf(contains(t,"costcenter")), prod=countIf(contains(t,"cost.product")) ]
| summarize total=sum(total), sec=sum(sec), cc=sum(cc), prod=sum(prod)
| fieldsAdd sec_pct=round(100.0*sec/total,decimals:1), cc_pct=round(100.0*cc/total,decimals:1)
```
Read as: `dt.security_context`/`dt.cost.*` live inside the `tags` object (not dedicated fields) — match with `toString(tags)`+`contains`. Low `sec_pct` = ABAC boundaries and IAM policies have nothing to key on; low `cc_pct` = consumption can't be charged back. If your *records* carry these fields (V2) but your *entities* don't, enrichment lives only in the pipeline — segments and source-tag ownership won't see it.

**V31 — Masking / PII-sanitization posture (per enforcement layer)** — mostly config; validate the effect in the UI
```
// at ingest — log masking rules and whether they're enabled
dtctl get settings --schema builtin:logmonitoring.sensitive-data-masking-settings -o json
// at display — Session Replay masking preset (ALLOW_ALL while RUM is live = recording raw PII)
dtctl get settings --schema builtin:sessionreplay.web.privacy-preferences -o json
// IP masking set?  empty result = IPs stored unmasked
dtctl get settings --schema builtin:preferences.ipaddressmasking -o json
```
Read as: a built-in masking rule left `enabled:false`, a `recordingMaskingPreset` of `ALLOW_ALL`, or empty IP-masking while logs/RUM are flowing = unredacted PII landing in Grail. Cross-check with the compliance framework you're regulated under (V27). Requires `settings:objects:read`.

**V32 — Deep-monitoring gap: Full-Stack cost, Infrastructure value (FAQ-12 §4.2)**
```
// Full-Stack hosts...
fetch dt.entity.host | filter monitoringMode=="FULL_STACK" | summarize fullstack_hosts=count()
// ...vs hosts actually emitting spans in the window (short span window — cost-guarded)
fetch spans, from:-5m | summarize hosts_with_spans=countDistinctExact(dt.entity.host)
```
Read as: Full-Stack hosts materially exceeding the count of hosts producing spans = hosts paying Full-Stack rates whose process groups aren't producing traces — deep monitoring is likely disabled on their main PGs. Confirm the specific PG in the UI (**Settings → Process group monitoring**) or authoritatively per-PG: `dtctl get settings --schema builtin:process-group.monitoring.state --scope <PG-id>`.

**V33 — Gen3 migration progress (native cutover vs. classic residue, per domain)**
Classic *detection* residue — share of the problem stream still driven by ported thresholds:
```
fetch dt.davis.problems, from:-7d | dedup {display_id}
| summarize total = count(), custom = countIf(event.category == "CUSTOM_ALERT")
| fieldsAdd classic_share = custom / total
```
Native *alert delivery* — davis-problem workflow executions actually firing:
```
fetch dt.system.events, from:-30d
| filter event.kind == "WORKFLOW_EVENT" and event.type == "WORKFLOW_EXECUTION"
| summarize runs = count()
```

**V35 — Log processing: is anything actually falling through to the classic path?**
Ordered routing is first-match-wins, so the last enabled rule decides the fallback. Check for a
catch-all before concluding the classic pipeline is still carrying traffic:
```
dtctl get settings --schema builtin:openpipeline.logs.routing -o json \
  --jq '[.[0].value.routingEntries[] | select(.enabled and (.matcher|tostring|test("^\\s*true\\s*$")))] | length'
```
A result of 1 means **every** record is routed into a pipeline and nothing reaches the classic flow —
classic configuration is then residue to retire, not a live parallel path. A result of 0 means
unmatched records really do fall through. Then confirm the pipelines you are judging are the ones
being used, by joining the routing targets against the pipeline objects:
```
dtctl get settings --schema builtin:openpipeline.logs.routing -o json --jq '[.[0].value.routingEntries[].pipelineId]|unique|length'
dtctl get settings --schema builtin:openpipeline.logs.pipelines -o json --jq '[.[].objectId]|length'
```
If the routed-target count exceeds the pipeline count, or the two ID sets do not intersect, resolve
the gap before judging any pipeline: try `dtctl describe settings <pipelineId>` on a routed target.
A `403 No read share for object` means the pipeline exists but is not shared with your identity — the
stages cannot be assessed and need an object share (extension-provided pipelines stay readable, which
is why a partial result is common). Only if reads succeed and objects are still missing should you
look at pipeline **groups** or scope. Either way, do not report unreadable pipelines as absent. Finally, remember the bucket
distribution answers a **storage** question, not a processing one:
```
fetch logs, from:-2m | summarize n = count(), by:{dt.system.bucket} | sort n desc
```

**V34 — Maintenance-window suppression (measure the effect, not the object count)**
How much of the problem stream is being suppressed by maintenance windows:
```
fetch dt.davis.problems, from:-24h
| summarize total = count(), under_maint = countIf(maintenance.is_under_maintenance == true)
| fieldsAdd suppressed_pct = round(100.0 * under_maint / total, decimals: 1)
```
Whether the Gen3 window model is executing at all:
```
fetch dt.maintenance.windows, from:-24h | summarize executions = count()
```
Read against the configured window count (the two schema reads in the config one-liners above):
**windows configured but `under_maint` = 0** = the windows are scoping nothing they were meant to
catch — a real finding a config count reports as healthy; **`under_maint` materially > 0** = real
alerts are being suppressed, so check which recurring windows absorb them; **0 windows and
`under_maint` = 0** = an evidence-backed pass, far stronger than "none configured"; **windows present
but `executions` = 0** = the legacy windows do not emit to the Gen3 surface — say that rather than
concluding nothing ran. Requires `storage:events:read`; not readable = ⚪, never a failed check.
Classic *construct inventory* (0 = that domain migrated) — read-only CLI:
```
for s in builtin:management-zones builtin:alerting.profile builtin:problem.notifications builtin:tags.auto-tagging; do
  echo "$s: $(dtctl get settings --schema $s -o json | jq 'length')"
done
```
Native *scoping / tagging* — reuse V2 (record-level `dt.security_context` %), V30 (enrichment ratio), and the segment-effectiveness one-liner below.
Read per domain: **native signal present ∧ classic count 0 = migrated (✅)** · **both present = dual-running, mid-migration (💡)** · **classic only / native absent = not started (⚠️)**. High `classic_share` = detection still on ported thresholds; `runs = 0` with davis-problem workflows configured = native lane defined but not delivering.

**V36 — ActiveGate fleet version drift (Smartscape)**
```
smartscapeNodes ACTIVEGATE
| fields name, full = dt.active_gate.version, group = dt.active_gate.group.name, zone = dt.network_zone.id
| parse full, "INT PUNCT INT: version PUNCT INT"
| summarize ags = count(), gates = collectDistinct(name), by:{version}
| sort version desc
```
Read as: one version row = fleet in step · a minority cohort 1–2 sprint versions behind = update process lagging (the `gates` column names the stragglers) · ≥3 versions behind or 3+ version rows = drift needing a maintenance plan — check it against the auto-update policy (A25). Type name is `ACTIVEGATE` (`ACTIVE_GATE` returns 0 rows); **0 rows = no AGs visible in Smartscape, not proven absence** — fall back to the V10 metrics read. Auto-update *status* is not queryable (`AUTOUPDATE` in `modules[]` is module presence, not status) — verify it in the Deployment Status app.

**V37 — Alert-delivery liveness: configured vs executed workflow triggers**
```
fetch dt.system.events, from:now()-30d
| filter event.kind == "WORKFLOW_EVENT"
| summarize runs = count(), by:{title = dt.automation_engine.workflow.title,
                                trig  = dt.automation_engine.workflow_execution.trigger.type}
| sort runs desc
```
Read as: compare against your deployed, event-triggered workflows (Workflows app). **A deployed workflow with an active event trigger and zero rows here over 30 days is either a live alert-delivery outage or a workflow you believe is live and is not** — and if no row shows an Event trigger class while problems are being raised, nothing event-driven is executing at all. GUI: **Workflows** app → each workflow → Executions tab (should show runs); **Settings → search "Problem notifications"** for the delivery chain. Field prefix is `dt.automation_engine.*` — the natural short names return null.

**V38 — Management-zone population census (which zones actually contain entities)**
```
fetch dt.entity.host           | fields mz = managementZones | expand mz | summarize Hosts = count(), by:{mz}
| append [ fetch dt.entity.process_group | fields mz = managementZones | expand mz | summarize PGs = count(), by:{mz} ]
| append [ fetch dt.entity.service       | fields mz = managementZones | expand mz | summarize Services = count(), by:{mz} ]
| summarize Hosts = max(Hosts), PGs = max(PGs), Services = max(Services), by:{mz}
| sort Hosts desc
```
Read as: a zone in your Settings list but absent here matches **nothing** — if nothing consumes it either (no alerting profile, notification, metric event, or dashboard filter keyed on it), it is retirable without migration work. A populated zone whose dimension a segment already covers should show the **same population** through that segment — parity is the safe-to-retire gate. `managementZones` is an array: the `expand` is load-bearing — without it, grouping falls on membership *combinations* and populated zones read as empty. A null column after `append` means "none of that entity type", never "not measured". GUI: **Settings → search "management zones"** for the definition list; **Segments** app for the covering segment; compare entity counts in **Smartscape / Hosts** filtered by each.

**V39 — Source-tag propagation: which zone tag keys are primary Grail tags?**
```
smartscapeNodes HOST
| fieldsAdd t = toString(tags)
| summarize hosts = count(), keyA = countIf(contains(t, "<your-tag-key>")), keyB = countIf(contains(t, "<another-key>"))
```
Read as: a tag key your management zones filter on that shows on a **material share** of Smartscape hosts is a **primary Grail tag** — segments, IAM policies, and dashboards can key on it today. A key at zero (or a token handful of hosts) exists **only as a classic tag** — often computed by a classic auto-tagging rule — and **retires with classic**: establish it at the source first (host tags / K8s labels / cloud tags / OpenPipeline enrichment), then build the segment. Keys rendered as `[Azure]…` / `[Environment]…` in zone rules are imported metadata — segment on the native field (`azure.*`, host properties) rather than the tag string. GUI: **Smartscape** → any host → Tags (source tags) vs **Settings → search "automatically applied tags"** (the classic compute-side list).

**V40 — Notification delivery health (the platform's own delivery counters)**
```
timeseries n = sum(dt.sfm.server.notifications.problem_notifications),
  by: { notification.type, notification.display_name, notification.delivery_status, http_status_code },
  from:-7d
| fieldsAdd total = arraySum(n)
| fields notification.type, notification.display_name, notification.delivery_status, http_status_code, total
| sort total desc
```
Read as: every problem notification the platform attempted, per integration, with its outcome. Zero rows while problems are open and notifications are configured means nothing is being delivered at all. **This view is sorted by volume, so a busy healthy integration can push a failing one off the list — always run the failure-only view below before concluding delivery is healthy.** GUI: **Settings → search "Problem notifications"** → the failing integration (re-enter credentials / test); **Workflows** app → Executions for the workflow-side lanes. Requires `storage:metrics:read`.

**The failure-only view — run this one every time:**
```
timeseries n = sum(dt.sfm.server.notifications.problem_notifications),
  by: { notification.type, notification.display_name, notification.delivery_status, http_status_code },
  from:-7d, filter: { NOT matchesValue(notification.delivery_status, "Success") }
| fieldsAdd total = arraySum(n)
| fields notification.type, notification.display_name, notification.delivery_status, http_status_code, total
| sort total desc
```
Read as: **no rows = delivery is genuinely healthy. Any sustained rows = that integration is failing right now**, and the count is the true scale (this surface counts every attempt; sampling recent executions does not). A constant `401`/`403` is a broken or expired credential; a constant `400` is a payload or endpoint mismatch with the receiving API; `Could not connect` is a network/endpoint problem; `Email blocked by bounce list` means the subscribed people receive nothing even though the console still lists them. A couple of isolated failures across tens of thousands of attempts is ordinary network noise — judge on sustained volume per named integration. Worth running on a schedule: an expired credential otherwise surfaces weeks later.

**V41 — Metric ingest health: rejections and cardinality overflow**
```
timeseries r = sum(dt.sfm.server.metrics.rejections),
  by: { metric_key, rejectionreason }, from:-7d
| fieldsAdd total = arraySum(r)
| fields metric_key, rejectionreason, total
| sort total desc | limit 15
```
Read as: metric datapoints the platform refused, by key and reason. `Dimension limit reached for metric` = cardinality overflow — the metric silently has holes, and every chart or alert on it under-reads without any error. Fix at the source: drop or bucket the exploding dimension (job IDs, request IDs and container hashes are the usual culprits), or split the metric. GUI: **Metrics** browser → the named key (gaps visible); the ingest source that emits it (extension config / collector config) is where the dimension is dropped.

**V42 — Ingest capture rate (is the platform keeping up with your agents?)**
```
timeseries received = sum(dt.sfm.server.service_calls.received),
           processed = sum(dt.sfm.server.service_calls.processed),
  from:-24h, interval:1h
| fieldsAdd r = arraySum(received), p = arraySum(processed)
| fieldsAdd capture_pct = if(r >= 10000, round(100.0 * p / r, decimals:2))
| fields r, p, capture_pct
```
Read as: 100% = everything your agents sent was processed. Sustained values below ~98% mean adaptive capture or throttling is engaged — trace-based numbers are floors, not totals, until the cause (licensing ceiling, sizing) is resolved. **Check the `r` column before trusting the percentage:** the query deliberately returns a blank `capture_pct` below 10,000 calls in the window, because a ratio over a handful of datapoints reads as a perfect 100% and means nothing. A blank percentage with a small `r` is "not measurable here", not a pass. GUI: **Settings → search "Adaptive traffic management"**; account management for trace-volume entitlements.

**V33-E8 — Extension entity model (are entities Gen3-native?).** Classic extensions write `CUSTOM_DEVICE-*`; Gen3 extensions write typed nodes with no `id_classic`. A typed node with a populated `id_classic` = extension binary updated but configs not re-saved. This is a **new Grail surface** (unlike the classic-dashboard count). **Run the typed-node census FIRST — `troubleshooting.upsert_source` is sparsely populated in general (live: 6 of ~118k typed extension nodes), so a zero-row result from the filtered query below is the filter failing, never "migration not started"** (census query in probes-grail.md B33: `smartscapeNodes "*"` filtered to non-core types, `count()` + `countIf(isNotNull(id_classic))` by type):
```
smartscapeNodes "*"
| fields id, id_classic, upsert_source = troubleshooting.upsert_source
| filter startsWith(toString(upsert_source), "extension:")
| parse upsert_source, "'extension:' LD:extShortName '|'"
| summarize nodes = countDistinct(id), classicBacked = countDistinct(id_classic), by:{extShortName}
| fieldsAdd pctMigrated = if(nodes == 0, 0.0, else: round(100.0 * (nodes - classicBacked) / nodes, decimals:0))
| sort classicBacked desc
```
Read: `classicBacked` = 0 ∧ `nodes` > 0 = ✅ that extension is fully Gen3; `classicBacked` > 0 = 💡 configs still need re-saving (`pctMigrated` shows how far); an extension emitting metrics but with **0** nodes (join `metrics | filter startsWith(dt.openpipeline.source,"extension")`, see probes-grail.md B33) = ⚠️ binary not updated. **Weight by metric volume** (P1 >10k … P4 <100 datapoints) and call out any **P1/P2 not-started** extension — highest operational risk. `id_classic` is normal on core/K8s/service nodes; the `extension:` filter isolates real debt.

**V33-E5 — Dashboarding by real-user usage, NOT object count (the correction).** Gen3 dashboards run on Grail; classic dashboards do not. So real-user Grail engagement *is* the Gen3-usage signal — a native dashboard count can be high while day-to-day use stays on the classic surface. **Exclude Dynatrace staff** (`@dynatrace.com`) — their logins are not customer adoption:
```
fetch dt.system.query_executions, from:-30d
| filter isNull(client.internal_service_context) and query_pool != "AUTOMATION"
| filterOut in(user.id, {"UNKNOWN","system"})
| fieldsAdd isDynatraceStaff = endsWith(lower(coalesce(user.email,"")), "@dynatrace.com")
| summarize realUsers = countDistinct(if(not(isDynatraceStaff), user.id)),
            dynatraceStaff = countDistinct(if(isDynatraceStaff, user.id))
```
Read: near-zero `realUsers` while platform dashboards exist = users are still on classic → E5 = ⚠️/💡, **never ✅** (do not read native presence as leverage). A large `dynatraceStaff` count is the reason a naive engagement number over-reported adoption — name that share.

**V33-E9 — SLO model (did SLOs get upgraded?).** A3 and A37 are **disjoint populations, not a drill-down of each other** (live 2026-07-29: A3 = 0 while A37 held 278 tuned classic SLOs on the same tenant) — read both, report `<platform count> platform + <classic count> classic`, never substitute one for the other:
```
dtctl get settings --schema builtin:monitoring.slo -o json | jq 'length'   # A37 — classic SLOs (exact)
dtctl get slos -o json | jq 'length'                                       # A3 — platform-native SLOs (exact)
```
Corroborate the platform-native count live where useful (SLI = single DQL query; the enumeration surface beyond A3 is otherwise undocumented) — `dtctl get documents -o json` type-filtered for SLO documents · SLO Service Public API · a `dt.slo*`-metric presence tell. Read: classic present ∧ 0 native = ⚠️ · both = 💡 dual-running · only native = ✅. If A3 returns 0 and no corroborating live surface is reachable, grade on classic residue + confirmed native presence and **state the native count is verify-live — never fabricate it.**

**V43 — Management-zone query activity (is anyone actually querying this zone?).** The platform's own per-zone counter — this is the measurement that retires the old "usage is a proxy" caveat:
```
timeseries queries = sum(dt.sfm.server.management_zones.queries_counter, default:0),
  by: { dt.management_zone.name }, from:-7d
| fieldsAdd total = arraySum(queries)
| fields dt.management_zone.name, total
| sort total desc
```
Read: a zone absent from these results had **no queries in the window** — say it that way, never "unused", because self-monitoring retention is short and a zone serving a quarterly review reads silent on 7 days. A zone that IS queried but has no configured consumer is the useful catch: something outside the configuration (a classic dashboard filter, an external integration) depends on it, and retiring it would break that consumer silently. Retire-now still requires zero population **and** zero consumers **and** zero query activity.

**V44 — Which of my integrations break on upgrade day (classic API usage by caller).** The single most-asked migration question:
```
fetch dt.system.events, from:-24h
| filter event.kind == "AUDIT_EVENT" and event.provider == "CLASSIC_API"
| fieldsAdd resource = replacePattern(resource, "'/e/'[a-z]{3}[0-9]{5}'/'", "/")
| summarize calls = count(), by: { resource, authentication.token }
| sort calls desc | limit 25
```
Read: each row is a real caller hitting a classic endpoint today. **Classify the endpoint, do not just count the calls** — many classic paths survive the upgrade, so a large call count against a surviving endpoint is not migration debt. The endpoints that stop working are published in your environment's own **Check your upgrade readiness** dashboard. **This query returns API-token identifiers** — treat the output as sensitive, and map each token to its owner in **Settings → Access tokens** rather than pasting it anywhere.

**V45 — Which of my dashboards, notebooks and workflows use the classic entity model.** The platform flags these itself:
```
fetch dt.system.query_executions, from:-24h
| filter status == "SUCCEEDED"
| filter in(client.application_context, "dynatrace.dashboards", "dynatrace.automations",
            "dynatrace.notebooks", "dynatrace.site.reliability.guardian")
| filter in("CLASSIC_ENTITY_MIGRATION_ADVISED", flags)
| summarize executions = count(), by: { client.application_context, client.source }
| sort executions desc | limit 25
```
Read: `CLASSIC_ENTITY_MIGRATION_ADVISED` is the query engine's own advisory. **Restrict to the authoring surfaces above** — an unfiltered count is dominated by Dynatrace's own apps querying internally and hugely overstates your work. The number that matters is *how many of your own documents are listed*, each of which is one rewrite.

**V46 — How much data actually flows through OpenPipeline vs the classic path.** Configuration presence is not adoption:
```
timeseries records = sum(dt.sfm.openpipeline.routing.records, default:0),
  by: { dt.openpipeline.source }, from:-7d
| fieldsAdd total = arraySum(records)
| fields dt.openpipeline.source, total
| sort total desc | limit 20
```
Read: the share of records on OpenPipeline lanes is the real migration state — a complete OpenPipeline configuration with traffic still on the classic path is dual-running, and object counts cannot show it. A large **null-source** bucket is normal residual attribution, not "unrouted data".

**V47 — Who is still using classic apps and classic dashboards.** Engagement, not object counts:
```
fetch dt.system.events, from:-7d
| filter event.provider == "CLASSIC_APPS" and event.type == "app.opened"
| summarize opens = count(), users = countDistinct(user.id), by: { dt.app.id }
| sort opens desc
```
Read: usually a **short, nameable list of people**, not a tenant-wide retraining problem — which makes it an enablement conversation with a handful of named users. Each classic app has a documented successor (your **Check your upgrade readiness** dashboard pairs them); a few classic apps have no successor yet, and continuing to use those is not a gap. Swap `dt.app.id == "dynatrace.classic.dashboards"` and group by `details.page_dashboard_id` to see which specific classic dashboards are still opened.

**V48 — Are my user groups still on classic RBAC roles?** The platform publishes a daily readiness snapshot; this reads the newest one:
```
fetch dt.system.events, from:-7d
| filter event.kind == "PLATFORM_PERMISSION_READINESS_EVENT"
| sort timestamp desc
| limit 1
| fieldsAdd `Groups on classic roles` = arraySize(legacy_permissions_groups),
            `Groups on default policies` = arraySize(default_policies_groups)
| fields timestamp, `Groups on classic roles`, `Groups on default policies`
```
Read: classic RBAC roles are being replaced by policies, so groups on the left-hand number are the migration list. **`sort timestamp desc | limit 1` is load-bearing** — these are daily snapshots, and aggregating a week multiplies your estate. To list the groups themselves, `expand legacy_permissions_groups` and parse each entry's `name`. Manage the change in **Account Management → Identity & access → Groups**. This is the one area where getting it wrong removes or wrongly grants someone's access, so verify each group before changing it.

**V49 — Which service-detection and failure-detection rules must be reworked before upgrading?** Read the enabled rules and check their scopes:
```
dtctl get settings --schema builtin:service-detection.full-web-request -o json
dtctl get settings --schema builtin:service-detection.full-web-service -o json
dtctl get settings --schema builtin:failure-detection.environment.rules -o json
dtctl get settings --schema builtin:failure-detection.environment.parameters -o json
```
Read: an **enabled** rule needs rework if it is scoped by a **management zone**, a **service tag**, or a **process-group tag that is not prefixed `primary_tags.`**. The fix is mechanical and has a documented target: remove those scopes and reproduce the behavior using **primary tags** from process groups in the *Process group tag* field. This matters more than the rule count suggests — service detection decides what a service *is*, so changes here reshape the service topology that automatic root-cause analysis works over. **0 objects returned means you have no rules of that kind**, which needs no action. Validate and edit in **Settings → search "service detection"** and **"failure detection"**.

**V50 — Enhanced Endpoints, and the two rule families this check does not cover.** 
```
dtctl get settings --schema builtin:enhanced-endpoints-for-sdv1 -o json
```
Read: a capability toggle (`enabled`, `resolveRequestAttributes`), not a rule rewrite — decide it separately from V49. **Coverage note, stated plainly:** Dynatrace's own readiness check covers four rule families, and V49 + V50 reach two of them. **Request attributes** and **request naming** rules can carry the same unsupported scopes, and they are reviewed in the UI rather than by the commands above — **Settings → search "request attributes"** and **"request naming"**: look for a non-`primary_tags.` process-group tag scope, a service-technology scope, a management zone, or a service tag on each enabled rule. Your environment's ready-made **Check your upgrade readiness** dashboard lists all four families together.

**V51 — What share of custom-detector activity is still on the classic engine? (the E13 Gen3 Migration Progress footprint weight)**
```
fetch dt.davis.events, from:now()-30d
| filter dt.settings.schema_id == "builtin:anomaly-detection.metric-events" or dt.settings.schema_id == "builtin:davis.anomaly-detectors"
| summarize legacy_events = countIf(dt.settings.schema_id == "builtin:anomaly-detection.metric-events"),
    native_events = countIf(dt.settings.schema_id == "builtin:davis.anomaly-detectors")
| fieldsAdd legacy_share_pct = round(100.0 * toDouble(legacy_events) / toDouble(legacy_events + native_events), decimals:1)
```
Read: the classic/native **status** for this domain comes free from config (`dtctl get settings --schema builtin:anomaly-detection.metric-events` vs `dtctl get anomaly-detectors`) — this query exists only to weight that status by actual firing volume rather than raw enabled-rule count, the same correction V33-E5 made for dashboards. A high `legacy_share_pct` means the classic metric-event engine, not just a few leftover configs, is still doing the tenant's real detection work. 0 rows for both schema_ids = no custom-detector activity in the window — not a finding, this domain simply carries near-zero weight for this tenant (same precedent as a 0-SLO tenant on V33-E9). Migrate via **Anomaly Detection app → Custom alert → Improve metric events with DQL → select → Transform**, which converts the classic config to a Davis detector and auto-disables the original.

**V52 — Does OpenPipeline route metrics, the way it routes logs? (VERIFIED LIVE 2026-08-07 on `playground` — the discovery step below is unreliable and must not gate the read; see the correction)**
```
dtctl get settings --schema builtin:openpipeline.metrics.routing --scope environment -o json
dtctl get settings --schema builtin:openpipeline.metrics.pipelines --scope environment -o json
```
**🔴 Correction from the live run: don't discover first.** `dtctl get settings-schemas -o json --jq '[.[]|select(.schemaId|test("openpipeline";"i"))|.schemaId]'` — the same discovery A22 runs for logs — returned **zero** matches for either the logs or metrics routing/pipelines schemas on `playground`, even though both are real and populated (`.metrics.routing` had 1 entry, `.metrics.pipelines` had 10 objects). Read the two schemas above **directly**, by name, regardless of what discovery shows; treat discovery as informational only. Grade what you find exactly like V35 (routing catch-all, pipelines-vs-groups join, per-pipeline governance stages) — **and before calling any unrouted pipeline "orphaned config debt," check its `externalId`: `com.dynatrace.*` — the whole namespace, not only `.extension.` — = a platform default, not a finding** (live: 9 of `playground`'s 10 metrics pipelines were unrouted platform defaults, not orphans; widened 2026-08-10 after `com.dynatrace.filesystem_filesystem-metrics` on a second tenant missed the narrow prefix and read as a customer orphan). Only if the direct read 404s / genuinely returns nothing does "metrics ingestion is not OpenPipeline-routed on this tenant" apply — in that case the effective-use and improvement questions for metrics ingestion route through V21 (OTLP metric config), V41 (ingest rejections/cardinality), V33-E8 (extension metric volume), and V53 (duplicate custom-collector metrics) instead. GUI: **OpenPipeline** app (Settings → Process and contextualize) — open it and check whether a "Metrics" data-type tab exists.

**V53 — Are you paying to collect a metric twice? (custom collector, e.g. Telegraf/StatsD, vs. a Dynatrace-native equivalent; VERIFIED LIVE 2026-08-07 on `playground` — query mechanics confirmed, 0 candidate keys found; the mapping table is unexercised until a tenant with a third-party collector runs this)**
```
metrics from:now()-7d
| filter startsWith(dt.metrics.source, "custom:") or startsWith(metric.key, "telegraf.") or startsWith(metric.key, "statsd.")
| dedup {metric.key}
| fields metric.key, dt.metrics.source
```
Read as: the custom-collector metric namespaces actually flowing in. **Distinguish from V41 first** — V41 flags rejected `telegraf.*`/custom keys (data lost); this flags *accepted* keys that duplicate what OneAgent/an extension already reports for the same host — money spent twice, and two numbers that can silently disagree about the same signal. Cross-reference the returned keys against the collector-plugin → native-equivalent table in probes-grail.md B50 (`cpu.*`→`dt.host.cpu.usage`, `mem.*`→`dt.host.memory.usage`, `diskio.*`→`dt.host.disk.*`, `net.*`→`dt.host.net.nic.*`, `docker.*`/`kubernetes.*`→`dt.container.*`/`dt.kubernetes.container.*`, …), then confirm on the **same entity** — namespace overlap alone is not proof; a custom metric on a host with no OneAgent is legitimate gap-filling, not waste. GUI: **Metrics** browser → the custom key (check its host/entity dimension) vs the native key on the same host; **Hub** / collector config for where to retire the parallel collection once confirmed.

**V54 — Which pipelines are actually processing your data, and which routing rules actually match? (VERIFIED LIVE 2026-08-26 on `playground`)**
```
timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-7d, by:{pipeline_id, configuration}
| fieldsAdd total = arraySum(records)
| fields configuration, pipeline_id, total
| sort total desc
```
```
timeseries records = sum(dt.sfm.openpipeline.routing.records), from:-7d, by:{route_name, configuration}
| fieldsAdd total = arraySum(records)
| fields configuration, route_name, total
| sort total desc
```
```
timeseries n = sum(dt.sfm.openpipeline.not_stored.records), from:-7d, by:{reason, configuration}
| fieldsAdd total = arraySum(n)
| fields configuration, reason, total
| sort total desc
```
Read as: query 1 is every pipeline that moved a record in the last 7 days, by signal type — **and the identifier alone does not tell you who built it.** `default` is the platform's own pipeline and `extension:*` was installed by an extension; neither is your configuration. Anything else is *probably* yours, but confirm it in the OpenPipeline app or with its owner before counting it — and note the identifier is the pipeline's **internal** id, which survives renames, so one reading `..._drop_..._logs_...` can be the main processing pipeline rather than a drop rule. Query 2 answers the question the configuration screen cannot: **a routing rule that is enabled in your routing table but absent from this result matched nothing in the window** — either its matcher is wrong or the traffic it was written for is not arriving, and both are findings. Query 3 separates `intentionally_dropped` (a processor doing exactly its job) from `not_valid` / `not_persisted` (data you meant to keep and did not). Treat all three as a **floor, never an inventory**: they count what processed records in the window, so the honest reading is "at least N pipelines are live", never "you have N pipelines". Live on `playground` 2026-08-26, this listed 34 pipelines while the same identity got `403 Access denied` reading the pipeline configuration itself — which is why this view is worth keeping: it reports throughput when the configuration will not open.

### Read-only CLI one-liners (no Grail surface for the object itself)

- **SLOs defined:** `dtctl get slos` (or Platform UI → Service-Level Objectives). 0 = no reliability targets.
- **Workflow trigger mix:** `dtctl get workflows -o json | jq '[.[] | if .trigger.schedule then "schedule" elif .trigger.eventTrigger then .trigger.eventTrigger.triggerConfiguration.type else "none" end] | group_by(.) | map({trigger: .[0], n: length})'`
- **Routing table (config side of V1):** `dtctl get settings --schema builtin:openpipeline.logs.routing --scope environment -o json`
- **Default monitoring mode (config side of V4):** `dtctl get settings --schema builtin:deployment.oneagent.default-mode -o json`
- **Detector rule export (for the duplicate/overlap analysis):** `dtctl get anomaly-detectors -o json`
- **Deep-monitoring exclusions (config side of V32, authoritative per PG):** `dtctl get settings --schema builtin:process-group.monitoring.state --scope <PG-id> -o json` — PROCESS_GROUP-scoped; deep monitoring off on a Full-Stack host's PG = Full-Stack cost, Infrastructure value.
- **Failure-detection tuning:** `dtctl get settings --schema builtin:failure-detection.service.general-parameters -o json` — empty = all-default (your error rates use the platform's default notion of failure).
- **Service-detection rules:** `dtctl get settings --schema builtin:service-detection-rules -o json` — over/under-splitting distorts the service topology Davis correlates over.
- **Gen3 Davis detectors:** `dtctl get settings --schema builtin:davis.anomaly-detectors -o json` — the platform-native detection surface (score capability here, not on classic thresholds).
- **Maintenance-window hygiene (read BOTH schemas — the counts do not roll up):** legacy `dtctl get settings --schema builtin:alerting.maintenance-window -o json` and Gen3 `dtctl get settings --schema builtin:maintenance-windows -o json` — standing (`DAILY`/`WEEKLY`) windows silently suppress real alerts, while `ONCE` windows lapse on their own. Verify the *effect* with **V34**, not the object count.
- **Classic log routing/retention (vs OpenPipeline):** `dtctl get settings --schema builtin:logmonitoring.log-storage-settings -o json`
- **Network zones (config side of V10):** `dtctl get settings --schema builtin:networkzones.zones -o json` — a lone `default` zone with a multi-AG fleet = no traffic-locality design.
- **Extension shelfware:** for each `extensionName` from `dtctl get extensions -o json`, run `dtctl get extension-configs <extensionName> -o json` — 0 configs = installed but collecting nothing.
- **Segment effectiveness:** `dtctl get segments -o json` gives each segment a `variables.value` DQL query; run each one and count rows — 0 rows = dead segment (bad filter / references entities that don't exist), no `variables` block = empty placeholder. Report *effective / total*; name the dead ones (a common cause is a filter copied from a demo tenant, e.g. `easytrade`/`astroshop` namespaces).

## GUI validation & remediation map (put this in every report)

Every finding also has a place in the Dynatrace UI where the customer can **see it** and a place where they can **fix it** — include both alongside the DQL, because many report readers act through the UI, not queries. (Apps are found via **Ctrl/Cmd+K search or the Hub**; settings via **Settings → search term** — search terms are more stable than deep menu paths.)

| Check | Validate in the UI | Remediate in the UI |
|---|---|---|
| V1 Routing & buckets | **Storage Management** app (per-bucket records, retention); **Notebooks** for the recency queries | **OpenPipeline** (Settings → Process and contextualize): routing entries + pipeline bucket assignment; **Storage Management** for bucket create/retention |
| V2 ABAC + cost tags | **Notebooks** (V2 query); **Account Management → Cost & consumption** for attribution views | **OpenPipeline** pipeline stages: Security context + Cost allocation processors; **Account Management → Identity & access → Policies** to bind IAM conditions |
| V3/V15 Detection & noise | **Problems** app filtered by alert source; **Davis Anomaly Detection** app (rule list) | **Davis Anomaly Detection** app (edit/disable rules); **Settings → Anomaly detection** (classic metric events, host thresholds) |
| V4 Monitoring mode | **Deployment Status** app → Hosts (mode + agent version per host) | Host settings → Monitoring mode; **Settings → search "monitoring mode"** for the deployment default |
| V5 Problem feed | **Problems** app (24 h, group by title) | Tune sources per V3; alerting profiles under **Settings → Alerting** |
| V6 Business events | **Business Flow / Business Analytics** app | **OpenPipeline → Business events** (sources, pipelines); bizevent capture rules |
| V7 Synthetic | **Synthetic** app (monitor list, results) | **Synthetic** app → Create monitor (browser/HTTP); private locations under Deployment Status → ActiveGates |
| V8 Tags & ownership | Host details → Properties and tags; **Settings → Tags** (auto-tagging rules) | Fix at source (deployment config / cloud tags / K8s labels); **Settings → Tags → Automatically applied tags**; **Settings → Ownership → Teams** |
| V9 Agent versions | **Deployment Status** app → OneAgents (version column, filterable) | **Settings → search "OneAgent updates"** (update policy, target version, maintenance windows) |
| V10 Gateways & zones | **Deployment Status** app → ActiveGates — **also shows auto-update state, which DQL cannot** (versions are queryable — V36) | **Settings → search "ActiveGate updates"** and **"network zones"**; zone assignment in each gateway's config |
| V48 Classic RBAC roles | **Notebooks** (V48 query); **Account Management → Identity & access → Groups** | **Account Management → Identity & access → Policies**: move each group onto default policies; bind the boundary on security context rather than management zones |
| V49 Service-detection rework | **Settings → search "service detection"** / **"failure detection"** (rule list, scopes per rule) | Edit each flagged rule: remove management-zone / service-tag / non-`primary_tags.` PG-tag scopes, re-scope on **primary tags** in the Process group tag field |
| V50 Enhanced Endpoints | **Settings → search "enhanced endpoints"**; **Settings → search "request attributes"** and **"request naming"** for the two families V49 does not cover | Enhanced Endpoints is a capability toggle; request-attribute and request-naming rules are re-scoped the same way as V49 |
| V51 Anomaly-detector schema share | **Notebooks** (V51 query); **Anomaly Detection** app for the config-side classic-vs-Gen3 detector counts | **Anomaly Detection app → Custom alert → Improve metric events with DQL → select → Transform** — converts the classic config to a Davis DQL detector and auto-disables the original |
| V52 OpenPipeline metrics routing (design) | **OpenPipeline** app (Settings → Process and contextualize) — check whether a Metrics data-type tab/schema exists at all | If it exists: same as V46 (move sources onto pipelines, retire classic residue). If it doesn't: the improvement lever is V21/V41/V33-E8/V53, not OpenPipeline |
| V53 Duplicate custom-collector metrics (design) | **Metrics** browser → the custom key (Telegraf/StatsD namespace) and its host dimension vs the native key on the same host | Retire the parallel collector for the overlapping signal at the collector/**Hub** config; keep custom ingest only for signals with no native equivalent |
| V54 OpenPipeline throughput & route matching | **Notebooks** (the three V54 queries); **OpenPipeline** app (Settings → Process and contextualize) for the configured pipelines and dynamic routes — the app opens even where the settings API refuses | Fix the matcher on any enabled route that moved no records, or retire it; for records under `not_valid` / `not_persisted`, correct the producer or the processor that rejects them — `intentionally_dropped` needs no action |
| V43 Zone query activity | **Notebooks** (V43 query); **Settings → search "management zones"** for the zone list | Build the replacing **segment** (Settings → Segments) and the IAM policy, then delete the zone — never delete on the query count alone |
| V44 Classic API callers | **Notebooks** (V44 query); **Settings → Access tokens** to map a token to its owner; the ready-made **Check your upgrade readiness** dashboard (Dashboards) for which endpoints stop working | Re-point the integration at the platform API; **Settings → Access tokens** to retire the token once migrated |
| V45 Classic entity DQL | **Notebooks** (V45 query); open each listed document directly | Rewrite the query to Smartscape / direct dimension filters in the owning **Dashboard**, **Notebook** or **Workflow** |
| V46 OpenPipeline volume | **Notebooks** (V46 query); **OpenPipeline** app (Settings → Process and contextualize) for the configured routes | **OpenPipeline**: move remaining sources onto pipelines, then retire the classic processing rules |
| V47 Classic app usage | **Notebooks** (V47 query); the ready-made **Check your upgrade readiness** dashboard (Dashboards) for the classic→successor pairing | Enable the named users on the successor app (Ctrl/Cmd+K or the **Hub**); **Settings → search "prevent classic"** to restrict classic access once they have moved |
| V36 Gateway versions | **Notebooks** (V36 query — per-gateway version, group, zone); **Deployment Status** app → ActiveGates (version column + auto-update state) | **Settings → search "ActiveGate updates"** (auto-update, target version, maintenance windows); update lagging gateways per docs.dynatrace.com ActiveGate update guidance |
| V12 Security posture | **Security Overview / Vulnerabilities** app (findings by risk) | **Settings → Application Security** (Vulnerability Analytics monitoring rules — enable RVA); route findings via **Workflows** |
| V13 RUM | **Frontend/Web applications** app (sessions, Core Web Vitals) | Application onboarding (auto-injection via OneAgent) + privacy settings per app |
| V14 Consumption | **Account Management → Usage & consumption** | Mode changes (V4), log routing/retention (V1), metric extraction (OpenPipeline) |
| V16 Estate hygiene | **Deployment Status** app (candidates, inactive hosts) | Install/decommission decisions; Discovery mode for the long tail |
| V17 Log coverage | **Logs** app → group by host | OneAgent log module settings; **Settings → Log Monitoring** ingest rules |
| V18 Effective consumption | **Notebooks** (import the Effective Consumption notebook — WFR/COC/PUI/QEI/OES tiles); **Workflows** app → executions (success/error); **Account Management → Identity & access** for the configurator roster | **Workflows** (fix failing/scheduled workflows; adopt davis-problem triggers); **IAM policies + groups** to widen self-service; adopt config-as-code (Dynatrace Terraform provider / Monaco / settings API) to lift CCS; **Davis Anomaly Detection** to raise problem usefulness; tune noise via V3/V15 |
| Workflows & triggers | **Workflows** app → each workflow's trigger; **Executions** tab for failure history | **Workflows** app: switch triggers to Davis problem trigger; fix failing actions (the execution detail shows the exact error) |
| SLOs | **Service-Level Objectives** app | Same app → add from template; burn-rate alerts wired to Workflows |
| Segments vs zones | **Segments** app; **Settings → Management zones** (legacy inventory) | Build segments; re-scope alerting profiles; retire zones last |
| Segment effectiveness | **Segments** app → open each segment, check its filter returns values | Fix/remove segments whose filter returns nothing; delete empty placeholders |
| V19 Traces | **Distributed Tracing** app (services, failure rate); **Services** app | Enable OneAgent/OTel on gap services; **Settings → search "service detection"**; drop health-check spans via **OpenPipeline → spans** |
| V20 Databases | **Databases** app; **Distributed Tracing** filtered to DB spans | Enable query/statement capture (**Settings → search "database"**); add DB extension from **Hub** for agentless engines |
| V21 OpenTelemetry | **Distributed Tracing** (OTel-sourced services); Collector self-monitoring dashboard | Fix collector export failures / memory limiter; **OpenPipeline** routing for OTLP; OTLP endpoint + API-token scopes |
| V22 Kubernetes | **Kubernetes** app (clusters, workloads, right-sizing); **Kubernetes Security Posture** | Set/adjust requests & limits in workload manifests; enable **Settings → search "Kubernetes"** monitoring + KSPM; DynaKube CR |
| V23 Core Web Vitals | **Frontend / Web applications** app (Web Vitals, sessions); **Session Replay** | App config: instrumentation + capture rules; SPA detection; enable Session Replay per app (privacy settings) |
| V24 Synthetic | **Synthetic** app (monitor availability, locations) | **Synthetic** app → create/fix monitors; private locations under Deployment Status → ActiveGates; renew expiring TLS certs |
| V25 SLOs | **Service-Level Objectives** app | Add SLOs from template for uncovered top-traffic services; wire burn-rate alerts to **Workflows** |
| V26 App Security | **Vulnerabilities / Security Overview** app (Davis Security Score, exposure) | **Settings → Application Security** → enable RVA + RAP; prioritize by exposure/exploit/function-in-use; route via **Workflows** |
| V27 Compliance posture | **Security Posture Management** app (findings by framework) | Enable CSPM/KSPM; remediate failing rules per framework; **Settings → Cloud/Kubernetes security posture** |
| V28 Davis efficacy | **Problems** app; **Davis** views (root cause) | Deepen topology/OneAgent coverage; retire per-entity static thresholds (V3) so Davis correlation can compress signals |
| V29 Mobile | **Mobile applications** app (crashes, sessions) | Mobile agent onboarding + crash-symbolication upload; enable Session Replay for mobile |
| V30 Enrichment ratio | **Notebooks** (V30 query); host/service details → Properties and tags | Enrich at source (deployment config / K8s labels / cloud tags); **OpenPipeline** Security-context + Cost-allocation processors; **Settings → Ownership** |
| V31 Masking / PII | **Settings → search "masking"** / "data privacy"; **Session Replay** config; **Notebooks** to confirm no raw PII in logs | **OpenPipeline** mask processors; **Settings → Log Monitoring → sensitive data masking**; Session Replay masking presets; IP-address masking; per-app RUM privacy |
| V32 Deep-monitoring gap | **Deployment Status** app (host mode); **Services** app (is the PG's service present?) | **Settings → search "process group monitoring"** — re-enable deep monitoring on the Full-Stack host's PG |
| V33 Gen3 migration progress | **Workflows** app (davis-problem executions); **Segments** app; **Problems** app (CUSTOM_ALERT share); **Settings → search** "management zones" / "alerting profiles" / "tags" / "problem notifications" to see remaining classic objects | Retire-classic → adopt-native: **Segments** to replace management zones; **Workflows** (davis-problem) to replace alerting profiles + classic notifications; **OpenPipeline** to replace classic log pipelines; **source tags** to replace auto-tagging; migrate dashboards to the **Dashboards** app. Sequence per the report plan; docs.dynatrace.com migration guides + BPN (MZ2POL, OPMIG, WFLOW, DASH) |
| V33-E8 Extension entity model | **Smartscape** / **Notebooks** (the B33 query — typed nodes vs `id_classic`-backed); **Hub** → installed extensions (2.0 vs classic) | Update the extension to its Gen3 release from the **Hub**, then **re-save each monitoring configuration** so the typed node drops its `CUSTOM_DEVICE` backing; start with the P1/P2 (highest-volume) not-started extensions. docs.dynatrace.com Extensions 2.0 / network-topology guides |
| V33-E5 Dashboard usage | **Dashboards** app (native) and **Dashboards Classic** (Popularity / Last viewed columns — who still opens classic); **Notebooks** for the B34 real-user engagement query | Upgrade classic dashboards via **Dashboards Classic → Upgrade** (recreates in the Dashboards app); drive real users onto the Grail dashboards; do **not** treat native dashboard count as adoption |
| V33-E9 SLO upgrade | **Service-Level Objectives** app (Gen3) vs **Service-Level Objectives Classic** (classic definitions) | **Upgrade Classic SLOs**: recreate each classic SLO in the SLO app with a DQL SLI (docs Upgrading-Metrics table maps metric-expression → Grail; entity-selector → DQL); wire burn-rate alerts to **Workflows**; retire the classic SLO once validated |
| V38 MZ population census | **Settings → search "management zones"** (definition list) vs **Smartscape / Hosts** filtered per zone; **Segments** app for the covering segment | Per the `/dt-eval-mz2seg` plan's dispositions: empty + unconsumed zones → retire; populated + uncovered dimensions → author the proposed segment, validate population parity, rehome consumers (profiles → **Workflows**, access → IAM on security context), then retire. docs.dynatrace.com Segments + BPN MZ2POL |
| V39 Source-tag propagation | **Smartscape** → host → Tags (source tags flowing to Grail) vs **Settings → search "automatically applied tags"** (classic compute-side rules) | **Tag at the source for long-term success**: emit the key via host tags/`DT_TAGS`, K8s labels, cloud tags, or **OpenPipeline** enrichment so it becomes a **primary Grail tag**; then key segments/IAM/dashboards on it and retire the classic auto-tag rule. Never build new work on classic-computed tags — they retire with Gen2. docs.dynatrace.com Tagging (source tags) + BPN FAQ-02, ORGNZ |
| Detection tuning | **Settings → Anomaly detection / Failure detection**; **Davis Anomaly Detection** app (Gen3 detectors) | **Settings → Failure detection** rules; **Settings → Service detection**; **Davis Anomaly Detection** app to add/enable Gen3 detectors |
| V34 Maintenance-window suppression | **Problems** app (filter to problems under maintenance); **Settings → search "maintenance"** for the window list and schedules — check the legacy *and* Gen3 entries, their counts do not roll up | Time-box or scope standing `DAILY`/`WEEKLY` windows; **Settings → Maintenance windows**. Confirm by re-running the suppressed-share query and seeing it fall |
| Network zones | **Deployment Status** app → ActiveGates (zone per gateway) | **Settings → search "network zones"**; assign zones + alternatives per gateway |
| Extension shelfware | **Hub** / **Extensions** (installed list) → each extension's monitoring configurations | Add a monitoring configuration, or remove the unused extension |

**Standing instruments (recommend in every report):** for continuous self-service validation between reviews, import the open-source **Dynatrace Tenant Review** and **Platform Adoption** dashboards from [github.com/dynatrace-oss/CustomerSuccess](https://github.com/dynatrace-oss/CustomerSuccess) (Dashboards app → Upload), and use the **Discovery & Coverage** app (Hub) for coverage and ActiveGate diagnostics. These give the customer a maintained, always-on view of most checks in this catalog.

## Team usage

Setup and installation live in the package [README.md](../../../README.md) — clone the package, run `setup.sh`, create a dtctl context, open Claude Code. Operational notes:

1. **Permission prompts are handled two ways** (both ship with the package): a static allowlist in `.claude/settings.json` for simple read-only commands, and a PreToolUse hook (`.claude/hooks/allow-readonly-probes.sh`) that auto-allows *compound* probe batteries — variable assignments, `for` loops, pipes, heredocs — **when every command in them is read-only tooling** (dtctl read verbs, jq/grep/text utils, a project-venv python). Anything mutating (dtctl apply/create/delete/edit/exec, `ctx token`, rm/curl/git, `source`) always falls through to a normal prompt. Fail-safe: if the hook can't parse a command, you get the prompt.
2. Prior runs live in `runs/<tenant>-<date>/` — bring the folder to another machine to get resume + comparison; `runlog.py compare` diffs any two runs.
3. Coverage-tracking: V1–V17 map to probes B1–B16/D1/D5/D6 in [probes-grail.md](probes-grail.md) (**D6** — OpenPipeline pipeline consolidation, verified live 2026-08-07 on `playground` — rides on V35's A21/A22 evidence, with an extension-ownership pre-filter added from that run), **V18 maps to the EC1–EC17 Effective Consumption battery** (§D), **V19–V29 map to the application-observability / value / security-plane probes B17–B29** (traces, DB, OTel, Kubernetes, Core Web Vitals, synthetic availability, SLO SLIs, AppSec reachability, compliance posture, Davis efficacy, mobile), **V30–V31 map to the governance & compliance plane B30/B31 + A38** (enrichment ratio, masking coverage), and **V32 + the config-side one-liners map to the dtctl config-posture probes A39–A50** (deep-monitoring exclusions, failure/service detection, span capturing, Gen3 Davis detectors, maintenance windows, classic log governance, network zones, extension shelfware, OTLP, OneAgent features). **V35 maps to A21/A22** (routing catch-all, pipelines-vs-groups join, and the bucket-is-not-pipeline rule), **V34 maps to B32 + A44** (maintenance-window suppression measured against the configured window count), **V36 maps to B36** (ActiveGate fleet version drift via Smartscape — the lifted §C hold), **V37 maps to A4/A4b** (configured-vs-executed workflow trigger cross-check — the alert-delivery liveness gate), **V38 maps to B37** (management-zone population census — the live read behind the `/dt-eval-mz2seg` Migration Plan's retire/build dispositions; the plan's offline stages are a recipe over A17/A6/A13–A16 per mz2seg-migration-plan-spec.md), **V39 maps to B38** (source-tag propagation census — the same plan's tagging-at-source provenance evidence: primary Grail tags vs retiring classic auto-tags), **V40 maps to B39 + B39b** (notification delivery health via `dt.sfm.server.notifications.*` — the platform-counter delivery read that complements V37's workflow-side liveness gate; **the failure-only view is the mandatory half — the volume-sorted view alone can never establish a delivery ✅**), **V41 maps to B40 + B40b** (metric ingest rejections via `dt.sfm.server.metrics.rejections`; **B40b — the intersection of rejected keys with detector-watched metric keys — is the mandatory half**, and a non-empty intersection carries the sequencing rule *fix ingest before re-tuning detectors*), **V42 maps to B41** (ingest capture rate via `dt.sfm.server.service_calls.*`, carrying B41's minimum-volume guard — a percentage over a trivial denominator is not a measurement; A51's settings-object limit proximity has no Grail twin — its client-side check is the targeted `describe settings-schema` reads plus the community Product Limits dashboard), and **V33 maps to the §E Gen3 Migration Progress recipe** — the evaluation over the classic-inventory probes (A14–A18/A29) and native-target probes (A4/A6/A21–A22/A8–A10/B5/B30) for domains E1–E7, plus the three 2026-07-28 Grail reads **B33** (E8 extension entity model — `V33-E8`), **B34** (E5 real-user dashboard usage — `V33-E5`), and **B35** (E9 SLO model — `V33-E9`), and the 2026-08-05 addition **B49** (E13 custom anomaly-detector schema-generation share — `V51`, weighting only; the domain's status is free from A2/A13/A43); used only for the standalone Gen3 Migration Progress deliverable, **V54 maps to B51** (OpenPipeline self-monitoring throughput — the surface that answers *which pipelines are live and which routes actually match* when the pipeline configuration will not open; verified live 2026-08-26 on `playground`, where it corrected two things this catalog and the probe had both asserted about its own output), and **V52/V53 map to A54/B50** (metrics-scope OpenPipeline discovery; duplicate custom-collector-vs-native metric detection — both verified live 2026-08-07 on `playground`, see field-notes.md for the corrections that run surfaced). When a new probe class is added there, add its client-facing verification twin (DQL + GUI validate/remediate row) here, and mirror the probe in the repo-root [MANUAL-EXTRACTION.md](../../../docs/MANUAL-EXTRACTION.md) reproduction guide.
