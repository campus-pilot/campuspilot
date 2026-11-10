/** Longest provider-requested wait honoured; longer hints are capped. */
const MAX_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Parses an HTTP `Retry-After` header (seconds or an HTTP date) into
 * milliseconds; undefined when absent or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(at - now, 0), MAX_RETRY_AFTER_MS);
}
