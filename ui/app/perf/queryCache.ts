// ui/app/perf/queryCache.ts
//
// 24h-TTL result cache backed by the Dynatrace Document Store.
//
// Why a cache ────────────────────────────────────────────────────────────
// Pulse Assessment runs the same ~110 DQL queries every time the user opens
// the app or clicks Refresh. On the reference baseline that's $1.61 of DPS
// per click; at 80k hosts in xLarge mode it's $34. Users routinely run the
// assessment multiple times a day to track progress on remediations or to
// re-export the PDF. Each re-run scans the same logs/spans/events as the
// previous one, producing values that should be effectively identical on
// the 2h–72h windows the criteria use.
//
// This cache eliminates the second-through-Nth runs of the day. The first
// run still pays full price (cold start); every run within 24h after that
// is essentially free — same numbers returned, no Grail scan.
//
// Contract ───────────────────────────────────────────────────────────────
//   • Cache key:    (sha-ish hash of originalQuery) + (tier)
//   • Cache value:  the numeric DQL result + the timestamp it was stored
//   • TTL:          24 hours, enforced at load time (expired entries pruned
//                   so the cache file doesn't grow unbounded)
//   • Storage:      single Document Store entry per tenant, named
//                   "pulse-querycache". Created on first miss; updated via
//                   optimistic locking on every flush.
//   • Failure mode: silent degradation. Any Doc Store error → cache stays
//                   empty → app runs exactly like pre-cache. No user impact.
//
// Tier handling ──────────────────────────────────────────────────────────
// A query string is the same in 'exact' and 'large' modes, but the value
// returned is different because the Large tier narrows the window and adds
// a scanLimitGBytes cap. Caching ignoring tier would serve Exact-mode data
// to a Large-mode caller, corrupting coverage values. The key therefore
// includes the tier explicitly.
//
// Coverage values can still differ slightly between two Exact-mode runs of
// the same query in the same tenant (e.g., new logs ingested between calls).
// That's a deliberate trade — we accept the small drift in exchange for the
// 70%+ DPS reduction on repeat runs. The cache document records the
// timestamp of each entry so consumers can tell how stale the data is.

import { documentsClient } from '@dynatrace-sdk/client-document';
import type { ScaleTier } from '../scale-tier';

/** Inner shape of one cached query result. */
interface CacheEntry {
  /** The numeric value the DQL query returned (post-extractValue()). */
  v: number;
  /** Epoch milliseconds when the entry was written. Used for TTL eviction
   *  and surfaced to the analyzer so it can spot stale-but-not-yet-expired
   *  caches. */
  ts: number;
  /** Scanned bytes attributed to this query at write time. Lets the perf
   *  report show "X GB saved by serving from cache" without re-running. */
  bytes: number;
  /** Scanned records at write time. Same purpose as bytes. */
  records: number;
}

/** Layout of the persisted cache document. The schemaVersion guards us
 *  against silently misreading future revisions. */
interface CacheDocument {
  schemaVersion: 1;
  tenantId: string;
  /** Map of cache-key → entry. Keys are FNV-32 hex of "${tier}|${query}". */
  entries: Record<string, CacheEntry>;
}

/** TTL for entries. Entries older than this are dropped at load time. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Identifier of the per-tenant cache document. There's exactly one per
 *  tenant. Naming intentionally short and stable to avoid orphans on schema
 *  rollover. */
const DOC_ID = 'pulse-querycache';
const DOC_TYPE = 'pulse-querycache';

/** Tiny non-cryptographic hash (FNV-1a 32-bit). Same family used in
 *  scenarios.ts and ../demo/scenarios.ts for deterministic seeding. */
function fnv32(str: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function makeKey(query: string, tier: ScaleTier): string {
  return `${tier}.${fnv32(query)}`;
}

/**
 * In-memory representation of the cache loaded from the Document Store.
 * The class is intentionally simple: no eviction, no concurrency control
 * (we serialise reads/writes per assessment run from a single React hook).
 */
export class QueryCache {
  private entries = new Map<string, CacheEntry>();
  /** Document version returned by the server on load. Required by
   *  updateDocument() for optimistic locking. */
  private docVersion: string | null = null;
  /** True after load() succeeded — even if the doc didn't exist (we'd then
   *  create one on flush). False means storage is broken; flush is a no-op. */
  private loaded = false;
  /** Track how many entries existed in the doc at load time so we can tell
   *  the difference between "new tenant, empty cache" and "doc not loaded
   *  yet". Useful for the perf report. */
  private initialSize = 0;

  constructor(private readonly tenantId: string) {}

  /**
   * Reads the cache document for this tenant, prunes expired entries, and
   * populates the in-memory map. Returns true on success (including the
   * "doc doesn't exist yet" case), false on storage errors.
   */
  async load(): Promise<boolean> {
    try {
      const content = await documentsClient.downloadDocumentContent({ id: DOC_ID });
      const text = await content.get('text');
      const doc = JSON.parse(text) as Partial<CacheDocument>;
      if (doc?.schemaVersion !== 1 || doc.tenantId !== this.tenantId) {
        // Schema rollover or wrong tenant — treat as empty. We'll overwrite
        // on the next flush with the correct shape.
        this.loaded = true;
        return true;
      }
      // Get the optimistic-locking version so updates don't conflict with
      // concurrent assessment runs in other tabs.
      try {
        const meta = await documentsClient.getDocumentMetadata({ id: DOC_ID });
        this.docVersion = String(meta.version ?? '');
      } catch {
        // Metadata read failed — leave docVersion null, fall back to "create"
        // path on flush which will likely 409. That's recoverable.
        this.docVersion = null;
      }
      const now = Date.now();
      let kept = 0;
      let pruned = 0;
      for (const [key, entry] of Object.entries(doc.entries ?? {})) {
        if (!entry || typeof entry.v !== 'number' || typeof entry.ts !== 'number') {
          pruned++;
          continue;
        }
        if (now - entry.ts > TTL_MS) {
          pruned++;
          continue;
        }
        this.entries.set(key, {
          v: entry.v,
          ts: entry.ts,
          bytes: typeof entry.bytes === 'number' ? entry.bytes : 0,
          records: typeof entry.records === 'number' ? entry.records : 0,
        });
        kept++;
      }
      this.initialSize = kept;
      this.loaded = true;
      // eslint-disable-next-line no-console
      console.log(
        `[QueryCache] loaded ${kept} entries (pruned ${pruned} expired) for tenant ${this.tenantId}`,
      );
      return true;
    } catch (err: unknown) {
      // 404 == document doesn't exist yet. That's the steady state for
      // fresh tenants — treat as empty cache, not an error. Other failures
      // (auth, 5xx) also fall through but we leave `loaded=true` so the
      // flush path will try to create the doc and either succeed or log.
      const status = (err as { response?: { status?: number }; code?: number })?.response?.status
        ?? (err as { code?: number })?.code;
      if (status === 404) {
        this.loaded = true;
        // eslint-disable-next-line no-console
        console.log('[QueryCache] no cache document exists yet — first run for this tenant');
        return true;
      }
      // Anything else: surface a warning but keep the app running. The
      // worst case is "first-run cost on every run" which matches pre-v2.5.1
      // behaviour exactly.
      // eslint-disable-next-line no-console
      console.warn('[QueryCache] load failed, falling back to no-cache mode:', err);
      this.loaded = false;
      return false;
    }
  }

  /**
   * Returns the cached value for (query, tier) if present and not expired,
   * else null. Pruning happens at load time, so a non-null return here is
   * guaranteed to be fresh.
   */
  get(query: string, tier: ScaleTier): CacheEntry | null {
    if (!this.loaded) return null;
    return this.entries.get(makeKey(query, tier)) ?? null;
  }

  /**
   * Stores a value. Replaces any prior entry for the same (query, tier).
   * The change is only persisted on the next flush().
   */
  set(query: string, tier: ScaleTier, value: number, bytes: number, records: number): void {
    if (!this.loaded) return;
    this.entries.set(makeKey(query, tier), {
      v: value,
      ts: Date.now(),
      bytes,
      records,
    });
  }

  /**
   * Persists the in-memory map back to the Document Store. Tries
   * updateDocument() first (existing doc); falls back to createDocument()
   * on 404. Silently ignores all other failures so a broken Doc Store
   * never breaks the assessment itself.
   */
  async flush(): Promise<void> {
    if (!this.loaded || this.entries.size === 0) return;
    const doc: CacheDocument = {
      schemaVersion: 1,
      tenantId: this.tenantId,
      entries: Object.fromEntries(this.entries),
    };
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });

    if (this.docVersion) {
      try {
        await documentsClient.updateDocument({
          id: DOC_ID,
          optimisticLockingVersion: this.docVersion,
          body: { name: DOC_ID, type: DOC_TYPE, content: blob },
        });
        return;
      } catch (err: unknown) {
        // 409 = optimistic locking conflict (another tab updated the doc
        // first). 404 = doc was deleted between load and flush. Both → try
        // create. Other errors → log and give up.
        const status = (err as { response?: { status?: number }; code?: number })?.response?.status
          ?? (err as { code?: number })?.code;
        if (status !== 404 && status !== 409) {
          // eslint-disable-next-line no-console
          console.warn('[QueryCache] update failed, not retrying:', err);
          return;
        }
        // Fall through to createDocument below.
      }
    }

    try {
      await documentsClient.createDocument({
        body: { id: DOC_ID, name: DOC_ID, type: DOC_TYPE, content: blob },
      });
    } catch (err: unknown) {
      // 409 here means the doc was created by another tab between our
      // failed update and this create. We can't merge cleanly without a
      // second load → just drop this run's additions. The next run will
      // re-fill what it can.
      // eslint-disable-next-line no-console
      console.warn('[QueryCache] create failed (race or quota?), drops this run:', err);
    }
  }

  /** Drop every entry without writing. Used by the "🗘 Force refresh"
   *  control to guarantee the next run hits Grail for every query. */
  async clearAndFlush(): Promise<void> {
    this.entries.clear();
    if (!this.docVersion) {
      // Nothing on the server to clear.
      return;
    }
    try {
      await documentsClient.deleteDocument({
        id: DOC_ID,
        optimisticLockingVersion: this.docVersion,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[QueryCache] clear failed (ok, just means next run is full-cost):', err);
    }
  }

  /** Counts surfaced by useCoverageData to populate the perf report. */
  stats() {
    return {
      loadedEntries: this.initialSize,
      currentEntries: this.entries.size,
      loaded: this.loaded,
    };
  }
}
