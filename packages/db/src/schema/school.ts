import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
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
});
