import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * The ledger of schools people created themselves (docs/school-creation.md),
 * one row per creation. A person's used allowance is the number of their rows,
 * compared with `user.school_creation_limit`.
 *
 * The row outlives the school on purpose (`school_id` is set null when the
 * school is deleted): creating a school, discarding it and creating another
 * must not hand the allowance back. Handing the school to someone else or
 * leaving it does not touch the ledger either.
 */
export const schoolCreationTable = pgTable(
  "school_creation",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolCreation")),
    /** Who created the school. The ledger is the person's own history and goes with the account. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The school created; null after it was deleted, while the creation still counts. */
    schoolId: text("school_id").references(() => schoolTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("school_creation_user_id_idx").on(table.userId),
    uniqueIndex("school_creation_school_id_key").on(table.schoolId),
  ],
);

export const SCHOOL_CREATION_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type SchoolCreationRequestStatus = (typeof SCHOOL_CREATION_REQUEST_STATUSES)[number];

/**
 * A person's request to create more schools than their allowance
 * (docs/school-creation.md). It reaches the admin app's School requests page,
 * where a platform administrator approves it (setting
 * `user.school_creation_limit` to `granted_limit`, which may differ from what
 * was asked) or rejects it. A person has at most one pending request.
 */
export const schoolCreationRequestTable = pgTable(
  "school_creation_request",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolCreationRequest")),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The total number of schools the person asks to be allowed to create (not the number of extra schools). */
    requestedLimit: integer("requested_limit").notNull(),
    /** Why they need more schools, as they wrote it. */
    reason: text("reason").notNull(),
    status: text("status", { enum: SCHOOL_CREATION_REQUEST_STATUSES }).notNull().default("pending"),
    /** The limit the administrator set when approving; set exactly while approved (CHECK). */
    grantedLimit: integer("granted_limit"),
    /** What the administrator told the person with the decision; optional. */
    decisionNote: text("decision_note"),
    /** The administrator who decided; null while pending and after that account is deleted. */
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    /** When it was decided; set exactly while it is not pending (CHECK). */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("school_creation_request_user_id_idx").on(table.userId, table.createdAt),
    index("school_creation_request_status_idx").on(table.status, table.createdAt),
    index("school_creation_request_decided_by_idx").on(table.decidedBy),
    uniqueIndex("school_creation_request_one_pending_key")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "school_creation_request_status_check",
      sql`${table.status} in (${sql.raw(SCHOOL_CREATION_REQUEST_STATUSES.map((status) => `'${status}'`).join(", "))})`,
    ),
    check("school_creation_request_requested_limit_check", sql`${table.requestedLimit} >= 1`),
    check(
      "school_creation_request_granted_limit_check",
      sql`(${table.status} = 'approved') = (${table.grantedLimit} is not null) and (${table.grantedLimit} is null or ${table.grantedLimit} >= 0)`,
    ),
    check(
      "school_creation_request_decided_at_check",
      sql`(${table.status} = 'pending') = (${table.decidedAt} is null)`,
    ),
  ],
);

export type SchoolCreationRequestRow = typeof schoolCreationRequestTable.$inferSelect;

/**
 * The guided setup a self-created school is offered (docs/school-creation.md,
 * "Guided setup"). A row exists only for a school that is offered it, written
 * by the creation itself, so schools an administrator opened, demo schools and
 * every school created before the guide never see it. Whether the guide was
 * finished and whether someone chose to set up later are separate facts; a
 * school set up later may still finish the guide while it has no session and
 * no class.
 */
export const schoolOnboardingTable = pgTable("school_onboarding", {
  schoolId: text("school_id")
    .primaryKey()
    .references(() => schoolTable.id, { onDelete: "cascade" }),
  /** When the guide finished: its session, examinations, classes, subjects and plans were created. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** When someone chose Set up later; from then on the guide no longer opens on its own. */
  skippedAt: timestamp("skipped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SchoolOnboardingRow = typeof schoolOnboardingTable.$inferSelect;
