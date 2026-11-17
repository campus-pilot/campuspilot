import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { SCHOOL_TIERS } from "../feature-flags/catalogue";
import { generateId } from "../id";
import { user } from "./auth";
import { admissionSettingsSchema } from "./jsonb";
import type { AdmissionSettings } from "./jsonb";

export const schoolTable = pgTable(
  "school",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("school")),
    slug: varchar("slug").notNull().unique(),
    name: varchar("name").notNull(),
    location: varchar("location").notNull(),
    registrationNo: varchar("registration_no"),
    logoS3Key: varchar("logo_s3_key"),
    admissionSettings: jsonb("admission_settings")
      .$type<AdmissionSettings>()
      .notNull()
      .default(admissionSettingsSchema.parse({})),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    hasCompletedOnboarding: boolean("has_completed_onboarding")
      .notNull()
      .default(false),
    /**
     * Demo status is its own explicit fact. It drives the management banner,
     * admin badges, the worker's `system-job` guard and the demo purge. It is
     * never inferred from the slug, staff email domain or a provisioning job.
     */
    isDemo: boolean("is_demo").notNull().default(false),
    /**
     * The platform admin who requested the demo. Recorded independently from
     * that admin's principal role, which can change after creation.
     */
    demoCreatedBy: text("demo_created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Whether the Cadet Portal may show class averages next to a student's own
     * results. Off by default; the cadet API omits every average while it is
     * off, so the setting is enforced on the server, not only hidden in the UI.
     */
    cadetShowClassAverages: boolean("cadet_show_class_averages")
      .notNull()
      .default(false),
    /**
     * The school's subscription tier. It decides which platform features the
     * school has (`@campuspilot/db/feature-flags/catalogue`), together with
     * the per-school adjustments in `school_feature_flag`. Null: the school
     * has no subscribed tier, so no tier includes any feature for it (its
     * adjustments still apply). No database default: whoever creates a school
     * states its tier.
     */
    tier: text("tier", { enum: SCHOOL_TIERS }),
    /**
     * When a platform administrator suspended the school; null while it is
     * not suspended. A suspended school is read-only: its staff and students
     * still read everything, and every change is refused
     * (`docs/school-suspension.md`). Its own fact, never inferred from the
     * tier, the features or the demo status.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /**
     * Why the school is suspended, as the administrator wrote it; set exactly
     * while `suspendedAt` is (CHECK). For platform administrators only: the
     * school's staff and students are told to contact support and never see
     * this. Lifting the suspension clears it.
     */
    suspendedReason: text("suspended_reason"),
    /**
     * The administrator who suspended the school; null while it is not
     * suspended and after that account is deleted.
     */
    suspendedBy: text("suspended_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "school_tier_check",
      sql`${table.tier} is null or ${table.tier} in (${sql.raw(SCHOOL_TIERS.map((tier) => `'${tier}'`).join(", "))})`,
    ),
    check(
      "school_suspension_reason_check",
      sql`(${table.suspendedAt} is null) = (${table.suspendedReason} is null)`,
    ),
  ],
);
