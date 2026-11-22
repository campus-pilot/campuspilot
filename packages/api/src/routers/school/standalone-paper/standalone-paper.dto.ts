import { QUESTION_PAPER_DETAIL_MAX_CHARS, normalizeQuestionPaperDetail } from '@campuspilot/question-paper/details';
import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';
import {
  deletePageInputSchema,
  detailJobSchema,
  draftChatInput,
  editVersionInputSchema,
  generationInstructionsSchema,
  getQuestionPaperDraftInputSchema,
  jobSchema,
  pageDtoSchema,
  paperHtmlInput,
  questionPaperWarningSchema,
  releasePageInputSchema,
  reorderPagesInputSchema,
  reservePagesInputSchema,
  rotatePageInputSchema,
  startGenerationInputSchema,
  templatePrintsSchema,
  versionNoInputSchema,
  versionSummarySchema,
} from '../question-paper/question-paper.dto';

/**
 * The contract of standalone question papers (docs/personal-space.md): the
 * papers of a personal space, with no session, exam, class, subject or mode.
 * Every input is flat (`{ schoolId, paperId, ... }`) so MCP clients and the
 * assistant can call the tools directly. The page, draft and version shapes
 * are the exam paper tools' own: only the key differs.
 */

const id = z.string().trim().min(1).max(100);

/** One standalone paper: its school and its id (from listStandalonePapers or createStandalonePaper). */
export const standalonePaperRefSchema = z.object({
  schoolId: id.describe('School id of the personal space.'),
  paperId: id.describe('Question paper id from listStandalonePapers or createStandalonePaper.'),
});
export type StandalonePaperRef = z.infer<typeof standalonePaperRefSchema>;

/** The exam paper key fields a standalone input replaces with `paperId`. */
const examKeyFields = { sessionId: true, examSlug: true, classId: true, subjectSlug: true, modeSlug: true } as const;

/** One detail as a writer sends it: any text (cut to the cap, never refused), or null when the paper does not state it. */
const detailInput = (what: string) =>
  z
    .string()
    .max(2_000)
    .nullable()
    .transform((value) => normalizeQuestionPaperDetail(value))
    .describe(`${what} exactly as the paper prints it, or null when the paper does not state it. At most ${QUESTION_PAPER_DETAIL_MAX_CHARS} characters are kept.`);

/**
 * The details a saved version states (school, class, subject and exam names
 * the paper prints). Every save sends all four: they are not revisioned, so
 * the save replaces what the paper had with exactly these.
 */
export const standalonePaperDetailsInputSchema = z
  .object({
    schoolName: detailInput("The school's name"),
    className: detailInput('The class (for example "Class 5" or "VII-B")'),
    subjectName: detailInput('The subject'),
    examName: detailInput('The examination (for example "Half Yearly Examination 2026")'),
  })
  .describe(
    'What the paper itself prints about its school, class, subject and examination. Every save replaces all four with these, so send all of them each time, updated whenever the paper changes one of them.',
  );

/** The four details as they are read back. */
export const standalonePaperDetailsSchema = z.object({
  schoolName: z.string().nullable(),
  className: z.string().nullable(),
  subjectName: z.string().nullable(),
  examName: z.string().nullable(),
});
export type StandalonePaperDetailsDto = z.infer<typeof standalonePaperDetailsSchema>;

/**
 * The most standalone papers one personal space holds, with the space's other
 * limits in `personal-space.limits.ts` (docs/personal-space.md "Limits"). A
 * hard cap: creating one more is refused until a paper is deleted.
 */
export { STANDALONE_PAPERS_PER_SPACE_LIMIT } from '../../../personal-space/personal-space.limits';

export const createStandalonePaperInputSchema = z.object({ schoolId: id.describe('School id of the personal space.') });
export const createStandalonePaperOutputSchema = z.object({
  paperId: z.string(),
  /** An unused paper the space already had was returned instead of a new one (`createStandalonePaper`). */
  reused: z.boolean(),
});

/** The detail filters of the paper list; each is matched exactly against the paper's current detail. */
export const standalonePaperFiltersSchema = z
  .object({
    schoolName: z.string().max(QUESTION_PAPER_DETAIL_MAX_CHARS).optional(),
    className: z.string().max(QUESTION_PAPER_DETAIL_MAX_CHARS).optional(),
    subjectName: z.string().max(QUESTION_PAPER_DETAIL_MAX_CHARS).optional(),
    examName: z.string().max(QUESTION_PAPER_DETAIL_MAX_CHARS).optional(),
  })
  .default({});
export type StandalonePaperFilters = z.infer<typeof standalonePaperFiltersSchema>;

export const listStandalonePapersInputSchema = createListInputSchema({
  schoolId: id.describe('School id of the personal space.'),
  searchQuery: z.string().trim().max(100).default('').describe('Matches any of the four details.'),
  filters: standalonePaperFiltersSchema.describe('Exact values from listStandalonePaperFilterOptions.'),
});

/** One paper as the list shows it. */
export const standalonePaperListItemSchema = z.object({
  paperId: z.string(),
  details: standalonePaperDetailsSchema,
  pageCount: z.number().int(),
  latestVersionNo: z.number().int(),
  /** Notices of the latest version. */
  warningCount: z.number().int(),
  activeJob: z.object({ id: z.string(), status: z.enum(['queued', 'running']) }).nullable(),
  /** The last generation's failure, until a version is saved after it. */
  lastJobFailure: z.object({ errorCode: z.string(), message: z.string() }).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StandalonePaperListItemDto = z.infer<typeof standalonePaperListItemSchema>;
export const listStandalonePapersOutputSchema = createPaginatedOutputSchema(standalonePaperListItemSchema);

export const listStandalonePaperFilterOptionsInputSchema = z.object({ schoolId: id.describe('School id of the personal space.') });
/** The distinct details of the school's own papers, sorted: what the list's filters offer. */
export const listStandalonePaperFilterOptionsOutputSchema = z.object({
  schoolNames: z.array(z.string()),
  classNames: z.array(z.string()),
  subjectNames: z.array(z.string()),
  examNames: z.array(z.string()),
});

/** The facts of one standalone paper, the `paper` block of its reads. */
export const standalonePaperFactsSchema = z.object({
  paperId: z.string(),
  details: standalonePaperDetailsSchema,
  pageCount: z.number().int(),
  pageRevision: z.number().int(),
  latestVersionNo: z.number().int(),
});

/**
 * What a standalone paper's plain page prints around its body: always two
 * empty lists (known to print nothing), so the whole heading of the source
 * belongs in the paper.
 */
const standaloneTemplatePrintsField = templatePrintsSchema.describe(
  'What is printed around the paper: always nothing for a standalone paper, so write its whole heading (school, examination, class, subject, time, marks, instructions) yourself.',
);

export const getStandalonePaperInputSchema = standalonePaperRefSchema.extend({
  versionNo: z.number().int().min(1).optional().describe('A saved version; the latest when omitted.'),
});

export const getStandalonePaperOutputSchema = z.object({
  paper: standalonePaperFactsSchema,
  templatePrints: standaloneTemplatePrintsField,
  pages: z.array(pageDtoSchema),
  activeJob: jobSchema.nullable(),
  version: versionSummarySchema.extend({ warnings: z.array(questionPaperWarningSchema), html: z.string() }).nullable(),
});

export const standalonePaperDetailOutputSchema = z.object({
  paper: standalonePaperFactsSchema,
  pages: z.array(pageDtoSchema),
  activeJob: detailJobSchema.nullable(),
  lastFinishedJob: detailJobSchema.extend({ errorCode: z.string().nullable(), errorMessage: z.string().nullable(), completedAt: z.date() }).nullable(),
  versions: z.array(versionSummarySchema),
  /** The paper's most recently active conversation shared with it; null when it has none. */
  latestConversationId: z.string().nullable(),
});

export const getStandalonePaperDraftInputSchema = getQuestionPaperDraftInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const getStandalonePaperDraftOutputSchema = z.object({
  paper: standalonePaperFactsSchema,
  templatePrints: standaloneTemplatePrintsField,
  draftId: z.string(),
  html: z.string(),
  characters: z.number().int(),
});

export const validateStandalonePaperDraftInputSchema = standalonePaperRefSchema.extend({ html: paperHtmlInput, conversationId: draftChatInput });
export const previewStandalonePaperDraftInputSchema = validateStandalonePaperDraftInputSchema;

export const saveStandalonePaperVersionInputSchema = standalonePaperRefSchema
  .extend({
    expectedVersionNo: z
      .number()
      .int()
      .min(0)
      .describe('latestVersionNo from getStandalonePaper (0 when the paper has no version). A different current value is refused with CONFLICT.'),
    html: paperHtmlInput.optional(),
    draftId: z
      .string()
      .length(12)
      .optional()
      .describe('The draftId returned by validateStandalonePaperDraft earlier in this chat; instead of html. Only the in-app assistant can use it.'),
    details: standalonePaperDetailsInputSchema,
  })
  // As for exam papers: JSON Schema cannot say "exactly one", so at least one is asked for and the handler refuses both.
  .refine((value) => value.html !== undefined || value.draftId !== undefined, { message: 'Send html or draftId.' });

export const editStandalonePaperInputSchema = standalonePaperRefSchema.extend({
  expectedVersionNo: z
    .number()
    .int()
    .min(1)
    .describe('latestVersionNo from getStandalonePaper: the saved version the edits apply to. If a newer version was saved meanwhile the call fails with CONFLICT.'),
  edits: editVersionInputSchema.shape.edits,
  details: standalonePaperDetailsInputSchema,
});

export const saveStandalonePaperVersionOutputSchema = z.object({
  versionNo: z.number().int(),
  paperId: z.string(),
  warnings: z.array(questionPaperWarningSchema),
  hasPdf: z.boolean(),
});

export const startStandalonePaperGenerationInputSchema = startGenerationInputSchema.omit(examKeyFields).extend({
  ...standalonePaperRefSchema.shape,
  instructions: generationInstructionsSchema.optional(),
});
export const reorderStandalonePaperPagesInputSchema = reorderPagesInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const reserveStandalonePaperPagesInputSchema = reservePagesInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const releaseStandalonePaperPageInputSchema = releasePageInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const deleteStandalonePaperPageInputSchema = deletePageInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const rotateStandalonePaperPageInputSchema = rotatePageInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const standalonePaperVersionNoInputSchema = versionNoInputSchema.omit(examKeyFields).extend(standalonePaperRefSchema.shape);
export const learnStandalonePaperInputSchema = z.object({ schoolId: id.describe('School id of the personal space.') });
