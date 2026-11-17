import { and, eq } from "drizzle-orm";

import type { DatabaseExecutor } from "../index";
import { schoolTable } from "../schema/school";
import { schoolFeatureFlagTable } from "../schema/school-feature-flag";
import {
  parseSchoolFeatureConfig,
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  SCHOOL_FEATURE_KEYS,
  schoolTierIncludes,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolTier,
} from "./catalogue";

/**
 * Reads of a school's features (its tier on `school`, its adjustments and
 * settings in `school_feature_flag`), shared by the API and the auth package
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

/** What is stored about one feature of one school: its adjustment and its raw config. */
type StoredFeatureRow = { adjustment: boolean | null; config: unknown };

type SchoolFeatureSwitches = {
  found: boolean;
  tier: SchoolTier | null;
  switches: Record<SchoolFeatureKey, boolean>;
  rows: Map<string, StoredFeatureRow>;
};

/** A school's tier, every feature's state and its unusable configs ({@link readSchoolFeatureFlags}). */
export type SchoolFeatureFlagsRead = {
  tier: SchoolTier | null;
  features: SchoolFeatureFlags;
  invalidConfigs: SchoolFeatureKey[];
};

/**
 * A school's tier, every feature's switch (the stored adjustment, or the
 * tier's own answer without one) and the stored rows, in one query. `found`
 * says whether the school exists; `tier` is null both for a school without
 * a subscribed tier and for a school that does not exist. An unknown school
 * has no stored row either, so every switch is off and a gate answers it
 * like a school without the feature.
 */
async function readSchoolFeatureSwitches(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolFeatureSwitches> {
  // From the school, so a school without any stored row still answers with its tier.
  const rows = await db
    .select({
      tier: schoolTable.tier,
      feature: schoolFeatureFlagTable.feature,
      adjustment: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolTable)
    .leftJoin(schoolFeatureFlagTable, eq(schoolFeatureFlagTable.schoolId, schoolTable.id))
    .where(eq(schoolTable.id, schoolId));
  const tier = rows[0]?.tier ?? null;
  const byKey = new Map<string, StoredFeatureRow>();
  for (const row of rows) {
    if (row.feature !== null) byKey.set(row.feature, { adjustment: row.adjustment, config: row.config });
  }
  const adjustments = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, byKey.get(key)?.adjustment ?? null]),
  ) as Record<SchoolFeatureKey, boolean | null>;
  return { found: rows.length > 0, tier, switches: resolveSchoolFeatureSwitches(tier, adjustments), rows: byKey };
}

/**
 * Whether a school **has** a feature now: its switch is on (the school's
 * adjustment, or its tier without one) and every feature it `requires` is
 * active. Every gate asks exactly this, so a feature whose own switch is on
 * still closes when a feature it needs is switched off. A school that does
 * not exist has no feature.
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
 * A school's tier, every catalogue feature's state, and which features hold
 * a stored config that no longer matches its schema. Rows of retired keys
 * are ignored. Null when the school does not exist. `tier` is null for a
 * school without a subscribed tier: no tier includes any feature for it, and
 * its adjustments still apply.
 *
 * Per feature: `included` is the tier's answer, `adjustment` what is stored
 * for this school (null: it follows the tier), `enabled` the switch that
 * results and `active` whether the school has the feature (see
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
): Promise<SchoolFeatureFlagsRead | null> {
  const read = await readSchoolFeatureSwitches(db, schoolId);
  if (!read.found) return null;
  return resolveSchoolFeatureFlags(read);
}

/** Every feature's state from what {@link readSchoolFeatureSwitches} read. */
function resolveSchoolFeatureFlags({ tier, switches, rows }: SchoolFeatureSwitches): SchoolFeatureFlagsRead {
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
          included: schoolTierIncludes(tier, key),
          adjustment: row?.adjustment ?? null,
          enabled: switches[key],
          active: active[key],
          config: stored.status === "valid" ? stored.config : null,
        },
      ];
    }),
  ) as SchoolFeatureFlags;
  return { tier, features, invalidConfigs };
}

/**
 * The `features` of {@link readSchoolFeatureFlags}, for callers that only ask
 * what a school has. A school that does not exist has every feature off.
 */
export async function getSchoolFeatureFlags(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolFeatureFlags> {
  return resolveSchoolFeatureFlags(await readSchoolFeatureSwitches(db, schoolId)).features;
}
