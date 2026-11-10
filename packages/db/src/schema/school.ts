import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { user } from "./auth";
import { admissionSettingsSchema } from "./jsonb";
import type { AdmissionSettings } from "./jsonb";

export const schoolTable = pgTable("school", {
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
});
