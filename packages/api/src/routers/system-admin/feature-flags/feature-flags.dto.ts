import {
  schoolFeatureFlagsSchema,
  schoolFeatureKeySchema,
  schoolFeatureUpdateSchema,
  schoolTierSchema,
} from '@campuspilot/db/feature-flags/catalogue';
import { z } from 'zod';

import { activeSchoolTrialDtoSchema } from '../school/school.dto';

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

/**
 * `{ id, tier }`: the school's new subscribed tier, or null to remove the
 * subscription (the school is then on its trial, or has no plan). Its
 * adjustments are kept.
 */
export const updateSchoolTierInputSchema = z.object({
  id: z.string().min(1),
  tier: schoolTierSchema.nullable(),
});

export const adminSchoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  /**
   * The tier of the school's plan, which decides `included` of every
   * feature: the higher of `subscribedTier` and the active `trial`'s tier.
   * Null when the school has no plan (no feature is included).
   */
  tier: schoolTierSchema.nullable(),
  /** `school.tier`: the tier the school subscribes to; null without a subscription. */
  subscribedTier: schoolTierSchema.nullable(),
  /** The active trial, whether or not it gives the plan; null without one. */
  trial: activeSchoolTrialDtoSchema.nullable(),
  features: schoolFeatureFlagsSchema,
  /**
   * Features whose stored config no longer matches its schema (their
   * `config` reads null). Saving the feature again replaces the stored
   * value and clears it from this list.
   */
  invalidConfigs: z.array(schoolFeatureKeySchema),
});
