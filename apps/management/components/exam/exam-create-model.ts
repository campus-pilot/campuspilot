import { z } from 'zod';
import { createExamInputSchema } from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  examNameKey,
  findExamNameClash,
  isExamNameTakenError,
  isExamSlugTakenError,
} from '@campuspilot/api/routers/school/exam/exam-definition.contract';
import { slugify } from '@campuspilot/components/session/types';
import type { SessionScope } from './exam-model';

/** Shown next to the slug when the session already has an exam with it. */
export const EXAM_SLUG_TAKEN_MESSAGE =
  'An examination with this slug already exists in this session.';

/**
 * Shown next to the name when another exam of the session has it, compared
 * with the shared rule (`examNameKey`: ignoring case, spacing differences,
 * invisible characters and Unicode compatibility forms).
 */
export const EXAM_NAME_TAKEN_MESSAGE =
  'An examination with this name already exists in this session.';

/** The session's exams as the dialog holds them (`getSession`), keyed by slug. */
export type SessionExams = Readonly<Record<string, { name: string }>>;

/**
 * The Create examination dialog's values and rules. Name and slug use the
 * server's own rules (`createExamInputSchema`, whose slug rule session
 * settings shares).
 *
 * Uniqueness is checked twice, the server staying the authority. First
 * against `sessionExams`, the session's exams the page already holds (the
 * session read that gates the action), so a taken slug or name is shown before
 * any request. Then by the server: `takenSlugs` and `takenNames` hold what it
 * refused while the dialog is open (an exam added elsewhere since the session
 * was read), so the refusal stays beside its field until the value changes.
 */
export function createExamFormSchema(sessionExams: SessionExams = {}) {
  return z
    .object({
      name: createExamInputSchema.shape.name,
      slug: createExamInputSchema.shape.examSlug,
      takenSlugs: z.array(z.string()),
      takenNames: z.array(z.string()),
    })
    .superRefine((values, context) => {
      const slug = values.slug.trim();
      if (values.takenSlugs.includes(slug) || Object.hasOwn(sessionExams, slug))
        context.addIssue({
          code: 'custom',
          message: EXAM_SLUG_TAKEN_MESSAGE,
          path: ['slug'],
        });
      const nameKey = examNameKey(values.name);
      if (
        values.takenNames.some((name) => examNameKey(name) === nameKey) ||
        findExamNameClash(sessionExams, values.name) !== undefined
      )
        context.addIssue({
          code: 'custom',
          message: EXAM_NAME_TAKEN_MESSAGE,
          path: ['name'],
        });
    });
}

export type CreateExamFormValues = z.input<
  ReturnType<typeof createExamFormSchema>
>;

export const emptyCreateExamForm: CreateExamFormValues = {
  name: '',
  slug: '',
  takenSlugs: [],
  takenNames: [],
};

/**
 * The values after the server refused the attempt `values` as a taken slug or
 * a taken name, which puts the refusal beside that field (`createExamFormSchema`).
 * Returns `undefined` for any other refusal, which the dialog shows above the
 * buttons. Decided by the refusal's explicit reason, never by its code.
 */
export function withServerRefusal(
  values: CreateExamFormValues,
  error: unknown,
): CreateExamFormValues | undefined {
  if (isExamSlugTakenError(error))
    return { ...values, takenSlugs: [...values.takenSlugs, values.slug.trim()] };
  if (isExamNameTakenError(error))
    return { ...values, takenNames: [...values.takenNames, values.name.trim()] };
  return undefined;
}

/**
 * The slug after the name changes. It is derived from the name with the
 * session settings rule (`slugify`) for as long as the user has not typed a
 * slug of their own: an empty slug, or one equal to the previous name's
 * derived slug, follows the name; any other slug is kept.
 */
export function followNameSlug({
  previousName,
  nextName,
  slug,
}: {
  previousName: string;
  nextName: string;
  slug: string;
}): string {
  return slug === '' || slug === slugify(previousName)
    ? slugify(nextName)
    : slug;
}

/**
 * The request for `school.createExam`. Order is left out on purpose: the
 * server lists the new exam last, deciding under the session lock.
 */
export function toCreateExamInput(
  scope: SessionScope,
  values: CreateExamFormValues,
) {
  return {
    schoolId: scope.schoolId,
    sessionId: scope.sessionId,
    examSlug: values.slug.trim(),
    name: values.name.trim(),
  };
}

/**
 * Starts a new submission attempt from the dialog's submit event.
 *
 * The previous attempt's form-level message (a refusal other than a taken
 * slug or name, or an uncertain outcome) is cleared first. It has to happen here,
 * before `handleSubmit`: TanStack Form keeps an `onSubmit` error the handler
 * set itself through submit validation (this form has no submit validator to
 * replace it), so the form stays invalid and `handleSubmit` stops before
 * calling `onSubmit`. Clearing it inside `onSubmit` would never run, and Create
 * would do nothing until a field changed.
 */
export function startCreateExamAttempt(form: {
  setErrorMap: (errorMap: { onSubmit: undefined }) => void;
  handleSubmit: () => Promise<unknown>;
}) {
  form.setErrorMap({ onSubmit: undefined });
  return form.handleSubmit();
}
