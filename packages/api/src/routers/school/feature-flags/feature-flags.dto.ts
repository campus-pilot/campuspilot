import {
  schoolFeatureFlagsSchema,
  schoolFeatureKeySchema,
  schoolTierSchema,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
} from '@campuspilot/db/feature-flags/catalogue';
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

/**
 * The assistant's settings as a school may see them. The stored config holds
 * the limit in dollars (`monthlyLimitUsd`), which schools are never shown
 * (they see the share of it used, `school.getAssistantAllowance`); this shape
 * carries only whether there is one.
 */
export const schoolAssistantConfigSchema = z.object({
  /** Whether the school's AI use is limited (the stored `monthlyLimitUsd` is set). */
  limited: z.boolean(),
  voice: z.object({ enabled: z.boolean() }),
});

export type SchoolAssistantConfig = z.infer<typeof schoolAssistantConfigSchema>;

/**
 * Every feature's state as a school sees it: the catalogue's, with the
 * assistant's config in its school-facing shape ({@link schoolAssistantConfigSchema}).
 * An explicit schema rather than an omission on the client, so the dollar
 * limit never leaves the server. Administrators read the full config
 * (`systemAdmin.getSchoolFeatureFlags`).
 */
export const schoolFacingFeatureFlagsSchema = schoolFeatureFlagsSchema.extend({
  assistant: schoolFeatureFlagsSchema.shape.assistant.extend({ config: schoolAssistantConfigSchema.nullable() }),
});

export type SchoolFacingFeatureFlags = z.infer<typeof schoolFacingFeatureFlagsSchema>;

/** One feature's state as a school sees it, typed by its key. */
export type SchoolFacingFeatureState<K extends SchoolFeatureKey> = SchoolFacingFeatureFlags[K];

/** The school-facing form of every feature's state: the assistant's config without its dollar limit. */
export function toSchoolFacingFeatureFlags(features: SchoolFeatureFlags): SchoolFacingFeatureFlags {
  const { config, ...assistant } = features.assistant;
  return {
    ...features,
    assistant: { ...assistant, config: config && { limited: config.monthlyLimitUsd !== null, voice: config.voice } },
  };
}

/** The tier of a school's plan and every catalogue feature's state, keyed by feature. */
export const schoolFeatureFlagsDtoSchema = z.object({
  schoolId: z.string(),
  /**
   * The tier of the school's plan (its subscription, or a higher active
   * trial); null when it has none. Screens decide from each feature's
   * `active`, never from this.
   */
  tier: schoolTierSchema.nullable(),
  /** Every feature's state; the assistant's config without its dollar limit ({@link schoolFacingFeatureFlagsSchema}). */
  features: schoolFacingFeatureFlagsSchema,
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
  resolveSchoolPlan,
  SCHOOL_PLAN_SOURCES,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolFeatureHasConfig,
  schoolTierCatalogue,
  schoolTierFeatures,
  schoolTierIncludes,
  schoolTierRank,
  schoolTierSchema,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
  type SchoolFeatureUpdate,
  type SchoolPlan,
  type SchoolPlanSource,
  type SchoolTier,
} from '@campuspilot/db/feature-flags/catalogue';
