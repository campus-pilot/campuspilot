import { auth } from '@campuspilot/auth/server';
import { MCP_DEFAULT_SCOPES } from '@campuspilot/auth/mcp-oauth-policy';
import { oauthClient, oauthConsent } from '@campuspilot/db/schema/auth';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import {
  type OAuthClientRegistrationMethod,
  oauthClientRegistrationMethod,
  oauthClientVerifiedHost,
} from '../../../oauth/oauth-client-facts';
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from '../../../paginations';
import { requireSystemPermission } from '../../../permissions/system';
import {
  createOAuthClientInputSchema,
  listOAuthClientsInputSchema,
  listOAuthClientsOutputSchema,
  oauthClientIdInputSchema,
  oauthClientMutationOutputSchema,
  oauthClientSecretOutputSchema,
  setOAuthClientDisabledInputSchema,
} from './oauth-client.dto';

const MCP_META = {
  exposure: 'hidden',
  destructive: false,
  module: 'platform',
} as const;

const recordedMethod = sql`${oauthClient.metadata} ->> 'registrationMethod'`;

/** SQL form of {@link oauthClientRegistrationMethod}, for filtering. */
function registrationMethodCondition(method: OAuthClientRegistrationMethod): SQL {
  const notCimd = or(
    isNull(oauthClient.clientDiscoveryId),
    sql`${oauthClient.clientDiscoveryId} <> 'cimd'`,
  )!;
  switch (method) {
    case 'client_id_metadata_document':
      return eq(oauthClient.clientDiscoveryId, 'cimd');
    case 'pre_registered':
    case 'dynamic':
      return and(notCimd, sql`${recordedMethod} = ${method}`)!;
    case 'unknown':
      return and(
        notCimd,
        sql`coalesce(${recordedMethod}, '') not in ('pre_registered', 'dynamic')`,
      )!;
  }
}

/**
 * Better Auth rejects invalid client input with 4xx API errors (an object
 * with a numeric `statusCode` and an OAuth error body); those become
 * BAD_REQUEST with the server's description, everything else is mapped as usual.
 */
function toOAuthAdminError(error: unknown) {
  const apiError = error as {
    statusCode?: unknown;
    message?: string;
    body?: { error_description?: string };
  } | null;
  if (typeof apiError?.statusCode === 'number' && apiError.statusCode < 500) {
    return rpcError.badRequest(
      apiError.body?.error_description ?? apiError.message ?? 'Invalid OAuth client.',
      error,
    );
  }
  return toRpcError(error);
}

/** Loads a client that must have been pre-registered by an administrator. */
async function findPreRegisteredClient(
  db: typeof import('@campuspilot/db').db,
  clientId: string,
) {
  const [client] = await db
    .select({
      clientId: oauthClient.clientId,
      clientDiscoveryId: oauthClient.clientDiscoveryId,
      metadata: oauthClient.metadata,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client) throw rpcError.notFound('OAuth client');
  if (oauthClientRegistrationMethod(client) !== 'pre_registered') {
    throw rpcError.badRequest(
      'Only pre-registered clients can be changed here. Disable a CIMD or dynamically registered client instead.',
    );
  }
  return client;
}

/**
 * Platform administration of OAuth clients (decision D8): pre-registered
 * clients are created, rotated and deleted here through Better Auth's own
 * endpoints (which hash secrets); any client can be disabled, which stops new
 * authorizations and, through the MCP gate's liveness check, existing
 * connections on their next request. Hidden from MCP: these hand out client
 * secrets.
 */
export const oauthClientRouter = {
  listOAuthClients: protectedProcedure
    .route({
      summary: 'List OAuth clients',
      description:
        'List every OAuth client of the MCP authorization server (Client ID Metadata Document, dynamically registered and pre-registered) with search, filters and connection counts. Requires system-administrator permission.',
      tags: ['System Admin', 'OAuth'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(listOAuthClientsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_OAUTH_CLIENTS))
    .output(listOAuthClientsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const search = input.searchQuery
          ? or(
              ilike(oauthClient.name, `%${input.searchQuery}%`),
              ilike(oauthClient.clientId, `%${input.searchQuery}%`),
            )
          : undefined;
        const method = input.filters?.registrationMethod
          ? registrationMethodCondition(input.filters.registrationMethod)
          : undefined;
        const disabled =
          input.filters?.disabled === undefined
            ? undefined
            : input.filters.disabled
              ? eq(oauthClient.disabled, true)
              : or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false));
        const where = and(search, method, disabled);
        const direction = input.orderBy.direction === 'asc' ? asc : desc;
        const orderColumn = {
          createdAt: oauthClient.createdAt,
          name: oauthClient.name,
        }[input.orderBy.field];
        const connections = context.db
          .select({ clientId: oauthConsent.clientId, total: count().as('total') })
          .from(oauthConsent)
          .groupBy(oauthConsent.clientId)
          .as('connections');

        const [rows, totalRows] = await Promise.all([
          context.db
            .select({
              clientId: oauthClient.clientId,
              name: oauthClient.name,
              uri: oauthClient.uri,
              redirectUris: oauthClient.redirectUris,
              tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
              disabled: oauthClient.disabled,
              createdAt: oauthClient.createdAt,
              clientDiscoveryId: oauthClient.clientDiscoveryId,
              metadata: oauthClient.metadata,
              connectionCount: connections.total,
            })
            .from(oauthClient)
            .leftJoin(connections, eq(connections.clientId, oauthClient.clientId))
            .where(where)
            .orderBy(sql`${direction(orderColumn)} nulls last`, asc(oauthClient.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(oauthClient).where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: rows.map((row) => {
            const registrationMethod = oauthClientRegistrationMethod(row);
            return {
              clientId: row.clientId,
              name: row.name,
              uri: row.uri,
              registrationMethod,
              verifiedHost: oauthClientVerifiedHost(row.clientId, registrationMethod),
              redirectUris: row.redirectUris,
              tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
              disabled: row.disabled === true,
              createdAt: row.createdAt,
              connectionCount: Number(row.connectionCount ?? 0),
            };
          }),
          nextCursor: createNextPageCursor(currentPage, totalPages),
          currentPage,
          totalPages,
          totalItems,
          pageSize,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createOAuthClient: protectedProcedure
    .route({
      summary: 'Create a pre-registered OAuth client',
      description:
        'Create a confidential OAuth client for an AI app that needs a client ID and secret (for example Gemini Enterprise). The secret is returned only once. Requires system-administrator permission.',
      tags: ['System Admin', 'OAuth'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write' } })
    .input(createOAuthClientInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_OAUTH_CLIENT))
    .output(oauthClientSecretOutputSchema)
    .handler(async ({ context, input }) => {
      let created: { client_id: string; client_secret?: string };
      try {
        created = await auth.api.createOAuthClient({
          body: {
            client_name: input.name,
            redirect_uris: input.redirectUris,
            token_endpoint_auth_method: input.tokenEndpointAuthMethod,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: MCP_DEFAULT_SCOPES.join(' '),
          },
          headers: context.headers,
        });
      } catch (error) {
        throw toOAuthAdminError(error);
      }
      try {
        if (!created.client_secret) {
          throw new Error('The authorization server returned no client secret.');
        }
        await context.db
          .update(oauthClient)
          .set({
            metadata: sql`coalesce(${oauthClient.metadata}, '{}'::jsonb) || ${JSON.stringify({ registrationMethod: 'pre_registered' })}::jsonb`,
          })
          .where(eq(oauthClient.clientId, created.client_id));
        return { clientId: created.client_id, clientSecret: created.client_secret };
      } catch (error) {
        // Never leave a client whose registration method is unrecorded.
        await context.db
          .delete(oauthClient)
          .where(eq(oauthClient.clientId, created.client_id));
        throw toRpcError(error);
      }
    }),

  rotateOAuthClientSecret: protectedProcedure
    .route({
      summary: 'Rotate an OAuth client secret',
      description:
        'Replace the secret of a pre-registered OAuth client. The old secret stops working immediately and the new one is returned only once. Requires system-administrator permission.',
      tags: ['System Admin', 'OAuth'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write', destructive: true } })
    .input(oauthClientIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_OAUTH_CLIENT))
    .output(oauthClientSecretOutputSchema)
    .handler(async ({ context, input }) => {
      await findPreRegisteredClient(context.db, input.clientId).catch((error) => {
        throw toRpcError(error);
      });
      try {
        const rotated = await auth.api.rotateClientSecret({
          body: { client_id: input.clientId },
          headers: context.headers,
        });
        if (!rotated.client_secret) {
          throw new Error('The authorization server returned no client secret.');
        }
        return { clientId: input.clientId, clientSecret: rotated.client_secret };
      } catch (error) {
        throw toOAuthAdminError(error);
      }
    }),

  deleteOAuthClient: protectedProcedure
    .route({
      summary: 'Delete a pre-registered OAuth client',
      description:
        'Delete a pre-registered OAuth client together with its connections and tokens. Clients registered through CIMD or DCR are disabled instead. Requires system-administrator permission.',
      tags: ['System Admin', 'OAuth'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write', destructive: true } })
    .input(oauthClientIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.DELETE_OAUTH_CLIENT))
    .output(oauthClientMutationOutputSchema)
    .handler(async ({ context, input }) => {
      await findPreRegisteredClient(context.db, input.clientId).catch((error) => {
        throw toRpcError(error);
      });
      try {
        await auth.api.deleteOAuthClient({
          body: { client_id: input.clientId },
          headers: context.headers,
        });
        return { success: true as const };
      } catch (error) {
        throw toOAuthAdminError(error);
      }
    }),

  setOAuthClientDisabled: protectedProcedure
    .route({
      summary: 'Disable or enable an OAuth client',
      description:
        'Disable an OAuth client (for example an abusive dynamically registered one) or enable it again. A disabled client cannot authorize, and its existing connections stop on their next request. Requires system-administrator permission.',
      tags: ['System Admin', 'OAuth'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write', destructive: true } })
    .input(setOAuthClientDisabledInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_OAUTH_CLIENT))
    .output(oauthClientMutationOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const updated = await context.db
          .update(oauthClient)
          .set({ disabled: input.disabled, updatedAt: new Date() })
          .where(eq(oauthClient.clientId, input.clientId))
          .returning({ clientId: oauthClient.clientId });
        if (updated.length === 0) throw rpcError.notFound('OAuth client');
        return { success: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
