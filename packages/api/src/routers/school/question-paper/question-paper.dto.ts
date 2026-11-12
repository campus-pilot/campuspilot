import { z } from 'zod';

/** The most pages (uploaded photos) one paper may hold (R3). */
export const QUESTION_PAPER_MAX_PAGES = 20;
/** The largest accepted original photo, 15 MiB (D24). */
export const QUESTION_PAPER_MAX_PAGE_BYTES = 15 * 1024 * 1024;

/**
 * How many characters of a result the assistant gives the model for a tool
 * that returns a whole paper (`getQuestionPaper`, `validateQuestionPaperDraft`;
 * the default 24,000 would cut a long paper). The stored result stays cut at
 * 4,000 either way.
 */
export const QUESTION_PAPER_PAPER_OUTPUT_CHARS = 80_000;
/**
 * The same for `learn_question_paper_generation`: the guide, the model-facing
 * JSON Schema (about 7 KB with `$defs`), the limits and two full examples are
 * about 17 KB. It is a one-off call per paper (and pruned from the context
 * afterwards), so it gets room for the whole payload rather than a schema
 * without its examples.
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

export const learnInputSchema = z.object({ schoolId: id });

/** The paper as JSON. Validated by `@campuspilot/question-paper`, not by this transport schema. */
const paperContentInput = z
  .record(z.string(), z.unknown())
  .describe('The question paper as a JSON object (schemaVersion 1) exactly as described by learn_question_paper_generation.');

export const validateDraftInputSchema = paperKeySchema.extend({ content: paperContentInput });

export const saveVersionInputSchema = paperKeySchema
  .extend({
    expectedVersionNo: z
      .number()
      .int()
      .min(0)
      .describe('latestVersionNo from getQuestionPaper (0 when the paper has no version). A different current value is refused with CONFLICT.'),
    content: paperContentInput.optional(),
    draftId: z
      .string()
      .length(12)
      .optional()
      .describe('The draftId returned by validateQuestionPaperDraft earlier in this chat; instead of content. Only the in-app assistant can use it.'),
  })
  // "Exactly one" cannot be stated in JSON Schema, which MCP clients read, so the
  // schema asks for at least one and the handler refuses both.
  .refine((value) => value.content !== undefined || value.draftId !== undefined, {
    message: 'Send content or draftId.',
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
export const previewDraftInputSchema = paperKeySchema.extend({ content: paperContentInput });

export const questionPaperWarningSchema = z.object({
  code: z.string(),
  path: z.string(),
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
  createdAt: z.date(),
  createdBy: userRefSchema,
  totalMarks: z.number().nullable(),
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
                  totalMarks: z.number().nullable(),
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
      content: z.record(z.string(), z.unknown()),
    })
    .nullable(),
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
  jsonSchema: z.record(z.string(), z.unknown()),
  limits: z.record(z.string(), z.unknown()),
  examples: z.array(z.record(z.string(), z.unknown())),
  schemaVersion: z.number().int(),
});

export const validateDraftOutputSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
  warnings: z.array(questionPaperWarningSchema),
  total: z.number().nullable(),
  planMaxMarks: z.number().int(),
  draftId: z.string().nullable(),
  placeholderFigures: z.number().int(),
  characters: z.number().int(),
});

export const saveVersionOutputSchema = z.object({
  versionNo: z.number().int(),
  paperId: z.string(),
  totalMarks: z.number().nullable(),
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
  templateName: z.string().nullable(),
});
export const previewDraftOutputSchema = previewOutputSchema.extend({
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export const downloadOutputSchema = z.object({ url: z.url(), fileName: z.string(), expiresIn: z.number().int() });
