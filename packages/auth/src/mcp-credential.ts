import type { DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import {
  cadetOauthClient,
  cadetOauthConsent,
} from '@campuspilot/db/schema/cadet';
import { env } from '@campuspilot/env/server';
import { getJwks, verifyJwsAccessToken } from 'better-auth/oauth2';
import { and, eq, isNull, lt, or } from 'drizzle-orm';

import { oauthIssuer } from './mcp-oauth';
import { OAUTH_GRANT_USE_RECORD_INTERVAL_MS } from './mcp-oauth-policy';

/** The claims CampusPilot relies on from a verified MCP access token. */
export type McpAccessTokenClaims = {
  /** User the token acts for. */
  userId: string;
  /** OAuth client the user authorized. */
  clientId: string;
  scopes: string[];
  expiresAt: Date;
};

type JwksSource = { api: { getJwks: () => Promise<unknown> } };

type JwksSet = Awaited<ReturnType<typeof getJwks>>;

/** Which authorization server a token must come from and which resource it is for. */
export type McpTokenAudience = { issuer: string; audience: string };

/**
 * Verifies a bearer value as a CampusPilot OAuth access token: signature
 * against the given instance's JWKS, issuer, audience and expiry (staff
 * defaults: the `/api/auth` issuer and MCP_RESOURCE_URL). Returns null for
 * anything else (another issuer's JWT, an expired or tampered token, or a
 * non-JWT value such as an API key), letting the caller try its next
 * verifier. Nothing is decided from the token's prefix or shape.
 */
export async function verifyMcpAccessToken(
  auth: JwksSource,
  token: string,
  expected: McpTokenAudience = {
    issuer: oauthIssuer(),
    audience: env.MCP_RESOURCE_URL,
  },
): Promise<McpAccessTokenClaims | null> {
  try {
    const payload = await verifyJwsAccessToken(token, {
      // In-process key lookup: the server never fetches its own JWKS over
      // HTTP. Better Auth caches the keys per auth instance (the cache key).
      jwksFetch: async () => (await auth.api.getJwks()) as JwksSet,
      jwksCacheKey: auth,
      verifyOptions: { issuer: expected.issuer, audience: expected.audience },
    });
    const clientId = payload.azp ?? payload.client_id;
    if (
      typeof payload.sub !== 'string' ||
      typeof clientId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      clientId,
      scopes:
        typeof payload.scope === 'string'
          ? payload.scope.split(' ').filter(Boolean)
          : [],
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}

export type LiveOAuthGrant = {
  grantId: string;
  /** Scopes the user currently grants; a token can use only these. */
  scopes: string[];
};

/**
 * The consent and client tables of one authorization server. Staff and Cadet
 * Portal grants live in separate tables, so a grant is only ever looked up
 * in the tables of the issuer that signed the token.
 */
export type OAuthGrantTables =
  | { consent: typeof schema.oauthConsent; client: typeof schema.oauthClient }
  | { consent: typeof cadetOauthConsent; client: typeof cadetOauthClient };

export const STAFF_OAUTH_GRANT_TABLES: OAuthGrantTables = {
  consent: schema.oauthConsent,
  client: schema.oauthClient,
};

export const CADET_OAUTH_GRANT_TABLES: OAuthGrantTables = {
  consent: cadetOauthConsent,
  client: cadetOauthClient,
};

/**
 * Types either table pair as the staff pair for query building. The cadet
 * tables are column-for-column copies of the staff ones (both store the same
 * Better Auth models; `CadetOAuthTableShapeChecks` in `mcp-oauth.ts` fails
 * typecheck if they drift), and Drizzle builds the SQL from the runtime
 * table object, so queries still run against the tables actually passed.
 */
function asStaffShape(tables: OAuthGrantTables) {
  return tables as {
    consent: typeof schema.oauthConsent;
    client: typeof schema.oauthClient;
  };
}

/**
 * Per-request liveness check: the user's consent for the client must still
 * exist and the client must not be disabled. Disconnecting in CampusPilot or
 * disabling a client therefore takes effect on the next request, not when
 * the access token expires. One indexed lookup.
 */
export async function findLiveOAuthGrant(
  db: DatabaseExecutor,
  { userId, clientId }: { userId: string; clientId: string },
  tables: OAuthGrantTables = STAFF_OAUTH_GRANT_TABLES,
): Promise<LiveOAuthGrant | null> {
  const { consent, client } = asStaffShape(tables);
  const [grant] = await db
    .select({ grantId: consent.id, scopes: consent.scopes })
    .from(consent)
    .innerJoin(client, eq(client.clientId, consent.clientId))
    .where(
      and(
        eq(consent.userId, userId),
        eq(consent.clientId, clientId),
        or(isNull(client.disabled), eq(client.disabled, false)),
      ),
    )
    .limit(1);
  return grant ?? null;
}

/**
 * Records that a connection was used, at most once per
 * OAUTH_GRANT_USE_RECORD_INTERVAL_MS, so a busy connection does not write on
 * every request.
 */
export async function recordOAuthGrantUse(
  db: DatabaseExecutor,
  grantId: string,
  now = new Date(),
  tables: OAuthGrantTables = STAFF_OAUTH_GRANT_TABLES,
): Promise<void> {
  const stale = new Date(now.getTime() - OAUTH_GRANT_USE_RECORD_INTERVAL_MS);
  const { consent } = asStaffShape(tables);
  await db
    .update(consent)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(consent.id, grantId),
        or(isNull(consent.lastUsedAt), lt(consent.lastUsedAt, stale)),
      ),
    );
}
