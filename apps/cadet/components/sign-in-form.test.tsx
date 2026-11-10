import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers, orpcMock, resetHandlers } from '@/test/orpc-mock';

import { SignInForm } from './sign-in-form';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  signInFetch: vi.fn(),
  oauthSignInFetch: vi.fn(),
}));

vi.mock('@/lib/orpc', () => ({ orpc: orpcMock }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  redirect: vi.fn(),
}));

/**
 * The real query helpers with stubbed clients: no session, and sign-in
 * requests answered by the test.
 */
vi.mock('@/lib/auth-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-client')>();
  return {
    ...actual,
    authClient: {
      useSession: () => ({ data: null, isPending: false }),
      $fetch: mocks.signInFetch,
    },
    oauthAuthClient: { $fetch: mocks.oauthSignInFetch },
  };
});

function renderSignIn(search = '') {
  mocks.searchParams = new URLSearchParams(search);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<SignInForm />, { wrapper });
}

const greenwood = { slug: 'greenwood', name: 'Greenwood High', logoUrl: null };

/** Picks Greenwood High from the school combobox's suggestions. */
async function chooseSchool() {
  fireEvent.click(screen.getByLabelText('School'));
  fireEvent.change(screen.getByPlaceholderText('School name or code…'), { target: { value: 'gre' } });
  fireEvent.click(await screen.findByRole('option', { name: /Greenwood High/ }));
}

async function fillIn() {
  await chooseSchool();
  fireEvent.change(screen.getByLabelText('Admission number'), { target: { value: 'ADM-1' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'maple-river-42' } });
}

const signInButton = () => screen.getByRole('button', { name: 'Sign in' });

beforeEach(() => {
  resetHandlers({
    searchSchools: () => ({ schools: [greenwood] }),
    getSignInSchool: (input) => {
      if ((input as { slug: string }).slug === 'greenwood') return greenwood;
      throw { code: 'NOT_FOUND' };
    },
  });
  mocks.signInFetch.mockReset();
  mocks.oauthSignInFetch.mockReset();
});

describe('SignInForm', () => {
  it('shows an error under each empty field on submit and sends nothing', async () => {
    renderSignIn();
    fireEvent.click(signInButton());

    expect(await screen.findByText('Choose your school.')).toBeTruthy();
    expect(screen.getByText('Enter your admission number.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(mocks.signInFetch).not.toHaveBeenCalled();
  });

  it('keeps Sign in enabled after a rejected attempt, so the student can retry', async () => {
    mocks.signInFetch.mockResolvedValue({
      data: null,
      error: { message: 'The school code, admission number or password is incorrect.' },
    });
    renderSignIn();
    await fillIn();
    fireEvent.click(signInButton());

    expect(await screen.findByText('The school code, admission number or password is incorrect.')).toBeTruthy();
    await waitFor(() => expect((signInButton() as HTMLButtonElement).disabled).toBe(false));

    // Retrying without editing a field sends the request again.
    fireEvent.click(signInButton());
    await waitFor(() => expect(mocks.signInFetch).toHaveBeenCalledTimes(2));
    expect(mocks.signInFetch).toHaveBeenLastCalledWith('/sign-in/admission', {
      method: 'POST',
      body: { schoolSlug: 'greenwood', admissionNo: 'ADM-1', password: 'maple-river-42' },
    });
  });

  it('asks for three letters before suggesting schools', async () => {
    const search = vi.fn(() => ({ schools: [greenwood] }));
    handlers.searchSchools = search;
    renderSignIn();
    fireEvent.click(screen.getByLabelText('School'));
    fireEvent.change(screen.getByPlaceholderText('School name or code…'), { target: { value: 'gr' } });
    expect(screen.getByText(/Type at least 3 letters/)).toBeTruthy();
    expect(search).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('School name or code…'), { target: { value: 'gre' } });
    expect(await screen.findByRole('option', { name: /Greenwood High/ })).toBeTruthy();
    expect(search).toHaveBeenCalledWith({ query: 'gre' });
  });

  it('shows the chosen school above the form', async () => {
    renderSignIn();
    await chooseSchool();
    expect(await screen.findByText('Greenwood High', { selector: 'p' })).toBeTruthy();
  });

  it('chooses the school from a shared link and signs in with its code', async () => {
    mocks.signInFetch.mockResolvedValue({ data: null, error: { message: 'Nope.' } });
    renderSignIn('school=greenwood');
    expect(await screen.findByText('Greenwood High', { selector: 'p' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Admission number'), { target: { value: 'ADM-1' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'maple-river-42' } });
    fireEvent.click(signInButton());
    await waitFor(() =>
      expect(mocks.signInFetch).toHaveBeenCalledWith('/sign-in/admission', {
        method: 'POST',
        body: { schoolSlug: 'greenwood', admissionNo: 'ADM-1', password: 'maple-river-42' },
      }),
    );
  });

  it('says so when a shared link names a code no school has', async () => {
    renderSignIn('school=unknown');
    expect(await screen.findByText(/No school has the code “unknown”/)).toBeTruthy();
  });

  it('says an app is asking to connect only when the signed OAuth query is present', () => {
    const hint = /An app is asking to connect/;
    const { unmount } = renderSignIn();
    expect(screen.queryByText(hint)).toBeNull();
    unmount();

    const future = Math.floor(Date.now() / 1000) + 600;
    renderSignIn(`client_id=app&scope=mcp%3Aread&exp=${future}&sig=signature`);
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('replaces the form with a restart hint when the signed OAuth query has expired', () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    renderSignIn(`client_id=app&exp=${past}&sig=signature`);
    expect(screen.getByText(/This connection request has expired/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});
