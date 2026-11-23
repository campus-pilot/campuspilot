import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { generateId } from "../id";

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
 * A request is not school data: it names no school row, and the demo purge
 * never touches it.
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
  },
  (table) => [
    uniqueIndex("school_registration_request_submission_id_unique").on(table.submissionId),
    index("school_registration_request_created_at_idx").on(table.createdAt),
  ],
);

export type SchoolRegistrationRequest = typeof schoolRegistrationRequestTable.$inferSelect;
