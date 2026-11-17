import type { ReviewClass } from './exam-plan-review-table';

/**
 * Whether a class's checkbox can change. A class needs at least one configured
 * subject to take part (the server refuses one with nothing to examine); a class
 * already taking part (`baseline`) can always be kept or removed.
 */
export function isClassSelectable(schoolClass: ReviewClass, baseline: readonly string[] = []): boolean {
  return schoolClass.subjects.length > 0 || baseline.includes(schoolClass.classId);
}

/** Every class that can be chosen, in the review's order: what "Select all" picks. */
export function allSelectableClassIds(classes: readonly ReviewClass[], baseline: readonly string[] = []): string[] {
  return classes.filter((entry) => isClassSelectable(entry, baseline)).map((entry) => entry.classId);
}

/** The selection after checking or unchecking one class, kept in the review's order. */
export function toggleClassSelection(
  classes: readonly ReviewClass[],
  selected: readonly string[],
  classId: string,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  if (checked) next.add(classId);
  else next.delete(classId);
  return classes.map((entry) => entry.classId).filter((id) => next.has(id));
}

/** Whether two selections hold the same classes, whatever their order. */
export function sameClassSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
