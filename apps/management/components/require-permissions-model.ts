/** The parts of a permission-check query that decide whether to render. */
export type PermissionQueryState = {
  isPending: boolean;
  isError: boolean;
  results: readonly boolean[] | undefined;
};

/**
 * What a permission gate shows. `pending`: the check has no answer yet,
 * which is neither a grant nor a refusal. `granted`: the gated content.
 * `denied`: the gate's fallback.
 */
export type PermissionGateState = 'pending' | 'granted' | 'denied';

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

/**
 * The state a gate renders. A check still waiting for its first answer is
 * `pending`, kept apart from `denied`: every page asks its own permission
 * list, so each navigation starts with an unanswered check, and showing the
 * refusal for it flashed "Permission required" before pages the member may
 * open. A check that failed with no answer held is `denied` (fails closed).
 */
export function permissionGateState(
  query: PermissionQueryState,
  requested: number,
  mode: 'all' | 'any' = 'all',
): PermissionGateState {
  if (query.isPending) return 'pending';
  return permissionsSatisfied(query, requested, mode) ? 'granted' : 'denied';
}
