import type { Context, OAuthContextInput } from '@campuspilot/api/context';
import type { McpAccess } from '@campuspilot/api/mcp-metadata';
import type {
  LiveOAuthGrant,
  McpAccessTokenClaims,
} from '@campuspilot/auth/mcp-credential';
import { MCP_DEFAULT_SCOPES } from '@campuspilot/auth/mcp-oauth-policy';
import type { AuthInfo } from '@modelcontextprotocol/server';

import { type McpCatalog, requiredScopes } from './mcp';
import { META_TOOL_NAMES } from './mcp-meta-tools';

/** What the gate verified for one MCP request, handed to the tool layer. */
export type McpRequestCredential = {
  context: Context;
  /** SDK auth info, set for OAuth access tokens only. */
  authInfo?: AuthInfo;
};

export type McpGateOptions = {
  catalog: Promise<McpCatalog>;
  /** Canonical MCP URL (MCP_RESOURCE_URL). */
  resource: string;
  verifyAccessToken: (token: string) => Promise<McpAccessTokenClaims | null>;
  findLiveGrant: (claims: McpAccessTokenClaims) => Promise<LiveOAuthGrant | null>;
  /** Builds the context for an API key; anonymous when the key is invalid. */
  createApiKeyContext: (apiKey: string) => Promise<Context>;
  createOAuthContext: (input: OAuthContextInput) => Promise<Context | null>;
  /** Records that the grant was used (throttled by the implementation). */
  recordGrantUse: (grantId: string) => Promise<void>;
};

export type McpGateResult =
  | { ok: true; credential: McpRequestCredential }
  | { ok: false; response: Response };

/**
 * RFC 9728 metadata URL for a resource: the well-known segment is inserted
 * between the origin and the resource path.
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`;
}

function quote(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function challenge(parameters: Record<string, string | undefined>): string {
  return `Bearer ${Object.entries(parameters)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(', ')}`;
}

function jsonRpcError(
  status: number,
  wwwAuthenticate: string,
  message: string,
  id: unknown = null,
): Response {
  return Response.json(
    { jsonrpc: '2.0', id, error: { code: -32001, message } },
    { status, headers: { 'www-authenticate': wwwAuthenticate } },
  );
}

function bearerToken(headers: Headers): string | null {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(
    headers.get('authorization') ?? '',
  );
  return match?.[1] ?? null;
}

type JsonRpcMessage = { id?: unknown; method?: unknown; params?: unknown };

/** The JSON-RPC messages of a POST body; empty when it is not JSON-RPC. */
async function jsonRpcMessages(request: Request): Promise<JsonRpcMessage[]> {
  if (request.method !== 'POST') return [];
  try {
    const body = (await request.clone().json()) as unknown;
    const messages = Array.isArray(body) ? body : [body];
    return messages.filter(
      (message): message is JsonRpcMessage =>
        typeof message === 'object' && message !== null,
    );
  } catch {
    return [];
  }
}

/**
 * The access a tool call needs, from the tool's explicit metadata. Meta tools
 * are read-only except the write runner. Names the catalog does not know need
 * read access only; the MCP server then answers "unknown tool".
 */
function requiredAccess(catalog: McpCatalog, message: JsonRpcMessage): McpAccess {
  if (message.method !== 'tools/call') return 'read';
  const name = (message.params as { name?: unknown } | undefined)?.name;
  if (name === META_TOOL_NAMES.runWrite) return 'write';
  const core = catalog.core.find((tool) => tool.name === name);
  return core?.mcp.access ?? 'read';
}

/**
 * Creates the authentication gate in front of the MCP handler. Every request
 * needs a credential (D4); without one the response is the 401 challenge that
 * starts OAuth in MCP clients. Verification order (D5), each verifier deciding
 * on its own evidence:
 * 1. `x-api-key` present → API key only.
 * 2. `Authorization: Bearer` → CampusPilot OAuth access token (signature,
 *    issuer, audience, expiry, then a live grant); if it is not one, the same
 *    value is tried as an API key.
 * 3. Otherwise, or when both fail → 401.
 * Cookies are never accepted here. OAuth requests then need the scopes of
 * the tools they call; API keys carry the user's full rights.
 */
export function createMcpGate(options: McpGateOptions) {
  const metadataUrl = protectedResourceMetadataUrl(options.resource);
  const unauthorized = (description?: string) =>
    jsonRpcError(
      401,
      challenge({
        resource_metadata: metadataUrl,
        scope: MCP_DEFAULT_SCOPES.join(' '),
        ...(description
          ? { error: 'invalid_token', error_description: description }
          : {}),
      }),
      description ?? 'Authentication required.',
    );

  async function apiKeyCredential(apiKey: string): Promise<McpRequestCredential | null> {
    const context = await options.createApiKeyContext(apiKey);
    return context.principal.authMethod === 'apiKey' ? { context } : null;
  }

  async function oauthCredential(
    token: string,
    request: Request,
  ): Promise<McpRequestCredential | 'revoked' | null> {
    const claims = await options.verifyAccessToken(token);
    if (!claims) return null;
    const grant = await options.findLiveGrant(claims);
    if (!grant) return 'revoked';
    // A token can only use scopes the grant still holds.
    const scopes = claims.scopes.filter((scope) => grant.scopes.includes(scope));
    const context = await options.createOAuthContext({
      headers: new Headers({
        'user-agent': request.headers.get('user-agent') ?? '',
      }),
      userId: claims.userId,
      oauthGrant: { clientId: claims.clientId, scopes, grantId: grant.grantId },
      expiresAt: claims.expiresAt,
    });
    if (!context) return 'revoked';
    await options.recordGrantUse(grant.grantId);
    return {
      context,
      authInfo: {
        token,
        clientId: claims.clientId,
        scopes,
        expiresAt: Math.floor(claims.expiresAt.getTime() / 1000),
        resource: new URL(options.resource),
      },
    };
  }

  async function insufficientScope(
    request: Request,
    scopes: readonly string[],
  ): Promise<Response | null> {
    const catalog = await options.catalog;
    for (const message of await jsonRpcMessages(request)) {
      const needed = requiredScopes(requiredAccess(catalog, message));
      if (needed.every((scope) => scopes.includes(scope))) continue;
      const header = challenge({
        error: 'insufficient_scope',
        scope: needed.join(' '),
        resource_metadata: metadataUrl,
        error_description: `This connection needs ${needed.join(' ')}.`,
      });
      if (message.method !== 'tools/call') {
        return jsonRpcError(403, header, 'Insufficient scope.', message.id ?? null);
      }
      // Spec clients step up from the 403 and its header; ChatGPT reads the
      // same challenge from the tool result's `_meta`.
      return Response.json(
        {
          jsonrpc: '2.0',
          id: message.id ?? null,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'INSUFFICIENT_SCOPE',
                  message:
                    'This connection is read-only. Reconnect CampusPilot and allow changes to use this tool.',
                }),
              },
            ],
            _meta: { 'mcp/www_authenticate': [header] },
          },
        },
        { status: 403, headers: { 'www-authenticate': header } },
      );
    }
    return null;
  }

  return async function authenticate(request: Request): Promise<McpGateResult> {
    const apiKey = request.headers.get('x-api-key')?.trim();
    if (apiKey) {
      const credential = await apiKeyCredential(apiKey);
      return credential
        ? { ok: true, credential }
        : { ok: false, response: unauthorized('The API key is invalid or expired.') };
    }

    const token = bearerToken(request.headers);
    if (!token) return { ok: false, response: unauthorized() };

    const oauth = await oauthCredential(token, request);
    if (oauth === 'revoked') {
      return {
        ok: false,
        response: unauthorized('This connection was disconnected. Connect CampusPilot again.'),
      };
    }
    if (oauth) {
      const principal = oauth.context.principal;
      const scopes = principal.authMethod === 'oauth' ? principal.oauthGrant.scopes : [];
      const denied = await insufficientScope(request, scopes);
      return denied ? { ok: false, response: denied } : { ok: true, credential: oauth };
    }

    const keyCredential = await apiKeyCredential(token);
    return keyCredential
      ? { ok: true, credential: keyCredential }
      : { ok: false, response: unauthorized('The access token is invalid or expired.') };
  };
}
