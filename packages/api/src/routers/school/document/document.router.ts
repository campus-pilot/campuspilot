import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
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
import { requireSchoolPermission } from "../../../permissions/school";
import { assertPermission } from "../../../permissions/authorization";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import * as dto from "./document.dto";
import {
  DOCUMENT_CONTEXT_HELP,
  DOCUMENT_MARKETPLACE,
  SAMPLE_DOCUMENT_CONTEXT,
} from "./document.catalog";
import {
  combineDocuments,
  convertDocumentPdf,
  renderDocument,
} from "./document.render";
import {
  deleteDocumentObject,
  documentDownloadUrl,
  persistDocumentObject,
  readDocumentTemplate,
} from "./document.storage";
import { buildDocumentContexts } from "./document.context";

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
async function getTemplate(
  db: Database,
  input: { schoolId: string; documentType: dto.DocumentType },
  revision?: string,
) {
  const [selected] = await db
    .select({ artifact: artifactTable })
    .from(schoolDocumentTemplateTable)
    .innerJoin(
      artifactTable,
      and(
        eq(artifactTable.id, schoolDocumentTemplateTable.artifactId),
        eq(artifactTable.schoolId, input.schoolId),
        eq(artifactTable.documentType, input.documentType),
        eq(artifactTable.kind, "template"),
        eq(artifactTable.status, "ready"),
      ),
    )
    .where(
      and(
        eq(schoolDocumentTemplateTable.schoolId, input.schoolId),
        eq(schoolDocumentTemplateTable.documentType, input.documentType),
      ),
    )
    .limit(1);
  if (!selected) throw rpcError.notFound("Configured document template");
  if (revision && selected.artifact.id !== revision)
    throw rpcError.conflict(
      "The template changed. Refresh the template and preview again.",
    );
  return {
    row: selected.artifact,
    content: await readDocumentTemplate(selected.artifact.s3Key),
  };
}
async function saveTemplate(
  db: Database,
  userId: string,
  input: z.infer<typeof dto.saveTemplateSchema>,
  marketplaceSlug: string | null,
) {
  renderDocument(input.content, SAMPLE_DOCUMENT_CONTEXT);
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
      if ((previous?.artifactId ?? null) !== input.expectedRevisionId)
        throw rpcError.conflict(
          "Another person updated this template. Reload the saved revision before saving.",
        );
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
      return { artifact: serialize(row), content: input.content };
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
  const actions =
    input.source.documentType === "timetable"
      ? [SCHOOL_ACTIONS.READ_EXAM_TIMETABLE, SCHOOL_ACTIONS.READ_EXAMS]
      : input.source.documentType === "report_card"
        ? [
            SCHOOL_ACTIONS.READ_STUDENT,
            SCHOOL_ACTIONS.READ_EXAM_RESULTS,
            SCHOOL_ACTIONS.READ_EXAMS,
            SCHOOL_ACTIONS.READ_EXAM_PLANS,
          ]
        : input.source.documentType === "admit_card"
          ? [
              SCHOOL_ACTIONS.READ_STUDENT,
              SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
              SCHOOL_ACTIONS.READ_EXAMS,
            ]
          : [SCHOOL_ACTIONS.READ_STUDENT];
  for (const action of [
    SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_SESSION,
    SCHOOL_ACTIONS.READ_CLASS,
    ...actions,
  ])
    await assertPermission(
      context,
      { action, resource: { kind: "school", schoolId: input.schoolId } },
      signal,
    );
  return next();
});
async function renderSelection(
  db: Database,
  input: z.infer<typeof dto.generateDocumentSchema>,
) {
  const template = await getTemplate(
    db,
    { schoolId: input.schoolId, documentType: input.source.documentType },
    input.templateRevisionId,
  );
  const data = await db.transaction(
    (tx) => buildDocumentContexts(tx, input.schoolId, input.source),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const documents = data.contexts.map((context) =>
    renderDocument(template.content, context),
  );
  return {
    ...data,
    template,
    html: combineDocuments(documents, input.source.documentType),
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
    .input(dto.listMarketplaceSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES))
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
    .input(dto.templateScopeSchema.extend({ slug: z.string().min(1).max(100) }))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES))
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
        html: renderDocument(item.content, SAMPLE_DOCUMENT_CONTEXT),
        contextHelp: DOCUMENT_CONTEXT_HELP,
      };
    }),
  getActiveDocumentTemplate: protectedProcedure
    .route(
      route(
        "Get the selected school template",
        "Read the school’s immutable active template revision, or null when that document type has not been configured.",
      ),
    )
    .input(dto.templateScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES))
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
        return { artifact: serialize(template.row), content: template.content };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  selectMarketplaceTemplate: protectedProcedure
    .route(
      route(
        "Select a marketplace template",
        "Copy a server-owned template into an immutable school S3 object and atomically select that revision. Reject stale selection revisions.",
      ),
    )
    .input(dto.selectTemplateSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES))
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
          { ...input, name: item.name, content: item.content },
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
        "Validate Handlebars, upload a new immutable S3 blob, and atomically update the school selection with optimistic concurrency.",
      ),
    )
    .input(dto.saveTemplateSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES))
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
    .input(dto.previewTemplateSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES))
    .output(z.object({ html: z.string(), contextHelp: z.string() }))
    .handler(async ({ input }) => ({
      html: renderDocument(input.content, SAMPLE_DOCUMENT_CONTEXT),
      contextHelp: DOCUMENT_CONTEXT_HELP,
    })),
  previewDocument: protectedProcedure
    .route(
      route(
        "Preview a document export",
        "Build authorized live school contexts and preview the selected template revision before generating a PDF. Requires approved results for report cards.",
      ),
    )
    .input(dto.generateDocumentSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.GENERATE_DOCUMENTS))
    .use(requireSourcePermissions)
    .output(dto.previewOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const data = await renderSelection(context.db, input);
        return {
          html: data.html,
          studentCount: data.studentIds.length,
          warnings: data.warnings,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  generateDocument: protectedProcedure
    .route(
      route(
        "Generate a school PDF artifact",
        "Render the selected template against independently validated school data, convert with Gotenberg, and persist the PDF in S3 with an immutable database reference and template provenance.",
      ),
    )
    .input(dto.generateDocumentSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.GENERATE_DOCUMENTS))
    .use(requireSourcePermissions)
    .output(
      z.object({
        artifact: dto.artifactDtoSchema,
        warnings: z.array(z.string()),
      }),
    )
    .handler(async ({ context, input, signal }) => {
      try {
        const data = await renderSelection(context.db, input);
        const bytes = await convertDocumentPdf(
          data.html,
          input.source.documentType,
          signal,
        );
        const id = generateId("artifact");
        const artifact = await persistDocumentObject(
          context.db,
          {
            id,
            schoolId: input.schoolId,
            kind: "pdf",
            documentType: input.source.documentType,
            name: data.name,
            s3Key: `schools/${input.schoolId}/documents/${id}.pdf`,
            contentType: "application/pdf",
            templateRevisionId: data.template.row.id,
            sessionId: input.source.sessionId,
            examSlug: "examSlug" in input.source ? input.source.examSlug : null,
            classId: input.source.classId ?? null,
            studentIds: data.studentIds,
            studentCount: data.studentIds.length,
            generationOptions:
              input.source.documentType === "report_card"
                ? {
                    reportSections: input.source.reportSections,
                    resultPolicy: input.source.resultPolicy,
                  }
                : {},
            createdBy: context.session.user.id,
          },
          bytes,
          async (_tx, row) => serialize(row, data.template.row.name),
        );
        return { artifact, warnings: data.warnings };
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
    .input(dto.listArtifactsSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS))
    .output(dto.listArtifactsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const f = input.filters;
        const where = and(
          eq(artifactTable.schoolId, input.schoolId),
          eq(artifactTable.kind, "pdf"),
          f.documentType
            ? eq(artifactTable.documentType, f.documentType)
            : undefined,
          f.sessionId ? eq(artifactTable.sessionId, f.sessionId) : undefined,
          f.classId ? eq(artifactTable.classId, f.classId) : undefined,
          f.examSlug ? eq(artifactTable.examSlug, f.examSlug) : undefined,
          f.studentId
            ? sql`${artifactTable.studentIds} @> ${JSON.stringify([f.studentId])}::jsonb`
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
    .input(dto.artifactScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS))
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
            ),
          )
          .limit(1);
        if (!row) throw rpcError.notFound("Document artifact");
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
    .input(dto.artifactScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_DOCUMENT_ARTIFACTS))
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) => {
      try {
        const where = and(
          eq(artifactTable.id, input.artifactId),
          eq(artifactTable.schoolId, input.schoolId),
          eq(artifactTable.kind, "pdf"),
        );
        const [row] = await context.db
          .update(artifactTable)
          .set({ status: "deleting" })
          .where(where)
          .returning();
        if (!row) throw rpcError.notFound("Document artifact");
        await deleteDocumentObject(row.s3Key);
        await context.db.delete(artifactTable).where(where);
        return { deleted: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
