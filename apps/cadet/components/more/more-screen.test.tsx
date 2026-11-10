import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { featureDisabledError, notices, profile } from '@/test/fixtures';
import { page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { MoreScreen, SignOutButton } from './more-screen';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), signOut: vi.fn(), turnOff: vi.fn() }));

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock('@/lib/web-push.client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/web-push.client')>()),
  turnOffDeviceNotifications: mocks.turnOff,
}));
// Device notifications and the theme switch have their own behaviour and are not under test here.
vi.mock('../notifications/cadet-device-notifications', () => ({ CadetDeviceNotifications: () => null }));
vi.mock('@campuspilot/components/theme-toggle', () => ({ ThemeToggle: () => null }));

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.signOut.mockReset();
  mocks.turnOff.mockReset();
  mocks.turnOff.mockResolvedValue(undefined);
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

describe('SignOutButton when the device cannot be turned off', () => {
  it('still signs out: the server revokes the session\'s device notifications, so the app\'s own request is best effort', async () => {
    // For example offline, or refused because the school's portal is switched off.
    mocks.turnOff.mockRejectedValue(Object.assign(new Error('Cadet Portal is not enabled for this school.'), { code: 'FORBIDDEN' }));
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    renderWithQuery(<SignOutButton />);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/sign-in'));
    expect(mocks.turnOff).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MoreScreen notices row', () => {
  it('links to Notices for a school that has them', async () => {
    resetHandlers({ getProfile: () => profile, listNotices: () => page(notices) });
    renderWithQuery(<MoreScreen />);
    expect((await screen.findByRole('link', { name: /Notices/ })).getAttribute('href')).toBe('/notices');
  });

  it('keeps the row when the student has no notice yet or the read fails for another reason', async () => {
    resetHandlers({ getProfile: () => profile, listNotices: () => page([]) });
    const empty = renderWithQuery(<MoreScreen />);
    expect(await screen.findByRole('link', { name: /Notices/ })).toBeTruthy();
    empty.unmount();
    resetHandlers({ getProfile: () => profile, listNotices: () => { throw new Error('Network down'); } });
    renderWithQuery(<MoreScreen />);
    expect(await screen.findByRole('link', { name: /Notices/ })).toBeTruthy();
  });

  it('has no Notices row when the school does not have notices', async () => {
    resetHandlers({ getProfile: () => profile, listNotices: () => { throw featureDisabledError('notices'); } });
    renderWithQuery(<MoreScreen />);
    expect(await screen.findByText('Meera Singh')).toBeTruthy();
    expect(await screen.findByText('Appearance')).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByRole('link', { name: /Notices/ })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
