import {
  QUESTION_PAPER_DETAIL_MAX_CHARS,
  QUESTION_PAPER_DETAIL_MAX_MARKS,
  normalizeQuestionPaperDetail,
  normalizeQuestionPaperMaxMarks,
} from '@campuspilot/question-paper/details';
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
  downloadFormatSchema,
  versionSummarySchema,
} from '../question-paper/question-paper.dto';

/**
 * The contract of standalone question papers: the papers of a personal space
 * (docs/personal-space.md) and a real school's quick papers
 * (docs/question-papers.md "Quick papers in a school"), with no exam, class,
 * subject or mode.
 * Every input is flat (`{ schoolId, paperId, ... }`) so MCP clients and the
 * assistant can call the tools directly. The page, draft and version shapes
 * are the exam paper tools' own: only the key differs.
 */

const id = z.string().trim().min(1).max(100);

/** One standalone paper: its school and its id (from listStandalonePapers or createStandalonePaper). */
export const standalonePaperRefSchema = z.object({
  schoolId: id.describe('School id (a school or a personal space).'),
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
 * The maximum marks as a writer sends them: a whole number (or text that is
 * only one), kept when it is from 1 to the cap and null otherwise, never
 * refused, like the names.
 */
const maxMarksInput = z
  .union([z.number(), z.string().max(20)])
  .nullable()
  .transform((value) => normalizeQuestionPaperMaxMarks(value))
  .describe(
    `The paper's maximum marks as a whole number exactly as it states them, or null when it states none. Never add up the questions' marks. A value that is not a whole number from 1 to ${QUESTION_PAPER_DETAIL_MAX_MARKS} is kept as null.`,
  );

/**
 * The details a saved version states (school, class, subject and exam names
 * and maximum marks the paper states). Every save sends all five: they are
 * not revisioned, so the save replaces what the paper had with exactly these.
 */
export const standalonePaperDetailsInputSchema = z
  .object({
    schoolName: detailInput("The school's name"),
    className: detailInput('The class (for example "Class 5" or "VII-B")'),
    subjectName: detailInput('The subject'),
    examName: detailInput('The examination (for example "Half Yearly Examination 2026")'),
    maxMarks: maxMarksInput,
  })
  .describe(
    "What the paper states about its school, class, subject, examination and maximum marks. Every save replaces all five with these, so send all of them each time, updated whenever the paper changes one of them. In a school, the school's template prints the class, subject, examination and maximum marks from them.",
  );

/** The five details as they are read back. */
export const standalonePaperDetailsSchema = z.object({
  schoolName: z.string().nullable(),
  className: z.string().nullable(),
  subjectName: z.string().nullable(),
  examName: z.string().nullable(),
  maxMarks: z.number().int().nullable(),
});
export type StandalonePaperDetailsDto = z.infer<typeof standalonePaperDetailsSchema>;

/**
 * The most standalone papers one personal space holds, with the space's other
 * limits in `personal-space.limits.ts` (docs/personal-space.md "Limits"). A
 * hard cap: creating one more is refused until a paper is deleted.
 */
export { STANDALONE_PAPERS_PER_SPACE_LIMIT } from '../../../personal-space/personal-space.limits';

export const createStandalonePaperInputSchema = z.object({
  schoolId: id.describe('School id (a school or a personal space).'),
  sessionId: id
    .optional()
    .describe("In a school (required there): the academic session the paper belongs to, whose years its template prints. Not sent for a personal space, which has no sessions."),
});
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
  schoolId: id.describe('School id (a school or a personal space).'),
  searchQuery: z.string().trim().max(100).default('').describe('Matches any of the four details.'),
  filters: standalonePaperFiltersSchema.describe('Exact values from listStandalonePaperFilterOptions.'),
});

/** One paper as the list shows it. */
export const standalonePaperListItemSchema = z.object({
  paperId: z.string(),
  /** The session a school's quick paper belongs to (papers of every session are listed); null in a personal space. */
  sessionId: z.string().nullable(),
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

export const listStandalonePaperFilterOptionsInputSchema = z.object({ schoolId: id.describe('School id (a school or a personal space).') });
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
  /** How the paper prints: with the school's template (a school's quick paper), or on the plain page (a personal space's). */
  printLayout: z.enum(['school_template', 'plain']),
  /** The session a school's quick paper belongs to; null in a personal space. */
  sessionId: z.string().nullable(),
  details: standalonePaperDetailsSchema,
  pageCount: z.number().int(),
  pageRevision: z.number().int(),
  latestVersionNo: z.number().int(),
});

/**
 * What is printed around a standalone paper's body (`readTemplatePrints`): two
 * empty lists on a personal space's plain page (so the whole heading of the
 * source belongs in the paper); the school template's lines for a quick paper,
 * or null when they are not known (no template selected, or it does not
 * render), as for an exam paper.
 */
const standaloneTemplatePrintsField = templatePrintsSchema
  .nullable()
  .describe(
    "The text lines printed around the paper. Both lists empty (a personal space): nothing is printed, so write the paper's whole heading yourself. Lines (a school's quick paper): the school's template prints them as heading and footer, a value in square brackets being a detail the paper does not state yet; leave every fact they print out of the fragment. Null: not known (no question paper template selected).",
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
  /**
   * Whether the paper can print: always for a plain paper; for a quick paper,
   * whether the school has selected a question paper template (generating and
   * saving are refused until it has), as on an exam paper's screen.
   */
  templateConfigured: z.boolean(),
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
export const standalonePaperDownloadInputSchema = standalonePaperVersionNoInputSchema.extend({ format: downloadFormatSchema });
export const learnStandalonePaperInputSchema = z.object({ schoolId: id.describe('School id (a school or a personal space).') });
