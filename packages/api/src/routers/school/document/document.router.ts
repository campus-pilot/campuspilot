import { assertValidSchoolNoticeTemplate } from "../notice/notice.render";
import {
  assertValidSchoolQuestionPaperTemplate,
  renderSampleQuestionPaperDocument,
} from "../question-paper/question-paper.render";
import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, sql } from "drizzle-orm";
import { generateId } from "@campuspilot/db/id";
import type { Database } from "@campuspilot/db";
import {
  artifactTable,
  schoolDocumentTemplateTable,
} from "@campuspilot/db/schema/artifact";
import { schoolTable } from "@campuspilot/db/schema/school";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { o, protectedProcedure } from "../../../index";
import { rpcError, toRpcError } from "../../../errors";
import { assertPermission, checkPermissions } from "../../../permissions/authorization";
import { assertSchoolFeatureEnabled } from "../../../feature-flags/feature-flags.service";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import * as dto from "./document.dto";
import {
  DOCUMENT_CONTEXT_HELP,
  DOCUMENT_MARKETPLACE,
  sampleDocumentContext,
  SAMPLE_NOTICE_CONTEXT,
} from "./document.catalog";
import {
  combineDocuments,
  documentsPerSheet,
  renderDocument,
  renderDocuments,
} from "./document.render";
import {
  deleteDocumentObject,
  documentDownloadUrl,
  persistDocumentObject,
} from "./document.storage";
import { requireSchoolFeature } from "../../../permissions/feature";
import { DocumentImageError, embedDocumentImages } from "./document.images";
import { resolveDocumentSource } from "./document.source";
import { getDocumentJob, listDocumentJobs, startDocumentGeneration } from "./document.jobs";
import { getSelectedDocumentTemplate as getTemplate } from "./document.selected-template";

const isFinanceDocument = dto.isFinanceDocumentType;

function requireDocumentTypePermission(
  academicAction: Parameters<typeof assertPermission>[1]["action"],
  financeAction: Parameters<typeof assertPermission>[1]["action"],
) {
  return o.middleware<Record<never, never>, { schoolId: string; documentType: dto.DocumentType }>(
    async ({ context, next, signal }, input) => {
      await assertPermission(context, {
        action: isFinanceDocument(input.documentType) ? financeAction : academicAction,
        resource: { kind: "school", schoolId: input.schoolId },
      }, signal);
      // Every document type belongs to a feature (`DOCUMENT_TYPE_FEATURE`): a
      // school without it has no such template, document or history to read,
      // preview, import, save, download or delete. Checked after the
      // permission, so a caller without access learns nothing. For a question
      // paper only the feature is checked, not the caller's own assistant
      // role: a principal whose role is not switched on can still configure
      // the school's template. Papers themselves use the full assistant gate.
      await assertSchoolFeatureEnabled(context.db, input.schoolId, dto.DOCUMENT_TYPE_FEATURE[input.documentType]);
      return next();
    },
  );
}
function requireSourceTypePermission(
  academicAction: Parameters<typeof assertPermission>[1]["action"],
  financeAction: Parameters<typeof assertPermission>[1]["action"],
) {
  return o.middleware<Record<never, never>, z.infer<typeof dto.generateDocumentSchema>>(
    async ({ context, next, signal }, input) => {
      await assertPermission(context, {
        action: isFinanceDocument(input.source.documentType) ? financeAction : academicAction,
        resource: { kind: "school", schoolId: input.schoolId },
      }, signal);
      return next();
    },
  );
}
type GeneratorDocumentType = Exclude<dto.DocumentType, dto.TemplateOnlyDocumentType>;
const GENERATOR_DOCUMENT_TYPES = dto.documentTypeSchema.options.filter(
  (type): type is GeneratorDocumentType => !(dto.TEMPLATE_ONLY_DOCUMENT_TYPES as readonly string[]).includes(type),
);
/**
 * Every action starting a document of `type` needs: its generate action and
 * the reads of its source data. Decided by the type alone (no source field
 * changes it), so starting, reading and listing jobs share one rule.
 */
function startActions(type: dto.DocumentType) {
  if (isFinanceDocument(type))
    return [
      SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS,
      SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
      SCHOOL_ACTIONS.READ_SESSION_FINANCE,
      SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
    ];
  const sourceReads =
    type === "timetable"
      ? [SCHOOL_ACTIONS.READ_EXAM_TIMETABLE, SCHOOL_ACTIONS.READ_EXAMS]
      : type === "report_card"
        ? [SCHOOL_ACTIONS.READ_STUDENT, SCHOOL_ACTIONS.READ_EXAM_RESULTS, SCHOOL_ACTIONS.READ_EXAMS, SCHOOL_ACTIONS.READ_EXAM_PLANS]
        : type === "admit_card"
          ? [SCHOOL_ACTIONS.READ_STUDENT, SCHOOL_ACTIONS.READ_EXAM_TIMETABLE, SCHOOL_ACTIONS.READ_EXAMS]
          : [SCHOOL_ACTIONS.READ_STUDENT];
  return [
    SCHOOL_ACTIONS.GENERATE_DOCUMENTS,
    SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_SESSION,
    SCHOOL_ACTIONS.READ_CLASS,
    ...sourceReads,
  ];
}
/**
 * Reading a job needs what starting one of its type needs (`startActions`)
 * and its type's feature: a job says what was exported, so nobody reads one
 * they could not have started.
 */
const requireJobPermission = o.middleware<Record<never, never>, z.infer<typeof dto.documentJobScopeSchema>>(
  async ({ context, next, signal }, input) => {
    for (const action of startActions(input.documentType))
      await assertPermission(context, { action, resource: { kind: "school", schoolId: input.schoolId } }, signal);
    await assertSchoolFeatureEnabled(context.db, input.schoolId, dto.DOCUMENT_TYPE_FEATURE[input.documentType]);
    return next();
  },
);
/** The generator types of a domain the caller could start (permissions and the type's feature). */
async function startableDocumentTypes(
  context: Parameters<typeof assertPermission>[0],
  input: { schoolId: string; documentDomain: "academic" | "finance" | "all" },
  signal?: AbortSignal,
): Promise<GeneratorDocumentType[]> {
  const candidates = GENERATOR_DOCUMENT_TYPES.filter((type) =>
    input.documentDomain === "all" ? true : (input.documentDomain === "finance") === isFinanceDocument(type),
  );
  // One OPA round for every action of every candidate type.
  const actions = [...new Set(candidates.flatMap(startActions))];
  const results = await checkPermissions(
    context,
    actions.map((action) => ({ action, resource: { kind: "school" as const, schoolId: input.schoolId } })) as Parameters<typeof checkPermissions>[1],
    signal,
  );
  const granted = new Set(actions.filter((_action, index) => results[index]));
  const allowed = candidates.filter((type) => startActions(type).every((action) => granted.has(action)));
  const features = new Map<string, boolean>();
  const startable: GeneratorDocumentType[] = [];
  for (const type of allowed) {
    const feature = dto.DOCUMENT_TYPE_FEATURE[type];
    if (!features.has(feature))
      features.set(feature, await assertSchoolFeatureEnabled(context.db, input.schoolId, feature).then(() => true, () => false));
    if (features.get(feature)) startable.push(type);
  }
  return startable;
}
/** Listing jobs needs the history permission of every domain listed, as listing their PDFs does. */
const requireJobListPermission = o.middleware<Record<never, never>, z.infer<typeof dto.listDocumentJobsSchema>>(
  async ({ context, next, signal }, input) => {
    const actions = input.documentDomain === "all"
      ? [SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS]
      : [input.documentDomain === "finance" ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS : SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS];
    for (const action of actions)
      await assertPermission(context, { action, resource: { kind: "school", schoolId: input.schoolId } }, signal);
    return next();
  },
);
const requireArtifactListPermission = o.middleware<Record<never, never>, z.infer<typeof dto.listArtifactsSchema>>(
  async ({ context, next, signal }, input) => {
    const domain = input.filters.documentDomain;
    const actions = domain === "all"
      ? [
          SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
          SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS,
        ]
      : [
          domain === "finance" ||
          Boolean(
            input.filters.documentType &&
              isFinanceDocument(input.filters.documentType),
          )
            ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS
            : SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
        ];
    for (const action of actions) {
      await assertPermission(
        context,
        {
          action,
          resource: { kind: "school", schoolId: input.schoolId },
        },
        signal,
      );
    }
    return next();
  },
);

const route = (summary: string, description: string) => ({
  summary,
  description,
  tags: ["School", "Documents"],
});
const templateRevision = alias(artifactTable, "document_template_revision");
const serialize = (
  row: typeof artifactTable.$inferSelect,
  templateName: string | null = null,
) =>
  dto.artifactDtoSchema.parse({
    ...row,
    templateName,
    createdAt: row.createdAt.toISOString(),
  });
function page<T>(
  items: T[],
  totalItems: number,
  input: { limit: number; page?: number; cursor?: string },
) {
  const { currentPage, pageSize } = resolvePaginationInput(input);
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items,
    totalItems,
    currentPage,
    pageSize,
    totalPages,
    nextCursor: createNextPageCursor(currentPage, totalPages),
  });
}
/**
 * A template rendered with synthetic data for a preview. A Notice design is
 * laid out at the requested notice print size (`printSize`, full when
 * omitted) and told that size as `print.size`, exactly as a plain notice of
 * that size is printed; every other type uses its revision's footprint.
 */
function previewTemplateHtml(
  content: string,
  documentType: dto.DocumentType,
  pageSize: dto.DocumentTemplatePageSize,
  printSize: dto.DocumentTemplatePageSize | undefined,
) {
  if (documentType === "notice") {
    const size = printSize ?? "full";
    return combineDocuments([renderDocument(content, { ...SAMPLE_NOTICE_CONTEXT, print: { size } })], "notice", size);
  }
  // Rendered like a real paper (template budget, one body slot, logo limit),
  // with the English example paper as the body so an author sees a real page.
  if (documentType === "question_paper") return renderSampleQuestionPaperDocument(content);
  return combineDocuments([renderDocument(content, sampleDocumentContext(documentType))], documentType, pageSize);
}
/**
 * The CONFLICT for a stale `expectedRevisionId`. It names the revision selected
 * now because MCP and assistant callers receive only the code and message:
 * without the id, a model cannot tell which value to send and retries with the
 * same wrong one. It does not say another person made the change, since a wrong
 * value or the caller's own earlier save is just as likely.
 */
function staleTemplateRevisionError(currentRevisionId: string | null) {
  return rpcError.conflict(
    currentRevisionId
      ? `This template changed since it was loaded. Reload the saved revision before saving (selected revision: ${currentRevisionId}).`
      : "This template changed since it was loaded and no revision is selected now. Reload it before saving (selected revision: none).",
  );
}
/**
 * Validates and stores a template revision and selects it. Exported for the
 * demo seed, which selects the Question paper template for a demo school
 * whose `assistant` feature is off (the procedures refuse that), after
 * checking the permission itself.
 */
export async function saveTemplate(
  db: Database,
  userId: string,
  input: z.infer<typeof dto.saveTemplateSchema>,
  marketplaceSlug: string | null,
) {
  // A Notice template is checked the way notices render it (their output
  // budget and logo limit), so a design no notice could print is refused here.
  if (input.documentType === "notice") assertValidSchoolNoticeTemplate(input.content);
  else if (input.documentType === "question_paper") assertValidSchoolQuestionPaperTemplate(input.content);
  else renderDocument(input.content, sampleDocumentContext(input.documentType));
  const id = generateId("artifact");
  return persistDocumentObject(
    db,
    {
      id,
      schoolId: input.schoolId,
      kind: "template",
      documentType: input.documentType,
      name: input.name,
      s3Key: `schools/${input.schoolId}/document-templates/${id}.hbs`,
      contentType: "text/x-handlebars-template",
      pageSize: input.pageSize,
      marketplaceSlug,
      createdBy: userId,
    },
    Buffer.from(input.content),
    async (tx, row) => {
      // A non-key lock serializes selections without upgrading the KEY SHARE
      // locks held by concurrent artifact foreign-key inserts into a deadlock.
      const [school] = await tx
        .select({ id: schoolTable.id })
        .from(schoolTable)
        .where(eq(schoolTable.id, input.schoolId))
        .for("no key update");
      if (!school) throw rpcError.notFound("School");
      const [previous] = await tx
        .select()
        .from(schoolDocumentTemplateTable)
        .where(
          and(
            eq(schoolDocumentTemplateTable.schoolId, input.schoolId),
            eq(schoolDocumentTemplateTable.documentType, input.documentType),
          ),
        )
        .limit(1);
      const currentRevisionId = previous?.artifactId ?? null;
      if (currentRevisionId !== input.expectedRevisionId)
        throw staleTemplateRevisionError(currentRevisionId);
      await tx
        .insert(schoolDocumentTemplateTable)
        .values({
          schoolId: input.schoolId,
          documentType: input.documentType,
          artifactId: row.id,
        })
        .onConflictDoUpdate({
          target: [
            schoolDocumentTemplateTable.schoolId,
            schoolDocumentTemplateTable.documentType,
          ],
          set: { artifactId: row.id, updatedAt: new Date() },
        });
      return { revisionId: row.id, artifact: serialize(row), content: input.content };
    },
  );
}
/** Generation needs its own grant plus the grants for the data being exported.
 * Possession of a template or artifact ID does not authorize its source data.
 */
const requireSourcePermissions = o.middleware<
  Record<never, never>,
  z.infer<typeof dto.generateDocumentSchema>
>(async ({ context, next, signal }, input) => {
  for (const action of startActions(input.source.documentType).slice(1))
    await assertPermission(context, { action, resource: { kind: "school", schoolId: input.schoolId } }, signal);
  return next();
});
/**
 * A preview renders a sample, not the whole selection: the first documents,
 * enough to fill two physical sheets (four half-A4 documents, sixteen
 * student IDs, two of anything else). Every context is still built (one
 * repeatable-read transaction), so the counts, warnings and the statement
 * review hash cover the whole selection, but only the sample's images are
 * read and only the sample is rendered.
 */
async function previewSelection(
  db: Database,
  input: z.infer<typeof dto.generateDocumentSchema>,
) {
  const template = await getTemplate(
    db,
    { schoolId: input.schoolId, documentType: input.source.documentType },
    input.templateRevisionId,
  );
  const data = await resolveDocumentSource(db, input.schoolId, input.source, { images: "reference" });
  const sampleSize = 2 * documentsPerSheet(input.source.documentType, template.row.pageSize);
  let sample: object[];
  try {
    sample = await embedDocumentImages(data.contexts.slice(0, sampleSize));
  } catch (error) {
    if (error instanceof DocumentImageError)
      throw rpcError.badRequest(`A photo or the school logo ${error.message}. Upload it again as a PNG, JPEG or WebP image of at most 5 MB.`);
    throw error;
  }
  return {
    html: combineDocuments(renderDocuments(template.content, sample), input.source.documentType, template.row.pageSize),
    studentCount: isFinanceDocument(input.source.documentType) ? data.contexts.length : data.studentIds.length,
    documentCount: data.contexts.length,
    sampleCount: sample.length,
    warnings: data.warnings,
    reviewHash: data.reviewHash,
  };
}
export const schoolDocumentRouter = {
  listMarketplaceTemplates: protectedProcedure
    .route(
      route(
        "Browse document templates",
        "List the server-owned marketplace for a document type, ordered by name and slug with page pagination.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.listMarketplaceSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES))
    .output(dto.listMarketplaceOutputSchema)
    .handler(async ({ input }) => {
      const items = DOCUMENT_MARKETPLACE.filter(
        (t) =>
          t.documentType === input.documentType &&
          `${t.name} ${t.description}`
            .toLowerCase()
            .includes(input.searchQuery.toLowerCase()),
      ).sort(
        (a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug),
      );
      const { offset, pageSize } = resolvePaginationInput(input);
      return page(items.slice(offset, offset + pageSize), items.length, input);
    }),
  getMarketplaceTemplate: protectedProcedure
    .route(
      route(
        "Preview a marketplace template",
        "Get template source, variable documentation, and a safe preview using synthetic sample data.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.marketplaceTemplateInputSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES))
    .output(
      dto.marketplaceItemSchema.extend({
        content: z.string(),
        html: z.string(),
        contextHelp: z.string(),
      }),
    )
    .handler(async ({ input }) => {
      const item = DOCUMENT_MARKETPLACE.find(
        (t) => t.slug === input.slug && t.documentType === input.documentType,
      );
      if (!item) throw rpcError.notFound("Marketplace template");
      return {
        ...item,
        html: previewTemplateHtml(item.content, item.documentType, item.pageSize, input.printSize),
        contextHelp: DOCUMENT_CONTEXT_HELP,
      };
    }),
  getActiveDocumentTemplate: protectedProcedure
    .route(
      route(
        "Get the selected school template",
        "Read the school’s immutable active template revision, or null when that document type has not been configured. Its revisionId is the expectedRevisionId for the next save or selection.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.templateScopeSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES))
    .output(dto.activeTemplateSchema.nullable())
    .handler(async ({ context, input }) => {
      try {
        const [selection] = await context.db
          .select()
          .from(schoolDocumentTemplateTable)
          .where(
            and(
              eq(schoolDocumentTemplateTable.schoolId, input.schoolId),
              eq(schoolDocumentTemplateTable.documentType, input.documentType),
            ),
          )
          .limit(1);
        if (!selection) return null;
        const template = await getTemplate(context.db, input);
        // The revision read through the selection with its content, not the
        // earlier `selection` row: a save in between would pair a newer id with
        // older content.
        return {
          revisionId: template.row.id,
          artifact: serialize(template.row),
          content: template.content,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  selectMarketplaceTemplate: protectedProcedure
    .route(
      route(
        "Select a marketplace template",
        "Copy a server-owned template into an immutable school S3 object and atomically select that revision. Send expectedRevisionId as the revisionId from getActiveDocumentTemplate; a stale one gets a CONFLICT naming the revision selected now.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "documents",
      },
    })
    .input(dto.selectTemplateSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES))
    .output(dto.activeTemplateSchema)
    .handler(async ({ context, input }) => {
      try {
        const item = DOCUMENT_MARKETPLACE.find(
          (t) => t.slug === input.slug && t.documentType === input.documentType,
        );
        if (!item) throw rpcError.notFound("Marketplace template");
        return await saveTemplate(
          context.db,
          context.session.user.id,
          {
            ...input,
            name: item.name,
            content: item.content,
            pageSize: item.pageSize,
          },
          item.slug,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  saveDocumentTemplate: protectedProcedure
    .route(
      route(
        "Save a school template revision",
        "Validate Handlebars, upload a new immutable S3 blob, and atomically update the school selection with optimistic concurrency. Send expectedRevisionId as the revisionId from getActiveDocumentTemplate; a CONFLICT names the revision selected now.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "documents",
      },
    })
    .input(dto.saveTemplateSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES))
    .output(dto.activeTemplateSchema)
    .handler(async ({ context, input }) => {
      try {
        return await saveTemplate(
          context.db,
          context.session.user.id,
          input,
          null,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  previewDocumentTemplate: protectedProcedure
    .route(
      route(
        "Preview template changes",
        "Render unsaved Handlebars source with synthetic data in a sanitized, network-free HTML document. Does not change the selected school template.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.previewTemplateSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES))
    .output(z.object({ html: z.string(), contextHelp: z.string() }))
    .handler(async ({ input }) => ({
      html: previewTemplateHtml(input.content, input.documentType, input.pageSize, input.printSize),
      contextHelp: DOCUMENT_CONTEXT_HELP,
    })),
  previewDocument: protectedProcedure
    .route(
      route(
        "Preview a document export",
        "Build authorized live school contexts and preview the selected template revision before generating a PDF. The HTML shows the first documents only (two printed sheets); the counts, warnings and the statement reviewHash cover the whole selection. Requires approved results for report cards.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.generateDocumentSchema)
    .use(requireSourceTypePermission(SCHOOL_ACTIONS.GENERATE_DOCUMENTS, SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS))
    // Every source a document is generated from belongs to student management
    // (`GENERATOR_DOCUMENT_FEATURE`). Stated as the procedure's own gate so the
    // MCP catalog records it and the tool is not offered to a school without it.
    .use(requireSchoolFeature(dto.GENERATOR_DOCUMENT_FEATURE))
    .use(requireSourcePermissions)
    .output(dto.previewOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await previewSelection(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  generateDocument: protectedProcedure
    .route(
      route(
        "Generate a school PDF artifact",
        "Validate the selection against the selected template revision and queue a PDF job; returns at once with the job. The PDF is rendered in batches in the background (up to 1,500 documents). Poll getDocumentGenerationJob with the jobId until status is succeeded (then download artifactId with getDocumentDownload) or failed (errorMessage says why).",
      ),
    )
    .meta({
      mcp: {
        exposure: "core",
        access: "write",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.generateDocumentSchema)
    .use(requireSourceTypePermission(SCHOOL_ACTIONS.GENERATE_DOCUMENTS, SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS))
    // Every source a document is generated from belongs to student management
    // (`GENERATOR_DOCUMENT_FEATURE`). Stated as the procedure's own gate so the
    // MCP catalog records it and the tool is not offered to a school without it.
    .use(requireSchoolFeature(dto.GENERATOR_DOCUMENT_FEATURE))
    .use(requireSourcePermissions)
    .output(dto.generateDocumentOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const job = await startDocumentGeneration(context.db, {
          schoolId: input.schoolId,
          requestedBy: context.session.user.id,
          source: input.source,
          templateRevisionId: input.templateRevisionId,
        });
        return { jobId: job.id, job };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getDocumentGenerationJob: protectedProcedure
    .route(
      route(
        "Check a PDF generation job",
        "Read the status and progress of a job started by generateDocument: queued, running (batchesDone of batchCount), succeeded (artifactId is the PDF; download it with getDocumentDownload) or failed (errorMessage says why). Send the job's documentType.",
      ),
    )
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.documentJobScopeSchema)
    .use(requireJobPermission)
    .use(requireSchoolFeature(dto.GENERATOR_DOCUMENT_FEATURE))
    .output(dto.documentGenerationJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getDocumentJob(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  listDocumentGenerationJobs: protectedProcedure
    .route(
      route(
        "List PDF generation jobs in progress",
        "List a session's queued and running PDF jobs and those that failed in the last 7 days, newest first, of the document types the caller could start. Jobs that succeeded are listed by listDocumentArtifacts as their PDF.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.listDocumentJobsSchema)
    .use(requireJobListPermission)
    .use(requireSchoolFeature(dto.GENERATOR_DOCUMENT_FEATURE))
    .output(dto.listDocumentJobsOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listDocumentJobs(context.db, input, await startableDocumentTypes(context, input, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  listDocumentArtifacts: protectedProcedure
    .route(
      route(
        "List generated school documents",
        "Page through PDF history using explicit type, session, exam, class, and student filters. Sorting is allowlisted and has a stable ID tie-breaker.",
      ),
    )
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.listArtifactsSchema)
    .use(requireArtifactListPermission)
    // The history lists student and finance documents only (question papers
    // and notices are never in it), all of which belong to student management.
    .use(requireSchoolFeature("studentManagement"))
    .output(dto.listArtifactsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const f = input.filters;
        const where = and(
          eq(artifactTable.schoolId, input.schoolId),
          eq(artifactTable.kind, "pdf"),
          // Question paper access is per class (D37) while this history is
          // gated by school-wide actions, so papers are never listed here:
          // their versions and downloads live in the Question paper tab.
          ne(artifactTable.documentType, "question_paper"),
          f.documentType
            ? eq(artifactTable.documentType, f.documentType)
            : f.documentDomain === "finance"
              ? inArray(artifactTable.documentType, ["bill", "receipt", "statement"])
              : f.documentDomain === "all"
                ? undefined
                : notInArray(artifactTable.documentType, ["bill", "receipt", "statement"]),
          f.sessionId ? eq(artifactTable.sessionId, f.sessionId) : undefined,
          f.classId ? eq(artifactTable.classId, f.classId) : undefined,
          f.examSlug ? eq(artifactTable.examSlug, f.examSlug) : undefined,
          f.studentId
            ? sql`${artifactTable.studentIds} @> ${JSON.stringify([f.studentId])}::jsonb`
            : undefined,
          f.admissionId
            ? sql`(${artifactTable.financeSource} -> 'admissionIds' @> ${JSON.stringify([f.admissionId])}::jsonb or exists (select 1 from jsonb_array_elements(coalesce(${artifactTable.financeSource} -> 'accounts', '[]'::jsonb)) account where account ->> 'admissionId' = ${f.admissionId}))`
            : undefined,
          f.billId
            ? sql`${artifactTable.financeSource} -> 'billIds' @> ${JSON.stringify([f.billId])}::jsonb`
            : undefined,
          f.paymentId
            ? sql`exists (select 1 from jsonb_array_elements(coalesce(${artifactTable.financeSource} -> 'transactions', '[]'::jsonb)) transaction where transaction ->> 'kind' = 'payment' and transaction ->> 'id' = ${f.paymentId})`
            : undefined,
          input.searchQuery
            ? ilike(
                artifactTable.name,
                `%${input.searchQuery.replace(/[\\%_]/g, "\\$&")}%`,
              )
            : undefined,
        );
        const direction = input.orderBy.direction === "asc" ? asc : desc;
        const { offset, pageSize } = resolvePaginationInput(input);
        const [items, [total]] = await Promise.all([
          context.db
            .select({
              artifact: artifactTable,
              templateName: templateRevision.name,
            })
            .from(artifactTable)
            .leftJoin(
              templateRevision,
              and(
                eq(templateRevision.id, artifactTable.templateRevisionId),
                eq(templateRevision.schoolId, input.schoolId),
                eq(templateRevision.kind, "template"),
              ),
            )
            .where(where)
            .orderBy(
              direction(
                input.orderBy.field === "name"
                  ? artifactTable.name
                  : artifactTable.createdAt,
              ),
              asc(artifactTable.id),
            )
            .offset(offset)
            .limit(pageSize),
          context.db
            .select({ value: count() })
            .from(artifactTable)
            .where(where),
        ]);
        return page(
          items.map((item) => serialize(item.artifact, item.templateName)),
          total!.value,
          input,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getDocumentDownload: protectedProcedure
    .route(
      route(
        "Download a generated document",
        "Authorize the school and artifact before issuing a five-minute S3 URL. Deleting artifacts cannot be downloaded.",
      ),
    )
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "documents",
      },
    })
    .input(dto.artifactScopeSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS))
    .output(z.object({ url: z.url(), expiresIn: z.number().int() }))
    .handler(async ({ context, input }) => {
      try {
        const [row] = await context.db
          .select()
          .from(artifactTable)
          .where(
            and(
              eq(artifactTable.id, input.artifactId),
              eq(artifactTable.schoolId, input.schoolId),
              eq(artifactTable.kind, "pdf"),
              eq(artifactTable.documentType, input.documentType),
              ne(artifactTable.documentType, "question_paper"),
            ),
          )
          .limit(1);
        if (!row) throw rpcError.notFound("Document artifact");
        await assertPermission(context, {
          action: isFinanceDocument(row.documentType) ? SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS : SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
          resource: { kind: "school", schoolId: input.schoolId },
        });
        if (row.status !== "ready")
          throw rpcError.conflict(
            "This document is being deleted. Retry deletion to finish removing it.",
          );
        return {
          url: await documentDownloadUrl(row.s3Key, row.name),
          expiresIn: 300,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  deleteDocumentArtifact: protectedProcedure
    .route(
      route(
        "Delete a generated document",
        "Mark the tenant-scoped PDF for deletion, remove its S3 blob, then remove the reference. Failed storage deletion stays visible and can safely be retried. Template revisions are retained for provenance.",
      ),
    )
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "documents",
      },
    })
    .input(dto.artifactScopeSchema)
    .use(requireDocumentTypePermission(SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS, SCHOOL_ACTIONS.DELETE_FINANCE_DOCUMENT_ARTIFACTS))
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) => {
      try {
        const where = and(
          eq(artifactTable.id, input.artifactId),
          eq(artifactTable.schoolId, input.schoolId),
          eq(artifactTable.kind, "pdf"),
          eq(artifactTable.documentType, input.documentType),
          ne(artifactTable.documentType, "question_paper"),
        );
        const [existing] = await context.db.select().from(artifactTable).where(where).limit(1);
        if (!existing) throw rpcError.notFound("Document artifact");
        await assertPermission(context, {
          action: isFinanceDocument(existing.documentType) ? SCHOOL_ACTIONS.DELETE_FINANCE_DOCUMENT_ARTIFACTS : SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS,
          resource: { kind: "school", schoolId: input.schoolId },
        });
        const [row] = await context.db.update(artifactTable).set({ status: "deleting" }).where(where).returning();
        if (!row) throw rpcError.notFound("Document artifact");
        await deleteDocumentObject(row.s3Key);
        await context.db.delete(artifactTable).where(where);
        return { deleted: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
