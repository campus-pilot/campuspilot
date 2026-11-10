import {
  DISABLED_SCHOOL_FEATURE,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolFeatureState,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';

/** The parts of the school feature-flags query that decide what to render. */
export type FeatureFlagsQueryState = {
  isPending: boolean;
  isError: boolean;
  features: SchoolFeatureFlags | undefined;
};

/**
 * One feature's state as the UI may use it. `status` says whether the
 * school's flags have loaded: while `pending` and after an `error` the
 * feature reads as disabled with no config, so callers fail closed without
 * handling loading themselves. `enabled` and `config` are independent: a
 * disabled feature may still carry its stored config.
 */
export type SchoolFeatureView<K extends SchoolFeatureKey> = SchoolFeatureState<K> & {
  status: 'pending' | 'error' | 'ready';
};

/**
 * Resolves one feature from the query state. Pending, failed and missing
 * data all read as disabled (fail closed), like `permissionsSatisfied`.
 */
export function resolveSchoolFeature<K extends SchoolFeatureKey>(
  query: FeatureFlagsQueryState,
  feature: K,
): SchoolFeatureView<K> {
  if (query.isPending) return { ...DISABLED_SCHOOL_FEATURE, status: 'pending' };
  if (query.isError || !query.features) return { ...DISABLED_SCHOOL_FEATURE, status: 'error' };
  return { ...query.features[feature], status: 'ready' };
}
