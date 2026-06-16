/**
 * Simple in-memory cache with TTL for API call results.
 * Survives React navigation (module-level) but not full page refresh.
 * Default TTL: 5 minutes.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CacheEntry<unknown>>();

/** Get a cached value, or undefined if expired/missing */
export function getCached<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

/** Store a value in cache */
export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** Clear all cached data */
export function clearCache(): void {
  cache.clear();
}

/** Get cache stats for debugging */
export function getCacheStats(): { entries: number; keys: string[] } {
  return { entries: cache.size, keys: Array.from(cache.keys()) };
}

/**
 * Cached version of functions.call() — caches the JSON response by function name.
 * Returns cached data if available and not expired, otherwise calls the function.
 */
/**
 * Cached version of functions.call() — caches the JSON response by function name.
 * The callFn should be `(name) => functions.call(name)`.
 */
export async function cachedFunctionCall<T>(
  callFn: (name: string) => Promise<Response>,
  name: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const cacheKey = `fn:${name}`;
  const cached = getCached<T>(cacheKey, ttlMs);
  if (cached !== undefined) return cached;

  const response = await callFn(name);
  const data = (await response.json()) as T;
  setCache(cacheKey, data);
  return data;
}
