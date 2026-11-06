import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";

export const demoSchoolJobStatusEnum = pgEnum("demo_school_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

/** Product-facing result of a finished demo seed: counts and the private CSV key. */
export type DemoSchoolJobResult = {
  credentialsS3Key: string | null;
  counts: {
    staff: number;
    classes: number;
    students: number;
    unregistered: number;
    bills: number;
    payments: number;
    adjustments: number;
    templates: number;
  };
  /** Exact minor-unit totals as decimal strings (never JavaScript numbers). */
  amounts: {
    currency: string;
    billedMinor: string;
    collectedMinor: string;
    outstandingMinor: string;
  };
};

/** A safe, user-facing failure summary; never contains secrets or stack traces. */
export type DemoSchoolJobError = {
  step: string;
  message: string;
};

/**
 * The product status store for one demo provisioning request. Restate owns
 * durable execution; this row is what the admin UI polls. Only IDs, counts and
 * safe messages are stored here: passwords never are.
 */
export const demoSchoolJobTable = pgTable(
  "demo_school_job",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("demoSchoolJob")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    /**
     * The admin the job acts as. Set null if that account is deleted, so a
     * job never blocks deleting a user; the job context then refuses to run.
     */
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /** The validated dialog input the seed runs from. */
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    /** The PRNG seed, drawn once and journaled by the workflow. */
    seed: text("seed"),
    /** The journaled "now" every relative demo date derives from. */
    asOf: timestamp("as_of", { withTimezone: true }),
    status: demoSchoolJobStatusEnum("status").notNull().default("queued"),
    currentStep: text("current_step"),
    completedSteps: jsonb("completed_steps").$type<string[]>().notNull().default([]),
    result: jsonb("result").$type<DemoSchoolJobResult>(),
    error: jsonb("error").$type<DemoSchoolJobError>(),
    /**
     * Restate invocation of the current attempt, recorded from the submit
     * response so a purge can cancel exactly that run.
     */
    invocationId: text("invocation_id"),
    /**
     * When the admin asked to start the current attempt: the start outbox
     * entry. Null while the job only exists (for example during the logo
     * upload); the outbox sweep hands over only requested starts.
     */
    startRequestedAt: timestamp("start_requested_at", { withTimezone: true }),
    /**
     * When Restate durably accepted the current attempt's start (a one-way
     * `/send` to `DemoSchoolControl.startSeed`). Its own fact: accepted does
     * not mean a worker has picked it up.
     */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Restate invocation of that `DemoSchoolControl.startSeed` send. */
    submitInvocationId: text("submit_invocation_id"),
    /** Hand-over attempts of the current attempt's start, successful or not. */
    submitAttempts: integer("submit_attempts").notNull().default(0),
    /** Safe summary of the last failed hand-over, shown while it is retried. */
    lastSubmitError: text("last_submit_error"),
    /**
     * Set under the school lock when a purge starts, before any seed run is
     * cancelled. Its own fact: start, retry, the control service and every
     * seed step refuse to run once it is set, and uploads delete their object.
     */
    purgeRequestedAt: timestamp("purge_requested_at", { withTimezone: true }),
    /** Incremented by every retry; part of the Restate workflow key. */
    attempt: integer("attempt").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("demo_school_job_school_idx").on(table.schoolId, table.createdAt)],
);

export const demoSchoolPurgeStatusEnum = pgEnum("demo_school_purge_status", [
  "pending",
  "scheduled",
  "completed",
  "failed",
]);

/** Stages of the `DemoSchoolPurge` workflow, in order. */
export const DEMO_SCHOOL_PURGE_STAGES = [
  "stopping-seed",
  "revoking-sessions",
  "deleting-data",
  "deleting-files",
] as const;
export type DemoSchoolPurgeStage = (typeof DEMO_SCHOOL_PURGE_STAGES)[number];

/**
 * One demo purge request: its status store, its outbox and, once the data
 * is deleted, its manifest. Written when the admin requests the purge; the
 * `DemoSchoolPurge` workflow runs it and records each stage here.
 * `status`: `pending` (not yet accepted by Restate), `scheduled` (accepted),
 * `completed`, `failed`.
 * The manifest (`object_keys`, `demo_user_ids`) is written inside the data
 * purge transaction and is the only source of what may be deleted from S3:
 * only keys under `schools/{schoolId}/` and `users/{demoUserId}/` for the
 * users recorded here. Deliberately no foreign keys: the school and users are
 * gone once the data is deleted, so the school's name and slug are copied.
 */
export const demoSchoolPurgeTable = pgTable("demo_school_purge", {
  schoolId: text("school_id").primaryKey(),
  /** The school's name and slug when the purge was requested (null on rows from before 0028). */
  schoolName: text("school_name"),
  schoolSlug: text("school_slug"),
  /** The admin who requested the purge; no foreign key, the account may go. */
  requestedBy: text("requested_by"),
  /** S3 keys the database referenced when the data purge committed. */
  objectKeys: jsonb("object_keys").$type<string[]>().notNull().default([]),
  /** Deleted demo-only accounts whose `users/{id}/` prefix is cleaned up. */
  demoUserIds: jsonb("demo_user_ids").$type<string[]>().notNull().default([]),
  status: demoSchoolPurgeStatusEnum("status").notNull().default("pending"),
  /** The stage running now, or where a failed attempt stopped; null before the first stage and once completed. */
  stage: text("stage").$type<DemoSchoolPurgeStage>(),
  /** When the data purge transaction committed (the school row is gone from then on). */
  dataDeletedAt: timestamp("data_deleted_at", { withTimezone: true }),
  /** Hand-over attempts to Restate (outbox retries), successful or not. */
  submitAttempts: integer("submit_attempts").notNull().default(0),
  /** Safe summary of the last failed hand-over, shown while it is retried. */
  lastSubmitError: text("last_submit_error"),
  /** Restate invocation of the `DemoSchoolControl.startPurge` send. */
  submitInvocationId: text("submit_invocation_id"),
  /** Restate invocation of the current attempt's `DemoSchoolPurge` workflow. */
  invocationId: text("invocation_id"),
  /**
   * Purge attempt, part of the workflow key `{schoolId}.{attempt}`. A
   * workflow key runs once, so a purge that failed terminally is retried
   * under the next attempt; every stage is idempotent.
   */
  attempt: integer("attempt").notNull().default(1),
  /** Safe summary of the last terminal failure (status `failed`). */
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** When Restate accepted the current attempt. */
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Transaction-scoped marker that binds the finance delete exception to
 * `purge_demo_school()`: the function inserts a row for the current
 * transaction and removes it before returning (see migration 0026).
 */
export const demoPurgeMarkerTable = pgTable("demo_purge_marker", {
  transactionId: bigint("transaction_id", { mode: "bigint" }).primaryKey(),
  schoolId: text("school_id").notNull(),
});
