import { auth } from '@campuspilot/auth/server';
import { normalizeApiKeyHeaders } from '@campuspilot/auth/api-key-headers';
import { db } from '@campuspilot/db';
import type { Context as HonoContext } from 'hono';

export type CreateContextOptions = {
  context: HonoContext;
};

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/** The connector grant behind an OAuth-authenticated request. */
export type OAuthGrant = {
  /** OAuth client the user connected (CIMD URL, DCR or pre-registered id). */
  clientId: string;
  /** Scopes the request may use: the token's scopes still held by the grant. */
  scopes: readonly string[];
  /** The consent record that keeps the connection alive. */
  grantId: string;
};

/**
 * How the caller authenticated, recorded from the credential that was
 * actually verified rather than inferred from token shape or prefix.
 * - `session`: Better Auth browser session cookie.
 * - `apiKey`: user-owned API key (`x-api-key` or `Authorization: Bearer`).
 * - `oauth`: OAuth access token issued to an MCP connector; only accepted on
 *   the MCP endpoint, whose resource it is bound to.
 * - `system-job`: a durable background job acting as the admin who requested
 *   it. Created only by the worker's job context factory
 *   (`workflows/demo-school/job-context.ts`); no HTTP path can produce it.
 */
export type AuthPrincipal =
  | { authMethod: 'anonymous' }
  | { authMethod: 'session' }
  | { authMethod: 'apiKey' }
  | { authMethod: 'oauth'; oauthGrant: OAuthGrant }
  | { authMethod: 'system-job'; jobId: string };

export type Context = {
  db: typeof db;
  headers: Headers;
  session: AuthSession | null;
  principal: AuthPrincipal;
};

/**
 * Creates the shared oRPC context from transport-neutral request headers.
 * Keeping session resolution here ensures cookies and user-owned API keys
 * produce the same authorization context for HTTP, RPC, OpenAPI, and MCP.
 * A request that carries an API key is authenticated by that key alone.
 */
export async function createContextFromHeaders(
  headers: Headers,
): Promise<Context> {
  const normalizedHeaders = normalizeApiKeyHeaders(headers);
  let session: AuthSession | null = null;
  try {
    session = await auth.api.getSession({
      headers: normalizedHeaders,
    });
  } catch {
    session = null;
  }
  const principal: AuthPrincipal = !session
    ? { authMethod: 'anonymous' }
    : normalizedHeaders.has('x-api-key')
      ? { authMethod: 'apiKey' }
      : { authMethod: 'session' };
  return {
    db,
    headers: normalizedHeaders,
    session,
    principal,
  };
}

export type OAuthContextInput = {
  headers: Headers;
  userId: string;
  oauthGrant: OAuthGrant;
  /** Access-token expiry, which bounds this request-scoped session. */
  expiresAt: Date;
};

/**
 * Creates the context for a request authenticated by a verified OAuth access
 * token (see apps/server's MCP gate). The user is loaded from the database,
 * so platform role changes and bans apply immediately; OPA still decides
 * every action from live role assignments. Returns null when the user no
 * longer exists or is banned.
 */
export async function createOAuthContext({
  headers,
  userId,
  oauthGrant,
  expiresAt,
}: OAuthContextInput): Promise<Context | null> {
  const user = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, userId),
  });
  if (!user) return null;
  if (user.banned && (!user.banExpires || user.banExpires > new Date())) {
    return null;
  }

  const now = new Date();
  const session = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      setupStatus: user.setupStatus,
      profileImageS3Key: user.profileImageS3Key,
    },
    // Request-scoped, never persisted: an OAuth request has no browser
    // session. The id names the grant so logs can correlate requests.
    session: {
      id: `oauth:${oauthGrant.grantId}`,
      userId: user.id,
      token: '',
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      authMethod: 'oauth',
      apiKeyId: null,
      impersonatedBy: null,
    },
  } as AuthSession;

  return {
    db,
    headers,
    session,
    principal: { authMethod: 'oauth', oauthGrant },
  };
}

export async function createContext({ context }: CreateContextOptions) {
  return createContextFromHeaders(context.req.raw.headers);
}
