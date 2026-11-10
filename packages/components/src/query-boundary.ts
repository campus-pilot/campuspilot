/**
 * What a screen shows for one read, decided from the data it holds before
 * the error flag.
 *
 * TanStack Query keeps the last good `data` when a later refetch fails (a
 * return to the tab on a flaky network) and reports `isError` beside it. A
 * boundary that tests `isError` first then replaces a page that was already
 * on screen, with whatever the person had typed into it, by an error panel
 * for a failure that concerns nobody. Every boundary therefore resolves the
 * same way:
 * - data is held and the error does not `replace` it: `ready`, with the
 *   failed refresh available as `refetchError` for a quiet note;
 * - an error that `replaces` what is shown (the record no longer exists,
 *   the feature was switched off: the held copy is no longer true): `failed`;
 * - an error with nothing held: `failed`;
 * - neither data nor error yet: `pending`.
 *
 * This is about what stays on screen only. Nothing here grants anything:
 * the server decides every call again.
 */
export type QueryBoundaryState<T> =
  | { kind: 'pending' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'ready'; data: T; refetchError: unknown };

/** The parts of a query result the boundary reads (`null`/`undefined` error = no error). */
export type QueryBoundaryInput<T> = { data: T | undefined; error: unknown };

export function resolveQueryBoundary<T>(
  query: QueryBoundaryInput<T>,
  options: {
    /** True for an error that makes the held data untrue (not found, feature off). Transient failures never do. */
    replaces?: (error: unknown) => boolean;
  } = {},
): QueryBoundaryState<T> {
  const error = query.error ?? null;
  if (query.data !== undefined && (error === null || !options.replaces?.(error))) {
    return { kind: 'ready', data: query.data, refetchError: error };
  }
  return error === null ? { kind: 'pending' } : { kind: 'failed', error };
}
