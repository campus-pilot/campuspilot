import {
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
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
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
