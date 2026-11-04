import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from '@campuspilot/db/schema/auth';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../errors';
import { protectedProcedure } from '../../index';
import {
  oauthClientRegistrationMethod,
  oauthClientVerifiedHost,
} from '../../oauth/oauth-client-facts';
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from '../../paginations';
import {
  disconnectOAuthConnectionInputSchema,
  disconnectOAuthConnectionOutputSchema,
  listOAuthConnectionsInputSchema,
  listOAuthConnectionsOutputSchema,
} from './oauth-connection.dto';

/**
 * The signed-in user's own AI-app connections (OAuth grants). These are
 * identity-scoped like API keys: a user sees and disconnects only their own,
 * so no OPA action is involved. They are hidden from MCP because connecting
 * and disconnecting apps stays a human action.
 */
export const oauthConnectionRouter = {
  listOAuthConnections: protectedProcedure
    .route({
      summary: 'List my connected AI apps',
      description:
        'List the AI apps (OAuth clients) the signed-in user has connected to CampusPilot, with their granted scopes and when they were connected and last used.',
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
    .input(listOAuthConnectionsInputSchema)
    .output(listOAuthConnectionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const where = eq(oauthConsent.userId, context.session.user.id);
        const direction = input.orderBy.direction === 'asc' ? asc : desc;
        const orderColumn = {
          connectedAt: oauthConsent.createdAt,
          lastUsedAt: oauthConsent.lastUsedAt,
        }[input.orderBy.field];

        const [rows, totalRows] = await Promise.all([
          context.db
            .select({
              clientId: oauthConsent.clientId,
              scopes: oauthConsent.scopes,
              connectedAt: oauthConsent.createdAt,
              lastUsedAt: oauthConsent.lastUsedAt,
              name: oauthClient.name,
              clientDiscoveryId: oauthClient.clientDiscoveryId,
              metadata: oauthClient.metadata,
            })
            .from(oauthConsent)
            .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
            .where(where)
            .orderBy(
              sql`${direction(orderColumn)} nulls last`,
              asc(oauthConsent.id),
            )
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(oauthConsent).where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: rows.map((row) => {
            const registrationMethod = oauthClientRegistrationMethod(row);
            return {
              clientId: row.clientId,
              name: row.name,
              registrationMethod,
              verifiedHost: oauthClientVerifiedHost(row.clientId, registrationMethod),
              scopes: row.scopes,
              connectedAt: row.connectedAt,
              lastUsedAt: row.lastUsedAt,
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

  disconnectOAuthConnection: protectedProcedure
    .route({
      summary: 'Disconnect an AI app',
      description:
        "Disconnect one of the signed-in user's AI apps: its consent is deleted and its refresh and access tokens are revoked, so the app loses access on its next request.",
      tags: ['Authentication'],
    })
    .meta({
      mcp: {
        exposure: 'hidden',
        access: 'write',
        destructive: true,
        module: 'account',
      },
    })
    .input(disconnectOAuthConnectionInputSchema)
    .output(disconnectOAuthConnectionOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const userId = context.session.user.id;
        return await context.db.transaction(async (transaction) => {
          const deleted = await transaction
            .delete(oauthConsent)
            .where(
              and(
                eq(oauthConsent.userId, userId),
                eq(oauthConsent.clientId, input.clientId),
              ),
            )
            .returning({ id: oauthConsent.id });
          if (deleted.length === 0) throw rpcError.notFound('Connection');

          const revokedAt = new Date();
          await transaction
            .update(oauthRefreshToken)
            .set({ revoked: revokedAt })
            .where(
              and(
                eq(oauthRefreshToken.userId, userId),
                eq(oauthRefreshToken.clientId, input.clientId),
                isNull(oauthRefreshToken.revoked),
              ),
            );
          await transaction
            .update(oauthAccessToken)
            .set({ revoked: revokedAt })
            .where(
              and(
                eq(oauthAccessToken.userId, userId),
                eq(oauthAccessToken.clientId, input.clientId),
                isNull(oauthAccessToken.revoked),
              ),
            );
          return { success: true as const };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
