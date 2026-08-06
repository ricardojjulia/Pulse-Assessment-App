// ui/app/hooks/useAppAdoption.ts
//
// Who actually USES the platform, per capability.
//
// The 111 checks answer "is the data there?". This hook answers the other
// half: "does anyone open the app that consumes it?" — a capability at 95%
// coverage with one active user is a very different story from the same
// 95% with a whole team in it.
//
// Source ─────────────────────────────────────────────────────────────────
// Every DQL execution lands in dt.system.events as a QUERY_EXECUTION_EVENT
// carrying `user.email` and `client.source` (the app URL, which contains
// DT_APP_ID=<app id>). Counting distinct emails per app id gives active
// users per app; ../data/appCapabilityMap.ts maps apps to capabilities.
//
// Cost ───────────────────────────────────────────────────────────────────
// dt.system.events is a system bucket: measured at 0 GB scanned on a real
// tenant, so this adds no Grail cost to the assessment. Needs the
// storage:system:read scope, which the app already requests.
//
// Honest limits (surfaced in the UI, not hidden) ─────────────────────────
//   - Only apps that run DQL appear. Pure-configuration apps never query.
//   - API/automation traffic has no client.source and is excluded.
//   - This is platform usage, not data usage: a dashboard that queries logs
//     counts for whoever opened it, not for "Log Analytics" as such.
//
// NEVER feeds a score. Adoption is reported next to coverage; the
// assessment maths stays untouched.

import { useCallback, useEffect, useRef, useState } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { capabilityForApp, OTHER_BUCKET } from "../data/appCapabilityMap";

export interface AppUsage {
  appId: string;
  users: number;
  queries: number;
  capability: string;
}

export interface CapabilityAdoption {
  /** Distinct users across all apps serving this capability. Union is not
   *  computable per capability in one pass, so this is the max across its
   *  apps — a deliberately conservative "at least N people" reading. */
  users: number;
  /** Penetration: share (0–100) of ALL active platform users who opened an
   *  app serving this capability. "12 users" means little on its own; "12
   *  of 23 people on the platform (52%)" is the readable form. */
  rate: number;
  /** Apps serving the capability, busiest first. */
  apps: AppUsage[];
}

export interface UseAppAdoptionResult {
  loading: boolean;
  /** True when the query failed or returned nothing usable. */
  unavailable: boolean;
  /** All apps observed, most users first. */
  apps: AppUsage[];
  /** capability name → adoption. Includes OTHER_BUCKET when relevant. */
  byCapability: Record<string, CapabilityAdoption>;
  /** Distinct users across the whole platform in the window. */
  totalUsers: number;
  /** Days the window covers (for labelling). */
  windowDays: number;
  refresh: () => void;
}

const WINDOW_DAYS = 30;

/** Distinct users + query count per app id, over the window. Service
 *  accounts (heimdall) are excluded so the count reflects real people. */
const ADOPTION_QUERY = `
fetch dt.system.events, from:now()-${WINDOW_DAYS}d
| filter event.kind == "QUERY_EXECUTION_EVENT"
| filter isNotNull(client.source) and contains(client.source, "DT_APP_ID=")
| filter isNotNull(user.email) and not(contains(user.email, "heimdall.dynatrace.com"))
| fieldsAdd appId = splitString(splitString(client.source, "DT_APP_ID=")[1], "&")[0]
| filter isNotNull(appId) and appId != ""
| summarize users = countDistinct(user.email), queries = count(), by:{appId}
| sort users desc, queries desc
| limit 60`;

const TOTAL_USERS_QUERY = `
fetch dt.system.events, from:now()-${WINDOW_DAYS}d
| filter event.kind == "QUERY_EXECUTION_EVENT"
| filter isNotNull(user.email) and not(contains(user.email, "heimdall.dynatrace.com"))
| summarize users = countDistinct(user.email)`;

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return 0;
};

async function runQuery(query: string): Promise<Record<string, unknown>[] | null> {
  try {
    const res = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 30_000, maxResultRecords: 200 },
    });
    if (res?.state === "FAILED" || res?.state === "CANCELLED") return null;
    const records = (res?.result as { records?: Record<string, unknown>[] } | undefined)?.records;
    return Array.isArray(records) ? records : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[useAppAdoption] query failed:", err);
    return null;
  }
}

export function useAppAdoption(enabled: boolean): UseAppAdoptionResult {
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [apps, setApps] = useState<AppUsage[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [runId, setRunId] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current && runId === 0) return;
    startedRef.current = true;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setUnavailable(false);
      const [rows, totalRows] = await Promise.all([
        runQuery(ADOPTION_QUERY),
        runQuery(TOTAL_USERS_QUERY),
      ]);
      if (cancelled) return;

      if (!rows || rows.length === 0) {
        setApps([]);
        setUnavailable(true);
        setLoading(false);
        return;
      }
      const parsed: AppUsage[] = rows
        .map(r => {
          const appId = String(r.appId ?? "");
          return {
            appId,
            users: num(r.users),
            queries: num(r.queries),
            capability: capabilityForApp(appId),
          };
        })
        .filter(a => a.appId !== "");

      setApps(parsed);
      setTotalUsers(totalRows && totalRows[0] ? num(totalRows[0].users) : 0);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [enabled, runId]);

  const byCapability: Record<string, CapabilityAdoption> = {};
  for (const a of apps) {
    const entry = byCapability[a.capability] ?? { users: 0, rate: 0, apps: [] };
    entry.apps.push(a);
    // Conservative: report the best-attested single app rather than summing
    // users across apps (the same person usually opens several).
    entry.users = Math.max(entry.users, a.users);
    byCapability[a.capability] = entry;
  }
  for (const entry of Object.values(byCapability)) {
    entry.apps.sort((x, y) => y.users - x.users || y.queries - x.queries);
    // Penetration against the whole active population, capped at 100 (the
    // per-app count can never exceed the platform total, but a stale total
    // from a failed second query should not produce >100%).
    entry.rate = totalUsers > 0 ? Math.min(100, Math.round((entry.users / totalUsers) * 100)) : 0;
  }

  const refresh = useCallback(() => setRunId(n => n + 1), []);

  return { loading, unavailable, apps, byCapability, totalUsers, windowDays: WINDOW_DAYS, refresh };
}

export { OTHER_BUCKET };
