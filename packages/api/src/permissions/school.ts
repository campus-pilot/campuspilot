import type { SchoolAction } from '@campuspilot/opa/policies/school';

import { o } from '../index';
import { assertPermission } from './authorization';

type SchoolScopedInput = {
  schoolId: string;
};

/**
 * Creates an input-aware oRPC middleware for a school action. The role query is
 * scoped independently by both authenticated user ID and requested school ID;
 * OPA remains the only place that maps those facts to an allow/deny decision.
 */
export function requireSchoolPermission<TInput extends SchoolScopedInput>(
  action: SchoolAction,
) {
  return o.middleware<Record<never, never>, TInput>(
    async ({ context, next, signal }, input) => {
      await assertPermission(
        context,
        {
          action,
          resource: { kind: 'school', schoolId: input.schoolId },
        },
        signal,
      );

      return next();
    },
  );
}
