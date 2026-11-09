import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";

/**
 * Per-channel delivery forecast taken when staff pressed "Publish results"
 * (D-26): how many copies were going to be owed and why the others were
 * skipped. Keys are channel names and skip reasons; values are counts.
 */
export type ResultPublicationChannelSnapshot = {
  owed: number;
  skipped: Record<string, number>;
};
export type ResultPublicationSnapshot = {
  recipientCount: number;
  channels: Record<string, ResultPublicationChannelSnapshot>;
};

/**
 * Settled WhatsApp outcome of a publication, per student (each student has
 * exactly one WhatsApp delivery row, owed or skipped): `failed` also counts
 * students whose fan-out failed or whose delivery stayed unresolved.
 */
export type ResultPublicationOutcome = {
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
};

/**
 * The results notification batch of an examination (D-10, D-43): written by
 * the examination's **first** release to the Cadet Portal
 * (`releaseExamToCadet`), in the same transaction as the release, at most
 * one per exam (unique school/session/exam). It is the record that the
 * students were notified: a withdraw leaves it in place and a later
 * re-release finds it and notifies nobody again. A release that addresses
 * no registered student writes none (`admission_ids` is never empty).
 *
 * The recipients are snapshotted at release time (`admission_ids`, D-26);
 * one `exam.results_published` notification event per student is emitted in
 * the same transaction with the key `exam-results:<publicationId>:<admissionId>`.
 * `finished_at` / `outcome` are set by the API sweep once every one of those
 * deliveries has settled, together with the `exam.results_publish_finished`
 * staff notification to `published_by`.
 */
export const examResultPublicationTable = pgTable(
  "exam_result_publication",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examResultPublication")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text("exam_slug").notNull(),
    /** Exam name at release time (exam definitions live in session config and can be renamed). */
    examName: text("exam_name").notNull(),
    /** Staff member who released the results; null after the account is deleted. */
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The admissions addressed, in order, as resolved at release time. */
    admissionIds: jsonb("admission_ids").$type<string[]>().notNull(),
    /** The forecast taken at release time. */
    snapshot: jsonb("snapshot").$type<ResultPublicationSnapshot>().notNull(),
    /** When every delivery had settled and the publisher was notified. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: jsonb("outcome").$type<ResultPublicationOutcome>(),
    /**
     * When the API sweep last checked whether this publication settled. The
     * sweep checks the least recently checked first, so publications whose
     * deliveries are still retrying cannot starve newer ones.
     */
    settleCheckedAt: timestamp("settle_checked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("exam_result_publication_exam_unique").on(
      table.schoolId,
      table.sessionId,
      table.examSlug,
    ),
    index("exam_result_publication_unfinished_idx")
      .on(table.publishedAt)
      .where(sql`${table.finishedAt} is null`),
    check(
      "exam_result_publication_outcome_check",
      sql`(${table.finishedAt} is null) = (${table.outcome} is null)`,
    ),
    check(
      "exam_result_publication_recipients_check",
      sql`jsonb_typeof(${table.admissionIds}) = 'array' and jsonb_array_length(${table.admissionIds}) > 0`,
    ),
  ],
);

export type ExamResultPublicationRow = typeof examResultPublicationTable.$inferSelect;
