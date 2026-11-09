import { admissionTable } from '@campuspilot/db/schema/admission';
import { cadetOauthClient } from '@campuspilot/db/schema/cadet';
import type { RouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { cadetProcedure } from '../../cadet/procedure';
import { rpcError, toRpcError } from '../../errors';
import {
  oauthClientRegistrationMethod,
  oauthClientVerifiedHost,
} from '../../oauth/oauth-client-facts';
import {
  getOAuthConsentClientInputSchema,
  oauthConsentClientSchema,
} from '../auth/auth.dto';
import {
  admissionDtoSchema,
  toAdmissionDto,
} from '../school/admission/admission.dto';
import { cadetNotificationRouter } from './cadet-notification.router';

/**
 * The Cadet Portal's router. It is deliberately not part of `appRouter`, so
 * staff RPC, OpenAPI and MCP can never list or reach these procedures, and
 * cadet transports can never reach staff ones. Every leaf declares MCP
 * metadata like `appRouter` leaves; the cadet MCP catalog is built from it.
 */
export const cadetRouter = {
  ...cadetNotificationRouter,
  getAdmission: cadetProcedure
    .route({
      summary: 'Get my admission',
      description:
        "Get the signed-in student's own admission record (name, admission number, class, contact and parents' details). Takes no input: the student is identified by the sign-in.",
      tags: ['Cadet'],
    })
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'account',
      },
    })
    .output(admissionDtoSchema)
    .handler(async ({ context }) => {
      try {
        const [admission] = await context.db
          .select()
          .from(admissionTable)
          .where(eq(admissionTable.id, context.cadet.admissionId))
          .limit(1);
        if (!admission) throw rpcError.notFound('Admission');
        return toAdmissionDto(admission);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getOAuthConsentClient: cadetProcedure
    .route({
      summary: 'Get an OAuth client for consent',
      description:
        'Return the identity facts the Cadet Portal consent screen shows for an AI app asking to connect: its name, how it was registered and, for Client ID Metadata Documents, the verified host.',
      tags: ['Cadet'],
    })
    .meta({
      // Part of the browser consent flow only; no agent value.
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
      try {
        // Only cadet clients: a staff client id is never found here.
        const [client] = await context.db
          .select({
            clientId: cadetOauthClient.clientId,
            name: cadetOauthClient.name,
            uri: cadetOauthClient.uri,
            disabled: cadetOauthClient.disabled,
            clientDiscoveryId: cadetOauthClient.clientDiscoveryId,
            metadata: cadetOauthClient.metadata,
          })
          .from(cadetOauthClient)
          .where(eq(cadetOauthClient.clientId, input.clientId))
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
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

export type CadetRouter = typeof cadetRouter;
export type CadetRouterClient = RouterClient<typeof cadetRouter>;
