// ui/app/trace-proxy.ts
//
// Trace Proxy Mode — run the assessment on tenants WITHOUT the Traces on
// Grail entitlement (classic-SKU SaaS, DPS tenants with the trace
// entitlement disabled). See docs/STUDY-CLASSIC-SAAS-NO-GRAIL-TRACES.md.
//
// Principle ───────────────────────────────────────────────────────────────
// The same instrumentation that produces spans also produces service
// metrics (dt.service.request.*) and topology relations (calls/called_by)
// on Grail — which these tenants DO have. Span-based checks are therefore:
//   - PROXIED  when an honest metric/topology equivalent exists, or
//   - EXCLUDED when none does (never faked, never counted as a failure —
//     they leave the scoring denominator entirely).
//
// Fidelity was validated side-by-side on a reference tenant (which has both spans
// and metrics, 97 services, 2h window):
//   a1  traced services      spans 83  vs request-metric services 90  (Δ+7pts)
//   a3  root-span services   spans 75  vs request-metric services 90  (Δ+15, same band)
//   a4  OTel services        spans 64  vs UNIFIED-type services   60  (Δ-4pts)
//   a8  DB services          spans 6   vs DATABASE_SERVICE callers 1  (low here;
//       better on OneAgent-classic estates where DBs are modeled as entities)
//   a10 multi-service        27% of traces vs 40% of services w/ outgoing calls
//   s8  failing services     spans 7   vs failure_count>0 services 11 (Δ+4pts)
// Every proxied check keeps the same pass/fail outcome at its lowest
// (operative) threshold. s10 has no honest entity-level proxy (measured
// 11% vs 53%) and is excluded instead.
//
// AI Observability is excluded as a whole capability: gen_ai.* attributes
// exist ONLY on spans — there is no honest proxy. Its absence is disclosed
// in the TraceProxyBanner and becomes the enablement conversation.

import { CAPABILITIES, type CapabilityDef, type Criterion } from "./queries";

/** Query fragment that marks a criterion as span-dependent. */
const SPANS = "fetch spans";

export function isSpanCriterion(cr: Criterion): boolean {
  return cr.query.includes(SPANS) || (cr.queryB?.includes(SPANS) ?? false);
}

interface ProxyDef {
  /** Replacement numerator (metrics/topology — never spans). */
  query: string;
  /** Replacement denominator; omit to keep the original queryB. */
  queryB?: string;
  /** Appended to the criterion description so cards/PDF/Assist disclose it. */
  note: string;
}

// Shared strings so executeAllUnique dedups them with existing checks
// (a7/sd5 already run REQUEST_METRIC_SERVICES — the a1/a3 proxies are free).
const REQUEST_METRIC_SERVICES =
  "timeseries val=sum(dt.service.request.count), by:{dt.entity.service} | fields dt.entity.service | dedup dt.entity.service | summarize c=count()";
const DB_CALLER_SERVICES =
  'fetch dt.entity.service | filter serviceType == "DATABASE_SERVICE" | fieldsAdd callers = called_by[dt.entity.service] | expand callers | filter isNotNull(callers) | summarize count = countDistinct(callers)';

const PROXIES: Record<string, ProxyDef> = {
  a1: {
    query: REQUEST_METRIC_SERVICES,
    note: "Proxy: services emitting request metrics (dt.service.request.count) — a traced service always emits them. Validated Δ+7pts vs span truth.",
  },
  a3: {
    query: REQUEST_METRIC_SERVICES,
    note: "Proxy: services processing incoming requests (request metrics). Root-span detection needs spans; incoming-request activity is the closest honest signal.",
  },
  a4: {
    query: 'fetch dt.entity.service | filter serviceType == "UNIFIED" | summarize count()',
    note: "Proxy (low fidelity): unified-model services, which predominantly originate from OTel/span ingest. Directional only — validated Δ-4pts on an OTel-heavy tenant.",
  },
  a8: {
    query: DB_CALLER_SERVICES,
    note: "Proxy: services with topology calls to DATABASE_SERVICE entities. Faithful on OneAgent estates; undercounts on pure-OTel setups where DBs are not modeled as entities.",
  },
  a9: {
    query:
      'fetch dt.entity.service | filter in(serviceType, {"MESSAGING_SERVICE", "QUEUE_LISTENER_SERVICE"}) | fieldsAdd callers = called_by[dt.entity.service] | expand callers | summarize count = countDistinct(coalesce(callers, id))',
    note: "Proxy: messaging/queue-listener services plus their topology callers. Undercounts vs span truth (validated 2-4 vs 10 services); still detects messaging adoption.",
  },
  a10: {
    query:
      "fetch dt.entity.service | fieldsAdd callee = calls[dt.entity.service] | expand callee | filter isNotNull(callee) | summarize count = countDistinct(id)",
    queryB: "fetch dt.entity.service | summarize count()",
    note: "Proxy: % of services with outgoing cross-service calls (topology), instead of % of traces spanning 2+ services. Same spirit, service-level denominator.",
  },
  a13: {
    query:
      'fetch dt.entity.service | filter serviceType == "DATABASE_SERVICE" | fieldsAdd callers = called_by[dt.entity.service] | expand callers | filter isNotNull(callers) | summarize dbs = countDistinct(id), by:{callers} | filter dbs >= 2 | summarize count()',
    queryB: DB_CALLER_SERVICES,
    note: "Proxy: DB-calling services connected to 2+ distinct DATABASE_SERVICE entities (topology), instead of 2+ db.system values on spans.",
  },
  s4: {
    query: DB_CALLER_SERVICES,
    note: "Proxy: services with topology calls to DATABASE_SERVICE entities — same SQL-surface signal as span-based DB tracing, from the entity model.",
  },
  s8: {
    query:
      "timeseries val = sum(dt.service.request.failure_count), by:{dt.entity.service} | fieldsAdd m = arrayMax(val) | filter m > 0 | summarize c = count()",
    note: "Proxy: services with non-zero request failure counts (metrics). Validated Δ+4pts vs span truth.",
  },
};

/** Human-readable reasons for the span checks that have NO honest proxy. */
export const PROXY_EXCLUSION_REASONS: Record<string, string> = {
  s10: "HTTP request surface needs http.request.method on spans — entity service types misstate it (validated 11% vs 53%).",
  i18: "Cloud span enrichment has no metric/topology equivalent; cloud context is already measured via logs and hosts (i13–i17).",
};

export interface TraceProxyInfo {
  /** Criterion IDs whose queries were replaced with metric/topology proxies. */
  proxiedIds: string[];
  /** Criterion IDs removed from the run (and from every denominator). */
  excludedIds: string[];
  /** Capabilities removed entirely (all their checks need spans). */
  excludedCapabilities: string[];
}

/**
 * Transform a capability set for a tenant without Traces on Grail:
 * span criteria get proxy queries (same id → same utilization tier, same
 * thresholds), unproxiable span criteria are dropped from the criteria
 * array (scoring divides by criteria.length, so they leave the
 * denominator — the customer is not penalised for a missing entitlement),
 * and capabilities left with zero criteria (AI Observability) are dropped.
 */
export function applyTraceProxyMode(
  caps: CapabilityDef[],
): { caps: CapabilityDef[]; info: TraceProxyInfo } {
  const proxiedIds: string[] = [];
  const excludedIds: string[] = [];
  const excludedCapabilities: string[] = [];

  const out: CapabilityDef[] = [];
  for (const cap of caps) {
    const criteria: Criterion[] = [];
    for (const cr of cap.criteria) {
      if (!isSpanCriterion(cr)) {
        criteria.push(cr);
        continue;
      }
      const proxy = PROXIES[cr.id];
      if (proxy) {
        proxiedIds.push(cr.id);
        criteria.push({
          ...cr,
          query: proxy.query,
          queryB: proxy.queryB ?? cr.queryB,
          description: `${cr.description} ${proxy.note}`,
          proxied: true,
        });
      } else {
        excludedIds.push(cr.id);
      }
    }
    if (criteria.length === 0) {
      excludedCapabilities.push(cap.name);
    } else {
      out.push({ ...cap, criteria });
    }
  }
  return { caps: out, info: { proxiedIds, excludedIds, excludedCapabilities } };
}

/** Static counts over the FULL catalog, for banner copy that must not vary
 *  with the user's capability selection. */
export function fullCatalogProxyInfo(): TraceProxyInfo {
  return applyTraceProxyMode(CAPABILITIES).info;
}
