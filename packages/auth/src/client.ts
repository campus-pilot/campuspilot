import { apiKeyClient } from '@better-auth/api-key/client';
import { env } from '@campuspilot/env/web.client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { auth } from './server';

function getServerUrl(url: string) {
  const runtime = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    window?: { location: { origin: string } };
  };
  const processEnv = runtime.process?.env;

  if (!runtime.window && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith('/')
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  const normalized = url.endsWith('/') ? url.slice(0, -1) : url;

  if (!normalized.startsWith('/')) {
    return normalized;
  }

  if (runtime.window) {
    return `${runtime.window.location.origin}${normalized}`;
  }

  const vercelUrl =
    processEnv?.VERCEL_ENV === 'production'
      ? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
      : (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);

  if (vercelUrl) {
    const origin = vercelUrl.startsWith('http')
      ? vercelUrl
      : `https://${vercelUrl}`;
    return `${origin}${normalized}`;
  }

  return `http://localhost:3000${normalized}`;
}

export const authClient = createAuthClient({
  baseURL: new URL('/api/auth', getServerUrl(env.VITE_SERVER_URL)).toString(),
  plugins: [apiKeyClient(), inferAdditionalFields<typeof auth>()],
});
