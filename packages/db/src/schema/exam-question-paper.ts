import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { QuestionPaperWarning } from "@campuspilot/question-paper/marks";
import type { QuestionPaper } from "@campuspilot/question-paper/schema";

import { generateId } from "../id";
import { artifactTable } from "./artifact";
import { assistantModelProviderEnum } from "./assistant";
import { user } from "./auth";
import { classTable } from "./class";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";

/**
 * Question papers (docs/question-papers.md, written in the last phase of the
 * feature; the design is `.sks/handlebar-based-question-paper-generation`).
 *
 * A paper is one fact per (session, exam, class, subject, mode). The exam
 * lives in the session config JSON and plans can be deleted and regenerated,
 * so a paper is keyed by the plan's natural key and has NO foreign key to
 * `exam_plan`: the API validates the plan and the mode at write time.
 */

/**
 * Whether the server could decode an uploaded image. Its own fact: never
 * inferred from the content type. `ready` = thumbnail and model derivative
 * exist; `unsupported` = sharp could not decode it (HEIC), so the original is
 * stored but neither derivative exists. Shared with chat attachments.
 */
export const questionPaperPageDerivativeStatusEnum = pgEnum(
  "question_paper_page_derivative_status",
  ["ready", "unsupported"],
);

/** Lifecycle of one durable generation request. */
export const questionPaperJobStatusEnum = pgEnum("question_paper_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/**
 * Who authored a saved version. Its own fact: not inferred from whether
 * `source_job_id` is set.
 */
export const questionPaperVersionSourceEnum = pgEnum(
  "question_paper_version_source",
  ["ai_job", "agent"],
);

/** The largest accepted original image (D24). */
const MAX_PAGE_BYTES = 15 * 1024 * 1024;

/**
 * The paper of one class + subject + mode of an exam. Created lazily by the
 * first upload or the first agent save. Deleting it cascades pages, jobs,
 * versions and figures; the API removes S3 objects and PDF artifacts.
 */
export const examQuestionPaperTable = pgTable(
  "exam_question_paper",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examQuestionPaper")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text("exam_slug").notNull(),
    classId: text("class_id")
      .notNull()
      .references(() => classTable.id),
    subjectSlug: text("subject_slug").notNull(),
    modeSlug: text("mode_slug").notNull(),
    /**
     * Counts the saved versions; the `expectedVersionNo` optimistic-concurrency
     * token of `saveQuestionPaperVersion`. Its own column, not `max(version_no)`
     * (deleting versions must never reuse a number).
     */
    latestVersionNo: integer("latest_version_no").notNull().default(0),
    /**
     * Bumped on every page add, delete and reorder; the
     * `expectedPageRevision` token of reorder and generate.
     */
    pageRevision: integer("page_revision").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("exam_question_paper_unique").on(
      table.sessionId,
      table.examSlug,
      table.classId,
      table.subjectSlug,
      table.modeSlug,
    ),
    index("exam_question_paper_grid_idx").on(
      table.schoolId,
      table.sessionId,
      table.examSlug,
      table.classId,
    ),
    index("exam_question_paper_class_idx").on(table.classId),
    index("exam_question_paper_created_by_idx").on(table.createdBy),
    check(
      "exam_question_paper_counters_check",
      sql`${table.latestVersionNo} >= 0 and ${table.pageRevision} >= 0`,
    ),
  ],
);

/**
 * One uploaded photo of the handwritten paper (D4-D6, D25). Order is the
 * `position` column, rewritten in one transaction under the paper row lock
 * (no unique constraint: it would buy nothing under that lock). The 20-page
 * cap cannot be a CHECK (it counts siblings); the upload handler enforces it
 * under the same lock.
 */
export const examQuestionPaperPageTable = pgTable(
  "exam_question_paper_page",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examQuestionPaperPage")),
    paperId: text("paper_id")
      .notNull()
      .references(() => examQuestionPaperTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    /** 1-based order within the paper. */
    position: integer("position").notNull(),
    originalS3Key: text("original_s3_key").notNull().unique(),
    /** The client's file name, display only, sanitised. */
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Used to warn about a duplicate page in the UI, never a constraint. */
    sha256: text("sha256").notNull(),
    /** Null when the image could not be decoded. */
    width: integer("width"),
    height: integer("height"),
    derivativeStatus: questionPaperPageDerivativeStatusEnum(
      "derivative_status",
    ).notNull(),
    thumbS3Key: text("thumb_s3_key"),
    modelS3Key: text("model_s3_key"),
    modelContentType: text("model_content_type"),
    modelByteSize: integer("model_byte_size"),
    uploadedBy: text("uploaded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("exam_question_paper_page_order_idx").on(
      table.paperId,
      table.position,
    ),
    index("exam_question_paper_page_school_idx").on(table.schoolId),
    index("exam_question_paper_page_uploaded_by_idx").on(table.uploadedBy),
    check(
      "exam_question_paper_page_derivative_check",
      sql`(${table.derivativeStatus} = 'ready') = (${table.thumbS3Key} is not null and ${table.modelS3Key} is not null)`,
    ),
    check(
      "exam_question_paper_page_size_check",
      sql`${table.byteSize} between 1 and ${sql.raw(String(MAX_PAGE_BYTES))} and ${table.position} >= 1`,
    ),
    check(
      "exam_question_paper_page_content_type_check",
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')`,
    ),
  ],
);

/**
 * A durable generation request (D28), also the outbox row the API hands to
 * the worker. At most one in-flight job per paper. Cost rows reference a job
 * by a plain text value, never an FK, so deleting a paper never drops spend.
 */
export const examQuestionPaperJobTable = pgTable(
  "exam_question_paper_job",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examQuestionPaperJob")),
    paperId: text("paper_id")
      .notNull()
      .references(() => examQuestionPaperTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    /** A user id with no FK: cost rows keep it after the account is gone. */
    requestedBy: text("requested_by").notNull(),
    status: questionPaperJobStatusEnum("status").notNull().default("queued"),
    /**
     * The ordered snapshot of pages the job reads, so a later reorder never
     * changes a running job. Historical ids, deliberately not FKs.
     */
    pageIds: jsonb("page_ids").$type<string[]>().notNull(),
    /** The `page_revision` the request was made against. */
    pageRevision: integer("page_revision").notNull(),
    /** Retry counter, part of the provider idempotency keys. */
    attempt: integer("attempt").notNull().default(1),
    /** Set when the job starts. */
    provider: assistantModelProviderEnum("provider"),
    /** The answered model of the latest request. */
    model: text("model"),
    /** Includes the repair call. */
    modelRequestCount: integer("model_request_count").notNull().default(0),
    /** Machine code, see the design's B4 list. */
    errorCode: text("error_code"),
    /** Safe, user-facing text. */
    errorMessage: text("error_message"),
    /** Raw error for developers and logs only. Never shown to users. */
    errorDetail: text("error_detail"),
    /** The version this job produced (cleared if that version is deleted). */
    versionId: text("version_id").references(
      (): AnyPgColumn => examQuestionPaperVersionTable.id,
      { onDelete: "set null" },
    ),
    /** Outbox: when Restate accepted the start. */
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    handoverAttempts: integer("handover_attempts").notNull().default(0),
    lastHandoverError: text("last_handover_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("exam_question_paper_job_active_unique")
      .on(table.paperId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("exam_question_paper_job_paper_idx").on(
      table.paperId,
      table.createdAt,
    ),
    index("exam_question_paper_job_school_idx").on(table.schoolId),
    index("exam_question_paper_job_version_idx").on(table.versionId),
    index("exam_question_paper_job_unsent_idx")
      .on(table.createdAt)
      .where(sql`${table.handedOverAt} is null and ${table.status} = 'queued'`),
    index("exam_question_paper_job_unstarted_idx")
      .on(table.handedOverAt)
      .where(sql`${table.startedAt} is null and ${table.status} = 'queued'`),
    index("exam_question_paper_job_running_idx")
      .on(table.startedAt)
      .where(sql`${table.status} = 'running'`),
    check(
      "exam_question_paper_job_facts_check",
      sql`(${table.status} in ('succeeded', 'failed')) = (${table.completedAt} is not null)
        and (${table.status} = 'failed') = (${table.errorCode} is not null)`,
    ),
  ],
);

/**
 * One immutable saved version of the structured document (D19, D20, D32).
 * `total_marks`, `plan_max_marks`, `template_revision_id` and
 * `pdf_artifact_id` are stored facts, never recomputed from state that can
 * change later (the plan, the selected template, S3).
 */
export const examQuestionPaperVersionTable = pgTable(
  "exam_question_paper_version",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examQuestionPaperVersion")),
    paperId: text("paper_id")
      .notNull()
      .references(() => examQuestionPaperTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    versionNo: integer("version_no").notNull(),
    /** The structured document. Immutable. */
    content: jsonb("content").$type<QuestionPaper>().notNull(),
    /** SHA-256 of the canonical JSON: draft ids and duplicate detection. */
    contentSha256: text("content_sha256").notNull(),
    /** Copy of `content.schemaVersion` so migrations can query it. */
    schemaVersion: integer("schema_version").notNull(),
    source: questionPaperVersionSourceEnum("source").notNull(),
    /**
     * The job that produced this version. Unique, which makes the worker's
     * save idempotent: a retried save is a no-op.
     */
    sourceJobId: text("source_job_id")
      .references((): AnyPgColumn => examQuestionPaperJobTable.id, {
        onDelete: "set null",
      })
      .unique(),
    /** Pages the AI job read (historical ids). */
    sourcePageIds: jsonb("source_page_ids").$type<string[]>(),
    /** Chat provenance of an `agent` save. A plain value: conversations are soft-deleted. */
    sourceConversationId: text("source_conversation_id"),
    /** Marks total computed from `content` at save time. */
    totalMarks: numeric("total_marks", {
      precision: 8,
      scale: 2,
      mode: "number",
    }),
    /** The mode's max marks from the plan at save time (snapshot). */
    planMaxMarks: integer("plan_max_marks"),
    warnings: jsonb("warnings")
      .$type<QuestionPaperWarning[]>()
      .notNull()
      .default([]),
    /** The template revision rendered into the PDF. */
    templateRevisionId: text("template_revision_id")
      .notNull()
      .references(() => artifactTable.id),
    /**
     * The stored PDF (D17). Null only when the artifact was deleted; the
     * download then re-renders from `content` and the pinned revision.
     */
    pdfArtifactId: text("pdf_artifact_id").references(() => artifactTable.id, {
      onDelete: "set null",
    }),
    /** A user id with no FK. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("exam_question_paper_version_unique").on(
      table.paperId,
      table.versionNo,
    ),
    index("exam_question_paper_version_order_idx").on(
      table.paperId,
      table.versionNo.desc(),
    ),
    index("exam_question_paper_version_school_idx").on(table.schoolId),
    index("exam_question_paper_version_template_idx").on(
      table.templateRevisionId,
    ),
    index("exam_question_paper_version_pdf_idx").on(table.pdfArtifactId),
    check("exam_question_paper_version_no_check", sql`${table.versionNo} >= 1`),
  ],
);

/**
 * An uploaded figure image owned by a paper (D22, D39). Chat attachments
 * must not be the paper's lifetime anchor, so a figure is copied here when a
 * version is saved; stored content only ever holds `qpf_` ids. Max 30 per
 * paper, enforced when saving.
 */
export const examQuestionPaperFigureTable = pgTable(
  "exam_question_paper_figure",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examQuestionPaperFigure")),
    paperId: text("paper_id")
      .notNull()
      .references(() => examQuestionPaperTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    s3Key: text("s3_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    /** The chat attachment it was copied from (plain value). */
    sourceAttachmentId: text("source_attachment_id"),
    /** A user id with no FK. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("exam_question_paper_figure_paper_idx").on(table.paperId),
    index("exam_question_paper_figure_school_idx").on(table.schoolId),
    check(
      "exam_question_paper_figure_content_type_check",
      sql`${table.contentType} in ('image/jpeg', 'image/png')`,
    ),
  ],
);
