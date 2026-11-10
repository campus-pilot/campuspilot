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
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

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
 * (`routers/school/notice`).
 */
export const TEMPLATE_ONLY_DOCUMENT_TYPES = ["notice"] as const satisfies readonly DocumentType[];
export type TemplateOnlyDocumentType = (typeof TEMPLATE_ONLY_DOCUMENT_TYPES)[number];
export type AcademicDocumentType = Exclude<DocumentType, "bill" | "receipt" | "statement" | TemplateOnlyDocumentType>;
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
  templateRevisionId: z.string().nullable(),
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
export const activeTemplateSchema = z.object({
  artifact: artifactDtoSchema,
  content: z.string(),
});
export const saveTemplateSchema = templateScopeSchema
  .extend({
    name: z.string().trim().min(1).max(120),
    content: templateContentSchema,
    pageSize: documentTemplatePageSizeSchema.default("full"),
    expectedRevisionId: id.nullable(),
  })
  .superRefine(validateTemplatePageSize);
export const selectTemplateSchema = templateScopeSchema.extend({
  slug: z.string().trim().min(1).max(100),
  expectedRevisionId: id.nullable(),
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
export const marketplaceTemplateInputSchema = templateScopeSchema
  .extend({ slug: z.string().min(1).max(100), printSize: noticePrintSizeSchema })
  .superRefine(validateNoticePrintSize);
export const previewOutputSchema = z.object({
  html: z.string(),
  studentCount: z.number().int(),
  warnings: z.array(z.string()),
  reviewHash: z.string().nullable(),
});

const examSlug = id.describe("Exam slug from school.listExams.");
const selection = {
  sessionId: id,
  classId: id,
  studentIds: z.array(id).min(1).max(500).optional(),
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
    billIds: z.array(id).min(1).max(500).optional(),
    billRunId: id.optional(),
  }).strict().superRefine((source, context) => {
    if (Boolean(source.billIds) === Boolean(source.billRunId)) context.addIssue({ code: "custom", message: "Choose bill IDs or one complete billing run." });
  }),
  z.object({
    documentType: z.literal("receipt"),
    sessionId: id,
    transactions: z.array(z.object({ kind: z.enum(["payment", "refund"]), id })).min(1).max(500),
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
    admissionIds: z.array(id).min(1).max(500),
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
