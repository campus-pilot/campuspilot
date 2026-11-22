import { z } from "zod";

export const bookSchema = z
  .object({
    title: z
      .string()
      .min(1, "Book title is required")
      .describe("Title of the textbook"),
    publication: z.string().optional().describe("Publisher name"),
    author: z.string().optional().describe("Author name"),
  })
  .describe("A textbook prescribed for a subject");

export const examModeSchema = z
  .object({
    name: z
      .string()
      .min(1, "Mode name is required")
      .describe("Display name (e.g. 'Written', 'Practical')"),
    percentage: z
      .number()
      .min(0)
      .max(100)
      .describe("Weight as percentage of total marks"),
  })
  .describe("An exam assessment mode for a subject");

export const examModesSchema = z
  .record(
    z.string().min(1).describe("Mode slug (e.g. 'written', 'practical')"),
    examModeSchema,
  )
  .describe("Map of exam mode slug to mode definition");

/**
 * One examination a subject is attached to. An examination is identified by
 * its session and its slug in that session's `examConfig`; both are stored,
 * since slugs repeat across sessions.
 */
export const subjectExamRefSchema = z
  .object({
    sessionId: z.string().min(1).describe("Session of the examination"),
    examSlug: z.string().min(1).describe("Exam slug in that session"),
  })
  .describe("An examination a subject is attached to");

/**
 * Where a subject is offered, stored explicitly on every subject:
 *
 * - `school`: a classroom subject, offered in every examination of the class.
 * - `exam`: added from an examination and offered only in the listed
 *   examinations. The list holds exactly one examination today; it is a list
 *   so a later "use in this exam too" only relaxes `.length(1)` to `.min(1)`
 *   without a data migration. Readers never pick `exams[0]`: they ask
 *   {@link isSubjectOfferedInExam}.
 *
 * Removing an examination drops it from `exams`; a subject left with none is
 * removed with it (`detachExamsFromSubjects` in the API).
 */
export const subjectAttachmentSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("school") }),
    z.object({
      kind: z.literal("exam"),
      exams: z.array(subjectExamRefSchema).length(1),
    }),
  ])
  .describe(
    "Where the subject is offered: 'school' (a classroom subject, every examination) or 'exam' (only the listed examinations)",
  );

const subjectFields = {
  name: z
    .string()
    .min(1, "Subject name is required")
    .describe("Display name of the subject (e.g. 'Mathematics', 'English')"),
  books: z
    .array(bookSchema)
    .optional()
    .default([])
    .describe("Prescribed textbooks for this subject"),
  examModes: examModesSchema
    .optional()
    .default({})
    .describe("Exam assessment modes and their weights for this subject"),
};

function refineModeTotal(
  { examModes }: { examModes: Record<string, { percentage: number }> },
  context: z.RefinementCtx,
) {
  const modes = Object.values(examModes);
  if (modes.length === 0) return;

  const total = modes.reduce((sum, mode) => sum + mode.percentage, 0);
  if (Math.abs(total - 100) > 0.001) {
    context.addIssue({
      code: "custom",
      path: ["examModes"],
      message: "Exam mode percentages must sum to 100%",
    });
  }
}

/** A stored subject. Its `attachment` is always present (migration 0081 backfilled `school`). */
export const subjectSchema = z
  .object({ ...subjectFields, attachment: subjectAttachmentSchema })
  .superRefine(refineModeTotal)
  .describe("Subject configuration including books, exam modes and where it is offered");

/**
 * A subject as API callers send it in a whole class configuration
 * (`createClass`, `updateClassConfiguration`). `attachment` may be left out:
 * a new subject is then a classroom subject and an existing one keeps its
 * stored attachment. The procedures decide that and always store it.
 */
export const subjectInputSchema = z
  .object({
    ...subjectFields,
    attachment: subjectAttachmentSchema
      .optional()
      .describe(
        "Leave out: a new subject is a classroom subject ('school') and an existing one keeps where it is offered. Exam-only subjects are added with addClassSubject.",
      ),
  })
  .superRefine(refineModeTotal)
  .describe("Subject configuration including books and exam modes");

export const classConfigSchema = z
  .object({
    subjects: z
      .record(
        z.string().min(1).describe("Subject slug (e.g. 'math', 'english')"),
        subjectSchema,
      )
      .optional()
      .default({})
      .describe("Map of subject slug to subject configuration"),
  })
  .describe("Class-level configuration defining subjects, books, and exam modes");

/** A whole class configuration as API callers send it (see {@link subjectInputSchema}). */
export const classConfigInputSchema = z
  .object({
    subjects: z
      .record(
        z.string().min(1).describe("Subject slug (e.g. 'math', 'english')"),
        subjectInputSchema,
      )
      .optional()
      .default({})
      .describe("Map of subject slug to subject configuration"),
  })
  .describe("Class-level configuration defining subjects, books, and exam modes");

export type ClassConfig = z.infer<typeof classConfigSchema>;
/** A whole class configuration as a procedure receives it, after parsing (`attachment` may be missing). */
export type ClassConfigSubmission = z.infer<typeof classConfigInputSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type SubjectAttachment = z.infer<typeof subjectAttachmentSchema>;
export type SubjectExamRef = z.infer<typeof subjectExamRefSchema>;
export type Book = z.infer<typeof bookSchema>;
export type ExamMode = z.infer<typeof examModeSchema>;

/**
 * A class configuration as it is stored in `class.config`, read for code: the
 * one place stored subjects are normalised (the `class.config` column's
 * `fromDriver`, so every Drizzle read of the column goes through it).
 *
 * A stored subject without `attachment` reads as a classroom subject
 * (`{ kind: 'school' }`). That is not an inference from today's data: every
 * subject written before attachments existed was a classroom subject, and
 * the only writers that still leave it out are API servers of the previous
 * release during a rolling deploy (their schema strips the unknown key).
 * Migration 0081 and the `subject-attachment-backfill` data migration store
 * it explicitly; every current write path always stores it. Nothing else is
 * changed or validated here, so a read never fails on older data.
 */
export function readStoredClassConfig(value: unknown): ClassConfig {
  if (!value || typeof value !== "object") return { subjects: {} };
  const config = value as { subjects?: unknown };
  const stored = config.subjects && typeof config.subjects === "object" ? (config.subjects as Record<string, unknown>) : {};
  const subjects = Object.fromEntries(
    Object.entries(stored).map(([slug, subject]) => [
      slug,
      subject && typeof subject === "object" && !("attachment" in subject)
        ? { ...(subject as object), attachment: { kind: "school" } }
        : subject,
    ]),
  );
  return { ...(config as object), subjects } as ClassConfig;
}

/** The attachment of a classroom subject. */
export const CLASSROOM_SUBJECT: SubjectAttachment = { kind: "school" };

/**
 * Whether a subject is offered in an examination: a classroom subject is
 * offered in every examination, an exam-only subject only in the examinations
 * it lists. The one rule every place that offers a class's subjects for an
 * examination uses (plan preview and generation, legacy plan creation, the
 * timetable, the exam context). Whether the subject actually takes part is a
 * separate fact: the existence of its `exam_plan` row.
 */
export function isSubjectOfferedInExam(
  subject: { attachment: SubjectAttachment },
  exam: SubjectExamRef,
): boolean {
  if (subject.attachment.kind === "school") return true;
  return subject.attachment.exams.some(
    (entry) =>
      entry.sessionId === exam.sessionId && entry.examSlug === exam.examSlug,
  );
}

/** Whether a subject belongs to the classroom (`school`) rather than to examinations only. */
export function isClassroomSubject(subject: {
  attachment: SubjectAttachment;
}): boolean {
  return subject.attachment.kind === "school";
}

/** The class's subjects offered in an examination ({@link isSubjectOfferedInExam}), in stored order. */
export function subjectsOfferedInExam<T extends { attachment: SubjectAttachment }>(
  subjects: Record<string, T>,
  exam: SubjectExamRef,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(subjects).filter(([, subject]) =>
      isSubjectOfferedInExam(subject, exam),
    ),
  );
}
