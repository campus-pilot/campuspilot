/**
 * Rewriting one query parameter of the current address in place, for view
 * state that lives in the address (a tab, a selected item, an open chat)
 * without a navigation.
 *
 * It uses `window.history.replaceState`, not `router.replace`: on a route
 * that is an async server component a router navigation fetches its RSC
 * payload again on every change, so the screen would not move until that
 * returned (see `useOpenClassParam` in question-paper-page.tsx, where this
 * was first measured). Since Next 14.1 the App Router patches the History
 * API and syncs `useSearchParams` and `usePathname` with it, so the change
 * re-renders at once, with no request and no scroll, while Back and reload
 * keep the rewritten address.
 */

/**
 * The address (path, query and hash) of `current` with `name` set to `value`,
 * or removed when `value` is null. Every other parameter is kept as it was.
 */
export function withSearchParam(current: string, name: string, value: string | null): string {
  const url = new URL(current);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Replaces the current history entry with the current address with `name`
 * set (null removes it). The address is read when it is called, never from
 * a render's snapshot, so two changes made in one event (say, a chat and a
 * revision) both survive.
 */
export function replaceSearchParam(name: string, value: string | null) {
  window.history.replaceState(null, '', withSearchParam(window.location.href, name, value));
}
