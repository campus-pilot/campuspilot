import { z } from 'zod';

export const examDefinitionSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Exam name is required')
      .describe("Display name of the exam (e.g. 'Mid-Term', 'Final')"),
    order: z
      .number()
      .int()
      .min(1)
      .describe('Display order (1 = first exam of the session)'),
  })
  .describe('An exam defined for the academic session');

/**
 * Characters a new exam slug may use: lowercase letters, digits and
 * underscores. It also matches the empty string so that an empty slug is
 * reported once, by the length check, rather than also as malformed.
 */
export const EXAM_SLUG_PATTERN = /^[a-z0-9_]*$/;

/**
 * The rule for a new exam's slug, shared by the session settings editor, the
 * Examinations list's Create examination dialog and `school.createExam`.
 * Stored configurations are not re-validated against it: `examConfigSchema`
 * keeps accepting any non-empty key so older slugs keep working.
 */
export const examSlugSchema = z
  .string()
  .trim()
  .min(1, 'Exam slug is required')
  .max(100, 'Exam slug must be 100 characters or fewer')
  .regex(
    EXAM_SLUG_PATTERN,
    'Slug can only contain lowercase letters, numbers, and underscores',
  );

/**
 * The display order a newly created exam takes: one after the highest order in
 * the session, so it is listed last. Session settings keeps orders contiguous
 * (1..n, renumbered on reorder and removal), where this equals the number of
 * exams plus one, the order settings gives a new exam. Orders written by
 * other paths can have gaps or ties; taking the maximum instead of the count
 * keeps a new exam from sharing an order with the last one in that case.
 */
export function nextExamOrder(
  examConfig: Readonly<Record<string, { order: number }>>,
): number {
  return (
    Object.values(examConfig).reduce(
      (highest, exam) => Math.max(highest, exam.order),
      0,
    ) + 1
  );
}

/**
 * The form of an exam name that decides whether two exams of a session share a
 * name: exam names are unique within a session, compared trimmed and ignoring
 * case. The name is first put in Unicode NFC, so a precomposed letter and the
 * same letter written with a combining mark (`é` and `e` + U+0301) compare
 * equal; then surrounding whitespace is removed (`String.prototype.trim`,
 * which includes Unicode spaces such as U+00A0); then it is lowercased with
 * the fixed `en` locale, so the result does not depend on the runtime's locale
 * (a Turkish default locale would otherwise lowercase `I` to dotless `ı`).
 * Whitespace inside the name is kept as typed: `Unit  Test` and `Unit Test`
 * are different names. Used by the browser and the server alike, so the
 * dialogs and the procedures apply one rule. The stored name keeps the case
 * and inner spacing the user gave it; this key is only compared, never stored.
 */
export function examNameKey(name: string): string {
  return name.normalize('NFC').trim().toLocaleLowerCase('en');
}

/**
 * The slug of an exam in `examConfig` whose name clashes with `name`
 * (`examNameKey`), or `undefined` when none does. `exceptSlug` is the exam
 * being renamed: it never clashes with itself, so keeping its name or changing
 * only its case or surrounding whitespace is not a clash. When several exams
 * clash (stored duplicates), the first by slug is returned, so the answer does
 * not depend on the map's insertion order.
 */
export function findExamNameClash(
  examConfig: Readonly<Record<string, { name: string }>>,
  name: string,
  exceptSlug?: string,
): string | undefined {
  const key = examNameKey(name);
  return Object.keys(examConfig)
    .sort()
    .find(
      (slug) =>
        slug !== exceptSlug && examNameKey(examConfig[slug]!.name) === key,
    );
}

/**
 * The name clashes a full replacement of a session's exams would introduce:
 * each returned group lists the slugs (sorted) of `submitted` exams sharing
 * one name (`examNameKey`) where at least one of them is new (its slug is not
 * in `stored`) or was renamed (its stored name has a different key). Groups
 * made only of exams stored under the same names are not returned: a session
 * saved before names had to be unique keeps saving its existing duplicates,
 * so saving unrelated settings never fails for it. Changing an exam's slug in
 * session settings makes it a new exam here, like any exam whose slug the
 * session did not have. Groups are ordered by their first slug.
 */
export function findIntroducedExamNameClashes(
  stored: Readonly<Record<string, { name: string }>>,
  submitted: Readonly<Record<string, { name: string }>>,
): string[][] {
  const groups = new Map<string, string[]>();
  for (const slug of Object.keys(submitted).sort()) {
    const key = examNameKey(submitted[slug]!.name);
    groups.set(key, [...(groups.get(key) ?? []), slug]);
  }
  const isNewOrRenamed = (slug: string) =>
    !Object.hasOwn(stored, slug) ||
    examNameKey(stored[slug]!.name) !== examNameKey(submitted[slug]!.name);
  return [...groups.values()].filter(
    (slugs) => slugs.length > 1 && slugs.some(isNewOrRenamed),
  );
}

/**
 * Stored exam configurations, keyed by slug. It deliberately does not refuse
 * duplicate names (`examNameKey`): it also parses configurations read from the
 * database and response DTOs, and sessions saved before names had to be unique
 * may hold duplicates, which must keep loading. Name uniqueness is enforced
 * where exams are written: `school.createExam`, `school.updateExam`, and
 * `school.createSession` / `school.updateSession` through
 * `findIntroducedExamNameClashes`.
 */
export const examConfigSchema = z
  .record(
    z.string().min(1).describe("Exam slug (e.g. 'midterm', 'final')"),
    examDefinitionSchema,
  )
  .describe('Map of exam slug to exam definition for the session');

export const coScholasticAreaSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Area name is required')
      .describe("Display name (e.g. 'Art & Craft', 'Physical Education')"),
  })
  .describe('A co-scholastic assessment area');

export const coScholasticAreasSchema = z
  .record(
    z.string().min(1).describe("Area slug (e.g. 'art', 'sports')"),
    coScholasticAreaSchema,
  )
  .describe('Map of co-scholastic area slug to area definition');

// In dropdowns and selectors this must be shown top to bottom in descending order of minScore,
export const gradeSchema = z
  .object({
    label: z
      .string()
      .min(1, 'Grade label is required')
      .describe("Grade label (e.g. 'A+', 'A', 'B')"),
    minScore: z
      .number()
      .int()
      .min(0)
      .describe('Minimum percentage score to achieve this grade'),
  })
  .describe('A grade definition with label and minimum score threshold');

export const gradingScaleSchema = z
  .record(
    z.string().min(1).describe("Grade key (e.g. 'a_plus', 'a', 'b')"),
    gradeSchema,
  )
  .describe(
    'Map of grade key to grade definition, ordered by minScore descending',
  );

export const attendanceTrackingSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether attendance tracking is enabled for this session'),
  })
  .describe('Attendance tracking configuration');

export const sessionConfigSchema = z
  .object({
    examConfig: examConfigSchema
      .optional()
      .default({})
      .describe('Exams defined for this session'),
    coScholasticAreas: coScholasticAreasSchema
      .optional()
      .default({})
      .describe('Co-scholastic areas assessed in this session'),
    gradingScale: gradingScaleSchema
      .optional()
      .default({})
      .describe('Grading scale for converting marks to grades'),
    attendanceTracking: attendanceTrackingSchema
      .optional()
      .default({ enabled: false })
      .describe('Attendance tracking settings'),
  })
  .describe(
    'Academic session configuration: exams, grading, co-scholastic areas, and attendance',
  );

export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type ExamDefinition = z.infer<typeof examDefinitionSchema>;
export type CoScholasticArea = z.infer<typeof coScholasticAreaSchema>;
export type GradeDefinition = z.infer<typeof gradeSchema>;
