import type { oauthConsentClientSchema } from '@campuspilot/api/routers/auth/auth.dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { OAuthConsent } from './oauth-consent';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  session: null as { user: { id: string } } | null,
  redirect: vi.fn(),
  /** When set, the consent client lookup fails with it. */
  clientError: null as unknown,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  redirect: mocks.redirect,
}));

vi.mock('@/lib/auth-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-client')>();
  return {
    ...actual,
    authClient: { useSession: () => ({ data: mocks.session, isPending: false }) },
    oauthAuthClient: { oauth2: { consent: vi.fn() } },
  };
});

/** The consent client lookup answers with a self-registered app. */
vi.mock('@/lib/orpc', () => ({
  orpc: {
    getOAuthConsentClient: {
      queryOptions: ({ input }: { input: { clientId: string } }) => ({
        queryKey: ['getOAuthConsentClient', input.clientId],
        queryFn: async (): Promise<z.infer<typeof oauthConsentClientSchema>> => {
          if (mocks.clientError) throw mocks.clientError;
          return {
          clientId: input.clientId,
          name: 'Study Buddy',
          uri: null,
          registrationMethod: 'dynamic',
          verifiedHost: null,
          };
        },
      }),
    },
  },
}));

const STAYS_CONNECTED = "Stay connected when you're not using it";

function signedQuery(scope: string) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: 'http://127.0.0.1:43123/oauth/callback',
    scope,
    state: 'state-1',
    exp: String(Math.floor(Date.now() / 1000) + 600),
    sig: 'signature',
  });
}

function renderConsent(searchParams: URLSearchParams) {
  mocks.searchParams = searchParams;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<OAuthConsent />, { wrapper });
}

beforeEach(() => {
  mocks.redirect.mockReset();
  mocks.session = null;
  mocks.clientError = null;
});

describe('OAuthConsent', () => {
  it('sends a signed-out student to sign-in with the whole signed OAuth query', () => {
    const query = signedQuery('mcp:read offline_access');
    renderConsent(query);

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = new URL(mocks.redirect.mock.calls[0]![0] as string, 'http://cadet.test');
    expect(target.pathname).toBe('/sign-in');
    expect([...target.searchParams]).toEqual([...query]);
  });

  it('lists staying connected in plain words when the app asks for offline_access', async () => {
    mocks.session = { user: { id: 'cadet-user' } };
    renderConsent(signedQuery('mcp:read offline_access'));

    expect(await screen.findByText('Read your admission details')).toBeTruthy();
    expect(screen.getByText(STAYS_CONNECTED)).toBeTruthy();
    expect(screen.queryByText(/offline_access/)).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('does not mention staying connected when the app did not ask for it', async () => {
    mocks.session = { user: { id: 'cadet-user' } };
    renderConsent(signedQuery('mcp:read'));

    expect(await screen.findByText('Read your admission details')).toBeTruthy();
    expect(screen.queryByText(STAYS_CONNECTED)).toBeNull();
  });

  it('says the Cadet Portal is unavailable, not that the app is unknown, when the school has it switched off', async () => {
    mocks.session = { user: { id: 'cadet-user' } };
    mocks.clientError = Object.assign(new Error('Cadet Portal is not enabled for this school.'), {
      code: 'FORBIDDEN',
      data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' },
    });
    renderConsent(signedQuery('mcp:read'));

    expect(await screen.findByRole('heading', { name: 'Cadet Portal unavailable' })).toBeTruthy();
    expect(screen.getByText(/Your school is not using the Cadet Portal right now/)).toBeTruthy();
    expect(screen.queryByText(/not known to the Cadet Portal/)).toBeNull();
    expect(screen.queryByText(/Start the connection again/)).toBeNull();
  });

  it('still blames the app for any other failure of the lookup', async () => {
    mocks.session = { user: { id: 'cadet-user' } };
    mocks.clientError = Object.assign(new Error('OAuth client was not found.'), { code: 'NOT_FOUND' });
    renderConsent(signedQuery('mcp:read'));

    expect(await screen.findByRole('heading', { name: 'Cannot connect this app' })).toBeTruthy();
    expect(screen.getByText(/not known to the Cadet Portal or has been disabled/)).toBeTruthy();
  });
});
