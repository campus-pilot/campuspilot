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
]);

/**
 * Purge manifest and S3-cleanup outbox, written inside the purge transaction.
 * It is the only source of what the `DemoSchoolPurge` workflow may delete:
 * the workflow takes just the school ID and accepts keys only under
 * `schools/{schoolId}/` and `users/{demoUserId}/` for the users recorded
 * here. Deliberately no foreign keys: the school and users are gone by then.
 */
export const demoSchoolPurgeTable = pgTable("demo_school_purge", {
  schoolId: text("school_id").primaryKey(),
  /** S3 keys the database referenced when the purge committed. */
  objectKeys: jsonb("object_keys").$type<string[]>().notNull(),
  /** Deleted demo-only accounts whose `users/{id}/` prefix is cleaned up. */
  demoUserIds: jsonb("demo_user_ids").$type<string[]>().notNull(),
  status: demoSchoolPurgeStatusEnum("status").notNull().default("pending"),
  /** Submissions of the cleanup workflow (outbox retries). */
  submitAttempts: integer("submit_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
