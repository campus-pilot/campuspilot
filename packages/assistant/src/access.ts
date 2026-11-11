import {
  assistantAccessError,
  resolveAssistantAccess,
  type AssistantAccessDecision,
} from '@campuspilot/api/assistant/access';
import { schoolFeatureDisabledError } from '@campuspilot/api/feature-flags/feature-flags.service';
import { ORPCError } from '@orpc/server';

import { db } from './db';
import type { AssistantSession } from './session';

export type { AssistantAccessDecision };

/**
 * The API's one access decision (`resolveAssistantAccess`) for the user of a
 * `/model/*` request. Every gate below reads its facts; none decides on its
 * own.
 */
export async function loadAssistantAccess(session: AssistantSession, schoolId: string): Promise<AssistantAccessDecision> {
  return resolveAssistantAccess(db, { schoolId, userId: session.user.id });
}

/**
 * Whether the user may see the assistant in the school at all: the school
 * has the feature, the user is a member, and one of their roles is eligible
 * and switched on by the school. Everything of `resolveAssistantAccess`
 * except the monthly limit: at the limit the history stays visible (the
 * composer says why it cannot send); for anyone else the assistant
 * disappears, history included.
 */
export function canSee(decision: AssistantAccessDecision): boolean {
  return decision.featureEnabled && decision.member && decision.allowedRoles.length > 0;
}

/** Throws unless the school has the feature and the user is a member (the status check's precondition). */
export function assertMember(decision: AssistantAccessDecision): void {
  if (!decision.featureEnabled) throw schoolFeatureDisabledError('assistant');
  if (!decision.member) throw new ORPCError('FORBIDDEN', { message: 'You are not a member of this school.' });
}

/** Throws unless {@link canSee}: reading history, deleting, stopping and declining. */
export function assertCanSee(decision: AssistantAccessDecision): void {
  assertMember(decision);
  if (canSee(decision)) return;
  throw assistantAccessError(decision.refusal ?? { code: 'role_not_enabled', message: 'You cannot use the AI assistant in this school.' });
}

/** Throws unless the user may start or continue a turn now (feature, role, limit). */
export function assertCanUse(decision: AssistantAccessDecision): void {
  assertCanSee(decision);
  if (decision.refusal) throw assistantAccessError(decision.refusal);
}
