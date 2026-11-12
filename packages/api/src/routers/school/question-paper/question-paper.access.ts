import type { DatabaseExecutor } from '@campuspilot/db';

import { assistantAccessError, resolveAssistantAccess } from '../../../assistant/access';
import { rpcError } from '../../../errors';
import { o } from '../../../index';

/**
 * The question paper feature is part of the AI assistant (decision D26): it is
 * available to a user exactly when the assistant is, and it is hidden and
 * refused when it is not. The gate is the assistant's own decision
 * (`resolveAssistantAccess`), never a copy of its rules.
 *
 * Seeing and managing papers needs the facts every use of the assistant
 * needs except the monthly limit: the school has the `assistant` feature,
 * the user is a member, and one of their roles is both eligible and switched
 * on (this mirrors `canSee` in `packages/assistant/src/access.ts`, which this
 * package cannot import). Anything that spends model money, today only
 * starting a generation, also needs the school to be under its monthly limit
 * (`useModel`), so a school that reached its limit can still read, download
 * and edit papers it already has.
 */
export async function assertQuestionPaperAssistantAccess(
  db: DatabaseExecutor,
  input: { schoolId: string; userId: string },
  options: { useModel?: boolean } = {},
): Promise<void> {
  const decision = await resolveAssistantAccess(db, input);
  const canSee = decision.featureEnabled && decision.member && decision.allowedRoles.length > 0;
  if (!canSee || (options.useModel && decision.refusal)) {
    throw assistantAccessError(
      decision.refusal ?? { code: 'role_not_enabled', message: 'You cannot use the AI assistant in this school.' },
    );
  }
}

/**
 * Procedure middleware for the gate. It must come **after** the permission
 * middleware (`requireClassPermission` or `requireSchoolPermission`), so a
 * caller without access learns nothing about the school's features (the same
 * ordering rule as `requireSchoolFeature`).
 */
export function requireQuestionPaperAssistantAccess(options: { useModel?: boolean } = {}) {
  return o.middleware<Record<never, never>, { schoolId: string }>(async ({ context, next }, input) => {
    const userId = context.session?.user.id;
    if (!userId) throw rpcError.unauthorized();
    await assertQuestionPaperAssistantAccess(context.db, { schoolId: input.schoolId, userId }, options);
    return next();
  });
}
