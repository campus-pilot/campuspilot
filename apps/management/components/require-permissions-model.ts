/** The parts of a permission-check query that decide whether to render. */
export type PermissionQueryState = {
  isPending: boolean;
  isError: boolean;
  results: readonly boolean[] | undefined;
};

/**
 * True when every (or, for `any`, at least one) requested permission is
 * granted. A check that is pending, never answered, incomplete or denied
 * fails closed.
 *
 * An answer already held keeps applying when a later refetch fails:
 * TanStack Query reports that as `isError` with the last good `results`
 * still present (they belong to the same permission list, since the list is
 * the query key). Treating it as "denied" replaced open pages with
 * "Permission required" on every network blip and dropped unsaved input.
 * This is visibility only; the server checks every call again.
 */
export function permissionsSatisfied(
  query: PermissionQueryState,
  requested: number,
  mode: 'all' | 'any' = 'all',
): boolean {
  if (query.results?.length !== requested) return false;
  return mode === 'any' ? query.results.some(Boolean) : query.results.every(Boolean);
}
