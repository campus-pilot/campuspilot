import { z } from 'zod';
import { createExamInputSchema } from '@campuspilot/api/routers/school/exam/exam.dto';
import { slugify } from '@campuspilot/components/session/types';
import type { SessionScope } from './exam-model';

/** Shown next to the slug when the session already has an exam with it. */
export const EXAM_SLUG_TAKEN_MESSAGE =
  'An examination with this slug already exists in this session.';

/**
 * The Create examination dialog's values. Name and slug use the server's own
 * rules (`createExamInputSchema`, whose slug rule session settings shares).
 * `takenSlugs` holds slugs the server refused as duplicates while the dialog
 * is open, so the refusal stays beside the slug field until it is changed;
 * the server stays the only authority on uniqueness.
 */
export const createExamFormSchema = z
  .object({
    name: createExamInputSchema.shape.name,
    slug: createExamInputSchema.shape.examSlug,
    takenSlugs: z.array(z.string()),
  })
  .refine((values) => !values.takenSlugs.includes(values.slug.trim()), {
    message: EXAM_SLUG_TAKEN_MESSAGE,
    path: ['slug'],
  });

export type CreateExamFormValues = z.input<typeof createExamFormSchema>;

export const emptyCreateExamForm: CreateExamFormValues = {
  name: '',
  slug: '',
  takenSlugs: [],
};

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
