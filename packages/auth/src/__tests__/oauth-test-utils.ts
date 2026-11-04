import { createHash, randomBytes } from 'node:crypto';

import { MCP_DEFAULT_SCOPES } from '../mcp-oauth-policy';
import { createAuth } from '../server';

export const AUTH_ORIGIN = 'http://localhost:3000';
export const MCP_RESOURCE = 'http://localhost:3000/api/mcp';
export const ISSUER = `${AUTH_ORIGIN}/api/auth`;
export const APP_ORIGIN = 'http://localhost:3001';

/** A stub HTTPS host that serves Client ID Metadata Documents. */
export class StubMetadataHost {
  readonly documents = new Map<string, unknown>();
  readonly requests: string[] = [];

  fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    this.requests.push(url);
    const document = this.documents.get(url);
    return document === undefined
      ? new Response('not found', { status: 404 })
      : Response.json(document, {
          headers: { 'cache-control': 'max-age=300' },
        });
  };

  /** Publishes a public (PKCE) client whose client_id is its document URL. */
  publish(
    path: string,
    overrides: Record<string, unknown> = {},
  ): { clientId: string; redirectUri: string } {
    const clientId = `https://client.example${path}`;
    const redirectUri = 'https://client.example/callback';
    this.documents.set(clientId, {
      client_id: clientId,
      client_name: 'Example Assistant',
      client_uri: 'https://client.example',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...overrides,
    });
    return { clientId, redirectUri };
  }
}

export type TestAuth = ReturnType<typeof createAuth>;

/** Registers a public client through RFC 7591 Dynamic Client Registration. */
export async function registerDynamicClient(
  auth: TestAuth,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const redirectUri = 'http://127.0.0.1:43123/oauth/callback';
  const response = await auth.handler(
    new Request(`${ISSUER}/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        client_name: 'Example CLI',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        ...overrides,
      }),
    }),
  );
  const body = (await response.json()) as Record<string, unknown>;
  return {
    response,
    body,
    clientId: body.client_id as string,
    redirectUri,
  };
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Signs up a user through Better Auth and returns its session cookie. */
export async function signUpUser(auth: TestAuth, label: string) {
  const email = `${label}_${crypto.randomUUID()}@example.com`;
  const password = 'Password123!';
  const response = await auth.api.signUpEmail({
    body: { email, password, name: `${label} user` },
    asResponse: true,
  });
  const cookie = cookieHeader(response);
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  return { email, password, cookie, userId: session!.user.id };
}

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  scope?: string;
  resource?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

export function authorizeUrl(request: AuthorizationRequest) {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set(
    'scope',
    request.scope ?? `${MCP_DEFAULT_SCOPES.join(' ')} offline_access`,
  );
  url.searchParams.set('state', request.state ?? 'state-123');
  if (request.resource !== '') {
    url.searchParams.set('resource', request.resource ?? MCP_RESOURCE);
  }
  if (request.codeChallenge !== '') {
    url.searchParams.set('code_challenge', request.codeChallenge ?? '');
    url.searchParams.set(
      'code_challenge_method',
      request.codeChallengeMethod ?? 'S256',
    );
  }
  return url;
}

/** Sends a browser-style navigation to the authorization server. */
export async function navigate(
  auth: TestAuth,
  url: URL | string,
  cookie?: string,
): Promise<Response> {
  return auth.handler(
    new Request(url, {
      headers: {
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        ...(cookie ? { cookie } : {}),
      },
      redirect: 'manual',
    }),
  );
}

/** Posts JSON the way the management app does (with its origin). */
export async function postJson(
  auth: TestAuth,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return auth.handler(
    new Request(`${ISSUER}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: APP_ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

export async function postForm(
  auth: TestAuth,
  path: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${ISSUER}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

/** The signed query the login/consent pages forward with their requests. */
export function signedQueryFrom(location: string): string {
  return new URL(location, APP_ORIGIN).search.slice(1);
}

export type CompletedAuthorization = {
  code: string;
  iss: string | null;
  state: string | null;
  verifier: string;
  user: Awaited<ReturnType<typeof signUpUser>>;
};

/**
 * Runs the browser half of the flow: authorize → login page → sign in with
 * the signed query → consent page → consent → redirect with the code.
 */
export async function authorizeWithConsent(
  auth: TestAuth,
  request: Omit<AuthorizationRequest, 'codeChallenge'>,
  consent: { scope?: string } = {},
): Promise<CompletedAuthorization> {
  const { verifier, challenge } = pkce();
  const user = await signUpUser(auth, 'oauth');
  const login = await navigate(
    auth,
    authorizeUrl({ ...request, codeChallenge: challenge }),
  );
  const loginLocation = login.headers.get('location');
  if (!loginLocation?.startsWith(`${APP_ORIGIN}/auth/login`)) {
    throw new Error(`Expected login redirect, got ${login.status} ${loginLocation}`);
  }

  const signIn = await postJson(auth, '/sign-in/email', {
    email: user.email,
    password: user.password,
    oauth_query: signedQueryFrom(loginLocation),
  });
  const signInBody = (await signIn.json()) as { url?: string };
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!signInBody.url?.startsWith(`${APP_ORIGIN}/oauth/consent`)) {
    throw new Error(`Expected consent redirect, got ${JSON.stringify(signInBody)}`);
  }

  const consentResponse = await postJson(
    auth,
    '/oauth2/consent',
    {
      accept: true,
      ...(consent.scope ? { scope: consent.scope } : {}),
      oauth_query: signedQueryFrom(signInBody.url),
    },
    cookie,
  );
  const consentBody = (await consentResponse.json()) as { url?: string };
  if (!consentBody.url) {
    throw new Error(`Consent failed: ${JSON.stringify(consentBody)}`);
  }
  const callback = new URL(consentBody.url);
  return {
    code: callback.searchParams.get('code')!,
    iss: callback.searchParams.get('iss'),
    state: callback.searchParams.get('state'),
    verifier,
    user: { ...user, cookie },
  };
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

export async function exchangeCode(
  auth: TestAuth,
  completed: CompletedAuthorization,
  request: { clientId: string; redirectUri: string; resource?: string },
) {
  return postForm(auth, '/oauth2/token', {
    grant_type: 'authorization_code',
    code: completed.code,
    redirect_uri: request.redirectUri,
    client_id: request.clientId,
    code_verifier: completed.verifier,
    resource: request.resource ?? MCP_RESOURCE,
  });
}

export async function refresh(
  auth: TestAuth,
  clientId: string,
  refreshToken: string,
) {
  return postForm(auth, '/oauth2/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: MCP_RESOURCE,
  });
}

export function decodeJwt(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
}
