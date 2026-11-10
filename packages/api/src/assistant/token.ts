import { assistantDelegationEnabled, signAssistantToken } from '@campuspilot/auth/assistant-token';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { ORPCError } from '@orpc/server';

import type { Context } from '../context';
import { rpcError } from '../errors';
import { checkPermissions } from '../permissions/authorization';

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
 * own), and the user may use the assistant in the school now.
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
  const [allowed] = await checkPermissions(context, [
    { action: SCHOOL_ACTIONS.USE_ASSISTANT, resource: { kind: 'school', schoolId: scope.schoolId } },
  ]);
  if (!allowed) throw rpcError.forbidden('You do not have permission to use the assistant in this school.');
  return signAssistantToken({ userId: context.session.user.id, ...scope });
}
