import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/test/orpc-mock';
import { SignOutButton } from './more-screen';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), signOut: vi.fn() }));

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: mocks.signOut } }));

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.signOut.mockReset();
});

describe('SignOutButton', () => {
  it('stays on the page and shows the error when sign-out fails', async () => {
    mocks.signOut.mockResolvedValue({ data: null, error: { message: 'Network is unreachable' } });
    renderWithQuery(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Network is unreachable')).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('goes to sign-in after signing out', async () => {
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    renderWithQuery(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/sign-in'));
  });
});
