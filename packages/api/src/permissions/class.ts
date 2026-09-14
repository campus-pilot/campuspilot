import type { ClassAction } from '@campuspilot/opa/policies/class';

import { o } from '../index';
import { assertPermission } from './authorization';

type ClassScopedInput = {
  schoolId: string;
  classId: string;
};

/**
 * Requires a class-scoped policy decision. A role at another school or a role
 * whose metadata does not contain this class ID cannot satisfy the policy.
 */
export function requireClassPermission<TInput extends ClassScopedInput>(
  action: ClassAction,
) {
  return o.middleware<Record<never, never>, TInput>(
    async ({ context, next, signal }, input) => {
      await assertPermission(
        context,
        {
          action,
          resource: {
            kind: 'class',
            schoolId: input.schoolId,
            classId: input.classId,
          },
        },
        signal,
      );

      return next();
    },
  );
}
