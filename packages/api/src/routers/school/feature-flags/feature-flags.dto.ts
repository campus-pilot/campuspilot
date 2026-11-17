import { schoolFeatureFlagsSchema, schoolFeatureKeySchema, schoolTierSchema } from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

export const schoolFeatureFlagsInputSchema = z.object({
  schoolId: z.string().min(1),
});

/**
 * The features whose stored config no longer matches its schema. Such a
 * feature still reports its real `enabled` fact; its `config` reads null
 * (unusable), and whatever needs that config answers CONFLICT
 * (`SCHOOL_FEATURE_CONFIG_INVALID`) until an administrator saves it again.
 */
export const invalidFeatureConfigsSchema = z.array(schoolFeatureKeySchema);

/** A school's subscription tier and every catalogue feature's state, keyed by feature. */
export const schoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  /**
   * The school's subscription tier; null when it has none. Screens decide
   * from each feature's `active`, never from this.
   */
  tier: schoolTierSchema.nullable(),
  features: schoolFeatureFlagsSchema,
  invalidConfigs: invalidFeatureConfigsSchema,
});

export type SchoolFeatureFlagsDto = z.infer<typeof schoolFeatureFlagsDtoSchema>;

/**
 * The feature catalogue re-exported for the browser apps, which depend on
 * `@campuspilot/api` but not on `@campuspilot/db`. The catalogue itself
 * imports nothing but Zod, so this stays safe to bundle.
 */
export {
  ASSISTANT_DEFAULT_ROLES,
  DISABLED_SCHOOL_FEATURE,
  missingSchoolFeatureRequirements,
  readSchoolFeatureDisabled,
  SCHOOL_FEATURE_CONFIG_INVALID_REASON,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  SCHOOL_TIERS,
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolFeatureHasConfig,
  schoolTierCatalogue,
  schoolTierFeatures,
  schoolTierIncludes,
  schoolTierSchema,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolFeatureUpdate,
  type SchoolTier,
} from '@campuspilot/db/feature-flags/catalogue';
