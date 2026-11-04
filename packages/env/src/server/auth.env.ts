import { z } from 'zod';

export const AUTH_ENV_SHAPE = {
  SYSTEM_ADMIN_EMAIL: z.email().transform((email) => email.toLowerCase()),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  /**
   * Canonical URL of the MCP endpoint (`<API origin>/api/mcp`): the OAuth
   * protected resource, published in its metadata and required as the access
   * token audience. Its own value, never derived from BETTER_AUTH_URL, because
   * it must equal the URL users paste into their AI client, which can sit
   * behind a different public host.
   */
  MCP_RESOURCE_URL: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return !url.search && !url.hash && !url.pathname.endsWith('/');
    }, 'MCP_RESOURCE_URL must have no query, fragment or trailing slash.'),

  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // In production set this to .polyteia.com
  COOKIE_DOMAIN: z.string().optional(),
  SAME_SITE_COOKIE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Comma-separated origins for internal/self-hosted SSO IdPs whose host is
  // not publicly routable (e.g. a Keycloak on localhost in dev, or an IdP
  // behind a corporate VPN). This is the operator-controlled escape hatch the
  // SSO plugin's SSRF guard documents: only origins listed here may be trusted
  // as provider issuers when their host is private. Tenant-registered
  // providers can never widen it, which stops org admins from turning SSO
  // provider registration into an SSRF primitive against the internal network.
  SSO_INTERNAL_TRUSTED_ORIGINS: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
};
