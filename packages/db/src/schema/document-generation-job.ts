import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { generateId } from "../id";
import { artifactTable, documentTypeEnum } from "./artifact";
import { schoolTable } from "./school";

export const documentGenerationJobStatusEnum = pgEnum(
  "document_generation_job_status",
  ["queued", "running", "succeeded", "failed"],
);

/**
 * One ledger account's high-water sequence at the moment a finance document
 * job was accepted. The worker reads ledger facts of that account only up to
 * this sequence, so every batch of a bill, receipt or statement export
 * describes the moment the user pressed Generate, whatever was posted while
 * the job waited (docs/document-system.md "Generation jobs").
 */
export type DocumentLedgerCutoff = {
  admissionId: string;
  currency: string;
  highWaterSequence: string;
};

/**
 * A durable PDF generation (docs/document-system.md "Generation jobs"). The
 * API writes a `queued` row after authorizing and validating the request and
 * returns at once; the row is also the outbox the API sweep re-sends to
 * Restate. The worker (`workflows/document-generation`) renders the documents
 * in batches and creates exactly one `artifact` with the reserved
 * `artifact_id`. Every column is written when the job is created and never
 * changed, except the progress, outcome and outbox columns.
 */
export const documentGenerationJobTable = pgTable(
  "document_generation_job",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("documentGenerationJob")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    /** The source's session, a historical id like `artifact.session_id` (not a foreign key). */
    sessionId: text("session_id").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    /** A user id with no foreign key: the job and its PDF outlive the account. */
    requestedBy: text("requested_by").notNull(),
    status: documentGenerationJobStatusEnum("status")
      .notNull()
      .default("queued"),
    /** The `DocumentSource` exactly as `generateDocument` accepted it (strict union, parsed again by the worker). */
    source: jsonb("source").$type<Record<string, unknown>>().notNull(),
    /** The immutable template revision checked at start; the worker renders with it even if the school selects another. */
    templateRevisionId: text("template_revision_id")
      .notNull()
      .references(() => artifactTable.id),
    /**
     * The id the PDF's `artifact` row gets, reserved at start so the PDF's
     * storage key is known before it exists and a repeated finish step can
     * never create a second artifact. Not a foreign key: the artifact does not
     * exist until the job succeeds, and it may be deleted from history later.
     */
    artifactId: text("artifact_id").notNull().unique(),
    /** The document's display name, as decided at start (the artifact is named by the worker's own read). */
    name: text("name").notNull(),
    /** Documents (one per student, bill, receipt or statement; one timetable) the source had at start. */
    documentCount: integer("document_count").notNull(),
    /** Warnings the start read produced (for example excluded students). */
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    /** The `generatedAt` every document of the job prints: the moment the request was accepted. */
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    /** Statements only: the review hash the caller presented and the start read matched. */
    reviewHash: text("review_hash"),
    /** Finance documents only: per-account ledger cutoff pinned at start (see {@link DocumentLedgerCutoff}). */
    ledgerCutoff: jsonb("ledger_cutoff").$type<DocumentLedgerCutoff[] | null>(),
    /** Set by the worker once the documents are split into batches. */
    batchCount: integer("batch_count"),
    batchesDone: integer("batches_done").notNull().default(0),
    /** Machine code (`DOCUMENT_GENERATION_JOB_FAILURES`). */
    errorCode: text("error_code"),
    /** Safe, user-facing text. */
    errorMessage: text("error_message"),
    /** Raw error for developers and logs only. Never shown to users. */
    errorDetail: text("error_detail"),
    /** Outbox: when Restate accepted the start. */
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    handoverAttempts: integer("handover_attempts").notNull().default(0),
    lastHandoverError: text("last_handover_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * When the job's temporary objects (`schools/{schoolId}/document-jobs/{jobId}/`)
     * were removed. The worker removes them when the job ends; the API sweep
     * removes them for an ended job where this is still null (a worker that
     * died, a job the sweep failed).
     */
    temporaryObjectsDeletedAt: timestamp("temporary_objects_deleted_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    index("document_generation_job_school_session_idx").on(
      table.schoolId,
      table.sessionId,
      table.createdAt,
    ),
    index("document_generation_job_template_idx").on(table.templateRevisionId),
    // At most one running job per school; Restate's per-school queue keeps the rest waiting.
    uniqueIndex("document_generation_job_running_school_unique")
      .on(table.schoolId)
      .where(sql`${table.status} = 'running'`),
    index("document_generation_job_unsent_idx")
      .on(table.createdAt)
      .where(sql`${table.handedOverAt} is null and ${table.status} = 'queued'`),
    index("document_generation_job_unstarted_idx")
      .on(table.handedOverAt)
      .where(sql`${table.startedAt} is null and ${table.status} = 'queued'`),
    index("document_generation_job_running_idx")
      .on(table.startedAt)
      .where(sql`${table.status} = 'running'`),
    index("document_generation_job_cleanup_idx")
      .on(table.completedAt)
      .where(
        sql`${table.temporaryObjectsDeletedAt} is null and ${table.status} in ('succeeded', 'failed')`,
      ),
    check(
      "document_generation_job_facts_check",
      sql`(${table.status} in ('succeeded', 'failed')) = (${table.completedAt} is not null)
        and (${table.status} = 'failed') = (${table.errorCode} is not null)
        and (${table.status} <> 'queued' or ${table.startedAt} is null)
        and (${table.status} not in ('running', 'succeeded') or ${table.startedAt} is not null)`,
    ),
    check(
      "document_generation_job_progress_check",
      sql`${table.batchesDone} >= 0 and (${table.batchCount} is null or (${table.batchCount} >= 1 and ${table.batchesDone} <= ${table.batchCount}))`,
    ),
    check(
      "document_generation_job_documents_check",
      sql`${table.documentCount} >= 1`,
    ),
  ],
);
