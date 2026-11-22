import { z } from 'zod';

/** Slugs of subjects and exam modes: lowercase letters, numbers and single hyphens (as the API accepts them). */
const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens only');

/**
 * A subject as the subject form edits it: name, slug and at least one exam
 * mode whose percentages sum to 100, with unique mode slugs. Shared by the
 * classroom subject editor and Add subject from an examination.
 */
export const subjectFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Subject name is required').max(200),
    slug: slugSchema,
    examModes: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Mode name is required').max(100),
          slug: slugSchema,
          percentage: z.number().min(0).max(100),
        }),
      )
      .min(1, 'Add at least one exam mode')
      .max(20, 'Add at most 20 exam modes'),
  })
  .superRefine(({ examModes }, context) => {
    if (new Set(examModes.map(({ slug }) => slug)).size !== examModes.length) {
      context.addIssue({ code: 'custom', path: ['examModes'], message: 'Exam mode slugs must be unique' });
    }
    const total = examModes.reduce((sum, mode) => sum + mode.percentage, 0);
    if (Math.abs(total - 100) > 0.001) {
      context.addIssue({ code: 'custom', path: ['examModes'], message: 'Exam mode percentages must sum to 100%' });
    }
  });

export type SubjectFormValue = z.infer<typeof subjectFormSchema>;

/** The slug generated from a subject name. */
export function slugifySubject(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The slug after the name changes: it keeps following the name while it is
 * empty or still the slug generated from the previous name, and stays as the
 * person typed it once they edited it.
 */
export function followingSlug(previousName: string, nextName: string, slug: string) {
  return !slug || slug === slugifySubject(previousName) ? slugifySubject(nextName) : slug;
}

/** A new subject: no name yet and one Written mode worth 100%. */
export function newSubjectFormValue(): SubjectFormValue {
  return { name: '', slug: '', examModes: [{ name: 'Written', slug: 'written', percentage: 100 }] };
}

/** The form value of a stored subject. */
export function subjectFormValueOf(
  slug: string,
  subject: { name: string; examModes: Record<string, { name: string; percentage: number }> },
): SubjectFormValue {
  return {
    name: subject.name,
    slug,
    examModes: Object.entries(subject.examModes).map(([modeSlug, mode]) => ({ slug: modeSlug, ...mode })),
  };
}

/** The exam modes of a submitted form, keyed by slug, as the API stores them. */
export function examModesOf(value: SubjectFormValue): Record<string, { name: string; percentage: number }> {
  return Object.fromEntries(value.examModes.map(({ slug, name, percentage }) => [slug, { name, percentage }]));
}

/** Every distinct message of a form's or field's errors (strings, Zod issues or `{ form }` entries). */
export function errorMessages(errors: readonly unknown[]): string[] {
  const messages = errors.flatMap((error) => {
    if (typeof error === 'string') return [error];
    if (error && typeof error === 'object' && 'message' in error) return [String(error.message)];
    if (error && typeof error === 'object' && 'form' in error) return [String(error.form)];
    return [];
  });
  return [...new Set(messages)];
}
