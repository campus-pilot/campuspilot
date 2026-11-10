import { assistantDelegationEnabled, signAssistantToken } from '@campuspilot/auth/assistant-token';
import { ORPCError } from '@orpc/server';

import type { Context } from '../context';
import { rpcError } from '../errors';
import { assistantAccessError, resolveAssistantAccess } from './access';

export type AssistantRunScope = { schoolId: string; conversationId: string; runId: string };

/**
 * Issues the delegated MCP token one assistant run acts with, in-process: the
 * API's `/model/*` procedures call this while the user is present (sending,
 * approving), and the worker's turn uses the token for every tool call.
 *
 * Refused unless the request is the user's own browser session (API keys,
 * OAuth connectors and assistant tokens never mint one, so delegation never
 * chains), the user is not being impersonated (the assistant's calls carry
 * no impersonation marker, so its changes would be recorded as the user's
 * own), and the user may use the assistant in the school now
 * (`resolveAssistantAccess`: the feature, their role, the school's limit), so
 * a refused user never holds a token.
 */
export async function issueAssistantRunToken(
  context: Context,
  scope: AssistantRunScope,
): Promise<{ token: string; expiresAt: Date }> {
  if (!assistantDelegationEnabled()) {
    throw new ORPCError('PRECONDITION_FAILED', { message: 'The assistant is not configured for this deployment.' });
  }
  if (!context.session) throw rpcError.unauthorized();
  if (context.principal.authMethod !== 'session') {
    throw rpcError.forbidden('An assistant token needs the user’s own session.');
  }
  if (context.session.session.impersonatedBy) {
    throw rpcError.forbidden('The assistant is not available while impersonating a user.');
  }
  const access = await resolveAssistantAccess(context.db, { schoolId: scope.schoolId, userId: context.session.user.id });
  if (access.refusal) throw assistantAccessError(access.refusal);
  return signAssistantToken({ userId: context.session.user.id, ...scope });
}
