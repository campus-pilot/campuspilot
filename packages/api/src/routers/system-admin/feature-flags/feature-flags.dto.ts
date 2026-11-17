import {
  schoolFeatureFlagsSchema,
  schoolFeatureKeySchema,
  schoolFeatureUpdateSchema,
  schoolTierSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

/** The system admin router names the school `id`, like `getSchool`. */
export const adminSchoolFeatureFlagsInputSchema = z.object({
  id: z.string().min(1),
});

/**
 * `{ id, feature, enabled, config }`. The feature part is a discriminated
 * union on `feature`, so `config` is validated against that feature's
 * schema only and another feature's shape is rejected before the handler.
 * `enabled` is the school's adjustment: true or false to set the feature
 * for this school whatever its tier, null to follow the tier.
 */
export const updateSchoolFeatureFlagInputSchema = z
  .object({ id: z.string().min(1) })
  .and(schoolFeatureUpdateSchema);

/** `{ id, tier }`: the school's new subscription tier. Its adjustments are kept. */
export const updateSchoolTierInputSchema = z.object({
  id: z.string().min(1),
  tier: schoolTierSchema,
});

export const adminSchoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  /**
   * The school's subscription tier, which decides `included` of every
   * feature; null when it has none (no feature is included).
   */
  tier: schoolTierSchema.nullable(),
  features: schoolFeatureFlagsSchema,
  /**
   * Features whose stored config no longer matches its schema (their
   * `config` reads null). Saving the feature again replaces the stored
   * value and clears it from this list.
   */
  invalidConfigs: z.array(schoolFeatureKeySchema),
});
