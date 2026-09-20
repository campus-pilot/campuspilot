import { auth } from '@campuspilot/auth/server';
import { rpcError } from '../../errors';
import { protectedProcedure } from '../../index';
import {
  setPasswordInputSchema,
  setPasswordOutputSchema,
} from './auth.dto';

export const authRouter = {
  setPassword: protectedProcedure
    .route({
      summary: 'Set an account password',
      description:
        'Create the credential password for the authenticated account when it does not already have one.',
      tags: ['Authentication'],
    })
    .input(setPasswordInputSchema)
    .output(setPasswordOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await auth.api.setPassword({
          body: { newPassword: input.newPassword },
          headers: context.headers,
        });
        return { success: true as const };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to set password.';
        throw rpcError.badRequest(message, error);
      }
    }),
};
