/**
 * Where switching session lands, given the part of the current path after
 * the session (`/exam/term-1/results`, `/notices/ntc_1/edit`, `/admissions`).
 *
 * Most pages exist in every session, so the same page of the other session
 * opens. A page about one record of the current session does not: an
 * examination's plans and a notice belong to exactly one session, so
 * switching away from them returns to that area's list in the new session
 * instead of showing the old session's record under the new session's
 * navigation. Writing a new notice is not about a record and is kept.
 */
export function sessionSwitchSuffix(suffix: string): string {
  if (suffix.startsWith('/exam/')) return '/exam';
  if (suffix.startsWith('/notices/') && suffix !== '/notices/new') return '/notices';
  return suffix;
}
