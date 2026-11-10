import {
  schoolFeatureFlagsSchema,
  schoolFeatureUpdateSchema,
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
 */
export const updateSchoolFeatureFlagInputSchema = z
  .object({ id: z.string().min(1) })
  .and(schoolFeatureUpdateSchema);

export const adminSchoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  features: schoolFeatureFlagsSchema,
});
