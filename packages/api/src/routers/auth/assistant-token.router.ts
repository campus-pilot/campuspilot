import {
  assistantDelegationEnabled,
  ASSISTANT_SERVICE_SECRET_HEADER,
  isAssistantServiceSecret,
  signAssistantToken,
} from '@campuspilot/auth/assistant-token';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import { rpcError } from '../../errors';
import { protectedProcedure } from '../../index';
import { requireSchoolPermission } from '../../permissions/school';

export const issueAssistantTokenInputSchema = z.object({
  schoolId: z.string().min(1),
  conversationId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
});

export const issueAssistantTokenOutputSchema = z.object({
  token: z.string(),
  expiresAt: z.date(),
});

export const assistantTokenRouter = {
  /**
   * Issues the assistant service a short-lived MCP token for one user, school,
   * conversation and run. Two independent proofs are required: the user's
   * live browser session (forwarded by the service) and the service secret.
   * API keys, OAuth connectors and assistant tokens themselves cannot mint
   * one, so delegation never chains.
   */
  issueAssistantToken: protectedProcedure
    .route({
      summary: 'Issue an assistant access token',
      description:
        'Issue the CampusPilot assistant service a short-lived token to act for the signed-in user in one school and conversation. Only the assistant service can call this.',
      tags: ['Authentication'],
    })
    .meta({
      mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'account' },
    })
    .input(issueAssistantTokenInputSchema)
    .use(async ({ context, next }) => {
      if (!assistantDelegationEnabled()) {
        throw new ORPCError('PRECONDITION_FAILED', {
          message: 'The assistant is not configured for this deployment.',
        });
      }
      if (context.principal.authMethod !== 'session') {
        throw rpcError.forbidden('An assistant token needs the user’s own session.');
      }
      // An admin impersonating a user must not act through the assistant:
      // the assistant's calls carry no impersonation marker, so its changes
      // would be recorded as the user's own.
      if (context.session.session.impersonatedBy) {
        throw rpcError.forbidden('The assistant is not available while impersonating a user.');
      }
      if (!isAssistantServiceSecret(context.headers.get(ASSISTANT_SERVICE_SECRET_HEADER))) {
        throw rpcError.forbidden('Only the assistant service can request this token.');
      }
      return next();
    })
    .use(requireSchoolPermission(SCHOOL_ACTIONS.USE_ASSISTANT))
    .output(issueAssistantTokenOutputSchema)
    .handler(({ context, input }) =>
      signAssistantToken({
        userId: context.session.user.id,
        schoolId: input.schoolId,
        conversationId: input.conversationId,
        runId: input.runId,
      }),
    ),
};
