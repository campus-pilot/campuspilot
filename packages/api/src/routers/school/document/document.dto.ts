import type { SchoolFeatureKey } from "@campuspilot/db/feature-flags/catalogue";
import { z } from "zod";
import {
  reportSectionsSchema,
  DEFAULT_REPORT_SECTIONS,
  reportResultPolicySchema,
  documentGenerationOptionsSchema,
} from "@campuspilot/db/schema/jsonb/document-config";
export { reportSectionsSchema, DEFAULT_REPORT_SECTIONS };

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

export const documentTypeSchema = z.enum([
  "report_card",
  "id_card",
  "admit_card",
  "timetable",
  "bill",
  "receipt",
  "statement",
  "notice",
  "question_paper",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

/**
 * The school feature each document type belongs to (docs/feature-flags.md).
 * Its templates, previews, generated documents and history exist only while
 * the school has that feature. Exhaustive, so a new type decides.
 */
export const DOCUMENT_TYPE_FEATURE = {
  report_card: "studentManagement",
  id_card: "studentManagement",
  admit_card: "studentManagement",
  timetable: "studentManagement",
  bill: "studentManagement",
  receipt: "studentManagement",
  statement: "studentManagement",
  notice: "notices",
  // The question paper template belongs to the AI assistant's feature (D26).
  question_paper: "assistant",
} as const satisfies Record<DocumentType, SchoolFeatureKey>;

/** Document types whose content is finance data; each has its own permissions. */
export const FINANCE_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  "bill",
  "receipt",
  "statement",
]);

export const isFinanceDocumentType = (type: DocumentType) =>
  FINANCE_DOCUMENT_TYPES.has(type);
/**
 * Document types that have a template but no generator source: they are
 * rendered by their own feature, never through `previewDocument` /
 * `generateDocument`, and never appear in the Documents workspace or in
 * document history. A notice is rendered by the notices feature
 * (`routers/school/notice`); a question paper by the question paper feature
 * (`routers/school/question-paper`), which stores its own PDF per version.
 */
export const TEMPLATE_ONLY_DOCUMENT_TYPES = ["notice", "question_paper"] as const satisfies readonly DocumentType[];
export type TemplateOnlyDocumentType = (typeof TEMPLATE_ONLY_DOCUMENT_TYPES)[number];
export type AcademicDocumentType = Exclude<DocumentType, "bill" | "receipt" | "statement" | TemplateOnlyDocumentType>;
/**
 * The feature every document **generated** through `previewDocument` /
 * `generateDocument` belongs to. Those procedures accept the generator types
 * only (every type but the template-only ones), and all of them are student
 * management documents, so the procedures are gated on this one feature.
 * The type below fails the build if a generator type is ever given another
 * feature in {@link DOCUMENT_TYPE_FEATURE}; the gate must then be decided per
 * source instead.
 */
export const GENERATOR_DOCUMENT_FEATURE = "studentManagement" as const satisfies SchoolFeatureKey;
type GeneratorDocumentType = Exclude<DocumentType, TemplateOnlyDocumentType>;
const generatorTypesShareOneFeature: (typeof DOCUMENT_TYPE_FEATURE)[GeneratorDocumentType] extends typeof GENERATOR_DOCUMENT_FEATURE
  ? true
  : never = true;
void generatorTypesShareOneFeature;

export const documentTemplatePageSizeSchema = z.enum(["full", "half"]);
export type DocumentTemplatePageSize = z.infer<
  typeof documentTemplatePageSizeSchema
>;
export const HALF_PAGE_DOCUMENT_TYPES = [
  "admit_card",
  "bill",
  "receipt",
  "statement",
] as const satisfies readonly DocumentType[];
const halfPageDocumentTypes = new Set<DocumentType>(
  HALF_PAGE_DOCUMENT_TYPES,
);

/**
 * A revision's `pageSize` is its paper footprint, so `half` is refused for
 * a type that cannot be printed two-up. This includes `notice`: a Notice
 * template has no footprint of its own. Each notice chooses its own print
 * size (`notice.page_size`, full or half A4) and one Notice design prints
 * both, adapting to the `print.size` context fact, so a Notice revision is
 * always stored as `full` and its `pageSize` never decides a notice's
 * layout.
 */
function validateTemplatePageSize(
  value: { documentType: DocumentType; pageSize: DocumentTemplatePageSize },
  context: z.RefinementCtx,
) {
  if (value.pageSize === "half" && value.documentType === "notice") {
    context.addIssue({
      code: "custom",
      path: ["pageSize"],
      message: "A Notice design prints both sizes; each notice chooses full or half A4.",
    });
    return;
  }
  if (value.pageSize === "half" && value.documentType === "question_paper") {
    context.addIssue({
      code: "custom",
      path: ["pageSize"],
      message: "Question papers print on full A4.",
    });
    return;
  }
  if (value.pageSize === "half" && !halfPageDocumentTypes.has(value.documentType)) {
    context.addIssue({
      code: "custom",
      path: ["pageSize"],
      message: "Half A4 is available for admit cards and finance documents only.",
    });
  }
}
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  report_card: "Report cards",
  id_card: "Student ID cards",
  admit_card: "Admit cards",
  timetable: "Exam timetables",
  bill: "Bills",
  receipt: "Receipts",
  statement: "Account statements",
  notice: "Notices",
  question_paper: "Question papers",
};
const id = z.string().trim().min(1).max(100);
export const schoolScopeSchema = z.object({ schoolId: id });
export const templateScopeSchema = schoolScopeSchema.extend({
  documentType: documentTypeSchema,
});
export const templateContentSchema = z
  .string()
  .trim()
  .min(1, "Template content is required")
  .max(200_000);
export const artifactDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  kind: z.enum(["template", "pdf"]),
  documentType: documentTypeSchema,
  status: z.enum(["ready", "deleting"]),
  name: z.string(),
  contentType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  pageSize: documentTemplatePageSizeSchema,
  /**
   * On a generated PDF, the template revision it was rendered with. Always null
   * on a template revision itself; it is not the revision to save against (see
   * `activeTemplateSchema.revisionId`).
   */
  templateRevisionId: z
    .string()
    .nullable()
    .describe("Generated PDFs only: the template revision the PDF was rendered with. Always null on a template revision; never send it as expectedRevisionId."),
  templateName: z.string().nullable(),
  marketplaceSlug: z.string().nullable(),
  sessionId: z.string().nullable(),
  examSlug: z.string().nullable(),
  classId: z.string().nullable(),
  studentIds: z.array(z.string()),
  studentCount: z.number().int(),
  financeSource: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("bill"), admissionIds: z.array(z.string()), billIds: z.array(z.string()), billRunId: z.string().nullable() }),
    z.object({ kind: z.literal("receipt"), admissionIds: z.array(z.string()), transactions: z.array(z.object({ kind: z.enum(["payment", "refund"]), id: z.string() })) }),
    z.object({ kind: z.literal("statement"), currency: z.string(), throughDate: z.string(), timeZone: z.string(), accounts: z.array(z.object({ admissionId: z.string(), highWaterSequence: z.string() })) }),
  ]).nullable(),
  generationOptions: documentGenerationOptionsSchema,
  createdBy: z.string(),
  createdAt: z.string(),
});
export type DocumentArtifact = z.infer<typeof artifactDtoSchema>;
/**
 * The school's selected template revision. `revisionId` is the value the
 * selection pointer (`school_document_template.artifact_id`) held when this
 * revision was read, which is what `expectedRevisionId` is compared with. It is
 * an explicit field so a caller saving over it does not have to know that a
 * revision is identified by its artifact id. It is listed first so a model
 * reading a long result meets it before the template source.
 */
export const activeTemplateSchema = z.object({
  revisionId: z
    .string()
    .describe("The selected revision. Send it as expectedRevisionId when saving or selecting a template for this document type."),
  artifact: artifactDtoSchema,
  content: z.string(),
});
/**
 * Optimistic concurrency for saving or selecting a template: the revision the
 * caller last read. The description is what an MCP or assistant caller sees, so
 * it names where the value comes from and what it is not (a hash, or a PDF's
 * `templateRevisionId`), which a model has otherwise guessed wrong.
 */
const expectedRevisionIdSchema = id
  .nullable()
  .describe("The revisionId returned by school.getActiveDocumentTemplate for this document type (an art_… id), or null only when that call returned null. Not a sha256 and not artifact.templateRevisionId.");
export const saveTemplateSchema = templateScopeSchema
  .extend({
    name: z.string().trim().min(1).max(120),
    content: templateContentSchema,
    pageSize: documentTemplatePageSizeSchema.default("full"),
    expectedRevisionId: expectedRevisionIdSchema,
  })
  .superRefine(validateTemplatePageSize);
export const selectTemplateSchema = templateScopeSchema.extend({
  slug: z.string().trim().min(1).max(100),
  expectedRevisionId: expectedRevisionIdSchema,
});
export const marketplaceItemSchema = z.object({
  slug: z.string(),
  documentType: documentTypeSchema,
  name: z.string(),
  description: z.string(),
  pageSize: documentTemplatePageSizeSchema,
});
export const listMarketplaceSchema = createListInputSchema({
  ...templateScopeSchema.shape,
  searchQuery: z.string().trim().max(100).default(""),
});
export const listMarketplaceOutputSchema = createPaginatedOutputSchema(
  marketplaceItemSchema,
);
/**
 * The print size to preview a Notice design at. A Notice design prints
 * notices of both sizes (each notice chooses its own and the design reads
 * it as `print.size`), so its preview can be asked for either; it is not
 * the revision's `pageSize`. Refused for every other type rather than
 * ignored.
 */
export const noticePrintSizeSchema = documentTemplatePageSizeSchema
  .optional()
  .describe("Notice designs only: preview the design as it prints a full-A4 or half-A4 notice (print.size). Defaults to full.");
function validateNoticePrintSize(
  value: { documentType: DocumentType; printSize?: DocumentTemplatePageSize },
  context: z.RefinementCtx,
) {
  if (value.printSize !== undefined && value.documentType !== "notice")
    context.addIssue({
      code: "custom",
      path: ["printSize"],
      message: "A print size can be previewed for Notice designs only.",
    });
}
export const previewTemplateSchema = templateScopeSchema
  .extend({
    content: templateContentSchema,
    pageSize: documentTemplatePageSizeSchema.default("full"),
    printSize: noticePrintSizeSchema,
  })
  .superRefine(validateTemplatePageSize)
  .superRefine(validateNoticePrintSize);
/**
 * One saved revision of a school template (an immutable `artifact` of kind
 * `template`), as the template editor's revision history lists it.
 * `revisionNo` counts the type's revisions oldest first (1, 2, …) from their
 * creation order; it is a label, never an identifier: `revisionId` is.
 * `selected` is its own fact (the school's selection pointer names it), never
 * inferred from being the newest: an imported or reselected design can be
 * selected while a newer revision exists.
 */
export const templateRevisionSchema = z.object({
  revisionId: z.string(),
  revisionNo: z.number().int().positive(),
  name: z.string(),
  pageSize: documentTemplatePageSizeSchema,
  marketplaceSlug: z.string().nullable(),
  createdAt: z.string(),
  /** Who saved it, as named now; null when that account no longer exists. */
  createdByName: z.string().nullable(),
  selected: z.boolean(),
});
export type TemplateRevision = z.infer<typeof templateRevisionSchema>;
export const listTemplateRevisionsSchema = createListInputSchema({ ...templateScopeSchema.shape });
export const listTemplateRevisionsOutputSchema = createPaginatedOutputSchema(templateRevisionSchema);
export const templateRevisionInputSchema = templateScopeSchema.extend({
  revisionId: id.describe("A revisionId from listDocumentTemplateRevisions (an art_… id)."),
});
export const templateRevisionOutputSchema = z.object({
  revision: templateRevisionSchema,
  content: z.string(),
});
/**
 * A saved revision previewed as its PDF, named by its id: the server reads
 * its source, so someone who may only read the school's templates previews
 * what was saved, never source of their own (that preview,
 * `previewDocumentTemplatePdf`, is for those who may change templates).
 */
export const previewTemplateRevisionPdfSchema = templateRevisionInputSchema
  .extend({ printSize: noticePrintSizeSchema })
  .superRefine(validateNoticePrintSize);
/**
 * A template the assistant proposes in the template editor's chat. Only the
 * source: the name and the paper footprint stay the editor's own fields, and
 * the check does not depend on them (a save checks the source against the
 * type's sample, whatever its footprint).
 */
export const validateTemplateDraftSchema = templateScopeSchema.extend({
  content: templateContentSchema.describe(
    "The COMPLETE template (HTML with Handlebars bindings) as the editor should hold it, never a fragment or a diff. Call learn_document_template_editing first.",
  ),
});
/**
 * The verdict on a proposed template. It never echoes the source (the caller
 * has it); `draftId` names it in the conversation and is null when invalid.
 * Kept short (one or two problem lines) so the chat's stored copy of the
 * result, cut at 4,000 characters, is always whole.
 */
export const validateTemplateDraftOutputSchema = z.object({
  valid: z.boolean(),
  problems: z.array(z.string()).describe("Why the template cannot be saved; fix them and validate again. Empty when valid."),
  draftId: z.string().nullable(),
  characters: z.number().int(),
});
export const templateEditingGuideOutputSchema = z.object({
  documentType: documentTypeSchema,
  rules: z.string(),
  workflow: z.array(z.string()),
  contextHelp: z.string(),
});
/**
 * A preview as its PDF, base64-encoded: a template preview is a few synthetic
 * pages under a page cap (`TEMPLATE_PREVIEW_LIMITS`), so the bytes travel in
 * the procedure's JSON result.
 */
export const previewTemplatePdfOutputSchema = z.object({ pdfBase64: z.string() });
export const marketplaceTemplateInputSchema = templateScopeSchema
  .extend({ slug: z.string().min(1).max(100), printSize: noticePrintSizeSchema })
  .superRefine(validateNoticePrintSize);
export const previewOutputSchema = z.object({
  /** The sample: the first documents, enough to fill two physical sheets. */
  html: z.string(),
  /** Students the whole selection includes (0 for timetables); finance documents count documents. */
  studentCount: z.number().int(),
  /** Documents the whole selection resolves to. */
  documentCount: z.number().int(),
  /** Documents rendered in `html` (the first ones, in print order). */
  sampleCount: z.number().int(),
  warnings: z.array(z.string()),
  /** Statements only: the hash generation must present, over the whole selection. */
  reviewHash: z.string().nullable(),
});

/**
 * The most documents one export may hold: explicit students, bill IDs,
 * receipt transactions and statement admissions, and every whole-class,
 * whole-examination or billing-run selection once resolved. Generation runs
 * as a batched job in the worker (docs/document-system.md "Generation jobs"),
 * so the bound is the job's, not one request's.
 */
export const MAX_DOCUMENT_SOURCE_ITEMS = 1_500;
const examSlug = id.describe("Exam slug from school.listExams.");
const selection = {
  sessionId: id,
  classId: id,
  studentIds: z.array(id).min(1).max(MAX_DOCUMENT_SOURCE_ITEMS).optional(),
};
/** IDs remain independent inputs. The server verifies their school, session,
 * class and enrollment relationships instead of trusting a UI selection.
 */
export const documentSourceSchema = z.discriminatedUnion("documentType", [
  z.object({ documentType: z.literal("id_card"), ...selection }),
  z.object({
    documentType: z.literal("report_card"),
    ...selection,
    classId: id.optional(),
    examSlug: examSlug,
    resultPolicy: reportResultPolicySchema.default("require_all"),
    /** `{}` parses to DEFAULT_REPORT_SECTIONS through the per-section
     * defaults; prefaulting it keeps the advertised schema small. */
    reportSections: reportSectionsSchema.prefault({}),
  }),
  z.object({
    documentType: z.literal("admit_card"),
    sessionId: id,
    classId: id.optional(),
    studentIds: selection.studentIds,
    examSlug: examSlug,
  }),
  /** Timetable PDFs are school-wide examination schedules. This branch is
   * strict so stale clients cannot silently submit a class scope.
   */
  z
    .object({
      documentType: z.literal("timetable"),
      sessionId: id,
      examSlug: examSlug,
    })
    .strict(),
  z.object({
    documentType: z.literal("bill"),
    sessionId: id,
    billIds: z.array(id).min(1).max(MAX_DOCUMENT_SOURCE_ITEMS).optional(),
    billRunId: id.optional(),
  }).strict().superRefine((source, context) => {
    if (Boolean(source.billIds) === Boolean(source.billRunId)) context.addIssue({ code: "custom", message: "Choose bill IDs or one complete billing run." });
  }),
  z.object({
    documentType: z.literal("receipt"),
    sessionId: id,
    transactions: z.array(z.object({ kind: z.enum(["payment", "refund"]), id })).min(1).max(MAX_DOCUMENT_SOURCE_ITEMS),
    /** Session Documents uses this explicit policy for its payment-only bulk
     * picker. Contextual payment/refund regeneration intentionally omits it. */
    selectionPolicy: z.literal("posted_unreversed_payments").optional(),
  }).strict().superRefine((source, context) => {
    if (
      source.selectionPolicy === "posted_unreversed_payments" &&
      source.transactions.some(({ kind }) => kind !== "payment")
    ) {
      context.addIssue({
        code: "custom",
        path: ["transactions"],
        message: "This receipt selection accepts posted payments only.",
      });
    }
  }),
  z.object({
    documentType: z.literal("statement"),
    sessionId: id,
    admissionIds: z.array(id).min(1).max(MAX_DOCUMENT_SOURCE_ITEMS),
    throughDate: z.string().date(),
    /** Required by generation after preview; preview omits it. */
    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
]).superRefine((source, context) => {
  const ids = source.documentType === "bill"
    ? source.billIds ?? []
    : source.documentType === "receipt"
      ? source.transactions.map(({ kind, id: value }) => `${kind}:${value}`)
      : source.documentType === "statement"
        ? source.admissionIds
        : "studentIds" in source ? source.studentIds ?? [] : [];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Document source IDs must be unique." });
});
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export const generateDocumentSchema = schoolScopeSchema.extend({
  source: documentSourceSchema,
  templateRevisionId: id,
});
export const listArtifactsSchema = createListInputSchema({
  ...schoolScopeSchema.shape,
  filters: z
    .object({
      documentType: documentTypeSchema.optional(),
      /** Selects the permission and type family when no exact document type is
       * supplied. This keeps finance history unified without ever falling back
       * to the academic-document permission boundary. */
      documentDomain: z.enum(["academic", "finance", "all"]).optional(),
      sessionId: id.optional(),
      classId: id.optional(),
      examSlug: id.optional(),
      studentId: id.optional(),
      admissionId: id.optional(),
      billId: id.optional(),
      paymentId: id.optional(),
    })
    .superRefine((filters, context) => {
      if (
        filters.documentType &&
        filters.documentDomain &&
        filters.documentDomain !== "all"
      ) {
        const finance = ["bill", "receipt", "statement"].includes(filters.documentType);
        if ((filters.documentDomain === "finance") !== finance) {
          context.addIssue({ code: "custom", message: "Document type does not belong to the selected domain.", path: ["documentType"] });
        }
      }
    })
    .default({}),
  searchQuery: z.string().trim().max(100).default(""),
  orderBy: z
    .object({
      field: z.enum(["createdAt", "name"]),
      direction: z.enum(["asc", "desc"]),
    })
    .default({ field: "createdAt", direction: "desc" }),
});
export const listArtifactsOutputSchema =
  createPaginatedOutputSchema(artifactDtoSchema);
/** Artifact IDs are always accompanied by their document type so permission
 * preflight occurs before lookup and cannot reveal cross-domain existence. */
export const artifactScopeSchema = schoolScopeSchema.extend({
  artifactId: id,
  documentType: documentTypeSchema,
});

export const documentGenerationJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
/**
 * A PDF generation job (docs/document-system.md "Generation jobs"). Its
 * outcome is read here, never from the request that started it: the PDF is
 * created in the background, and `artifactId` is set once it succeeded.
 */
export const documentGenerationJobDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  sessionId: z.string(),
  documentType: documentTypeSchema,
  status: documentGenerationJobStatusSchema,
  name: z.string(),
  /** Documents the selection had when the job was requested. */
  documentCount: z.number().int(),
  /** Documents the PDF prints, known once the worker prepared the job (null before). */
  printedDocumentCount: z.number().int().nullable(),
  warnings: z.array(z.string()),
  /** Null until the documents are split into batches. */
  batchCount: z.number().int().nullable(),
  batchesDone: z.number().int(),
  /** Set when `status` is `succeeded`: the PDF's artifact (download it with getDocumentDownload). */
  artifactId: z.string().nullable(),
  /** Set when `status` is `failed`: a stable code and a message to show. */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type DocumentGenerationJobDto = z.infer<typeof documentGenerationJobDtoSchema>;
export const generateDocumentOutputSchema = z.object({
  jobId: z.string(),
  job: documentGenerationJobDtoSchema,
});
/** The job is addressed with its document type, so the permission is checked before the lookup (as for artifacts). */
export const documentJobScopeSchema = schoolScopeSchema.extend({
  jobId: id,
  documentType: documentTypeSchema,
});
/**
 * Failed jobs stay listed this long after they ended; queued and running
 * jobs are always listed, and a job that succeeded is listed as its PDF.
 */
export const DOCUMENT_JOB_FAILED_LISTED_DAYS = 7;
/** Newest first, with the id as the tie-breaker; the only order offered. */
export const listDocumentJobsSchema = createListInputSchema({
  ...schoolScopeSchema.shape,
  sessionId: id,
  /** Which permission and type family to list, as for listDocumentArtifacts. */
  documentDomain: z.enum(["academic", "finance", "all"]),
});
export const listDocumentJobsOutputSchema = createPaginatedOutputSchema(documentGenerationJobDtoSchema);
