import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { SCHOOL_FEATURE_KEYS } from "../feature-flags/catalogue";
import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * Per-school platform feature flags, one row per (school, feature). The keys
 * and each key's config shape come from the code catalogue
 * (`@campuspilot/db/feature-flags/catalogue`). `feature` is stored as text,
 * so adding a feature needs no migration and a retired key never breaks a
 * read (reads ignore unknown keys).
 *
 * A missing row means the feature is disabled with no config. `enabled` and
 * `config` are independent: disabling keeps the stored config. Only platform
 * administrators write these rows (`systemAdmin.updateSchoolFeatureFlag`),
 * plus demo school creation, which enables every demo feature.
 */
export const schoolFeatureFlagTable = pgTable(
  "school_feature_flag",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    feature: text("feature", { enum: SCHOOL_FEATURE_KEYS }).notNull(),
    enabled: boolean("enabled").notNull(),
    /** Validated against the catalogue schema of `feature` on write and read. */
    config: jsonb("config"),
    /** Who last changed the flag; null for migration backfills and after the account is deleted. */
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.feature] }),
    index("school_feature_flag_updated_by_idx").on(table.updatedBy),
  ],
);

export type SchoolFeatureFlagRow = typeof schoolFeatureFlagTable.$inferSelect;
