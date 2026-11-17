import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { SCHOOL_TIERS } from "../feature-flags/catalogue";
import { generateId } from "../id";
import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * A trial of one subscription tier given to a school by a platform
 * administrator (docs/school-trials.md), one row per trial so the history is
 * kept. A trial is **active** at time t when
 * `starts_at <= t < least(ends_at, coalesce(ended_at, 'infinity'))`: it
 * switches itself off at `ends_at` without any job, because every read
 * compares with `now()`. While active, the school's plan is the higher of its
 * subscribed tier (`school.tier`) and the trial's tier
 * (`resolveSchoolPlan` in the feature catalogue).
 *
 * Two trials of one school never overlap: migration
 * `0072_school-trials.sql` adds an EXCLUDE constraint (btree_gist) over
 * `tstzrange(starts_at, coalesce(ended_at, ends_at))`, which drizzle cannot
 * declare, so it is not in this file.
 */
export const schoolTrialTable = pgTable(
  "school_trial",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolTrial")),
    /** A trial is the school's own history and goes with it. */
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    /** The tier the school has while the trial is active (unless its subscription is higher). */
    tier: text("tier", { enum: SCHOOL_TIERS }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the trial ends by itself. An administrator can move it while the trial is active. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** When an administrator ended the trial early; null otherwise. Always before `ends_at`. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** The administrator who started the trial; null after that account is deleted. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** The administrator who ended it early; null when it was not ended early or that account is deleted. */
    endedBy: text("ended_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("school_trial_school_id_idx").on(table.schoolId, table.startsAt),
    index("school_trial_created_by_idx").on(table.createdBy),
    index("school_trial_ended_by_idx").on(table.endedBy),
    check(
      "school_trial_tier_check",
      sql`${table.tier} in (${sql.raw(SCHOOL_TIERS.map((tier) => `'${tier}'`).join(", "))})`,
    ),
    check("school_trial_ends_after_start_check", sql`${table.endsAt} > ${table.startsAt}`),
    check("school_trial_ended_after_start_check", sql`${table.endedAt} >= ${table.startsAt}`),
  ],
);

export type SchoolTrialRow = typeof schoolTrialTable.$inferSelect;
