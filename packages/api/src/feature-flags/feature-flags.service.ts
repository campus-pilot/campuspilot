import type { DatabaseExecutor } from '@campuspilot/db';
import {
  parseSchoolFeatureConfig,
  SCHOOL_FEATURE_CONFIG_INVALID_REASON,
  SCHOOL_FEATURE_DISABLED_REASON,
  type SchoolFeatureConfig,
  schoolFeatureCatalogue,
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
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { ORPCError } from '@orpc/server';

/**
 * Per-school feature flags (docs/feature-flags.md). Reads come from
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
 * It decides from `enabled` alone (`isSchoolFeatureEnabled`) and never parses
 * the stored config: a gate must not fail because of a setting it does not
 * read. The oRPC middleware `requireSchoolFeature` decides the same way.
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
 * One feature's new state for one school. A union discriminated on
 * `feature` (`SchoolFeatureEntry`), so a caller whose key is not a literal
 * cannot pass one feature's config under another feature's key.
 */
export type SetSchoolFeatureInput = SchoolFeatureEntry & {
  schoolId: string;
  /** The administrator making the change; null only for system writes. */
  updatedBy: string | null;
};

/**
 * Writes one feature's state for a school (insert or replace). `enabled` and
 * `config` are both stored as given: disabling does not clear the config,
 * and the config is validated against the schema of `feature`.
 * The caller verifies that the school exists and that the actor may change
 * flags; pass a transaction to write together with other rows.
 */
export async function setSchoolFeature(
  db: DatabaseExecutor,
  input: SetSchoolFeatureInput,
): Promise<void> {
  const config = parseSchoolFeatureConfig(input.feature, input.config);
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
}
