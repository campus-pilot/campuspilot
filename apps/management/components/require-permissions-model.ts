/** The parts of a permission-check query that decide whether to render. */
export type PermissionQueryState = {
  isPending: boolean;
  isError: boolean;
  results: readonly boolean[] | undefined;
};

/**
 * True when every (or, for `any`, at least one) requested permission is
 * granted. Pending, failed, incomplete and denied checks fail closed.
 */
export function permissionsSatisfied(
  query: PermissionQueryState,
  requested: number,
  mode: 'all' | 'any' = 'all',
): boolean {
  if (query.isPending || query.isError || query.results?.length !== requested) return false;
  return mode === 'any' ? query.results.some(Boolean) : query.results.every(Boolean);
}
