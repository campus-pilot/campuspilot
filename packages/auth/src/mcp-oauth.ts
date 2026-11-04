import type { DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource as fetchClientMetadataResourceOverNetwork } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import { createAuthMiddleware } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { and, eq, isNull, lt, notExists, sql } from 'drizzle-orm';

import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_DEFAULT_SCOPES,
  MCP_REFRESH_TOKEN_REUSE_INTERVAL_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS,
  OAUTH_CONSENT_PATH,
  OAUTH_LOGIN_PATH,
  OAUTH_SUPPORTED_SCOPES,
} from './mcp-oauth-policy';

/**
 * How an OAuth client came to exist, recorded explicitly in the client's
 * `metadata.registrationMethod` (CIMD clients are additionally identified by
 * `clientDiscoveryId`, which the CIMD plugin sets).
 */
export type OAuthClientRegistrationMethod =
  | 'pre_registered'
  | 'dynamic'
  | 'client_id_metadata_document';

export type McpOAuthOptions = {
  /**
   * Transport for Client ID Metadata Documents. Defaults to the SSRF-safe
   * Node transport (public addresses only, pinned connection, no redirects);
   * tests inject a stub metadata host.
   */
  fetchClientMetadataResource?: ClientMetadataResourceFetch;
};

/** Better Auth's base path; the issuer is the auth base URL plus this. */
export const AUTH_BASE_PATH = '/api/auth';

/** OAuth issuer (`${BETTER_AUTH_URL}/api/auth`), identical in every document. */
export function oauthIssuer(): string {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${AUTH_BASE_PATH}`;
}

/**
 * Authorization-server plugins for MCP connectors: `jwt()` signs access
 * tokens, `mcp()` is the OAuth 2.1 provider bound to the MCP resource, and
 * `cimd()` resolves Client ID Metadata Documents. Options follow the decided
 * policy: CIMD + pre-registered + open DCR (rate-limited), user-wide grants
 * without a school step, 1 h access tokens, 90-day rotating refresh tokens.
 */
export function mcpOAuthPlugins(options: McpOAuthOptions = {}) {
  return [
    jwt({
      // Session responses must not carry a JWT; access tokens come only from
      // the OAuth token endpoint.
      disableSettingJwtHeader: true,
    }),
    mcp({
      resource: env.MCP_RESOURCE_URL,
      loginPage: new URL(OAUTH_LOGIN_PATH, env.PUBLIC_APP_URL).toString(),
      consentPage: new URL(OAUTH_CONSENT_PATH, env.PUBLIC_APP_URL).toString(),
      scopes: [...OAUTH_SUPPORTED_SCOPES],
      // Only user-facing flows; no machine-to-machine client_credentials.
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
      refreshTokenReuseInterval: MCP_REFRESH_TOKEN_REUSE_INTERVAL_SECONDS,
      // DCR stays for clients that require it (Gemini app, Gemini CLI,
      // Cursor). It is unauthenticated as RFC 7591 intends, rate-limited per
      // IP, and every such client still sees the consent page.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
      clientRegistrationDefaultScopes: [...MCP_DEFAULT_SCOPES],
      clientRegistrationAllowedScopes: [...OAUTH_SUPPORTED_SCOPES],
      clientRegistrationRequirePKCE: true,
      rateLimit: { register: { window: 60, max: 5 } },
      /**
       * Client CRUD through the OAuth endpoints (create/list/update/delete,
       * secret rotation) is for platform administrators only; school users
       * connect clients through CIMD, DCR or a pre-registered client.
       */
      clientPrivileges: ({ user }) => user?.role === 'admin',
    }),
    cimd({
      fetchClientMetadataResource:
        options.fetchClientMetadataResource ??
        fetchClientMetadataResourceOverNetwork,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ];
}

/**
 * Records that a client was created through Dynamic Client Registration, so
 * cleanup and the admin client list never have to guess it from other fields.
 * Any `registrationMethod` the registrant sent is overwritten.
 */
export function recordDynamicClientRegistration(db: DatabaseExecutor) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/oauth2/register') return;
    const returned = ctx.context.returned as { client_id?: unknown } | undefined;
    if (!returned || typeof returned.client_id !== 'string') return;
    await db
      .update(schema.oauthClient)
      .set({
        metadata: sql`coalesce(${schema.oauthClient.metadata}, '{}'::jsonb) || ${JSON.stringify({ registrationMethod: 'dynamic' satisfies OAuthClientRegistrationMethod })}::jsonb`,
      })
      .where(eq(schema.oauthClient.clientId, returned.client_id));
  });
}

/**
 * Deletes dynamically registered clients that are older than
 * MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS and never received a grant (no consent,
 * no access or refresh token). DCR creates a client per connection attempt,
 * so abandoned registrations would otherwise accumulate. Idempotent; safe to
 * run on several server instances.
 */
export async function deleteUnusedDynamicOAuthClients(
  db: DatabaseExecutor,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const client = schema.oauthClient;
  const deleted = await db
    .delete(client)
    .where(
      and(
        sql`${client.metadata} ->> 'registrationMethod' = 'dynamic'`,
        isNull(client.clientDiscoveryId),
        lt(client.createdAt, cutoff),
        notExists(
          db
            .select({ id: schema.oauthConsent.id })
            .from(schema.oauthConsent)
            .where(eq(schema.oauthConsent.clientId, client.clientId)),
        ),
        notExists(
          db
            .select({ id: schema.oauthRefreshToken.id })
            .from(schema.oauthRefreshToken)
            .where(eq(schema.oauthRefreshToken.clientId, client.clientId)),
        ),
        notExists(
          db
            .select({ id: schema.oauthAccessToken.id })
            .from(schema.oauthAccessToken)
            .where(eq(schema.oauthAccessToken.clientId, client.clientId)),
        ),
      ),
    )
    .returning({ clientId: client.clientId });
  return deleted.length;
}
