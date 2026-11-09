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

/**
 * Links to one class's results or growth. The class record id is a path
 * segment (`/results/class/{recordId}`), not a query parameter; the server
 * only resolves it within the signed-in admission's own class records.
 */
export const classResultsHref = (recordId: string) => `/results/class/${encodeURIComponent(recordId)}`;
export const classGrowthHref = (recordId: string) => `/growth/class/${encodeURIComponent(recordId)}`;
