/**
 * Whether the admission list shows every registered admission: no search and
 * no filter beyond the default "Registered". Only then does an empty list mean
 * there is nothing yet (and offer New admission) rather than nothing matching.
 * An explicitly chosen session counts as a filter, even though the session
 * alone only decorates placements: it is what the person picked.
 */
export function isUnfilteredAdmissionList(query: { searchQuery?: string; filters?: Record<string, unknown> }): boolean {
  if (query.searchQuery) return false;
  return Object.entries(query.filters ?? {}).every(
    ([key, value]) => value === undefined || (key === 'registrationStatus' && value === 'registered'),
  );
}
