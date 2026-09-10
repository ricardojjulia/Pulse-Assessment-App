/** Extracts the tenant ID from a Dynatrace environment URL.
 *  e.g. "https://abc12345.live.dynatrace.com" → "abc12345"
 *  Returns an empty string when the URL is absent or does not match. */
export function getTenantId(envUrl: string): string {
  return envUrl.match(/\/\/([^.]+)/)?.[1] ?? '';
}
