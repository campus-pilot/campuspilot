import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { profile } from '@/test/fixtures';
import { renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { AppFrame, isTabActive } from './app-frame';

const mocks = vi.hoisted(() => ({ session: null as unknown, isPending: false, redirect: vi.fn() }));

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));
// The install chrome reads browser display modes; it has its own behaviour and is not under test here.
vi.mock('./cadet-school-chrome', () => ({ CadetSchoolChrome: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/fees/fbill_1', redirect: mocks.redirect }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: mocks.session, isPending: mocks.isPending }) },
}));

beforeEach(() => {
  mocks.redirect.mockReset();
  resetHandlers({ getProfile: () => profile, getUnreadNotificationCount: () => ({ count: 2 }) });
});

describe('AppFrame', () => {
  it('sends a signed-out visitor to sign-in before loading any record', () => {
    mocks.session = null;
    renderWithQuery(<AppFrame>secret</AppFrame>);
    expect(mocks.redirect).toHaveBeenCalledWith('/sign-in');
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('shows the student, the notification bell and the five tabs', async () => {
    mocks.session = { user: { id: 'cadet' } };
    renderWithQuery(<AppFrame>content</AppFrame>);
    expect(await screen.findByText('Meera Singh')).toBeTruthy();
    expect(screen.getByText('Class 7 · B · Greenfield Valley School')).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Fees', 'Results', 'Growth', 'More']);
    expect(screen.getByRole('link', { name: 'Fees' }).getAttribute('aria-current')).toBe('page');
    expect((await screen.findByRole('link', { name: /Notifications/ })).getAttribute('href')).toBe('/notifications');
  });

  it('matches a tab on its own route and nested routes; Home only exactly', () => {
    expect(isTabActive('/', '/')).toBe(true);
    expect(isTabActive('/fees', '/')).toBe(false);
    expect(isTabActive('/fees/abc', '/fees')).toBe(true);
    expect(isTabActive('/feesx', '/fees')).toBe(false);
  });
});
