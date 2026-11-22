import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { SCHOOL_TIERS } from "../feature-flags/catalogue";
import { SCHOOL_KINDS } from "../school-kind";
import { generateId } from "../id";
import { user } from "./auth";
import { admissionSettingsSchema } from "./jsonb";
import type { AdmissionSettings } from "./jsonb";

export { SCHOOL_KINDS, type SchoolKind } from "../school-kind";

/** See `school-kind.ts`. */
export const schoolKindEnum = pgEnum("school_kind", SCHOOL_KINDS);

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
    /**
     * The person accountable for the school (docs/school-creation.md): set to
     * the creator when someone creates a school themselves, and changed only
     * by a platform administrator. Its own fact, separate from roles: the
     * owner keeps the principal role and cannot be removed through school
     * procedures. Null for schools an administrator created until one is named.
     */
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Whether this is a real school or a person's personal space
     * ({@link SCHOOL_KINDS}). Set when the row is created and never changed.
     * A personal space's owner is the person it belongs to; at most one per
     * owner (`school_personal_owner_unique`).
     */
    kind: schoolKindEnum("kind").notNull().default("school"),
  },
  (table) => [
    index("school_owner_user_id_idx").on(table.ownerUserId),
    // One personal space per person. The owner may be cleared when the account is deleted (ON DELETE SET NULL); such
    // rows no longer collide (NULLs are distinct).
    uniqueIndex("school_personal_owner_unique")
      .on(table.ownerUserId)
      .where(sql`${table.kind} = 'personal'`),
    // A demo school is a full school; it is never a personal space. Compared as text: an enum value added in a migration
    // cannot be used in the transaction that adds it.
    check(
      "school_personal_not_demo_check",
      sql`${table.kind}::text <> 'personal' or not ${table.isDemo}`,
    ),
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
