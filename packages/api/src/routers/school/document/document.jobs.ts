import type { Database } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import { documentGenerationJobTable } from "@campuspilot/db/schema/document-generation-job";
import { and, desc, eq, gt, inArray, notInArray, or } from "drizzle-orm";

import { rpcError } from "../../../errors";
import { handOffDocumentJob } from "../../../workflows/document-generation/outbox";
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
 * did: the selected template revision (CONFLICT when it changed), the
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
  const template = await selectedDocumentTemplateRevision(
    db,
    { schoolId: input.schoolId, documentType: input.source.documentType },
    input.templateRevisionId,
  );
  const generatedAt = new Date();
  const data = await resolveDocumentSource(db, input.schoolId, input.source, { images: "reference", generatedAt });
  if (input.source.documentType === "statement") {
    if (!input.source.expectedReviewHash)
      throw rpcError.badRequest("Preview the statement before generating it.");
    if (input.source.expectedReviewHash !== data.reviewHash)
      throw rpcError.conflict("The statement changed after preview. Preview it again before generating.");
  }
  if (data.contexts.length > dto.MAX_DOCUMENT_SOURCE_ITEMS)
    throw rpcError.badRequest(
      `This selection has ${data.contexts.length.toLocaleString("en-IN")} documents. Create at most ${dto.MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} at a time.`,
    );
  const [row] = await db
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
      reviewHash: input.source.documentType === "statement" ? data.reviewHash : null,
      ledgerCutoff: data.ledgerCutoff,
    })
    .returning();
  const dispatch = options.dispatch ?? ((jobId: string) => handOffDocumentJob(db, jobId));
  dispatch(row!.id);
  return serializeDocumentJob(row!);
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

/** Most jobs one list returns; a session rarely has more than a few in flight. */
const LISTED_JOBS = 50;

/**
 * The session's jobs that History shows next to its PDFs: queued and running
 * jobs, and jobs that failed in the last `DOCUMENT_JOB_FAILED_LISTED_DAYS`
 * days, newest first. A job that succeeded is not listed: its PDF is.
 */
export async function listDocumentJobs(db: Database, input: { schoolId: string; sessionId: string; documentDomain: "academic" | "finance" | "all" }) {
  const finance = ["bill", "receipt", "statement"] as const;
  const failedSince = new Date(Date.now() - dto.DOCUMENT_JOB_FAILED_LISTED_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(documentGenerationJobTable)
    .where(
      and(
        eq(documentGenerationJobTable.schoolId, input.schoolId),
        eq(documentGenerationJobTable.sessionId, input.sessionId),
        input.documentDomain === "finance"
          ? inArray(documentGenerationJobTable.documentType, [...finance])
          : input.documentDomain === "academic"
            ? notInArray(documentGenerationJobTable.documentType, [...finance])
            : undefined,
        or(
          inArray(documentGenerationJobTable.status, ["queued", "running"]),
          and(eq(documentGenerationJobTable.status, "failed"), gt(documentGenerationJobTable.completedAt, failedSince)),
        ),
      ),
    )
    .orderBy(desc(documentGenerationJobTable.createdAt), desc(documentGenerationJobTable.id))
    .limit(LISTED_JOBS);
  return { items: rows.map(serializeDocumentJob) };
}
