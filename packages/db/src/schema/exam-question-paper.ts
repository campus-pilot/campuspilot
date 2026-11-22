import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { QuestionPaperNotice } from "@campuspilot/question-paper/hash";
import { QUESTION_PAPER_DETAIL_MAX_CHARS } from "@campuspilot/question-paper/details";
import {
  QUESTION_PAPER_PAGE_ROTATIONS,
  type QuestionPaperPageRotation,
} from "@campuspilot/question-paper/pages";

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
 * Whether the server has made the derivatives of an uploaded image. Its own
 * fact: never inferred from the content type. The worker makes them after the
 * upload (`workflows/image-derivatives`), so a stored image starts `pending`.
 * `ready` = thumbnail and model derivative exist; `unsupported` = sharp could
 * not decode it (HEIC), so the original is stored but neither derivative
 * exists; `failed` = a JPEG, PNG or WebP that could not be decoded, or one the
 * worker did not finish in time: the page must be removed and uploaded again.
 * The same values as chat attachments' own enum.
 */
export const questionPaperPageDerivativeStatusEnum = pgEnum(
  "question_paper_page_derivative_status",
  ["ready", "unsupported", "pending", "failed"],
);

/**
 * Whether a page's bytes have arrived. Its own fact, separate from the
 * derivatives: pages are reserved in the order the user picked them
 * (`awaiting`, no file facts yet) and their photos then upload in parallel
 * into those rows (`stored`), so the paper's page order never depends on which
 * upload finishes first. An `awaiting` row the upload never filled is removed
 * by the sweep (`QUESTION_PAPER_PAGE_RESERVATION_TTL_MS`).
 */
export const questionPaperPageUploadStatusEnum = pgEnum(
  "question_paper_page_upload_status",
  ["awaiting", "stored"],
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
 * `source_job_id` or `source_version_id` is set (`source_version_id` is
 * cleared when the copied version is deleted, the source stays `copy`).
 * - `ai_job`: the generation job wrote it from the uploaded pages.
 * - `agent`: a chat agent (in-app assistant or MCP client) wrote it.
 * - `copy`: a person started this paper from a version of an earlier paper
 *   of the same class and subject (`copyQuestionPaperVersion`).
 */
export const questionPaperVersionSourceEnum = pgEnum(
  "question_paper_version_source",
  ["ai_job", "agent", "copy"],
);

/**
 * What a paper belongs to (docs/personal-space.md). Its own fact, set when the
 * row is created and never changed:
 * - `exam`: the paper of one (session, exam, class, subject, mode) of an exam
 *   plan; the five key columns are set and the school's template prints it.
 * - `standalone`: a paper of a personal space, with no session, exam, class,
 *   subject or mode (the five key columns are null) and no template: the AI
 *   writes the whole paper, heading included, and a built-in plain A4 shell
 *   prints it. Its details (school, class, subject and exam names) are the
 *   `details_*` columns.
 */
export const QUESTION_PAPER_KINDS = ["exam", "standalone"] as const;
export type QuestionPaperKind = (typeof QUESTION_PAPER_KINDS)[number];
export const questionPaperKindEnum = pgEnum("question_paper_kind", QUESTION_PAPER_KINDS);


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
    /** See {@link QUESTION_PAPER_KINDS}. Never changed after the row is created. */
    kind: questionPaperKindEnum("kind").notNull().default("exam"),
    /** The five key columns: all set for an `exam` paper, all null for a `standalone` one (CHECK). */
    sessionId: text("session_id").references(() => schoolSessionTable.id),
    examSlug: text("exam_slug"),
    classId: text("class_id").references(() => classTable.id),
    subjectSlug: text("subject_slug"),
    modeSlug: text("mode_slug"),
    /**
     * The details of a `standalone` paper as its latest saved version states
     * them: the school, class, subject and exam names the paper prints. Not
     * revisioned: every version saved for the paper overwrites all four in
     * the same transaction with the details that save supplied (null for a
     * detail the paper does not state). Null until the first version, and
     * always null for an `exam` paper, whose names come from the exam plan
     * (CHECK). At most {@link QUESTION_PAPER_DETAIL_MAX_CHARS} characters each.
     */
    detailsSchoolName: text("details_school_name"),
    detailsClassName: text("details_class_name"),
    detailsSubjectName: text("details_subject_name"),
    detailsExamName: text("details_exam_name"),
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
    /** A personal space's papers, most recently changed first. */
    index("exam_question_paper_standalone_idx")
      .on(table.schoolId, table.updatedAt)
      .where(sql`${table.kind} = 'standalone'`),
    /** The target of the versions' (paper_id, paper_kind) foreign key. */
    unique("exam_question_paper_id_kind_unique").on(table.id, table.kind),
    check(
      "exam_question_paper_counters_check",
      sql`${table.latestVersionNo} >= 0 and ${table.pageRevision} >= 0`,
    ),
    // Compared as text: a migration may not use an enum value added in the same transaction.
    check(
      "exam_question_paper_kind_key_check",
      sql`case ${table.kind}::text
        when 'exam' then num_nonnulls(${table.sessionId}, ${table.examSlug}, ${table.classId}, ${table.subjectSlug}, ${table.modeSlug}) = 5
          and num_nonnulls(${table.detailsSchoolName}, ${table.detailsClassName}, ${table.detailsSubjectName}, ${table.detailsExamName}) = 0
        else num_nulls(${table.sessionId}, ${table.examSlug}, ${table.classId}, ${table.subjectSlug}, ${table.modeSlug}) = 5
      end`,
    ),
    check(
      "exam_question_paper_details_length_check",
      sql`coalesce(char_length(${table.detailsSchoolName}), 0) <= ${sql.raw(String(QUESTION_PAPER_DETAIL_MAX_CHARS))}
        and coalesce(char_length(${table.detailsClassName}), 0) <= ${sql.raw(String(QUESTION_PAPER_DETAIL_MAX_CHARS))}
        and coalesce(char_length(${table.detailsSubjectName}), 0) <= ${sql.raw(String(QUESTION_PAPER_DETAIL_MAX_CHARS))}
        and coalesce(char_length(${table.detailsExamName}), 0) <= ${sql.raw(String(QUESTION_PAPER_DETAIL_MAX_CHARS))}`,
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
    uploadStatus: questionPaperPageUploadStatusEnum("upload_status")
      .notNull()
      .default("stored"),
    /** Null while `awaiting`: the key's extension comes from the uploaded bytes. */
    originalS3Key: text("original_s3_key").unique(),
    /** The client's file name, display only, sanitised. */
    originalName: text("original_name").notNull(),
    /** Null while `awaiting`, like `byteSize` and `sha256`. */
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    /** Used to warn about a duplicate page in the UI, never a constraint. */
    sha256: text("sha256"),
    /** When the bytes arrived; the worker's deadline for the derivatives runs from here. */
    storedAt: timestamp("stored_at", { withTimezone: true }),
    /**
     * The displayed size: after EXIF orientation and `rotation`, so it is the
     * size of the derivatives' shape. Null when the image could not be decoded
     * and its header states no size.
     */
    width: integer("width"),
    height: integer("height"),
    derivativeStatus: questionPaperPageDerivativeStatusEnum(
      "derivative_status",
    ).notNull(),
    /**
     * Clockwise quarter turns (0, 90, 180, 270) a person applied on top of the
     * photo's EXIF orientation, because a page photographed with the phone held
     * sideways is still on its side after EXIF orientation. Its own fact: the
     * original object is never changed; the thumbnail and the model derivative
     * are made from the original with this turn applied, and `width`/`height`
     * follow it. Only a page whose derivatives exist (`ready`) can be turned.
     */
    rotation: integer("rotation")
      .$type<QuestionPaperPageRotation>()
      .notNull()
      .default(0),
    /**
     * How often the thumbnail and model derivative were made again after the
     * upload (0: they are the upload's own). Bumped with every change of
     * `rotation`. The page image URLs carry it, so a browser never shows a
     * cached redirect to an earlier turn's (deleted) objects. Its own counter:
     * never inferred from `rotation` (turning right and back left returns to
     * the same rotation with new objects).
     */
    derivativeRevision: integer("derivative_revision").notNull().default(0),
    thumbS3Key: text("thumb_s3_key"),
    /**
     * The stored thumbnail's size in bytes, written with `thumb_s3_key`. A
     * fact of its own so a personal space's storage quota adds what is
     * stored instead of estimating it (docs/personal-space.md). Null while
     * there is no thumbnail, and for thumbnails made before this column
     * existed (exam papers only: no personal space predates it).
     */
    thumbByteSize: integer("thumb_byte_size"),
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
      "exam_question_paper_page_thumb_size_check",
      sql`${table.thumbByteSize} is null or (${table.thumbS3Key} is not null and ${table.thumbByteSize} >= 1)`,
    ),
    check(
      "exam_question_paper_page_rotation_check",
      sql`${table.rotation} in (${sql.raw(QUESTION_PAPER_PAGE_ROTATIONS.join(", "))}) and (${table.rotation} = 0 or ${table.derivativeStatus} = 'ready') and ${table.derivativeRevision} >= 0`,
    ),
    check(
      "exam_question_paper_page_size_check",
      sql`${table.position} >= 1 and (${table.byteSize} is null or ${table.byteSize} between 1 and ${sql.raw(String(MAX_PAGE_BYTES))})`,
    ),
    // A stored page has every file fact; an awaiting one has none and nothing derived from it. The status is
    // compared as text: a migration may not use an enum value added in the same transaction.
    check(
      "exam_question_paper_page_upload_check",
      sql`(${table.uploadStatus} = 'stored') = (${table.originalS3Key} is not null and ${table.contentType} is not null and ${table.byteSize} is not null and ${table.sha256} is not null and ${table.storedAt} is not null) and (${table.uploadStatus} = 'stored' or ${table.derivativeStatus}::text = 'pending')`,
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
    /**
     * The teacher's instructions for this generation ("Keep the questions but
     * change the numbers"), as `startQuestionPaperGeneration` accepted them
     * (trimmed, at most 2,000 characters, no control characters besides line
     * feed and tab). Its own fact: null means the job was started without any
     * and only transcribes, never inferred from anything else. Written when
     * the job is created and never changed, so every attempt and every replay
     * of the job sends the model the same text.
     */
    instructions: text("instructions"),
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
 * One immutable saved version of the paper (D19, D20, D32): the HTML fragment a
 * model wrote, as cleaned by the `question_paper_body` sanitiser when it was
 * saved. `plan_max_marks`, `template_revision_id` and `pdf_artifact_id` are stored
 * facts, never recomputed from state that can change later (the plan, the
 * selected template, S3).
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
    /**
     * The kind of the paper this version belongs to, held here so the
     * version's own CHECK can tie `template_revision_id` to it. A foreign key
     * on (paper_id, paper_kind) keeps it equal to the paper's `kind`.
     */
    paperKind: questionPaperKindEnum("paper_kind").notNull().default("exam"),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    versionNo: integer("version_no").notNull(),
    /**
     * The sanitised HTML fragment (never a full document). Immutable. It is
     * sanitised again whenever it is rendered; KaTeX and figures are added only
     * then, so nothing rendered is stored here.
     */
    contentHtml: text("content_html").notNull(),
    /** SHA-256 of the canonical fragment (NFC, LF, trimmed): duplicate detection. */
    contentSha256: text("content_sha256").notNull(),
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
    /**
     * The version a `copy` was made from (another paper of the same school,
     * class and subject). `ON DELETE SET NULL`: the source paper can be deleted
     * later (`deleteQuestionPaper`, `deleteExamPlan`, the demo purge) and the
     * copy must survive it, so the reference may neither cascade nor block the
     * delete. The copy never needs the source again: its fragment is stored
     * here and its figures were copied into this paper. Null for every other
     * source, and for a copy whose source version is gone (`source` stays
     * `copy`).
     */
    sourceVersionId: text("source_version_id").references(
      (): AnyPgColumn => examQuestionPaperVersionTable.id,
      { onDelete: "set null" },
    ),
    /**
     * The mode's maximum marks in the exam plan at save time. A snapshot of the
     * header fact the template prints ("Maximum marks"), so a restored PDF or an
     * old preview never changes when the plan is edited. Not computed from the
     * paper: nothing adds up a paper's marks any more.
     */
    planMaxMarks: integer("plan_max_marks"),
    /**
     * What the sanitiser removed or changed when this version was saved, one
     * entry per kind. Notices, not errors: the version saved without them.
     */
    warnings: jsonb("warnings")
      .$type<QuestionPaperNotice[]>()
      .notNull()
      .default([]),
    /**
     * The template revision rendered into the PDF. Null exactly for a version
     * of a `standalone` paper, which is printed in the built-in plain shell
     * and has no template (CHECK on `paper_kind`).
     */
    templateRevisionId: text("template_revision_id").references(() => artifactTable.id),
    /**
     * The stored PDF (D17). Null only when the artifact was deleted; the
     * download then re-renders from `content_html` and the pinned revision.
     */
    pdfArtifactId: text("pdf_artifact_id").references(() => artifactTable.id, {
      onDelete: "set null",
    }),
    /**
     * The stored Word (.docx) file of this version, its own fact (never
     * derived from the PDF). Null until the version's first Word download
     * makes it from `content_html`, the stored figures and the pinned
     * revision, and null again when the artifact is deleted: the next Word
     * download then makes it again (docs/question-papers.md "Word download").
     */
    docxArtifactId: text("docx_artifact_id").references(() => artifactTable.id, {
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
    index("exam_question_paper_version_docx_idx").on(table.docxArtifactId),
    index("exam_question_paper_version_source_version_idx").on(
      table.sourceVersionId,
    ),
    check("exam_question_paper_version_no_check", sql`${table.versionNo} >= 1`),
    foreignKey({
      name: "exam_question_paper_version_paper_kind_fk",
      columns: [table.paperId, table.paperKind],
      foreignColumns: [examQuestionPaperTable.id, examQuestionPaperTable.kind],
    }).onDelete("cascade"),
    // Compared as text, as above.
    check(
      "exam_question_paper_version_template_check",
      sql`(${table.paperKind}::text = 'standalone') = (${table.templateRevisionId} is null)`,
    ),
    // Only a copy names a source version; a copy may have none once its source was deleted. Compared as text: an
    // enum value added in a migration cannot be used (cast to the enum) in the transaction that adds it, and the
    // migrator applies every pending migration in one transaction.
    check(
      "exam_question_paper_version_source_version_check",
      sql`${table.sourceVersionId} is null or ${table.source}::text = 'copy'`,
    ),
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
    /**
     * The figure of another paper it was copied from when a version was
     * copied (`copyQuestionPaperVersion`). A plain value, not a foreign key:
     * the source paper and its figures can be deleted and this copy keeps its
     * own object. Deduplicates a repeated copy of the same source figure into
     * this paper.
     */
    sourceFigureId: text("source_figure_id"),
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
      "exam_question_paper_figure_source_check",
      sql`num_nonnulls(${table.sourceAttachmentId}, ${table.sourceFigureId}) <= 1`,
    ),
    check(
      "exam_question_paper_figure_content_type_check",
      sql`${table.contentType} in ('image/jpeg', 'image/png')`,
    ),
  ],
);
