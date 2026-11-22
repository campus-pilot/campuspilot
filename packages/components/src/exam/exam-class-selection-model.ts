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

/** Per class ID, the slugs of the subjects chosen to get a plan, in the review's order. */
export type SubjectChoice = Record<string, string[]>;

/** Every subject the review offers, per class: the default choice, everything checked. */
export function offeredSubjects(classes: readonly ReviewClass[]): SubjectChoice {
  return Object.fromEntries(classes.map((entry) => [entry.classId, entry.subjects.map((subject) => subject.subjectSlug)]));
}

/** The choice after checking or unchecking one subject of a class, kept in the review's order. */
export function toggleSubjectChoice(
  classes: readonly ReviewClass[],
  choice: SubjectChoice,
  classId: string,
  subjectSlug: string,
  checked: boolean,
): SubjectChoice {
  const next = new Set(Object.hasOwn(choice, classId) ? choice[classId] : []);
  if (checked) next.add(subjectSlug);
  else next.delete(subjectSlug);
  const order = classes.find((entry) => entry.classId === classId)?.subjects.map((subject) => subject.subjectSlug) ?? [];
  return { ...choice, [classId]: order.filter((slug) => next.has(slug)) };
}

/** The classes chosen and, per class, the subjects chosen: a review form's value. */
export type PlanSelection = { classIds: string[]; subjects: SubjectChoice };

/**
 * What the person changed relative to the selection a review form started
 * from (its `base`): classes added and removed, and per class the subjects
 * checked and unchecked. Carried into the form a refreshed review remounts
 * instead of a snapshot of the whole selection, so a change someone else
 * saved meanwhile (a class that started taking part, a subject that got its
 * plan) shows in the new base and is never undone by an old snapshot.
 */
export type PlanSelectionChanges = {
  added: string[];
  removed: string[];
  checked: SubjectChoice;
  unchecked: SubjectChoice;
};

export const NO_PLAN_SELECTION_CHANGES: PlanSelectionChanges = { added: [], removed: [], checked: {}, unchecked: {} };

function own(choice: SubjectChoice, classId: string): string[] {
  return Object.hasOwn(choice, classId) ? choice[classId]! : [];
}

/** The changes that turn `base` into `value` ({@link PlanSelectionChanges}). */
export function planSelectionChanges(base: PlanSelection, value: PlanSelection): PlanSelectionChanges {
  const classIds = new Set([...Object.keys(base.subjects), ...Object.keys(value.subjects)]);
  const difference = (from: SubjectChoice, to: SubjectChoice) =>
    Object.fromEntries(
      [...classIds]
        .map((classId) => [classId, own(to, classId).filter((slug) => !own(from, classId).includes(slug))] as const)
        .filter(([, slugs]) => slugs.length > 0),
    );
  return {
    added: value.classIds.filter((classId) => !base.classIds.includes(classId)),
    removed: base.classIds.filter((classId) => !value.classIds.includes(classId)),
    checked: difference(base.subjects, value.subjects),
    unchecked: difference(value.subjects, base.subjects),
  };
}

/**
 * The selection a (refreshed) review form starts with: its own `base` with the
 * person's earlier changes applied, kept in the review's order. A class added
 * stays chosen while it can take part; a subject checked or unchecked keeps
 * that choice while it is still offered; everything else follows the base.
 */
export function applyPlanSelectionChanges(
  classes: readonly ReviewClass[],
  base: PlanSelection,
  changes: PlanSelectionChanges,
  baseline: readonly string[] = [],
): PlanSelection {
  const selectable = new Set(allSelectableClassIds(classes, baseline));
  const classIds = classes
    .map((entry) => entry.classId)
    .filter(
      (classId) =>
        selectable.has(classId) &&
        ((base.classIds.includes(classId) && !changes.removed.includes(classId)) || changes.added.includes(classId)),
    );
  const subjects = Object.fromEntries(
    classes.map((entry) => [
      entry.classId,
      entry.subjects
        .map((subject) => subject.subjectSlug)
        .filter(
          (slug) =>
            (own(base.subjects, entry.classId).includes(slug) && !own(changes.unchecked, entry.classId).includes(slug)) ||
            own(changes.checked, entry.classId).includes(slug),
        ),
    ]),
  );
  return { classIds, subjects };
}

/**
 * The changes after a subject was added to a class from the review: the
 * subject is checked, and a class that had no subject before is chosen (it
 * could not take part until now).
 */
export function changesAfterSubjectAdded(
  classes: readonly ReviewClass[],
  changes: PlanSelectionChanges,
  classId: string,
  subjectSlug: string,
): PlanSelectionChanges {
  const firstSubject = !classes.find((entry) => entry.classId === classId)?.subjects.length;
  return {
    ...changes,
    added: firstSubject && !changes.added.includes(classId) ? [...changes.added, classId] : changes.added,
    removed: changes.removed.filter((id) => id !== classId || !firstSubject),
    checked: { ...changes.checked, [classId]: [...own(changes.checked, classId), subjectSlug] },
  };
}
