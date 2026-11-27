import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { schoolTable } from "./school";

/**
 * WhatsApp media IDs of PDFs that are the same for every recipient (a
 * published notice, a timetable publication), so a send to thousands of
 * students uploads the file to Meta once instead of once per message.
 *
 * One row per (sending phone number, shared document): `share_key` is the
 * S3 object key of the immutable cached PDF (`NotificationDocument.shareKey`
 * in the API), and Meta's media IDs belong to the phone number that
 * uploaded them. Per-student documents (bills, receipts) are never stored
 * here. Meta keeps uploaded media for 30 days, so a row is reused only while
 * `uploaded_at` is younger than the API's reuse window and replaced by the
 * next fresh upload after that. Rows are a cache: losing one only costs an
 * upload.
 */
export const whatsappMediaUploadTable = pgTable(
  "whatsapp_media_upload",
  {
    /** The Cloud API phone number ID that uploaded the media. */
    phoneNumberId: text("phone_number_id").notNull(),
    /** The S3 object key of the shared PDF. */
    shareKey: text("share_key").notNull(),
    /**
     * The school the document belongs to. A cache of the school's own
     * documents, so it goes with the school (and with a demo purge).
     */
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /** Meta's media ID, sent in the template's document header. */
    mediaId: text("media_id").notNull(),
    /** When Meta accepted the upload; the reuse window counts from here. */
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.phoneNumberId, table.shareKey] }),
    index("whatsapp_media_upload_school_id_idx").on(table.schoolId),
  ],
);

export type WhatsAppMediaUploadRow = typeof whatsappMediaUploadTable.$inferSelect;
