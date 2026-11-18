import { sql } from "drizzle-orm";
import {
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

/** Where the WhatsApp alert of a lead stands. */
export const leadAlertStatusEnum = pgEnum("lead_alert_status", [
  "pending",
  "sent",
  "failed",
]);

/**
 * One marketing lead, such as a demo request from the website. The form's
 * answers are kept as submitted in `response` (JSONB), so a new or changed
 * form question needs no migration; `form` and `form_version` say which form
 * and which revision of it produced the answers.
 *
 * The row is also the outbox of the lead's WhatsApp alert to the CampusPilot
 * team: the public route commits it with `alert_status = 'pending'` and hands
 * the alert to Restate after commit. The submission never waits for the
 * alert; a lead is saved even when every side effect fails.
 */
export const leadTable = pgTable(
  "lead",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("lead")),
    /** The form that produced this lead (for example `book_demo`). */
    form: text("form").notNull(),
    /** Revision of that form's questions, so old answers stay readable. */
    formVersion: integer("form_version").notNull(),
    /**
     * Idempotency key the browser generates once per form fill. A retried
     * submission (lost response, flaky network) finds this row instead of
     * creating a second lead.
     */
    submissionId: text("submission_id").notNull(),
    /** The answers exactly as validated, keyed by question. */
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    /** The page path the form was submitted from, when the browser sent it. */
    sourcePath: text("source_path"),
    /** The submitting browser's user agent, truncated; for spotting abuse. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    alertStatus: leadAlertStatusEnum("alert_status").notNull().default("pending"),
    /**
     * When Restate durably accepted the alert (a one-way send to
     * `LeadControl.scheduleAlert`). Its own fact: accepted does not mean a
     * worker has run it, and the worker need not be running.
     */
    alertHandedOverAt: timestamp("alert_handed_over_at", { withTimezone: true }),
    /** Hand-over attempts of the alert, successful or not. */
    alertHandoverAttempts: integer("alert_handover_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over, shown while it is retried. */
    alertLastHandoverError: text("alert_last_handover_error"),
    /** When WhatsApp accepted the alert message. */
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
    /** The WhatsApp message id (`wamid`) of the sent alert. */
    alertMessageId: text("alert_message_id"),
    /** Safe, user-facing reason the alert failed for good (no secrets). */
    alertError: text("alert_error"),
  },
  (table) => [
    uniqueIndex("lead_submission_id_unique").on(table.submissionId),
    index("lead_created_at_idx").on(table.createdAt),
    index("lead_alert_unsent_idx")
      .on(table.createdAt)
      .where(sql`${table.alertStatus} = 'pending' and ${table.alertHandedOverAt} is null`),
  ],
);

export type Lead = typeof leadTable.$inferSelect;
