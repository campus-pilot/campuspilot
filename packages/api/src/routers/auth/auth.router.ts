import { auth } from '@campuspilot/auth/server';
import { oauthClient } from '@campuspilot/db/schema/auth';
import { eq } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { protectedProcedure } from '../../index';
import {
  oauthClientRegistrationMethod,
  oauthClientVerifiedHost,
} from '../../oauth/oauth-client-facts';
import { oauthConnectionRouter } from './oauth-connection.router';
import {
  getOAuthConsentClientInputSchema,
  oauthConsentClientSchema,
  setPasswordInputSchema,
  setPasswordOutputSchema,
} from './auth.dto';

export const authRouter = {
  ...oauthConnectionRouter,
  setPassword: protectedProcedure
    .route({
      summary: 'Set an account password',
      description:
        'Create the credential password for the authenticated account when it does not already have one.',
      tags: ['Authentication'],
    })
    .meta({
      mcp: {
        exposure: 'hidden',
        access: 'write',
        destructive: false,
        module: 'account',
      },
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
  getOAuthConsentClient: protectedProcedure
    .route({
      summary: 'Get an OAuth client for consent',
      description:
        'Return the identity facts the consent screen shows for an AI app asking to connect: its name, how it was registered and, for Client ID Metadata Documents, the verified host.',
      tags: ['Authentication'],
    })
    .meta({
      mcp: {
        exposure: 'hidden',
        access: 'read',
        destructive: false,
        module: 'account',
      },
    })
    .input(getOAuthConsentClientInputSchema)
    .output(oauthConsentClientSchema)
    .handler(async ({ context, input }) => {
      const [client] = await context.db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          uri: oauthClient.uri,
          disabled: oauthClient.disabled,
          clientDiscoveryId: oauthClient.clientDiscoveryId,
          metadata: oauthClient.metadata,
        })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, input.clientId))
        .limit(1);
      if (!client || client.disabled) throw rpcError.notFound('OAuth client');

      const registrationMethod = oauthClientRegistrationMethod(client);
      return {
        clientId: client.clientId,
        name: client.name,
        uri: client.uri,
        registrationMethod,
        verifiedHost: oauthClientVerifiedHost(client.clientId, registrationMethod),
      };
    }),
};
