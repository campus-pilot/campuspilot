import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { SCHOOL_FEATURE_KEYS } from "../feature-flags/catalogue";
import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * What is stored about one platform feature for one school, one row per
 * (school, feature): the school's **adjustment** to its tier and the
 * feature's settings. The keys and each key's config shape come from the
 * code catalogue (`@campuspilot/db/feature-flags/catalogue`). `feature` is
 * stored as text, so adding a feature needs no migration and a retired key
 * never breaks a read (reads ignore unknown keys).
 *
 * Which features a school has comes from its tier (`school.tier` and the
 * catalogue's `tiers`); a row only changes that for this one school. A
 * missing row means "follow the tier, no config". `enabled` and `config`
 * are independent: disabling, or returning a feature to its tier, keeps the
 * stored config. Only platform administrators write these rows
 * (`systemAdmin.updateSchoolFeatureFlag`).
 */
export const schoolFeatureFlagTable = pgTable(
  "school_feature_flag",
  {
    /**
     * Flags are the school's own configuration (like its memberships), so
     * they go with it: deleting a school must not be blocked by the row the
     * 0048 backfill, or any administrator toggle, wrote for it.
     */
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    feature: text("feature", { enum: SCHOOL_FEATURE_KEYS }).notNull(),
    /**
     * The adjustment: true switches the feature on for this school whatever
     * its tier, false switches it off, null follows the tier (the row then
     * only holds the feature's config).
     */
    enabled: boolean("enabled"),
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
