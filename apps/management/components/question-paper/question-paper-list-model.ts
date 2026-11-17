import { z } from 'zod';
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

/**
 * Where the Question paper tab's mode filter is kept: one entry per school
 * (not per examination), so a choice such as "Written only" follows the
 * person from one examination to the next.
 */
export const modeFilterStorageKey = (schoolId: string) => `question-paper-mode-filter:${schoolId}`;

/** The stored mode filter: mode slugs (never names), bounded so a tampered entry cannot grow without limit. */
export const modeFilterSchema = z.array(z.string().min(1).max(100)).max(100);

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
