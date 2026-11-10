import { schoolFeatureFlagsSchema, schoolFeatureKeySchema } from '@campuspilot/db/feature-flags/catalogue';
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

/** Every catalogue feature's state for one school, keyed by feature. */
export const schoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
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
  DISABLED_SCHOOL_FEATURE,
  readSchoolFeatureDisabled,
  SCHOOL_FEATURE_CONFIG_INVALID_REASON,
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolFeatureHasConfig,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolFeatureUpdate,
} from '@campuspilot/db/feature-flags/catalogue';
