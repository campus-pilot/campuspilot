import type { DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import {
  cadetOauthAccessToken,
  cadetOauthClient,
  cadetOauthConsent,
  cadetOauthRefreshToken,
} from '@campuspilot/db/schema/cadet';
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
  PLATFORM_OAUTH_CLIENT_OWNER,
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

/** Issuer of a Better Auth instance mounted at `basePath`. */
export function issuerFor(basePath: string): string {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, '')}${basePath}`;
}

/** OAuth issuer (`${BETTER_AUTH_URL}/api/auth`), identical in every document. */
export function oauthIssuer(): string {
  return issuerFor(AUTH_BASE_PATH);
}

type ClientPolicyContext = { user?: Record<string, unknown> };

/**
 * What differs between the staff and the cadet MCP authorization servers.
 * Everything else (token lifetimes, PKCE, DCR rate limit, CIMD) is the same
 * decided policy for both.
 */
export type McpOAuthServerConfig = {
  /** Canonical MCP URL: the protected resource and access-token audience. */
  resource: string;
  loginPage: string;
  consentPage: string;
  /** Every scope the authorization server accepts. */
  scopes: readonly string[];
  /** Scopes a dynamically registered client gets when it asks for none. */
  defaultScopes: readonly string[];
  /** Who may create, list, update and delete clients through OAuth endpoints. */
  clientPrivileges: (context: ClientPolicyContext) => boolean;
  /** Owner (`referenceId`) recorded on clients created through those endpoints. */
  clientReference: (context: ClientPolicyContext) => string | undefined;
};

/**
 * The staff MCP authorization server: resource `MCP_RESOURCE_URL`, pages on
 * the management app, and client CRUD for platform administrators only
 * (school users connect clients through CIMD, DCR or a pre-registered
 * client). Clients an administrator creates belong to the platform, not to
 * that administrator, so every platform administrator can manage them.
 */
export function staffMcpOAuthConfig(): McpOAuthServerConfig {
  return {
    resource: env.MCP_RESOURCE_URL,
    loginPage: new URL(OAUTH_LOGIN_PATH, env.PUBLIC_APP_URL).toString(),
    consentPage: new URL(OAUTH_CONSENT_PATH, env.PUBLIC_APP_URL).toString(),
    scopes: OAUTH_SUPPORTED_SCOPES,
    defaultScopes: MCP_DEFAULT_SCOPES,
    clientPrivileges: ({ user }) => user?.role === 'admin',
    clientReference: ({ user }) =>
      user?.role === 'admin' ? PLATFORM_OAUTH_CLIENT_OWNER : undefined,
  };
}

/**
 * Authorization-server plugins for MCP connectors: `jwt()` signs access
 * tokens, `mcp()` is the OAuth 2.1 provider bound to the MCP resource, and
 * `cimd()` resolves Client ID Metadata Documents. Options follow the decided
 * policy: CIMD + pre-registered + open DCR (rate-limited), user-wide grants
 * without a school step, 1 h access tokens, 90-day rotating refresh tokens.
 */
export function mcpOAuthPlugins(
  config: McpOAuthServerConfig,
  options: McpOAuthOptions = {},
) {
  return [
    jwt({
      // Session responses must not carry a JWT; access tokens come only from
      // the OAuth token endpoint.
      disableSettingJwtHeader: true,
    }),
    mcp({
      resource: config.resource,
      loginPage: config.loginPage,
      consentPage: config.consentPage,
      scopes: [...config.scopes],
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
      clientRegistrationDefaultScopes: [...config.defaultScopes],
      clientRegistrationAllowedScopes: [...config.scopes],
      clientRegistrationRequirePKCE: true,
      rateLimit: { register: { window: 60, max: 5 } },
      clientPrivileges: config.clientPrivileges,
      clientReference: config.clientReference,
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
 * The OAuth tables of one authorization server. Staff and Cadet Portal
 * clients and grants live in separate tables; the cadet tables are
 * column-for-column copies of the staff ones (the same Better Auth models),
 * so queries are typed against the staff shape while Drizzle builds the SQL
 * from the runtime table objects actually passed.
 */
export type OAuthServerTables = {
  client: typeof schema.oauthClient;
  consent: typeof schema.oauthConsent;
  refreshToken: typeof schema.oauthRefreshToken;
  accessToken: typeof schema.oauthAccessToken;
};

/** True only when A and B are mutually assignable. */
type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/**
 * Compile-time guard for the casts below and in `mcp-credential.ts`: each
 * cadet OAuth table must have exactly the staff table's row shape (select)
 * and insert shape (required/optional columns and their types). A column
 * added to or changed in only one of them fails typecheck here instead of
 * silently producing queries against a mismatched table.
 */
export type CadetOAuthTableShapeChecks = [
  Assert<SameShape<typeof cadetOauthClient.$inferSelect, typeof schema.oauthClient.$inferSelect>>,
  Assert<SameShape<typeof cadetOauthClient.$inferInsert, typeof schema.oauthClient.$inferInsert>>,
  Assert<SameShape<typeof cadetOauthConsent.$inferSelect, typeof schema.oauthConsent.$inferSelect>>,
  Assert<SameShape<typeof cadetOauthConsent.$inferInsert, typeof schema.oauthConsent.$inferInsert>>,
  Assert<SameShape<typeof cadetOauthRefreshToken.$inferSelect, typeof schema.oauthRefreshToken.$inferSelect>>,
  Assert<SameShape<typeof cadetOauthRefreshToken.$inferInsert, typeof schema.oauthRefreshToken.$inferInsert>>,
  Assert<SameShape<typeof cadetOauthAccessToken.$inferSelect, typeof schema.oauthAccessToken.$inferSelect>>,
  Assert<SameShape<typeof cadetOauthAccessToken.$inferInsert, typeof schema.oauthAccessToken.$inferInsert>>,
];

export const STAFF_OAUTH_SERVER_TABLES: OAuthServerTables = {
  client: schema.oauthClient,
  consent: schema.oauthConsent,
  refreshToken: schema.oauthRefreshToken,
  accessToken: schema.oauthAccessToken,
};

export const CADET_OAUTH_SERVER_TABLES = {
  client: cadetOauthClient,
  consent: cadetOauthConsent,
  refreshToken: cadetOauthRefreshToken,
  accessToken: cadetOauthAccessToken,
} as unknown as OAuthServerTables;

/**
 * Records that a client was created through Dynamic Client Registration, so
 * cleanup and the admin client list never have to guess it from other fields.
 * Any `registrationMethod` the registrant sent is overwritten.
 */
export function recordDynamicClientRegistration(
  db: DatabaseExecutor,
  tables: OAuthServerTables = STAFF_OAUTH_SERVER_TABLES,
) {
  const { client } = tables;
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/oauth2/register') return;
    const returned = ctx.context.returned as { client_id?: unknown } | undefined;
    if (!returned || typeof returned.client_id !== 'string') return;
    await db
      .update(client)
      .set({
        metadata: sql`coalesce(${client.metadata}, '{}'::jsonb) || ${JSON.stringify({ registrationMethod: 'dynamic' satisfies OAuthClientRegistrationMethod })}::jsonb`,
      })
      .where(eq(client.clientId, returned.client_id));
  });
}

/**
 * Deletes dynamically registered clients that are older than
 * MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS and never received a grant (no consent,
 * no access or refresh token). DCR creates a client per connection attempt,
 * so abandoned registrations would otherwise accumulate. Idempotent; safe to
 * run on several server instances. Runs against one server's tables (staff
 * by default).
 */
export async function deleteUnusedDynamicOAuthClients(
  db: DatabaseExecutor,
  now = new Date(),
  tables: OAuthServerTables = STAFF_OAUTH_SERVER_TABLES,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const { client, consent, refreshToken, accessToken } = tables;
  const deleted = await db
    .delete(client)
    .where(
      and(
        sql`${client.metadata} ->> 'registrationMethod' = 'dynamic'`,
        isNull(client.clientDiscoveryId),
        lt(client.createdAt, cutoff),
        notExists(
          db
            .select({ id: consent.id })
            .from(consent)
            .where(eq(consent.clientId, client.clientId)),
        ),
        notExists(
          db
            .select({ id: refreshToken.id })
            .from(refreshToken)
            .where(eq(refreshToken.clientId, client.clientId)),
        ),
        notExists(
          db
            .select({ id: accessToken.id })
            .from(accessToken)
            .where(eq(accessToken.clientId, client.clientId)),
        ),
      ),
    )
    .returning({ clientId: client.clientId });
  return deleted.length;
}
