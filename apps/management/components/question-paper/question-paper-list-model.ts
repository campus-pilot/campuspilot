import { modeFilterSchema } from '@campuspilot/components/question-paper/question-paper-model';
import { commandFuzzyScore } from '@/components/management-command-model';

/**
 * Pure rules of the ways into an examination's Question paper tab: the
 * `class` parameter the tab's accordion keeps in the address, the stored mode
 * filter, and the command palette's exam-then-class picker.
 */

/**
 * The query string (with its `?`, or empty) after opening `classId`, or
 * after collapsing the open class (null removes the parameter). Every other
 * parameter is kept as it was.
 */
export function withClassParam(search: string, classId: string | null): string {
  const params = new URLSearchParams(search);
  if (classId === null) params.delete('class');
  else params.set('class', classId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** What `replaceOpenClass` needs of the router and the current address. */
export type ClassParamNavigation = {
  pathname: string;
  /** The current query string, without its `?`. */
  search: string;
  replace: (href: string, options: { scroll: boolean }) => void;
};

/**
 * Opens `classId` (null collapses the open class) by rewriting the `class`
 * parameter. It replaces the address rather than pushing, so Back does not
 * step through every toggle, and never scrolls, so the page stays where the
 * person is.
 */
export function replaceOpenClass(navigation: ClassParamNavigation, classId: string | null) {
  navigation.replace(`${navigation.pathname}${withClassParam(navigation.search, classId)}`, { scroll: false });
}

/** What every school's mode filter entry starts with. */
const MODE_FILTER_KEY_PREFIX = 'question-paper-mode-filter:';
/**
 * Where the Question paper tab's mode filter is kept: one entry per school
 * (not per examination), so a choice such as "Written only" follows the
 * person from one examination to the next.
 */
export const modeFilterStorageKey = (schoolId: string) => `${MODE_FILTER_KEY_PREFIX}${schoolId}`;


/**
 * How many times another tab changed each school's stored mode filter.
 * `cleared` counts `localStorage.clear()` in another tab, which removes every
 * school's entry at once; `bySchool` counts changes of one school's entry.
 */
export type ModeFilterRevisions = { cleared: number; bySchool: ReadonlyMap<string, number> };

export const initialModeFilterRevisions: ModeFilterRevisions = { cleared: 0, bySchool: new Map() };

/**
 * The revisions after a `storage` event from another tab with `key`. A
 * school's entry bumps that school only, so a change to another school's
 * filter never reseeds (and closes) this school's open filter. A null key is
 * `localStorage.clear()` and bumps every school. Any other key returns the
 * same object, so readers see no change.
 */
export function nextModeFilterRevisions(revisions: ModeFilterRevisions, key: string | null): ModeFilterRevisions {
  if (key === null) return { ...revisions, cleared: revisions.cleared + 1 };
  if (!key.startsWith(MODE_FILTER_KEY_PREFIX)) return revisions;
  const schoolId = key.slice(MODE_FILTER_KEY_PREFIX.length);
  const bySchool = new Map(revisions.bySchool);
  bySchool.set(schoolId, (bySchool.get(schoolId) ?? 0) + 1);
  return { ...revisions, bySchool };
}

/** One school's revision: it grows exactly when that school's entry changed in another tab, or storage was cleared. */
export const modeFilterRevisionOf = (revisions: ModeFilterRevisions, schoolId: string) =>
  revisions.cleared + (revisions.bySchool.get(schoolId) ?? 0);

/**
 * The slugs a stored entry holds. A missing, unreadable or malformed entry
 * is no filter (every mode shown); it is not an error and is not deleted,
 * since the next change overwrites it anyway.
 */
export function parseStoredModeFilter(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = modeFilterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? [...new Set(parsed.data)] : [];
  } catch {
    return [];
  }
}

/** The command palette's question paper picker: an examination first, then one of its classes. */
export type QuestionPaperPickerStep = { step: 'exam' } | { step: 'class'; exam: { slug: string; name: string } };

/** What the picker's list says when it shows nothing: there is nothing at all, or nothing matches the search. */
export function pickerEmptyMessage(step: QuestionPaperPickerStep, query: string): string {
  const searching = query.trim() !== '';
  if (step.step === 'exam') return searching ? 'No matching examinations.' : 'No examinations in this session.';
  return searching ? 'No matching classes.' : 'No classes you can open.';
}

/**
 * The items matching the search, best first, by the palette's fuzzy score
 * over `fields`. An empty search keeps every item in its given order (the
 * session's exam order, the server's class order).
 */
export function rankByQuery<T>(items: readonly T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, index) => ({ item, index, score: commandFuzzyScore(query, fields(item)) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}
