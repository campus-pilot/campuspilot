import { schoolFeatureFlagsSchema } from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

export const schoolFeatureFlagsInputSchema = z.object({
  schoolId: z.string().min(1),
});

/** Every catalogue feature's state for one school, keyed by feature. */
export const schoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  features: schoolFeatureFlagsSchema,
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
  SCHOOL_FEATURE_DISABLED_REASON,
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  schoolFeatureHasConfig,
  type SchoolFeatureConfig,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolFeatureUpdate,
} from '@campuspilot/db/feature-flags/catalogue';
