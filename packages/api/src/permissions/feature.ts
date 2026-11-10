import type {
  SchoolFeatureKey,
  SchoolFeatureState,
} from '@campuspilot/db/feature-flags/catalogue';

import { assertSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';
import { o } from '../index';

type SchoolScopedInput = {
  schoolId: string;
};

/**
 * Creates an input-aware oRPC middleware that refuses the procedure unless
 * the input school has `feature` enabled, and hands the handler the
 * feature's typed state as `context.feature` (`context.feature.config` is
 * that feature's config type only).
 *
 * A feature flag is not authorization: it says what the school has, not who
 * may act. Attach it after `.input(...)` and **after** the permission
 * middleware, so a caller without access to the school gets the ordinary
 * FORBIDDEN and cannot probe which features a school has:
 *
 *   .use(requireSchoolPermission(SCHOOL_ACTIONS.X))
 *   .use(requireSchoolFeature('notices'))
 *
 * A disabled feature throws FORBIDDEN with
 * `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature }`.
 */
export function requireSchoolFeature<
  K extends SchoolFeatureKey,
  TInput extends SchoolScopedInput = SchoolScopedInput,
>(feature: K) {
  return o.middleware<{ feature: SchoolFeatureState<K> & { enabled: true } }, TInput>(
    async ({ context, next }, input) => {
      const state = await assertSchoolFeatureEnabled(
        context.db,
        input.schoolId,
        feature,
      );
      return next({ context: { feature: state } });
    },
  );
}
