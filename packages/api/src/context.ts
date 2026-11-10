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
 * - `assistant`: the in-app assistant running a user's request; never
 *   accepted from a request credential, only created by the assistant runtime.
 * - `system-job`: a durable background job acting as the admin who requested
 *   it. Created only by the worker's job context factory
 *   (`workflows/demo-school/job-context.ts`); no HTTP path can produce it.
 */
export type AuthPrincipal =
  | { authMethod: 'anonymous' }
  | { authMethod: 'session' }
  | { authMethod: 'apiKey' }
  | { authMethod: 'oauth'; oauthGrant: OAuthGrant }
  | { authMethod: 'system-job'; jobId: string }
  | { authMethod: 'assistant'; assistantRun: AssistantRunPrincipal };

/**
 * The in-app assistant acting for a user inside one run. It is its own
 * principal rather than a copy of the user's browser session: procedures and
 * logs can tell an agent action apart, and the assistant tool policy (see
 * `assistant/tool-policy.ts`) is enforced for it on every procedure call.
 */
export type AssistantRunPrincipal = {
  conversationId: string;
  runId: string;
  /** The school the conversation belongs to; tools may not leave it. */
  schoolId: string;
};

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

type RequestScopedSessionInput = {
  userId: string;
  /** Names the credential behind the request so logs can correlate calls. */
  sessionId: string;
  authMethod: string;
  expiresAt: Date;
};

/**
 * Builds a request-scoped, never-persisted session for a user who is not
 * presenting a browser session (OAuth connectors, the assistant runtime). The
 * user is loaded from the database, so platform role changes and bans apply
 * immediately; OPA still decides every action from live role assignments.
 * Returns null when the user no longer exists or is banned.
 */
async function loadRequestScopedSession({
  userId,
  sessionId,
  authMethod,
  expiresAt,
}: RequestScopedSessionInput): Promise<AuthSession | null> {
  const user = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, userId),
  });
  if (!user) return null;
  if (user.banned && (!user.banExpires || user.banExpires > new Date())) {
    return null;
  }

  const now = new Date();
  return {
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
    session: {
      id: sessionId,
      userId: user.id,
      token: '',
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      authMethod,
      apiKeyId: null,
      impersonatedBy: null,
    },
  } as AuthSession;
}

/**
 * Creates the context for a request authenticated by a verified OAuth access
 * token (see apps/server's MCP gate). Returns null when the user no longer
 * exists or is banned.
 */
export async function createOAuthContext({
  headers,
  userId,
  oauthGrant,
  expiresAt,
}: OAuthContextInput): Promise<Context | null> {
  const session = await loadRequestScopedSession({
    userId,
    // Request-scoped, never persisted: an OAuth request has no browser
    // session. The id names the grant so logs can correlate requests.
    sessionId: `oauth:${oauthGrant.grantId}`,
    authMethod: 'oauth',
    expiresAt,
  });
  if (!session) return null;

  return {
    db,
    headers,
    session,
    principal: { authMethod: 'oauth', oauthGrant },
  };
}

/** How long one assistant tool call's request-scoped session is valid. */
const ASSISTANT_TOOL_SESSION_TTL_MS = 5 * 60 * 1000;

export type AssistantContextInput = {
  userId: string;
  assistantRun: AssistantRunPrincipal;
};

/**
 * Creates the context the assistant runtime uses for one tool call on the
 * user's behalf. The user is re-loaded for every call, so a ban or removed
 * school role during a long conversation applies to the next action.
 * Returns null when the user no longer exists or is banned.
 */
export async function createAssistantContext({
  userId,
  assistantRun,
}: AssistantContextInput): Promise<Context | null> {
  const session = await loadRequestScopedSession({
    userId,
    sessionId: `assistant:${assistantRun.runId}`,
    authMethod: 'assistant',
    expiresAt: new Date(Date.now() + ASSISTANT_TOOL_SESSION_TTL_MS),
  });
  if (!session) return null;

  return {
    db,
    headers: new Headers(),
    session,
    principal: { authMethod: 'assistant', assistantRun },
  };
}

export async function createContext({ context }: CreateContextOptions) {
  return createContextFromHeaders(context.req.raw.headers);
}
