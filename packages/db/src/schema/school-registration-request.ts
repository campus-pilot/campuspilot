import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { leadAlertStatusEnum } from "./lead";

/**
 * One submission of the website's School Onboarding form (`/onboarding`): a
 * school sending what we need to set it up. The answers are kept as
 * submitted in `response` (JSONB), so a new or changed question needs no
 * migration; `form_version` says which revision of the questions produced
 * them.
 *
 * The logo and the voice note are private S3 objects under
 * `school-registration-requests/{id}/`, written before the row and read by
 * platform admins through short-lived presigned URLs. Each file's key,
 * media type and size are their own columns: a request has a logo exactly
 * when `logo_s3_key` is set, whatever the answers say.
 *
 * The row is also the outbox of its WhatsApp alert to the CampusPilot team,
 * as a lead is (`alert_*`, docs/leads.md): committed `pending`, handed to
 * Restate after commit, and never waited for by the submission.
 *
 * A request is not school data: it names no school row (the school set up
 * from it is on `school_setup`), and the demo purge never touches it.
 */
export const schoolRegistrationRequestTable = pgTable(
  "school_registration_request",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolRegistrationRequest")),
    /** Revision of the form's questions, so old answers stay readable. */
    formVersion: integer("form_version").notNull(),
    /**
     * Idempotency key the browser generates once per form fill. A retried
     * submission (lost response, flaky network) finds this row instead of
     * creating a second one.
     */
    submissionId: text("submission_id").notNull(),
    /** The answers exactly as validated, keyed by question. */
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    logoS3Key: text("logo_s3_key"),
    /** Media type decided from the logo's bytes, never the browser's claim. */
    logoContentType: text("logo_content_type"),
    logoBytes: integer("logo_bytes"),
    voiceNoteS3Key: text("voice_note_s3_key"),
    /** Media type decided from the voice note's bytes, never the browser's claim. */
    voiceNoteContentType: text("voice_note_content_type"),
    voiceNoteBytes: integer("voice_note_bytes"),
    /** The page path the form was submitted from, when the browser sent it. */
    sourcePath: text("source_path"),
    /** The submitting browser's user agent, truncated; for spotting abuse. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    alertStatus: leadAlertStatusEnum("alert_status").notNull().default("pending"),
    /** When Restate durably accepted the alert. Its own fact: accepted does not mean sent. */
    alertHandedOverAt: timestamp("alert_handed_over_at", { withTimezone: true }),
    /** Hand-over attempts of the alert, successful or not. */
    alertHandoverAttempts: integer("alert_handover_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over, shown while it is retried. */
    alertLastHandoverError: text("alert_last_handover_error"),
    /** When WhatsApp accepted the alert message. */
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
    /** The WhatsApp message id (`wamid`) of the sent alert. */
    alertMessageId: text("alert_message_id"),
    /** Safe reason the alert failed for good (no secrets). */
    alertError: text("alert_error"),
  },
  (table) => [
    uniqueIndex("school_registration_request_submission_id_unique").on(table.submissionId),
    index("school_registration_request_created_at_idx").on(table.createdAt),
    index("school_registration_request_alert_unsent_idx")
      .on(table.createdAt)
      .where(sql`${table.alertStatus} = 'pending' and ${table.alertHandedOverAt} is null`),
  ],
);

export type SchoolRegistrationRequest = typeof schoolRegistrationRequestTable.$inferSelect;
