import { QUESTION_PAPER_DETAIL_MAX_CHARS } from '@campuspilot/question-paper/details';
import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';

/**
 * The contract of a school's Question papers page (docs/question-papers.md
 * "The Question papers page"): one list of a session's exam papers and quick
 * papers (standalone papers of the school), for the management app only.
 */

const id = z.string().trim().min(1).max(100);

/**
 * What a listed paper is, in the page's words: `exam`, an examination's paper
 * (`exam_question_paper.kind = 'exam'`); `quick`, a quick paper (`kind =
 * 'standalone'`, not tied to an exam plan).
 */
export const SCHOOL_QUESTION_PAPER_TYPES = ['quick', 'exam'] as const;
export type SchoolQuestionPaperType = (typeof SCHOOL_QUESTION_PAPER_TYPES)[number];

/**
 * Whether a paper has a saved version (`latest_version_no > 0`): `generated`
 * or `not_generated` (a paper row with photos, a running or failed
 * generation, or nothing yet, and no version).
 */
export const SCHOOL_QUESTION_PAPER_STATUSES = ['generated', 'not_generated'] as const;
export type SchoolQuestionPaperStatus = (typeof SCHOOL_QUESTION_PAPER_STATUSES)[number];

const nameFilter = z.string().max(QUESTION_PAPER_DETAIL_MAX_CHARS).optional();

/**
 * The page's filters, each optional and each its own fact:
 * - `type`: quick papers or exam papers only.
 * - `status`: generated or not generated yet. Without it, every quick paper is
 *   listed and an exam paper only once it has a version: an exam's papers
 *   appear by themselves from the examination's work, so the ones with nothing
 *   generated stay out of the default view, while a quick paper was created on
 *   purpose and must not vanish while its first generation runs.
 * - `examName`, `className`, `subjectName`: the name exactly as the list shows
 *   it (an exam paper's from its examination, class and subject; a quick
 *   paper's from its details), values from `listSchoolQuestionPaperFilterOptions`.
 */
export const schoolQuestionPaperFiltersSchema = z
  .object({
    type: z.enum(SCHOOL_QUESTION_PAPER_TYPES).optional(),
    status: z.enum(SCHOOL_QUESTION_PAPER_STATUSES).optional(),
    examName: nameFilter,
    className: nameFilter,
    subjectName: nameFilter,
  })
  .default({});
export type SchoolQuestionPaperFilters = z.infer<typeof schoolQuestionPaperFiltersSchema>;

export const listSchoolQuestionPapersInputSchema = createListInputSchema({
  schoolId: id,
  sessionId: id,
  searchQuery: z.string().trim().max(100).default(''),
  filters: schoolQuestionPaperFiltersSchema,
});

/** The key of an exam paper's screen; null for a quick paper, which opens by its id. */
const examPaperKeySchema = z.object({ examSlug: z.string(), classId: z.string(), subjectSlug: z.string(), modeSlug: z.string() });

/** One paper as the page lists it. */
export const schoolQuestionPaperListItemSchema = z.object({
  paperId: z.string(),
  type: z.enum(SCHOOL_QUESTION_PAPER_TYPES),
  /** The names the row shows: an exam paper's from its plan (mode included), a quick paper's details (no mode). Null when a quick paper does not state one. */
  subjectName: z.string().nullable(),
  className: z.string().nullable(),
  examName: z.string().nullable(),
  modeName: z.string().nullable(),
  examKey: examPaperKeySchema.nullable(),
  latestVersionNo: z.number().int(),
  pageCount: z.number().int(),
  warningCount: z.number().int(),
  activeJob: z.object({ id: z.string(), status: z.enum(['queued', 'running']) }).nullable(),
  lastJobFailure: z.object({ errorCode: z.string(), message: z.string() }).nullable(),
  /** The name of the person who created the paper; null when their account is gone. */
  createdByName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SchoolQuestionPaperListItemDto = z.infer<typeof schoolQuestionPaperListItemSchema>;
export const listSchoolQuestionPapersOutputSchema = createPaginatedOutputSchema(schoolQuestionPaperListItemSchema);

export const listSchoolQuestionPaperFilterOptionsInputSchema = z.object({ schoolId: id, sessionId: id });
/** The distinct names of the papers the caller may see in the session, sorted: what the name filters offer. */
export const listSchoolQuestionPaperFilterOptionsOutputSchema = z.object({
  examNames: z.array(z.string()),
  classNames: z.array(z.string()),
  subjectNames: z.array(z.string()),
});
