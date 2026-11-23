import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";
import { schoolRegistrationRequestTable } from "./school-registration-request";

/**
 * Where a school setup stands. `draft` is being edited in the admin app;
 * `queued` was asked to run; `running` is in the worker; `succeeded` created
 * the school; `failed` stopped with `error` and can be retried (the draft is
 * kept and can be edited before a retry only while no school exists yet).
 */
export const schoolSetupStatusEnum = pgEnum("school_setup_status", ["draft", "queued", "running", "succeeded", "failed"]);

/** A safe, user-facing failure summary; never contains secrets or stack traces. */
export type SchoolSetupError = { step: string; message: string };

/** What a finished setup created, for the admin's result screen. */
export type SchoolSetupResult = {
  schoolId: string;
  sessionId: string;
  classCount: number;
  examCount: number;
  principalUserId: string;
  /** Whether the principal's account had a password when the setup finished; without one the admin issues it. */
  principalHasPassword: boolean;
};

/**
 * A platform administrator setting up a real school from a School Onboarding
 * form submission (docs/school-onboarding-form.md, "Setting up the school").
 * One row per request: it is the admin's saved draft while they edit, and
 * then the status store and outbox of the `SchoolSetup` Restate workflow,
 * like `demo_school_job` is for a demo school. The school it creates is a
 * real school (`is_demo` false).
 */
export const schoolSetupTable = pgTable(
  "school_setup",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolSetup")),
    requestId: text("request_id")
      .notNull()
      .references(() => schoolRegistrationRequestTable.id),
    /**
     * The wizard's answers as last saved (`schoolSetupDraftSchema` in
     * `@campuspilot/api/school-setup/school-setup.contract`). Started from the
     * request's answers and edited freely until the setup is asked to run;
     * the workflow runs from the draft as it was then.
     */
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
    /** The wizard step the admin was on when the draft was last saved, to reopen it there. */
    draftStep: text("draft_step").notNull(),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who last saved the draft; set null if that account is deleted. */
    draftUpdatedBy: text("draft_updated_by").references(() => user.id, { onDelete: "set null" }),
    status: schoolSetupStatusEnum("status").notNull().default("draft"),
    /**
     * The admin the workflow acts as: becomes the school's manager and is
     * recorded as the creator of its trial. Set when the setup is asked to
     * run; the workflow refuses to act once the account is gone.
     */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    /** The school this setup created, written in the same transaction as the school itself. */
    schoolId: text("school_id").references(() => schoolTable.id, { onDelete: "set null" }),
    currentStep: text("current_step"),
    /** Steps finished, each recorded in the same transaction as its writes, so a replay skips it. */
    completedSteps: jsonb("completed_steps").$type<string[]>().notNull().default([]),
    result: jsonb("result").$type<SchoolSetupResult>(),
    error: jsonb("error").$type<SchoolSetupError>(),
    /** Incremented by every retry; part of the Restate workflow key. */
    attempt: integer("attempt").notNull().default(1),
    /** When the admin asked the current attempt to run: the start outbox entry. */
    startRequestedAt: timestamp("start_requested_at", { withTimezone: true }),
    /** When Restate durably accepted the current attempt's start. Accepted is not started. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Restate invocation of that `SchoolSetupControl.start` send. */
    submitInvocationId: text("submit_invocation_id"),
    submitAttempts: integer("submit_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over, shown while it is retried. */
    lastSubmitError: text("last_submit_error"),
    /** Restate invocation of the current attempt's workflow run. */
    invocationId: text("invocation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("school_setup_request_unique").on(table.requestId),
    uniqueIndex("school_setup_school_unique").on(table.schoolId),
    index("school_setup_status_idx").on(table.status, table.submittedAt),
  ],
);

export type SchoolSetup = typeof schoolSetupTable.$inferSelect;
