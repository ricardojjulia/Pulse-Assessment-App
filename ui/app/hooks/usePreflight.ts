import { useState, useCallback } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { isDevEnvironment } from "./useDevMode";

export interface PreflightCheck {
  id: string;
  label: string;
  scope: string;
  status: "pending" | "running" | "ok" | "fail" | "not-entitled";
  detail?: string;
}

const PROBE_QUERIES: { id: string; label: string; scope: string; query: string }[] = [
  { id: "entities", label: "Entities (hosts, services, apps)", scope: "storage:entities:read", query: "fetch dt.entity.host | limit 1 | summarize count()" },
  { id: "logs",     label: "Log data",                         scope: "storage:logs:read",     query: "fetch logs | limit 1 | summarize count()" },
  { id: "metrics",  label: "Metrics (timeseries)",              scope: "storage:metrics:read",  query: "timeseries avg(dt.host.cpu.usage), by:{dt.entity.host} | limit 1 | summarize c = count()" },
  { id: "events",   label: "Events & problems",                 scope: "storage:events:read",   query: "fetch events | limit 1 | summarize count()" },
  { id: "spans",    label: "Distributed traces (spans)",         scope: "storage:spans:read",    query: "fetch spans | limit 1 | summarize count()" },
  { id: "bizevents",label: "Business events",                    scope: "storage:bizevents:read",query: "fetch bizevents | limit 1 | summarize count()" },
  { id: "buckets",  label: "Grail buckets",                      scope: "storage:buckets:read",  query: "fetch dt.system.buckets | limit 1 | summarize count()" },
];

/** Tenant-level entitlement failures (e.g. TRACE_QUERY_ENTITLEMENT_MISSING /
 *  exceptionType ENTITLEMENT-MISSING) are NOT scope problems — granting
 *  OAuth scopes cannot fix them. They get their own status so the UI can
 *  offer Trace Proxy Mode instead of the misleading "grant scopes" advice. */
function isEntitlementError(detail: string): boolean {
  return detail.toUpperCase().includes("ENTITLEMENT");
}

/** Everything the SDK error carries, flattened into one searchable string.
 *
 *  The query client throws `ClientRequestError`, which puts the parsed error
 *  envelope in `body` — `message` is generic. Classifying on `message` alone
 *  therefore never saw TRACE_QUERY_ENTITLEMENT_MISSING: a tenant without
 *  Traces on Grail was told to grant scopes (which cannot fix an entitlement)
 *  and Trace Proxy Mode was never offered — the exact case it exists for. */
function errorText(err: unknown): string {
  const e = err as Record<string, unknown> | null;
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") { parts.push(v); return; }
    try { parts.push(JSON.stringify(v)); } catch { /* circular — skip */ }
  };
  push(e?.message);
  push(e?.body);
  push(e?.cause);
  push(e?.details);
  if (parts.length === 0) parts.push(String(err));
  return parts.join(" | ");
}

/** The human-readable line out of the envelope, so the UI shows
 *  "Querying spans requires ... Trace query entitlement." instead of raw JSON. */
function humanDetail(err: unknown): string {
  const env = (err as { body?: { error?: { message?: string; details?: { errorMessage?: string } } } })?.body?.error;
  const msg = env?.details?.errorMessage || env?.message || (err as { message?: string })?.message;
  const out = msg ? String(msg) : String(err);
  return out.length > 160 ? out.slice(0, 160) + "…" : out;
}

/** Dev-only simulation of a tenant without Traces on Grail, so Trace Proxy
 *  Mode can be tested on any tenant (which HAS spans). Never active outside
 *  the dev environment — a customer tenant cannot trip this. */
function simulateNoTraces(): boolean {
  if (!isDevEnvironment()) return false;
  try {
    if (typeof window === "undefined") return false;
    const p = new URLSearchParams(window.location.search).get("noTraces");
    if (p === "1" || p === "true") return true;
    return window.localStorage.getItem("cca.noTraces") === "1";
  } catch {
    return false;
  }
}

/** `entitlement` is decided here, on the raw error, and carried out — the
 *  caller must not re-derive it from `detail`, which is human-facing text. */
async function probeQuery(query: string): Promise<{ ok: boolean; detail: string; entitlement: boolean }> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 15000, maxResultRecords: 1 },
    });
    const state = response?.state;
    if (state === "FAILED" || state === "CANCELLED") {
      const notes = (response?.result as any)?.metadata?.grail?.notifications ?? [];
      const msg = notes.map((n: any) => n.message).join("; ") || `Query ${state}`;
      return { ok: false, detail: msg, entitlement: isEntitlementError(msg) };
    }
    return { ok: true, detail: "Access confirmed", entitlement: false };
  } catch (err: unknown) {
    // Classify on the WHOLE error, not just `message` — see errorText above.
    const haystack = errorText(err);
    // Entitlement first: it is also a 403, so the scope branch below would
    // otherwise swallow it and give advice that cannot work.
    if (isEntitlementError(haystack))
      return { ok: false, detail: humanDetail(err), entitlement: true };
    if (haystack.includes("403") || haystack.includes("Forbidden") || haystack.includes("permission"))
      return { ok: false, detail: "Permission denied — scope not granted to this app", entitlement: false };
    if (haystack.includes("401") || haystack.includes("Unauthorized"))
      return { ok: false, detail: "Authentication failed — app token may be invalid", entitlement: false };
    return { ok: false, detail: humanDetail(err), entitlement: false };
  }
}

export function usePreflight() {
  const [checks, setChecks] = useState<PreflightCheck[]>(
    PROBE_QUERIES.map(p => ({ id: p.id, label: p.label, scope: p.scope, status: "pending" as const }))
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [validated, setValidated] = useState(false);

  const runPreflight = useCallback(async () => {
    if (validated) return;  // already passed — skip
    setRunning(true);
    setDone(false);
    setChecks(PROBE_QUERIES.map(p => ({ id: p.id, label: p.label, scope: p.scope, status: "running" })));

    for (const probe of PROBE_QUERIES) {
      if (probe.id === "spans" && simulateNoTraces()) {
        setChecks(prev => prev.map(c => c.id === probe.id
          ? { ...c, status: "not-entitled", detail: "Simulated (dev): Query failed: TRACE_QUERY_ENTITLEMENT_MISSING" }
          : c));
        continue;
      }
      const result = await probeQuery(probe.query);
      const status: PreflightCheck["status"] = result.ok
        ? "ok"
        : probe.id === "spans" && result.entitlement
          ? "not-entitled"
          : "fail";
      setChecks(prev => prev.map(c => c.id === probe.id ? { ...c, status, detail: result.detail } : c));
    }
    setRunning(false);
    setDone(true);
  }, [validated]);

  const reset = useCallback(() => {
    setChecks(PROBE_QUERIES.map(p => ({ id: p.id, label: p.label, scope: p.scope, status: "pending" })));
    setDone(false);
    setRunning(false);
  }, []);

  const allPassed = done && checks.every(c => c.status === "ok");
  const hasFails = done && checks.some(c => c.status === "fail");
  /** Every source is fine EXCEPT spans, which failed on the tenant-level
   *  Traces on Grail entitlement → the app can offer Trace Proxy Mode. */
  const spansNotEntitled = done && !hasFails && checks.some(c => c.id === "spans" && c.status === "not-entitled");

  // Persist validated state so preflight is skipped on subsequent runs
  const markValidated = useCallback(() => setValidated(true), []);

  return { checks, running, done, allPassed, hasFails, spansNotEntitled, validated, runPreflight, reset, markValidated };
}
