import {
  DISABLED_SCHOOL_FEATURE,
  readSchoolFeatureDisabled,
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
 * One feature's state as the UI may use it. `status` says what is known:
 * - `ready`: the school's flags are known; `enabled` is the truth, on or off;
 * - `pending`: the first read is still running;
 * - `unknown`: the flags could not be read and none are held from before.
 *   This is **not** "disabled": the school may well have the feature, so
 *   screens offer a retry instead of saying it is not enabled.
 * While `pending` or `unknown`, `enabled` is false and `config` null, so
 * callers that only gate on `enabled` fail closed without more handling.
 * `enabled` and `config` are independent: a disabled feature may still
 * carry its stored config.
 */
export type SchoolFeatureView<K extends SchoolFeatureKey> = SchoolFeatureState<K> & {
  status: 'pending' | 'unknown' | 'ready';
};

/**
 * Resolves one feature from the query state.
 *
 * Known flags win over a failed request: TanStack Query keeps the last
 * good data when a background refetch fails (returning to the tab on a
 * flaky network sets `isError` with `data` still present). Reading that as
 * "disabled" used to replace open pages, including a half-written notice,
 * with "not enabled". Only a read that never succeeded is `unknown`.
 */
export function resolveSchoolFeature<K extends SchoolFeatureKey>(
  query: FeatureFlagsQueryState,
  feature: K,
): SchoolFeatureView<K> {
  if (query.features) return { ...query.features[feature], status: 'ready' };
  if (query.isPending) return { ...DISABLED_SCHOOL_FEATURE, status: 'pending' };
  return { ...DISABLED_SCHOOL_FEATURE, status: 'unknown' };
}

/**
 * Whether a failed request says the cached flags are out of date: the
 * server refused it because a feature is switched off (an administrator
 * changed it while the app was open). The flags are then read again, so
 * navigation, actions and pages of that feature close at once instead of
 * staying on screen until the next refetch.
 */
export function featureFlagsOutdatedBy(error: unknown): boolean {
  return readSchoolFeatureDisabled(error) !== null;
}
