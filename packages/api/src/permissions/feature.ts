import type { SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';

import { assertSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';
import { o } from '../index';

type SchoolScopedInput = {
  schoolId: string;
};

/**
 * Creates an input-aware oRPC middleware that refuses the procedure unless
 * the input school has `feature` enabled.
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
 *
 * The gate decides from the `enabled` fact alone, exactly like every other
 * enforcement point (`assertSchoolFeatureEnabled`). It does not read or
 * parse the feature's stored config and adds nothing to the context: a
 * config that no longer matches its schema must not turn every procedure of
 * the feature into a server error. A handler that uses the config reads it
 * itself with `getSchoolFeatureConfig(context.db, input.schoolId, feature)`,
 * which is the only call that can fail on it (CONFLICT,
 * `SCHOOL_FEATURE_CONFIG_INVALID`).
 */
export function requireSchoolFeature<TInput extends SchoolScopedInput = SchoolScopedInput>(feature: SchoolFeatureKey) {
  return o.middleware<Record<never, never>, TInput>(async ({ context, next }, input) => {
    await assertSchoolFeatureEnabled(context.db, input.schoolId, feature);
    return next();
  });
}
