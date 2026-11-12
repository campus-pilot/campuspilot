import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { z } from 'zod';

/** The most pages (uploaded photos) one paper may hold (R3). */
export const QUESTION_PAPER_MAX_PAGES = 20;
/** The largest accepted original photo, 15 MiB (D24). */
export const QUESTION_PAPER_MAX_PAGE_BYTES = 15 * 1024 * 1024;

/**
 * How many characters of `getQuestionPaper` the assistant gives the model
 * (the default 24,000 would cut a long paper). The result carries the whole
 * fragment (`html`, at most `fragmentChars`) as JSON text, where `"`, `\\` and
 * line ends take two characters: twice the fragment is the ceiling for ordinary
 * markup, plus 40,000 for the rest of the result (20 pages, up to 100 version
 * summaries, the job). A fragment of mostly control characters (six characters
 * each as JSON) could still exceed it; the tool then appends its own
 * "Result truncated" line, so the model is told and never reads a cut paper as
 * a whole one. The stored result stays cut at 4,000 characters either way.
 */
export const QUESTION_PAPER_PAPER_OUTPUT_CHARS = QUESTION_PAPER_LIMITS.fragmentChars * 2 + 40_000;
/**
 * `getQuestionPaperDraft` returns one cleaned fragment (at most `fragmentChars`) and a
 * small paper facts block, so it gets the same room as `getQuestionPaper`.
 */
export const QUESTION_PAPER_DRAFT_OUTPUT_CHARS = QUESTION_PAPER_PAPER_OUTPUT_CHARS;
/**
 * The same for `validateQuestionPaperDraft`. It never echoes the fragment (the
 * model has it, and `draftId` names it), so its size does not depend on the
 * paper: at most {@link QUESTION_PAPER_VALIDATE_LISTED} problems and as many
 * removed-item lines of {@link QUESTION_PAPER_VALIDATE_LINE_CHARS} characters
 * each, which is well inside this.
 */
export const QUESTION_PAPER_VALIDATE_OUTPUT_CHARS = 40_000;
/** The most problems (and removed-item lines) the validate tool lists; the rest is summed in one last line. */
export const QUESTION_PAPER_VALIDATE_LISTED = 40;
/** The longest single problem or removed-item line the validate tool lists. */
export const QUESTION_PAPER_VALIDATE_LINE_CHARS = 400;
/**
 * The same for `learn_question_paper_generation`: the guide, the limits and one
 * full example are about 10 KB. It is a one-off call per paper (and pruned from
 * the context afterwards), so it gets room for the whole payload rather than a
 * guide without its example.
 */
export const QUESTION_PAPER_LEARN_OUTPUT_CHARS = 40_000;

const id = z.string().trim().min(1).max(100);

/**
 * Identifies the paper of one class + subject + mode of an exam. The ids come
 * from `school.listExams`, `school.listClasses` and `school.listQuestionPapers`.
 */
export const paperKeySchema = z.object({
  schoolId: id.describe('School id.'),
  sessionId: id.describe('Academic session id. Only the active session can be changed.'),
  examSlug: id.describe('Exam slug from school.listExams.'),
  classId: id.describe('Class id from school.listClasses.'),
  subjectSlug: id.describe('Subject slug of the class; the exam must have a plan for it.'),
  modeSlug: id.describe("Assessment mode slug of that subject's exam plan, for example theory."),
});
export type PaperKey = z.infer<typeof paperKeySchema>;

export const listQuestionPapersInputSchema = z.object({
  schoolId: id,
  sessionId: id,
  examSlug: id.describe('Exam slug from school.listExams.'),
  classId: id.optional().describe('Only this class; omit for every class of the exam that you may read.'),
});

export const versionNoInputSchema = paperKeySchema.extend({
  versionNo: z.number().int().min(1).describe('A version number from listQuestionPaperVersions.'),
});

export const getQuestionPaperInputSchema = paperKeySchema.extend({
  versionNo: z.number().int().min(1).optional().describe('A saved version; the latest when omitted.'),
});

/**
 * `getQuestionPaperDraft`: a draft the in-app assistant validated earlier in this
 * chat. The scope names the paper the draft is for; the draft itself is found by
 * `draftId` in this conversation only.
 */
export const getQuestionPaperDraftInputSchema = paperKeySchema.extend({
  draftId: z.string().length(12).describe('The draftId returned by validateQuestionPaperDraft earlier in this chat. Only the in-app assistant can use it.'),
});

export const learnInputSchema = z.object({ schoolId: id });

/**
 * The paper as an HTML fragment. Cleaned and checked by the sanitiser and the draft
 * check, not by this transport schema; the length bound is only the largest
 * text the sanitiser will look at (the product limit is lower and reported as a problem).
 */
const paperHtmlInput = z
  .string()
  .min(1)
  .max(QUESTION_PAPER_LIMITS.parseChars)
  .describe('The question paper as an HTML fragment (no <html>, <head> or <body>) exactly as described by learn_question_paper_generation.');

export const validateDraftInputSchema = paperKeySchema.extend({ html: paperHtmlInput });

export const saveVersionInputSchema = paperKeySchema
  .extend({
    expectedVersionNo: z
      .number()
      .int()
      .min(0)
      .describe('latestVersionNo from getQuestionPaper (0 when the paper has no version). A different current value is refused with CONFLICT.'),
    html: paperHtmlInput.optional(),
    draftId: z
      .string()
      .length(12)
      .optional()
      .describe('The draftId returned by validateQuestionPaperDraft earlier in this chat; instead of html. Only the in-app assistant can use it.'),
  })
  // "Exactly one" cannot be stated in JSON Schema, which MCP clients read, so the
  // schema asks for at least one and the handler refuses both.
  .refine((value) => value.html !== undefined || value.draftId !== undefined, {
    message: 'Send html or draftId.',
  });

export const startGenerationInputSchema = paperKeySchema.extend({
  expectedPageRevision: z.number().int().min(0),
});
export const reorderPagesInputSchema = paperKeySchema.extend({
  pageIds: z.array(id).min(1).max(QUESTION_PAPER_MAX_PAGES).describe('Every page id, in the new order.'),
  expectedPageRevision: z.number().int().min(0),
});
export const deletePageInputSchema = paperKeySchema.extend({
  pageId: id,
  expectedPageRevision: z.number().int().min(0),
});
export const previewDraftInputSchema = paperKeySchema.extend({ html: paperHtmlInput });

/** What the sanitiser removed or changed when a version was saved. A notice, not an error. */
export const questionPaperWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const pageDtoSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  originalName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  derivativeStatus: z.enum(['ready', 'unsupported']),
});

const jobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  createdAt: z.date(),
});
const userRefSchema = z.object({ id: z.string(), name: z.string().nullable() });

export const versionSummarySchema = z.object({
  versionNo: z.number().int(),
  source: z.enum(['ai_job', 'agent']),
  /** The generation job that produced this version; null for a version saved in chat. */
  sourceJobId: z.string().nullable(),
  createdAt: z.date(),
  createdBy: userRefSchema,
  /** The mode's maximum marks in the exam plan when the version was saved. */
  planMaxMarks: z.number().int().nullable(),
  warningCount: z.number().int(),
  hasPdf: z.boolean(),
  isLatest: z.boolean(),
});

const paperFactsSchema = z.object({
  /** Null until the first page or version exists. */
  paperId: z.string().nullable(),
  className: z.string(),
  subjectName: z.string(),
  modeName: z.string(),
  examName: z.string(),
  /** The mode's maximum marks in the exam plan. */
  planMaxMarks: z.number().int(),
  pageCount: z.number().int(),
  pageRevision: z.number().int(),
  latestVersionNo: z.number().int(),
  /** Whether the exam has ended (its lifecycle is `completed`): its papers are then read-only. */
  examCompleted: z.boolean(),
  /** Whether the exam's academic session is the school's active one: papers of any other session are read-only. */
  sessionActive: z.boolean(),
});

export const listQuestionPapersOutputSchema = z.object({
  classes: z.array(
    z.object({
      classId: z.string(),
      className: z.string(),
      canManage: z.boolean(),
      subjects: z.array(
        z.object({
          subjectSlug: z.string(),
          subjectName: z.string(),
          modes: z.array(
            z.object({
              modeSlug: z.string(),
              modeName: z.string(),
              maxMarks: z.number().int(),
              paper: z
                .object({
                  paperId: z.string(),
                  pageCount: z.number().int(),
                  latestVersionNo: z.number().int(),
                  planMaxMarks: z.number().int().nullable(),
                  warningCount: z.number().int(),
                  activeJob: z.object({ id: z.string(), status: z.enum(['queued', 'running']) }).nullable(),
                  lastJobFailure: z.object({ errorCode: z.string(), message: z.string() }).nullable(),
                })
                .nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export const getQuestionPaperOutputSchema = z.object({
  paper: paperFactsSchema,
  pages: z.array(pageDtoSchema),
  activeJob: jobSchema.nullable(),
  version: versionSummarySchema
    .extend({
      warnings: z.array(questionPaperWarningSchema),
      /** The sanitised HTML fragment of the version. */
      html: z.string(),
    })
    .nullable(),
});

export const getQuestionPaperDraftOutputSchema = z.object({
  /** The facts of the paper the draft belongs to, as in getQuestionPaper (its latestVersionNo is the expectedVersionNo for a save). */
  paper: paperFactsSchema,
  draftId: z.string(),
  /** The draft as the sanitiser cleaned it: what saving it would store and the preview shows. At most the fragment limit. */
  html: z.string(),
  /** Characters of `html`. */
  characters: z.number().int(),
});

export const listVersionsOutputSchema = z.object({ versions: z.array(versionSummarySchema) });

export const detailOutputSchema = z.object({
  paper: paperFactsSchema,
  pages: z.array(pageDtoSchema),
  activeJob: jobSchema.nullable(),
  lastFinishedJob: jobSchema.extend({ errorCode: z.string().nullable(), errorMessage: z.string().nullable(), completedAt: z.date() }).nullable(),
  versions: z.array(versionSummarySchema),
  /** Whether the school selected a question paper template (generation needs one). */
  templateConfigured: z.boolean(),
});

export const learnOutputSchema = z.object({
  guide: z.string(),
  limits: z.record(z.string(), z.unknown()),
  /** One complete worked example: an HTML fragment. */
  example: z.string(),
});

export const validateDraftOutputSchema = z.object({
  valid: z.boolean(),
  /** What must be fixed before the paper can be saved (empty when valid). */
  problems: z.array(z.string()),
  /** What the sanitiser removed or changed in the html. Not blocking. */
  stripped: z.array(z.string()),
  draftId: z.string().nullable(),
  placeholderFigures: z.number().int(),
  /** Characters of the cleaned fragment. */
  characters: z.number().int(),
});

export const saveVersionOutputSchema = z.object({
  versionNo: z.number().int(),
  paperId: z.string(),
  planMaxMarks: z.number().int(),
  warnings: z.array(questionPaperWarningSchema),
  hasPdf: z.boolean(),
});

export const startGenerationOutputSchema = z.object({ jobId: z.string(), status: z.literal('queued') });
export const reorderPagesOutputSchema = z.object({ pageRevision: z.number().int() });
export const deletePageOutputSchema = z.object({ pageRevision: z.number().int() });
export const deletePaperOutputSchema = z.object({ deleted: z.literal(true) });

export const previewOutputSchema = z.object({
  html: z.string(),
  warnings: z.array(questionPaperWarningSchema),
  /** Figures still drawn as a labelled box because no image was attached; the UI says where to add them. */
  placeholderFigures: z.number().int(),
  templateName: z.string().nullable(),
});
export const previewDraftOutputSchema = previewOutputSchema.extend({
  problems: z.array(z.string()),
});
export const downloadOutputSchema = z.object({ url: z.url(), fileName: z.string(), expiresIn: z.number().int() });
