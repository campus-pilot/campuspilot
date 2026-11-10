import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushConfig = vi.hoisted(() => ({ key: undefined as string | undefined }));
vi.mock('@campuspilot/env/cadet.client', () => ({
  env: {
    NEXT_PUBLIC_SERVER_URL: 'http://localhost:3000',
    get NEXT_PUBLIC_VAPID_PUBLIC_KEY() {
      return pushConfig.key;
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.resetModules();
});

async function renderCard() {
  const { CadetDeviceNotifications } = await import('./cadet-device-notifications');
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <CadetDeviceNotifications />
    </QueryClientProvider>,
  );
  return container;
}

describe('CadetDeviceNotifications', () => {
  it('offers nothing when web push is not set up for this portal build', async () => {
    pushConfig.key = undefined;
    const container = await renderCard();
    expect(container.innerHTML).toBe('');
    const { readDeviceNotificationStatus } = await import('@/lib/web-push.client');
    await expect(readDeviceNotificationStatus()).rejects.toThrow('not set up');
  });

  it('reports a browser without push APIs as unsupported only when push is set up', async () => {
    pushConfig.key = 'BPublicKeyForTests';
    const { readDeviceNotificationStatus, webPushConfigured } = await import('@/lib/web-push.client');
    expect(webPushConfigured).toBe(true);
    // jsdom has no PushManager.
    await expect(readDeviceNotificationStatus()).resolves.toBe('unsupported');
    expect((await renderCard()).innerHTML).not.toBe('');
  });
});
