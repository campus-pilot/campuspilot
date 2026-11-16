import { and, eq } from "drizzle-orm";

import type { DatabaseExecutor } from "../index";
import { schoolFeatureFlagTable } from "../schema/school-feature-flag";
import {
  parseSchoolFeatureConfig,
  resolveSchoolFeatureActivity,
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
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

/** Every feature's switch for a school: the stored `enabled`, or the catalogue default without a row. */
async function readSchoolFeatureSwitches(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<{ switches: Record<SchoolFeatureKey, boolean>; rows: Map<string, { enabled: boolean; config: unknown }> }> {
  const rows = await db
    .select({
      feature: schoolFeatureFlagTable.feature,
      enabled: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolFeatureFlagTable)
    .where(eq(schoolFeatureFlagTable.schoolId, schoolId));
  const byKey = new Map(rows.map((row) => [row.feature as string, row]));
  const switches = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, byKey.get(key)?.enabled ?? schoolFeatureCatalogue[key].defaultEnabled]),
  ) as Record<SchoolFeatureKey, boolean>;
  return { switches, rows: byKey };
}

/**
 * Whether a school **has** a feature now: its switch is on (the catalogue's
 * `defaultEnabled` without a stored row) and every feature it `requires` is
 * active. Every gate asks exactly this, so a feature whose own switch is on
 * still closes when a feature it needs is switched off.
 *
 * Reads the switches only and never parses `config`: the two are independent
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
  const { switches } = await readSchoolFeatureSwitches(db, schoolId);
  return resolveSchoolFeatureActivity(switches)[key];
}

/**
 * Every catalogue feature's state for a school, and which features hold a
 * stored config that no longer matches its schema. Rows of retired keys are
 * ignored.
 *
 * `enabled` is the switch (stored, or the catalogue default without a row)
 * and `active` whether the school has the feature (see
 * {@link isSchoolFeatureEnabled}). A feature listed in `invalidConfigs`
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
  const { switches, rows } = await readSchoolFeatureSwitches(db, schoolId);
  const active = resolveSchoolFeatureActivity(switches);
  const invalidConfigs: SchoolFeatureKey[] = [];
  const features = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => {
      const row = rows.get(key);
      const stored = readStoredConfig(key, row?.config ?? null);
      if (stored.status === "invalid") invalidConfigs.push(key);
      return [
        key,
        {
          enabled: switches[key],
          active: active[key],
          config: stored.status === "valid" ? stored.config : null,
        },
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
