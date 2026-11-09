/**
 * Decodes a dynamic route segment. A malformed escape (such as `%E0`) makes
 * `decodeURIComponent` throw; that URL cannot name any record, so callers
 * show their not-found state instead of crashing.
 */
export function decodeRouteParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
