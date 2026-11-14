import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { z } from 'zod';

/** The most pages (uploaded photos) one paper may hold (R3). */
export const QUESTION_PAPER_MAX_PAGES = 20;
/** The largest accepted original photo, 15 MiB (D24). */
export const QUESTION_PAPER_MAX_PAGE_BYTES = 15 * 1024 * 1024;
/**
 * The longest teacher's instructions a generation job accepts, in UTF-16 code
 * units (what a textarea's `maxLength` and `String.length` count), after
 * trimming. A short note ("Make section B easier"), not a second paper.
 */
export const QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS = 2_000;

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

/** The chat a draft card is shown from, so its attachments preview as figures. Set by the app's screens only; the in-app assistant's own chat is known without it. */
const draftChatInput = z.string().min(1).max(64).optional().describe('Leave out. Used by the app only.');

export const validateDraftInputSchema = paperKeySchema.extend({ html: paperHtmlInput, conversationId: draftChatInput });

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

/**
 * `copyQuestionPaperVersion`: the target paper's key, the version of an earlier
 * paper to start from and the target's `expectedVersionNo`. The source names a
 * paper of the same school, class and subject (any session, exam and mode),
 * as `listQuestionPaperCopySources` lists them; anything else is refused.
 */
export const copyVersionInputSchema = paperKeySchema.extend({
  expectedVersionNo: z
    .number()
    .int()
    .min(0)
    .describe('latestVersionNo of the target paper (0 when it has no version). A different current value is refused with CONFLICT.'),
  source: paperKeySchema
    .extend({ versionNo: z.number().int().min(1).describe('The version of the source paper to copy.') })
    .describe('The earlier paper to copy from, as listQuestionPaperCopySources returns it.'),
});

/**
 * Control characters a teacher's instructions may not hold: C0 (except tab and
 * line feed), DEL and C1. Line breaks are normalised to `\n` before the check,
 * so a pasted CRLF is not refused. Format characters (zero-width joiners, which
 * Indian scripts need, and direction marks) are not control characters and pass.
 */
// eslint-disable-next-line no-control-regex
const INSTRUCTIONS_CONTROL_CHARACTER = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/**
 * The teacher's optional instructions for a generation ("Keep the questions but
 * change the numbers"). Line breaks become `\n` and the text is trimmed; an
 * empty or whitespace-only value is the same as none (`null`). At most
 * {@link QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS} characters after
 * that. Any other control character is REFUSED rather than stripped: what the
 * job stores and the model reads is then exactly what the teacher sent (no
 * hidden text, nothing silently changed), and the caller learns why.
 */
export const generationInstructionsSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .max(QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS, `Instructions can be at most ${QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS} characters.`)
      .refine((value) => !INSTRUCTIONS_CONTROL_CHARACTER.test(value), 'Instructions cannot contain control characters.'),
  )
  .transform((value) => (value === '' ? null : value));

export const startGenerationInputSchema = paperKeySchema.extend({
  expectedPageRevision: z.number().int().min(0),
  instructions: generationInstructionsSchema
    .optional()
    .describe(
      `What the teacher wants changed when the AI writes the paper from the photos, for example "Keep the questions but change the numbers". Optional; at most ${QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS} characters; empty means none.`,
    ),
});
export const reorderPagesInputSchema = paperKeySchema.extend({
  pageIds: z.array(id).min(1).max(QUESTION_PAPER_MAX_PAGES).describe('Every page id, in the new order.'),
  expectedPageRevision: z.number().int().min(0),
});
export const deletePageInputSchema = paperKeySchema.extend({
  pageId: id,
  expectedPageRevision: z.number().int().min(0),
});
export const previewDraftInputSchema = paperKeySchema.extend({ html: paperHtmlInput, conversationId: draftChatInput });

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
/**
 * A job as the paper screen sees it (`getQuestionPaperDetail`): with the
 * teacher's instructions it was started with, so the screen can show what was
 * asked. Not part of `getQuestionPaper`, which agents read.
 */
const detailJobSchema = jobSchema.extend({
  /** The teacher's instructions, exactly as stored; null when the job was started without any. */
  instructions: z.string().nullable(),
});
const userRefSchema = z.object({ id: z.string(), name: z.string().nullable() });

/**
 * Who wrote a version: the AI job from photos, a chat agent, or a copy of an
 * earlier paper's version. Mirrors `question_paper_version_source`.
 */
export const versionSourceSchema = z.enum(['ai_job', 'agent', 'copy']);

export const versionSummarySchema = z.object({
  versionNo: z.number().int(),
  source: versionSourceSchema,
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
  activeJob: detailJobSchema.nullable(),
  lastFinishedJob: detailJobSchema.extend({ errorCode: z.string().nullable(), errorMessage: z.string().nullable(), completedAt: z.date() }).nullable(),
  versions: z.array(versionSummarySchema),
  /** Whether the school selected a question paper template (generation needs one). */
  templateConfigured: z.boolean(),
  /**
   * The paper's most recently active assistant conversation shared with it
   * (whoever started it); null when it has none. The paper's screen opens it
   * unless the address names another.
   */
  latestConversationId: z.string().nullable(),
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

/** `copyQuestionPaperVersion`: the new version of the target paper, as a save returns it. */
export const copyVersionOutputSchema = saveVersionOutputSchema;

/**
 * `listQuestionPaperCopySources`: saved papers of the same school, class and
 * subject as the target (any session, exam and mode), newest saved first.
 */
export const listCopySourcesOutputSchema = z.object({
  sources: z.array(
    z.object({
      /** The source paper's natural key, to pass as `source` (with a versionNo) to copyQuestionPaperVersion. */
      key: paperKeySchema,
      /** The academic session, as "2025–26". */
      sessionLabel: z.string(),
      /** Whether the source paper's session is the school's active one. */
      sessionActive: z.boolean(),
      /** The exam's name in its session's configuration (its slug when the exam was removed from it). */
      examName: z.string(),
      /** The mode's name in the class configuration (its slug when the class no longer names it). */
      modeName: z.string(),
      latestVersionNo: z.number().int(),
      /** When the latest version was saved. */
      savedAt: z.date(),
      /** The plan's maximum marks snapshot of the latest version (`plan_max_marks`). */
      planMaxMarks: z.number().int().nullable(),
    }),
  ),
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
