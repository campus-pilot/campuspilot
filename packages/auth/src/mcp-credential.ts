import type { DatabaseExecutor } from '@campuspilot/db';
import * as schema from '@campuspilot/db/schema/auth';
import { env } from '@campuspilot/env/server';
import { getJwks, verifyJwsAccessToken } from 'better-auth/oauth2';
import { and, eq, or, isNull } from 'drizzle-orm';

import { oauthIssuer } from './mcp-oauth';

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

/**
 * Verifies a bearer value as a CampusPilot OAuth access token: signature
 * against this server's JWKS, issuer, audience = MCP_RESOURCE_URL and expiry.
 * Returns null for anything else (another issuer's JWT, an expired or
 * tampered token, or a non-JWT value such as an API key), letting the caller
 * try its next verifier. Nothing is decided from the token's prefix or shape.
 */
export async function verifyMcpAccessToken(
  auth: JwksSource,
  token: string,
): Promise<McpAccessTokenClaims | null> {
  try {
    const payload = await verifyJwsAccessToken(token, {
      // In-process key lookup: the server never fetches its own JWKS over
      // HTTP. Better Auth caches the keys per auth instance (the cache key).
      jwksFetch: async () => (await auth.api.getJwks()) as JwksSet,
      jwksCacheKey: auth,
      verifyOptions: { issuer: oauthIssuer(), audience: env.MCP_RESOURCE_URL },
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
 * Per-request liveness check: the user's consent for the client must still
 * exist and the client must not be disabled. Disconnecting in CampusPilot or
 * disabling a client therefore takes effect on the next request, not when
 * the access token expires. One indexed lookup.
 */
export async function findLiveOAuthGrant(
  db: DatabaseExecutor,
  { userId, clientId }: { userId: string; clientId: string },
): Promise<LiveOAuthGrant | null> {
  const [grant] = await db
    .select({
      grantId: schema.oauthConsent.id,
      scopes: schema.oauthConsent.scopes,
    })
    .from(schema.oauthConsent)
    .innerJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.oauthConsent.clientId),
    )
    .where(
      and(
        eq(schema.oauthConsent.userId, userId),
        eq(schema.oauthConsent.clientId, clientId),
        or(
          isNull(schema.oauthClient.disabled),
          eq(schema.oauthClient.disabled, false),
        ),
      ),
    )
    .limit(1);
  return grant ?? null;
}
