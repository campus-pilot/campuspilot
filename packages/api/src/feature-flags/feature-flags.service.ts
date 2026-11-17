import type { DatabaseExecutor } from '@campuspilot/db';
import {
  ASSISTANT_DEFAULT_ROLES,
  parseSchoolFeatureConfig,
  resolveSchoolFeatureSwitches,
  SCHOOL_FEATURE_CONFIG_INVALID_REASON,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  type SchoolFeatureConfig,
  schoolFeatureCatalogue,
  schoolFeatureHasConfig,
  type SchoolFeatureDisabledData,
  type SchoolFeatureEntry,
  type SchoolFeatureKey,
} from '@campuspilot/db/feature-flags/catalogue';
import {
  getSchoolFeatureFlags,
  isSchoolFeatureEnabled,
  readSchoolFeatureConfig,
  readSchoolFeatureFlags,
} from '@campuspilot/db/feature-flags/store';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { and, eq } from 'drizzle-orm';
import { ORPCError } from '@orpc/server';

import { rpcError } from '../errors';

/**
 * Per-school features: the school's tier and its adjustments
 * (docs/feature-flags.md). Reads come from
 * `@campuspilot/db/feature-flags/store` so the auth package's Cadet sign-in
 * and the API decide from the same query; they are re-exported here so API
 * code has one import.
 */
export { getSchoolFeatureFlags, isSchoolFeatureEnabled, readSchoolFeatureFlags };

/**
 * The one error every surface throws for a disabled feature: FORBIDDEN with
 * `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature }`. A plain permission
 * denial is FORBIDDEN without that data, so clients can tell the two apart
 * (`readSchoolFeatureDisabled` in the catalogue) without parsing the message.
 */
export function schoolFeatureDisabledError(feature: SchoolFeatureKey) {
  return new ORPCError('FORBIDDEN', {
    message: `${schoolFeatureCatalogue[feature].label} is not enabled for this school.`,
    data: {
      reason: SCHOOL_FEATURE_DISABLED_REASON,
      feature,
    } satisfies SchoolFeatureDisabledData,
  });
}

/**
 * Throws the feature-disabled error unless the school has the feature.
 * Every enforcement point that is not the oRPC middleware (Cadet procedures,
 * the Cadet MCP gate, the manifest blob, password issuing inside
 * `createAdmission`) calls this, so they cannot drift apart.
 *
 * It decides from whether the feature is active (`isSchoolFeatureEnabled`:
 * its switch and every feature it requires) and never parses the stored
 * config: a gate must not fail because of a setting it does not read. The
 * oRPC middleware `requireSchoolFeature` decides the same way. A feature
 * that is inactive only because a feature it requires is off is refused
 * with its own key, since that is the feature the caller asked for.
 * Code that needs the config reads it with {@link getSchoolFeatureConfig}.
 */
export async function assertSchoolFeatureEnabled(
  db: DatabaseExecutor,
  schoolId: string,
  key: SchoolFeatureKey,
): Promise<void> {
  if (!(await isSchoolFeatureEnabled(db, schoolId, key))) {
    throw schoolFeatureDisabledError(key);
  }
}

/**
 * The error for code that needs a feature's config when the stored value no
 * longer matches the feature's schema: CONFLICT with
 * `data: { reason: 'SCHOOL_FEATURE_CONFIG_INVALID', feature }`. It is not a
 * server fault to retry and not a refusal of the caller: the stored settings
 * must be saved again by a platform administrator, and only what uses them
 * is unavailable until then.
 */
export function schoolFeatureConfigInvalidError(feature: SchoolFeatureKey) {
  return new ORPCError('CONFLICT', {
    message: `The stored settings of ${schoolFeatureCatalogue[feature].label} for this school are not valid. A platform administrator must save them again.`,
    data: { reason: SCHOOL_FEATURE_CONFIG_INVALID_REASON, feature },
  });
}

/**
 * One feature's typed config for a school (null when nothing is stored), for
 * the handlers that use it. Call it after the gate
 * (`requireSchoolFeature` / `assertSchoolFeatureEnabled`): being enabled and
 * having a usable config are separate facts, and only this read can fail on
 * the config, with {@link schoolFeatureConfigInvalidError}.
 */
export async function getSchoolFeatureConfig<K extends SchoolFeatureKey>(
  db: DatabaseExecutor,
  schoolId: string,
  key: K,
): Promise<SchoolFeatureConfig<K> | null> {
  const stored = await readSchoolFeatureConfig(db, schoolId, key);
  if (stored.status === 'invalid') throw schoolFeatureConfigInvalidError(key);
  return stored.config;
}

/**
 * One feature's new stored state for one school. A union discriminated on
 * `feature` (`SchoolFeatureEntry`), so a caller whose key is not a literal
 * cannot pass one feature's config under another feature's key. `enabled`
 * is the school's adjustment: true or false to set the feature for this
 * school whatever its tier, null to follow the tier.
 */
export type SetSchoolFeatureInput = SchoolFeatureEntry & {
  schoolId: string;
  /** The administrator making the change; null only for system writes. */
  updatedBy: string | null;
};

/**
 * Writes what is stored about one feature of a school (insert or replace):
 * its adjustment (`enabled`: on, off, or null to follow the tier) and its
 * config. Both are stored as given: disabling, or returning the feature to
 * its tier, does not clear the config, and the config is validated against
 * the schema of `feature`. A feature whose catalogue config is not
 * `z.null()` cannot end up switched on without a config (BAD_REQUEST),
 * whether the adjustment or the school's tier switches it on; switching it
 * off never needs one.
 *
 * When this switches the assistant on for a school that has no role
 * switched on, the default roles are switched on with it
 * ({@link switchOnDefaultAssistantRoles}).
 *
 * The caller verifies that the actor may change flags; pass a transaction
 * to write together with other rows. A school that does not exist is
 * NOT_FOUND.
 */
export async function setSchoolFeature(
  db: DatabaseExecutor,
  input: SetSchoolFeatureInput,
): Promise<void> {
  const config = parseSchoolFeatureConfig(input.feature, input.config);
  const [school] = await db
    .select({ tier: schoolTable.tier })
    .from(schoolTable)
    .where(eq(schoolTable.id, input.schoolId))
    .limit(1);
  if (!school) throw rpcError.notFound('School');
  const [before] = await db
    .select({ enabled: schoolFeatureFlagTable.enabled })
    .from(schoolFeatureFlagTable)
    .where(and(eq(schoolFeatureFlagTable.schoolId, input.schoolId), eq(schoolFeatureFlagTable.feature, input.feature)))
    .limit(1);
  const wasOn = resolveSchoolFeatureSwitches(school.tier, { [input.feature]: before?.enabled ?? null })[input.feature];
  const isOn = resolveSchoolFeatureSwitches(school.tier, { [input.feature]: input.enabled })[input.feature];
  // A feature with settings cannot be switched on without them: whatever
  // reads them would have nothing to go by. Switching it off stays possible either way.
  if (isOn && config === null && schoolFeatureHasConfig(input.feature)) {
    throw rpcError.badRequest(`${schoolFeatureCatalogue[input.feature].label} needs its settings to be enabled.`);
  }
  const updatedAt = new Date();
  await db
    .insert(schoolFeatureFlagTable)
    .values({
      schoolId: input.schoolId,
      feature: input.feature,
      enabled: input.enabled,
      config,
      updatedBy: input.updatedBy,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [schoolFeatureFlagTable.schoolId, schoolFeatureFlagTable.feature],
      set: { enabled: input.enabled, config, updatedBy: input.updatedBy, updatedAt },
    });
  if (input.feature === 'assistant' && isOn && !wasOn) {
    await switchOnDefaultAssistantRoles(db, input.schoolId, input.updatedBy);
  }
}

/**
 * Switches the assistant on for the default roles
 * (`ASSISTANT_DEFAULT_ROLES`: principal, manager, exam coordinator,
 * accountant) when the school has no role switched on. Called when the
 * assistant itself is switched on for the school, so an enabled assistant is
 * usable at once instead of waiting for someone to pick roles.
 *
 * It decides from the school's role list alone: a school that already has a
 * role switched on (chosen by its principal or by an administrator, also
 * before the assistant was switched off) keeps exactly that list. A school
 * whose every role was switched off gets the defaults again, because an
 * assistant that is on for nobody is what this exists to prevent.
 */
export async function switchOnDefaultAssistantRoles(
  db: DatabaseExecutor,
  schoolId: string,
  updatedBy: string | null,
): Promise<void> {
  const [existing] = await db
    .select({ role: schoolAssistantAccessRoleTable.role })
    .from(schoolAssistantAccessRoleTable)
    .where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId))
    .limit(1);
  if (existing) return;
  await db
    .insert(schoolAssistantAccessRoleTable)
    .values(ASSISTANT_DEFAULT_ROLES.map((role) => ({ schoolId, role, updatedBy, updatedAt: new Date() })))
    .onConflictDoNothing();
}

/**
 * The features active in at least one school the user belongs to. An MCP
 * connection is the user's, not one school's, and its tools take a
 * `schoolId`, so a tool is listed while some school of the user could run it
 * (`tools/list` in the server's MCP bridge). A call is still refused for a
 * school without the feature, with the disabled-feature error.
 */
export async function featuresOfUserSchools(
  db: DatabaseExecutor,
  userId: string,
): Promise<Set<SchoolFeatureKey>> {
  const memberships = await db
    .select({ schoolId: schoolMemberTable.schoolId })
    .from(schoolMemberTable)
    .where(eq(schoolMemberTable.userId, userId));
  const available = new Set<SchoolFeatureKey>();
  for (const { schoolId } of memberships) {
    const features = await getSchoolFeatureFlags(db, schoolId);
    for (const key of SCHOOL_FEATURE_KEYS) if (features[key].active) available.add(key);
    if (available.size === SCHOOL_FEATURE_KEYS.length) break;
  }
  return available;
}
