import { and, eq } from "drizzle-orm";

import type { DatabaseExecutor } from "../index";
import { schoolFeatureFlagTable } from "../schema/school-feature-flag";
import {
  DISABLED_SCHOOL_FEATURE,
  parseSchoolFeatureConfig,
  SCHOOL_FEATURE_KEYS,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
} from "./catalogue";

/**
 * Reads of `school_feature_flag`, shared by the API and the auth package
 * (Cadet sign-in), so every enforcement point decides from the same query.
 * Writes live in the API (`packages/api/src/feature-flags`).
 */

function toState<K extends SchoolFeatureKey>(
  key: K,
  row: { enabled: boolean; config: unknown } | undefined,
): SchoolFeatureState<K> {
  if (!row) return DISABLED_SCHOOL_FEATURE;
  return { enabled: row.enabled, config: parseSchoolFeatureConfig(key, row.config) };
}

/**
 * One feature's state for a school. A missing row (and a school that does
 * not exist) reads as disabled with no config. Throws when the stored config
 * no longer matches the feature's schema, rather than guessing a default.
 */
export async function getSchoolFeature<K extends SchoolFeatureKey>(
  db: DatabaseExecutor,
  schoolId: string,
  key: K,
): Promise<SchoolFeatureState<K>> {
  const [row] = await db
    .select({
      enabled: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolFeatureFlagTable)
    .where(
      and(
        eq(schoolFeatureFlagTable.schoolId, schoolId),
        eq(schoolFeatureFlagTable.feature, key),
      ),
    )
    .limit(1);
  return toState(key, row);
}

/**
 * Whether a feature is enabled for a school (missing row = disabled).
 *
 * Reads `enabled` only and never parses `config`: the two are independent
 * facts, and every gate (Cadet sign-in, `cadetProcedure`, the MCP context,
 * the manifest) asks just this question. A stored config that no longer
 * matches its schema must therefore not turn a gate into a 500; for Cadet
 * sign-in that would also tell an existing admission (500) from an unknown
 * one (401). Callers that use the config read it with `getSchoolFeature`,
 * which does throw on a mismatch.
 */
export async function isSchoolFeatureEnabled(
  db: DatabaseExecutor,
  schoolId: string,
  key: SchoolFeatureKey,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: schoolFeatureFlagTable.enabled })
    .from(schoolFeatureFlagTable)
    .where(
      and(
        eq(schoolFeatureFlagTable.schoolId, schoolId),
        eq(schoolFeatureFlagTable.feature, key),
      ),
    )
    .limit(1);
  return row?.enabled ?? false;
}

/** Every catalogue feature's state for a school; rows of retired keys are ignored. */
export async function getSchoolFeatureFlags(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolFeatureFlags> {
  const rows = await db
    .select({
      feature: schoolFeatureFlagTable.feature,
      enabled: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolFeatureFlagTable)
    .where(eq(schoolFeatureFlagTable.schoolId, schoolId));
  const byKey = new Map(rows.map((row) => [row.feature as string, row]));
  return Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, toState(key, byKey.get(key))]),
  ) as SchoolFeatureFlags;
}
