/** One class a scope picker can offer. */
export type ClassScopeOption = { id: string; label: string };

/** Classes shown per page of the picker's list. */
export const CLASS_SCOPE_PAGE_SIZE = 10;

/** Case-insensitive match of the search text against the class label; a blank search matches every class. */
export function filterClassScopeOptions<T extends ClassScopeOption>(classes: readonly T[], search: string): T[] {
  const needle = search.trim().toLocaleLowerCase();
  return classes.filter((item) => item.label.toLocaleLowerCase().includes(needle));
}

/**
 * One page of the filtered list. `totalPages` is at least 1, and a page
 * beyond the end (the list shrank under a stale page number) reads as the
 * last page rather than as an empty list.
 */
export function pageClassScopeOptions<T>(items: readonly T[], page: number, pageSize = CLASS_SCOPE_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return { totalPages, currentPage, visible: items.slice((currentPage - 1) * pageSize, currentPage * pageSize) };
}

/**
 * Adds or removes one class. The result keeps the order of `classes`
 * (display order), never the order of clicks, and drops IDs that are no
 * longer offered.
 */
export function toggleClassScopeId(classes: readonly ClassScopeOption[], selectedIds: readonly string[], id: string): string[] {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return classes.filter((item) => next.has(item.id)).map((item) => item.id);
}

/** The trigger text when the caller supplies none: how many of the offered classes are selected. */
export function classScopeSummary(selectedCount: number, totalCount: number) {
  if (selectedCount === 0) return 'Choose classes';
  return `${selectedCount} of ${totalCount} ${totalCount === 1 ? 'class' : 'classes'}`;
}
