import { z } from 'zod';
import {
  examClassSelectionSchema,
  type ExamPlanPreviewDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  offeredSubjects,
  type PlanSelection,
  type SubjectChoice,
} from '@campuspilot/components/exam/exam-class-selection-model';

type PreviewClass = ExamPlanPreviewDto['classes'][number];

/**
 * The subjects of a chosen class that get a plan: those in `subjects` when
 * the class has a choice there, otherwise every offered subject (what the
 * server plans for a class without a choice).
 */
function plannedSubjects(schoolClass: PreviewClass, subjects?: SubjectChoice) {
  const chosen = subjects && Object.hasOwn(subjects, schoolClass.classId) ? subjects[schoolClass.classId]! : undefined;
  return chosen ? schoolClass.subjects.filter((subject) => chosen.includes(subject.subjectSlug)) : schoolClass.subjects;
}

/**
 * The first problem that blocks saving this selection, as the server reports
 * it: a chosen class with no subject chosen, or an invalid chosen subject. A
 * class or subject left out does not block anything. Null when nothing
 * blocks.
 */
export function selectionIssue(
  preview: ExamPlanPreviewDto,
  classIds: readonly string[],
  subjects?: SubjectChoice,
): string | null {
  for (const schoolClass of preview.classes) {
    if (!classIds.includes(schoolClass.classId)) continue;
    const planned = plannedSubjects(schoolClass, subjects);
    if (schoolClass.subjects.length && !planned.length) return `${schoolClass.label}: select at least one subject.`;
    const subject = planned.find((entry) => entry.issue !== null);
    if (subject) return `${schoolClass.label} · ${subject.name}: ${subject.issue}`;
  }
  return null;
}

/** How many subject plans the chosen classes and subjects make. */
export function selectedPlanCount(
  preview: ExamPlanPreviewDto,
  classIds: readonly string[],
  subjects?: SubjectChoice,
): number {
  return preview.classes
    .filter((schoolClass) => classIds.includes(schoolClass.classId))
    .reduce((sum, schoolClass) => sum + plannedSubjects(schoolClass, subjects).length, 0);
}

/** The selection Create plan starts from: no class, every offered subject of every class. */
export function createPlanBase(preview: ExamPlanPreviewDto): PlanSelection {
  return { classIds: [], subjects: offeredSubjects(preview.classes) };
}

/** The subjects of each class that have their plan now (`planned`), in the review's order. */
function plannedChoice(preview: ExamPlanPreviewDto): SubjectChoice {
  return Object.fromEntries(
    preview.classes.map((entry) => [entry.classId, entry.subjects.filter((subject) => subject.planned).map((subject) => subject.subjectSlug)]),
  );
}

/**
 * The selection Edit classes starts from: the classes taking part, each with
 * the subjects that have plans; a class not taking part with every offered
 * subject (what adding it plans by default).
 */
export function editClassesBase(preview: ExamPlanPreviewDto): PlanSelection {
  const planned = plannedChoice(preview);
  const offered = offeredSubjects(preview.classes);
  return {
    classIds: participatingClassIds(preview),
    subjects: Object.fromEntries(
      preview.classes.map((entry) => [entry.classId, entry.participating ? planned[entry.classId]! : offered[entry.classId]!]),
    ),
  };
}

/** Whether two subject lists hold the same slugs, whatever their order. */
function sameSubjects(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((slug) => b.includes(slug));
}

/**
 * The kept classes (taking part before and after) whose chosen subjects
 * differ from the subjects planned now: the only kept classes Edit classes
 * sends in `subjects` (left out, a class keeps its plans).
 */
export function changedKeptClasses(preview: ExamPlanPreviewDto, value: PlanSelection): string[] {
  const planned = plannedChoice(preview);
  return participatingClassIds(preview).filter(
    (classId) =>
      value.classIds.includes(classId) &&
      Object.hasOwn(value.subjects, classId) &&
      !sameSubjects(value.subjects[classId]!, planned[classId] ?? []),
  );
}

/**
 * The first problem that blocks saving Edit classes: as for Create plan for
 * the classes joining, and for a kept class whose subjects change, no subject
 * chosen or an invalid subject that would get a plan.
 */
export function editSelectionIssue(preview: ExamPlanPreviewDto, value: PlanSelection): string | null {
  const baseline = participatingClassIds(preview);
  const joining = selectionIssue(
    preview,
    value.classIds.filter((classId) => !baseline.includes(classId)),
    value.subjects,
  );
  if (joining) return joining;
  for (const classId of changedKeptClasses(preview, value)) {
    const schoolClass = preview.classes.find((entry) => entry.classId === classId)!;
    const chosen = value.subjects[classId]!;
    if (!chosen.length) return `${schoolClass.label}: select at least one subject.`;
    const invalid = schoolClass.subjects.find((subject) => chosen.includes(subject.subjectSlug) && !subject.planned && subject.issue);
    if (invalid) return `${schoolClass.label} · ${invalid.name}: ${invalid.issue}`;
  }
  return null;
}

/** What Edit classes sends as `subjects`: every joining class and every kept class whose subjects change. */
export function editClassesSubjects(preview: ExamPlanPreviewDto, value: PlanSelection): Record<string, string[]> {
  const baseline = participatingClassIds(preview);
  return subjectsForClasses(
    [...value.classIds.filter((classId) => !baseline.includes(classId)), ...changedKeptClasses(preview, value)],
    value.subjects,
  );
}

/**
 * The API's per-class subject choice for the classes that join
 * (`generateExamPlan` / `updateExamClasses` `subjects`): every joining class
 * is sent with its chosen subjects, so the server plans exactly what the
 * dialog shows.
 */
export function subjectsForClasses(classIds: readonly string[], subjects: SubjectChoice): Record<string, string[]> {
  return Object.fromEntries(classIds.filter((classId) => Object.hasOwn(subjects, classId)).map((classId) => [classId, subjects[classId]!]));
}

/** The classes taking part now, in the preview's order. */
export function participatingClassIds(preview: ExamPlanPreviewDto): string[] {
  return preview.classes
    .filter((schoolClass) => schoolClass.participating)
    .map((schoolClass) => schoolClass.classId);
}

/** The first message of a field's validation errors (Zod issues or strings). */
export function fieldError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error)
      return String(error.message);
  }
  return undefined;
}

/** The values of a form choosing the classes taking part in an examination, and the subjects that get a plan. */
export type ClassSelectionValues = { classIds: string[]; subjects: SubjectChoice };

const classSelectionSchema = z.object({
  classIds: examClassSelectionSchema,
  subjects: z.record(z.string(), z.array(z.string())),
});

/**
 * TanStack Form options for choosing the classes of an examination, shared by
 * Create exam plan and Edit classes.
 *
 * A save the server refuses is handed to `onRefused` and is never written into
 * the form's error map. TanStack Form treats a form-level `onSubmit` error as
 * invalid until a field changes, so `canSubmit` stayed false and the button
 * (gated on it) could not retry the same selection, for example after the
 * results blocking a removal were deleted elsewhere. The caller shows the
 * refusal outside the form and clears it in `onAttempt`, which runs as each
 * attempt that passed validation starts.
 */
export function classSelectionFormOptions({
  classIds,
  subjects = {},
  save,
  onAttempt,
  onRefused,
  onSelectionChange,
}: {
  /** The selection the form starts with. */
  classIds: string[];
  /** The subjects chosen when the form starts (per class). */
  subjects?: SubjectChoice;
  /** Saves the selection; a rejection is a refusal. */
  save: (value: ClassSelectionValues) => Promise<void>;
  onAttempt: () => void;
  onRefused: (error: unknown) => void | Promise<void>;
  /**
   * Every change of the selection, so a caller can carry it into the form a
   * refreshed review remounts (see `carryPlanSelection`).
   */
  onSelectionChange?: (value: ClassSelectionValues) => void;
}) {
  return {
    defaultValues: { classIds, subjects } as ClassSelectionValues,
    validators: { onChange: classSelectionSchema, onSubmit: classSelectionSchema },
    listeners: {
      onChange: ({ formApi }: { formApi: { state: { values: ClassSelectionValues } } }) =>
        onSelectionChange?.(formApi.state.values),
    },
    onSubmit: async ({ value }: { value: ClassSelectionValues }) => {
      onAttempt();
      try {
        await save(value);
      } catch (error) {
        await onRefused(error);
      }
    },
  };
}
