import { and, eq, sql, type SQL } from "drizzle-orm";

import type { DatabaseExecutor } from "../index";
import { schoolTable } from "../schema/school";
import { schoolFeatureFlagTable } from "../schema/school-feature-flag";
import { schoolBillingPeriodTable } from "../schema/school-billing";
import {
  parseSchoolFeatureConfig,
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  resolveSchoolPlan,
  SCHOOL_FEATURE_KEYS,
  schoolTierIncludes,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolPlan,
  type BillingPeriodKind,
  type SchoolTier,
} from "./catalogue";

/**
 * Reads of a school's plan and features (its standing tier on `school`, its
 * active billing period in `school_billing_period`, its adjustments and
 * settings in `school_feature_flag`), shared by the API and the auth package
 * (Cadet sign-in), so every enforcement point decides from the same query.
 * Writes live in the API (`packages/api/src/feature-flags`,
 * `packages/api/src/billing`).
 */

/**
 * SQL condition: the `school_billing_period` row is active now, that is
 * `starts_at <= now() < least(ends_at, coalesce(ended_at, 'infinity'))`.
 * Compared with the database's `now()` at every read, so a period ends by
 * itself without any job (docs/school-billing.md). Inside a transaction
 * `now()` is the transaction's start, so a period ended in it
 * (`ended_at = now()`) is already inactive there. Periods of a school never
 * overlap (the table's EXCLUDE constraint), so a join on this condition adds
 * at most one row per school.
 */
export function activeBillingPeriodCondition(): SQL {
  return sql`${schoolBillingPeriodTable.startsAt} <= now() and now() < ${billingPeriodEnd()}`;
}

/** SQL: when a period really ends, its `ends_at` or the earlier moment it was cut short. */
export function billingPeriodEnd(): SQL<Date> {
  return sql<Date>`least(${schoolBillingPeriodTable.endsAt}, coalesce(${schoolBillingPeriodTable.endedAt}, 'infinity'::timestamptz))`;
}

/** The active billing period of a school as reads return it; `endsAt` is when it really ends. */
export type ActiveBillingPeriod = {
  id: string;
  kind: BillingPeriodKind;
  tier: SchoolTier;
  startsAt: Date;
  endsAt: Date;
};

/** The columns of an active period for a select joined with {@link activeBillingPeriodCondition}. */
export const activeBillingPeriodColumns = {
  periodId: schoolBillingPeriodTable.id,
  periodKind: schoolBillingPeriodTable.kind,
  periodTier: schoolBillingPeriodTable.tier,
  periodStartsAt: schoolBillingPeriodTable.startsAt,
  periodEndsAt: sql<Date | null>`least(${schoolBillingPeriodTable.endsAt}, coalesce(${schoolBillingPeriodTable.endedAt}, 'infinity'::timestamptz))`.mapWith(
    (value: string | Date | null) => (value === null ? null : new Date(value)),
  ),
};

/** The active period out of a row selected with {@link activeBillingPeriodColumns} (left joined: null without one). */
export function activeBillingPeriodOf(row: {
  periodId: string | null;
  periodKind: BillingPeriodKind | null;
  periodTier: SchoolTier | null;
  periodStartsAt: Date | null;
  periodEndsAt: Date | null;
}): ActiveBillingPeriod | null {
  if (row.periodId === null || row.periodKind === null || row.periodTier === null || row.periodStartsAt === null || row.periodEndsAt === null) {
    return null;
  }
  return { id: row.periodId, kind: row.periodKind, tier: row.periodTier, startsAt: row.periodStartsAt, endsAt: row.periodEndsAt };
}

/** The left join of a school's active billing period onto `school`. */
export function joinActiveBillingPeriod(): SQL {
  return and(eq(schoolBillingPeriodTable.schoolId, schoolTable.id), activeBillingPeriodCondition())!;
}

/** A school's plan with the two facts it comes from ({@link readSchoolPlan}). */
export type SchoolPlanRead = {
  /** `school.tier`: the standing tier, null without one. */
  subscribedTier: SchoolTier | null;
  /** The active billing period, null without one. */
  period: ActiveBillingPeriod | null;
  /** The plan both give ({@link resolveSchoolPlan}); `tier: null` means the school has no plan. */
  plan: SchoolPlan;
};

/**
 * A school's standing tier, its active billing period and the plan they
 * give, in one query. Null for a school that does not exist.
 */
export async function readSchoolPlan(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolPlanRead | null> {
  const [row] = await db
    .select({ subscribedTier: schoolTable.tier, ...activeBillingPeriodColumns })
    .from(schoolTable)
    .leftJoin(schoolBillingPeriodTable, joinActiveBillingPeriod())
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  if (!row) return null;
  return schoolPlanOf(row.subscribedTier, activeBillingPeriodOf(row));
}

function schoolPlanOf(subscribedTier: SchoolTier | null, period: ActiveBillingPeriod | null): SchoolPlanRead {
  return { subscribedTier, period, plan: resolveSchoolPlan({ subscribedTier, activePeriod: period }) };
}

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
  plan: SchoolPlanRead;
  switches: Record<SchoolFeatureKey, boolean>;
  rows: Map<string, StoredFeatureRow>;
};

/**
 * A school's plan, every feature's state and its unusable configs
 * ({@link readSchoolFeatureFlags}).
 */
export type SchoolFeatureFlagsRead = {
  /** The tier of the school's plan, which every feature's `included` follows; null when it has no plan. */
  tier: SchoolTier | null;
  /** `school.tier`: the standing tier, null without one. */
  subscribedTier: SchoolTier | null;
  /** The active billing period, null without one. */
  period: ActiveBillingPeriod | null;
  features: SchoolFeatureFlags;
  invalidConfigs: SchoolFeatureKey[];
};

/**
 * A school's plan (standing tier and active billing period), every feature's
 * switch (the stored adjustment, or the plan tier's own answer without one)
 * and the stored rows, in one query. `found` says whether the school
 * exists. A school that does not exist has no plan and no stored row, so
 * every switch is off and a gate answers it like a school without the
 * feature.
 */
async function readSchoolFeatureSwitches(
  db: DatabaseExecutor,
  schoolId: string,
): Promise<SchoolFeatureSwitches> {
  // From the school, so a school without any stored row still answers with
  // its plan. At most one period is active, so the period join adds no rows.
  const rows = await db
    .select({
      subscribedTier: schoolTable.tier,
      ...activeBillingPeriodColumns,
      feature: schoolFeatureFlagTable.feature,
      adjustment: schoolFeatureFlagTable.enabled,
      config: schoolFeatureFlagTable.config,
    })
    .from(schoolTable)
    .leftJoin(schoolBillingPeriodTable, joinActiveBillingPeriod())
    .leftJoin(schoolFeatureFlagTable, eq(schoolFeatureFlagTable.schoolId, schoolTable.id))
    .where(eq(schoolTable.id, schoolId));
  const first = rows[0];
  const plan = schoolPlanOf(first?.subscribedTier ?? null, first ? activeBillingPeriodOf(first) : null);
  const byKey = new Map<string, StoredFeatureRow>();
  for (const row of rows) {
    if (row.feature !== null) byKey.set(row.feature, { adjustment: row.adjustment, config: row.config });
  }
  const adjustments = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, byKey.get(key)?.adjustment ?? null]),
  ) as Record<SchoolFeatureKey, boolean | null>;
  return {
    found: rows.length > 0,
    plan,
    switches: resolveSchoolFeatureSwitches(plan.plan.tier, adjustments),
    rows: byKey,
  };
}

/**
 * Whether a school **has** a feature now: its switch is on (the school's
 * adjustment, or its plan's tier without one) and every feature it `requires` is
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
 * A school's plan, every catalogue feature's state, and which features hold
 * a stored config that no longer matches its schema. Rows of retired keys
 * are ignored. Null when the school does not exist. `tier` is the tier of
 * the school's plan (the higher of `subscribedTier` and the active
 * `period`'s tier); it is null for a school without a plan: no tier includes any
 * feature for it, and its adjustments still apply.
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
function resolveSchoolFeatureFlags({ plan, switches, rows }: SchoolFeatureSwitches): SchoolFeatureFlagsRead {
  const tier = plan.plan.tier;
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
  return { tier, subscribedTier: plan.subscribedTier, period: plan.period, features, invalidConfigs };
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
