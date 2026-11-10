import type { DatabaseExecutor } from '@campuspilot/db';
import {
  parseSchoolFeatureConfig,
  SCHOOL_FEATURE_DISABLED_REASON,
  schoolFeatureCatalogue,
  type SchoolFeatureConfig,
  type SchoolFeatureDisabledData,
  type SchoolFeatureKey,
  type SchoolFeatureState,
} from '@campuspilot/db/feature-flags/catalogue';
import {
  getSchoolFeature,
  getSchoolFeatureFlags,
  isSchoolFeatureEnabled,
} from '@campuspilot/db/feature-flags/store';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { ORPCError } from '@orpc/server';

/**
 * Per-school feature flags (docs/feature-flags.md). Reads come from
 * `@campuspilot/db/feature-flags/store` so the auth package's Cadet sign-in
 * and the API decide from the same query; they are re-exported here so API
 * code has one import.
 */
export { getSchoolFeature, getSchoolFeatureFlags, isSchoolFeatureEnabled };

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
 * Returns the feature's state when it is enabled and throws the
 * feature-disabled error otherwise. Every enforcement point that is not an
 * oRPC middleware (Cadet procedures, the Cadet MCP gate, the manifest blob,
 * password issuing inside `createAdmission`) calls this, so they cannot
 * drift apart.
 */
export async function assertSchoolFeatureEnabled<K extends SchoolFeatureKey>(
  db: DatabaseExecutor,
  schoolId: string,
  key: K,
): Promise<SchoolFeatureState<K> & { enabled: true }> {
  const state = await getSchoolFeature(db, schoolId, key);
  if (!state.enabled) throw schoolFeatureDisabledError(key);
  return { ...state, enabled: true };
}

export type SetSchoolFeatureInput<K extends SchoolFeatureKey> = {
  schoolId: string;
  feature: K;
  enabled: boolean;
  /** Validated against the schema of `feature`; null stores no config. */
  config: SchoolFeatureConfig<K> | null;
  /** The administrator making the change; null only for system writes. */
  updatedBy: string | null;
};

/**
 * Writes one feature's state for a school (insert or replace). `enabled` and
 * `config` are both stored as given: disabling does not clear the config.
 * The caller verifies that the school exists and that the actor may change
 * flags; pass a transaction to write together with other rows.
 */
export async function setSchoolFeature<K extends SchoolFeatureKey>(
  db: DatabaseExecutor,
  input: SetSchoolFeatureInput<K>,
): Promise<SchoolFeatureState<K>> {
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
  return { enabled: input.enabled, config };
}
