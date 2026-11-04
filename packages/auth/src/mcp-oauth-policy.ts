/**
 * OAuth policy for MCP connectors (Claude, ChatGPT, Gemini, IDE agents),
 * shared by the authorization server, the MCP resource server and the
 * management consent page. No server imports, so UIs can use it.
 */

/** Read-only access to CampusPilot data through MCP. */
export const MCP_READ_SCOPE = 'mcp:read';
/** Creating and changing CampusPilot data through MCP. */
export const MCP_WRITE_SCOPE = 'mcp:write';

/**
 * Scopes a connector asks for by default, and the scopes advertised in the
 * 401 challenge. Read + write by default because step-up is unreliable across
 * clients; the consent page lets the user narrow a grant to read-only.
 */
export const MCP_DEFAULT_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;

/** Every scope the authorization server accepts. */
export const OAUTH_SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
] as const;

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Access tokens (audience-bound JWTs) live one hour; clients refresh. */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Refresh tokens live 90 days and are replaced on every use, each new token
 * getting a fresh 90 days, so a connection in use never has to reconnect.
 */
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 90 * SECONDS_PER_DAY;

/** Seconds a rotated refresh token may be replayed by parallel refreshes. */
export const MCP_REFRESH_TOKEN_REUSE_INTERVAL_SECONDS = 30;

/** Dynamically registered clients that never got a grant are removed after this. */
export const MCP_UNUSED_DYNAMIC_CLIENT_TTL_DAYS = 30;

/** Management route that shows the consent screen. */
export const OAUTH_CONSENT_PATH = '/oauth/consent';

/** Management route that signs the user in (and resumes an authorization). */
export const OAUTH_LOGIN_PATH = '/auth/login';

/**
 * Owner (`referenceId`) of OAuth clients that platform administrators
 * pre-register. Any platform administrator may rotate or delete them.
 */
export const PLATFORM_OAUTH_CLIENT_OWNER = 'campuspilot-platform';

/** How often the MCP gate refreshes a connection's last-used time. */
export const OAUTH_GRANT_USE_RECORD_INTERVAL_MS = 5 * 60 * 1000;
