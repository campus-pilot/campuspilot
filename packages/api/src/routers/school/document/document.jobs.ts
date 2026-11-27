import type { Database } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import { documentGenerationJobTable } from "@campuspilot/db/schema/document-generation-job";
import { and, count, desc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { rpcError } from "../../../errors";
import { handOffDocumentJob } from "../../../workflows/document-generation/outbox";
import { DOCUMENT_JOBS_PER_SCHOOL, DOCUMENT_JOBS_PER_USER } from "../../../workflows/document-generation/constants";
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from "../../../paginations";
import * as dto from "./document.dto";
import { selectedDocumentTemplateRevision } from "./document.selected-template";
import { resolveDocumentSource } from "./document.source";

type JobRow = typeof documentGenerationJobTable.$inferSelect;

export function serializeDocumentJob(row: JobRow): dto.DocumentGenerationJobDto {
  return dto.documentGenerationJobDtoSchema.parse({
    id: row.id,
    schoolId: row.schoolId,
    sessionId: row.sessionId,
    documentType: row.documentType,
    status: row.status,
    name: row.name,
    documentCount: row.documentCount,
    printedDocumentCount: row.printedDocumentCount,
    warnings: row.warnings,
    batchCount: row.batchCount,
    batchesDone: row.batchesDone,
    artifactId: row.status === "succeeded" ? row.artifactId : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

/**
 * Accepts a generation request and queues its job; the PDF is made by the
 * worker (`workflows/document-generation`). Everything that can refuse the
 * request is checked here, before anything is queued, as generation always
 * did, plus the job limits (`DOCUMENT_JOBS_PER_SCHOOL` queued or running jobs
 * per school, `DOCUMENT_JOBS_PER_USER` per person; TOO_MANY_REQUESTS): the selected template revision (CONFLICT when it changed), the
 * source's relationships and approvals, the statement review hash, and the
 * document count. The contexts are built without reading any image (that
 * is the worker's work) and then discarded; what the job needs to describe
 * the same moment is pinned on its row (`generated_at`, the finance ledger
 * cutoff, the review hash). The caller's permissions are checked by the
 * procedure's middleware before this runs; the worker acts on the accepted
 * job and never re-authorizes.
 *
 * Returns at once: the hand-over to Restate runs after the insert commits
 * and never delays the response (the outbox sweep retries it).
 */
export async function startDocumentGeneration(
  db: Database,
  input: { schoolId: string; requestedBy: string; source: dto.DocumentSource; templateRevisionId: string },
  options: { dispatch?: (jobId: string) => void } = {},
) {
  // A Bill due is printed with the school's bill template (`templateTypeOf`).
  const template = await selectedDocumentTemplateRevision(
    db,
    { schoolId: input.schoolId, documentType: dto.templateTypeOf(input.source.documentType) },
    input.templateRevisionId,
  );
  const generatedAt = new Date();
  const data = await resolveDocumentSource(db, input.schoolId, input.source, { images: "reference", generatedAt });
  // Statements and Bills due are bound to the reviewed ledger: generation presents the preview's hash.
  if (input.source.documentType === "statement" || input.source.documentType === "bill_due") {
    const what = input.source.documentType === "statement" ? "statement" : "bill";
    if (!input.source.expectedReviewHash)
      throw rpcError.badRequest(`Preview the ${what} before generating it.`);
    if (input.source.expectedReviewHash !== data.reviewHash)
      throw rpcError.conflict(`The ${what} changed after preview. Preview it again before generating.`);
  }
  if (data.contexts.length > dto.MAX_DOCUMENT_SOURCE_ITEMS)
    throw rpcError.badRequest(
      `This selection has ${data.contexts.length.toLocaleString("en-IN")} documents. Create at most ${dto.MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} at a time.`,
    );
  const row = await db.transaction(async (tx) => {
    // One start at a time per person and per school, so two concurrent
    // requests cannot both pass the counts below (transaction-scoped advisory
    // locks: no row is locked). The person's lock is always taken first and
    // the school's second, so two starts can never wait on each other in a
    // cycle; the person's lock also covers their jobs in other schools.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`document-jobs:user:${input.requestedBy}`}, 0))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`document-jobs:school:${input.schoolId}`}, 0))`);
    const active = inArray(documentGenerationJobTable.status, ["queued", "running"]);
    const [school] = await tx
      .select({ value: count() })
      .from(documentGenerationJobTable)
      .where(and(eq(documentGenerationJobTable.schoolId, input.schoolId), active));
    if (school!.value >= DOCUMENT_JOBS_PER_SCHOOL)
      throw rpcError.tooManyRequests(
        `This school already has ${DOCUMENT_JOBS_PER_SCHOOL} PDFs being created. Wait for one to finish (see Document history), then try again.`,
      );
    const [mine] = await tx
      .select({ value: count() })
      .from(documentGenerationJobTable)
      .where(and(eq(documentGenerationJobTable.requestedBy, input.requestedBy), active));
    if (mine!.value >= DOCUMENT_JOBS_PER_USER)
      throw rpcError.tooManyRequests(
        `You already have ${DOCUMENT_JOBS_PER_USER} PDFs being created. Wait for one to finish (see Document history), then try again.`,
      );
    const [inserted] = await tx
    .insert(documentGenerationJobTable)
    .values({
      schoolId: input.schoolId,
      sessionId: input.source.sessionId,
      documentType: input.source.documentType,
      requestedBy: input.requestedBy,
      source: input.source as unknown as Record<string, unknown>,
      templateRevisionId: template.id,
      artifactId: generateId("artifact"),
      name: data.name,
      documentCount: data.contexts.length,
      warnings: data.warnings,
      generatedAt,
      reviewHash: input.source.documentType === "statement" || input.source.documentType === "bill_due" ? data.reviewHash : null,
      ledgerCutoff: data.ledgerCutoff,
    })
    .returning();
    return inserted!;
  });
  const dispatch = options.dispatch ?? ((jobId: string) => handOffDocumentJob(db, jobId));
  dispatch(row.id);
  return serializeDocumentJob(row);
}

/** One job of the school, of the given document type (the permission was checked for that type). */
export async function getDocumentJob(db: Database, input: { schoolId: string; jobId: string; documentType: dto.DocumentType }) {
  const [row] = await db
    .select()
    .from(documentGenerationJobTable)
    .where(
      and(
        eq(documentGenerationJobTable.id, input.jobId),
        eq(documentGenerationJobTable.schoolId, input.schoolId),
        eq(documentGenerationJobTable.documentType, input.documentType),
      ),
    )
    .limit(1);
  if (!row) throw rpcError.notFound("Document generation job");
  return serializeDocumentJob(row);
}

/**
 * The session's jobs that History shows next to its PDFs, newest first:
 * queued and running jobs, and jobs that failed in the last
 * `DOCUMENT_JOB_FAILED_LISTED_DAYS` days, of the document types the caller
 * could have started (`documentTypes`, decided by the procedure). A job that
 * succeeded is not listed: its PDF is.
 */
export async function listDocumentJobs(
  db: Database,
  input: { schoolId: string; sessionId: string; limit: number; page?: number; cursor?: string },
  documentTypes: readonly dto.DocumentType[],
) {
  const { currentPage, offset, pageSize } = resolvePaginationInput(input);
  const failedSince = new Date(Date.now() - dto.DOCUMENT_JOB_FAILED_LISTED_DAYS * 24 * 60 * 60 * 1000);
  const where = and(
    eq(documentGenerationJobTable.schoolId, input.schoolId),
    eq(documentGenerationJobTable.sessionId, input.sessionId),
    documentTypes.length ? inArray(documentGenerationJobTable.documentType, [...documentTypes]) : sql`false`,
    or(
      inArray(documentGenerationJobTable.status, ["queued", "running"]),
      and(eq(documentGenerationJobTable.status, "failed"), gt(documentGenerationJobTable.completedAt, failedSince)),
    ),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(documentGenerationJobTable)
      .where(where)
      .orderBy(desc(documentGenerationJobTable.createdAt), desc(documentGenerationJobTable.id))
      .offset(offset)
      .limit(pageSize),
    db.select({ value: count() }).from(documentGenerationJobTable).where(where),
  ]);
  const totalPages = Math.ceil(total!.value / pageSize);
  return createPaginatedResult({
    items: rows.map(serializeDocumentJob),
    totalItems: total!.value,
    currentPage,
    pageSize,
    totalPages,
    nextCursor: createNextPageCursor(currentPage, totalPages),
  });
}
