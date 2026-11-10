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

/**
 * A stored config as its feature's schema reads it. `invalid` is its own
 * outcome, not an exception: a config that no longer matches its schema
 * (after a schema change, or a row written by hand) must only stop the code
 * that uses that config, never a read of which features a school has.
 */
export type StoredSchoolFeatureConfig<K extends SchoolFeatureKey> =
  | { status: "valid"; config: SchoolFeatureState<K>["config"] }
  | { status: "invalid" };

function readStoredConfig<K extends SchoolFeatureKey>(
  key: K,
  raw: unknown,
): StoredSchoolFeatureConfig<K> {
  try {
    return { status: "valid", config: parseSchoolFeatureConfig(key, raw) };
  } catch {
    return { status: "invalid" };
  }
}

/**
 * One feature's stored config for a school, for the code that uses it. A
 * missing row is a valid "nothing stored" (`config: null`); a stored value
 * that does not match the feature's schema is `invalid`. This says nothing
 * about whether the feature is enabled ({@link isSchoolFeatureEnabled}).
 */
export async function readSchoolFeatureConfig<K extends SchoolFeatureKey>(
  db: DatabaseExecutor,
  schoolId: string,
  key: K,
): Promise<StoredSchoolFeatureConfig<K>> {
  const [row] = await db
    .select({ config: schoolFeatureFlagTable.config })
    .from(schoolFeatureFlagTable)
    .where(
      and(
        eq(schoolFeatureFlagTable.schoolId, schoolId),
        eq(schoolFeatureFlagTable.feature, key),
      ),
    )
    .limit(1);
  return readStoredConfig(key, row?.config ?? null);
}

/**
 * Whether a feature is enabled for a school (missing row = disabled).
 *
 * Reads `enabled` only and never parses `config`: the two are independent
 * facts, and every gate (Cadet sign-in, `cadetProcedure`, the MCP context,
 * the manifest) asks just this question. A stored config that no longer
 * matches its schema must therefore not turn a gate into a 500; for Cadet
 * sign-in that would also tell an existing admission (500) from an unknown
 * one (401). Code that uses the config reads it with
 * {@link readSchoolFeatureConfig} (the API's `getSchoolFeatureConfig`),
 * where a mismatch stops that code alone.
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

/**
 * Every catalogue feature's state for a school, and which features hold a
 * stored config that no longer matches its schema. Rows of retired keys are
 * ignored.
 *
 * `enabled` is always the stored fact. A feature listed in `invalidConfigs`
 * reads with `config: null` here: the stored value is unusable, which the
 * list states explicitly (null alone would also mean "nothing stored").
 * This read never throws because of a config, so the pages and gates that
 * only ask what a school has keep working; the administrator's editor shows
 * the listed features as needing their settings saved again.
 */
export async function readSchoolFeatureFlags(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<{ features: SchoolFeatureFlags; invalidConfigs: SchoolFeatureKey[] }> {
  const rows = await db
    .select({
      feature: schoolFeatureFlagTable.feature,
      enabled: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolFeatureFlagTable)
    .where(eq(schoolFeatureFlagTable.schoolId, schoolId));
  const byKey = new Map(rows.map((row) => [row.feature as string, row]));
  const invalidConfigs: SchoolFeatureKey[] = [];
  const features = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => {
      const row = byKey.get(key);
      if (!row) return [key, DISABLED_SCHOOL_FEATURE];
      const stored = readStoredConfig(key, row.config);
      if (stored.status === "invalid") invalidConfigs.push(key);
      return [
        key,
        { enabled: row.enabled, config: stored.status === "valid" ? stored.config : null },
      ];
    }),
  ) as SchoolFeatureFlags;
  return { features, invalidConfigs };
}

/** The `features` of {@link readSchoolFeatureFlags}, for callers that only ask what a school has. */
export async function getSchoolFeatureFlags(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolFeatureFlags> {
  return (await readSchoolFeatureFlags(db, schoolId)).features;
}
