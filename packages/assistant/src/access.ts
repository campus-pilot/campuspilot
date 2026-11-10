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
 * Whether the user may read their own assistant history in the school: the
 * school has the feature and the user is a member. Neither their role nor
 * the school's limit matters here: a user whose role was switched off, or a
 * school at its limit, keeps its conversations readable. With the feature
 * off everything disappears (the standard disabled-feature error).
 */
export function canRead(decision: AssistantAccessDecision): boolean {
  return decision.featureEnabled && decision.member;
}

/** Throws unless {@link canRead}. */
export function assertCanRead(decision: AssistantAccessDecision): void {
  if (!decision.featureEnabled) throw schoolFeatureDisabledError('assistant');
  if (!decision.member) throw new ORPCError('FORBIDDEN', { message: 'You are not a member of this school.' });
}

/** Throws unless the user may start or continue a turn now (feature, role, limit). */
export function assertCanUse(decision: AssistantAccessDecision): void {
  assertCanRead(decision);
  if (decision.refusal) throw assistantAccessError(decision.refusal);
}

/**
 * Whether the user's role may use the assistant, whatever the limit: the
 * entry points stay visible at the limit so the history and the reason stay
 * in reach.
 */
export function roleAllowed(decision: AssistantAccessDecision): boolean {
  return decision.featureEnabled && decision.member && decision.allowedRoles.length > 0 && decision.refusal?.code !== 'config_invalid';
}
