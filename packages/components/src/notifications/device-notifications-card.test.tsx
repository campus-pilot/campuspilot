// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceNotificationsCard, type DeviceNotificationStatus } from './device-notifications-card';

afterEach(() => cleanup());

function renderCard(status: DeviceNotificationStatus, overrides: { pending?: boolean; errorMessage?: string } = {}) {
  const onTurnOn = vi.fn();
  const onTurnOff = vi.fn();
  render(<DeviceNotificationsCard status={status} pending={overrides.pending ?? false} errorMessage={overrides.errorMessage} onTurnOn={onTurnOn} onTurnOff={onTurnOff} />);
  return { onTurnOn, onTurnOff };
}

describe('DeviceNotificationsCard', () => {
  it('offers to turn notifications on when they are off', () => {
    const { onTurnOn } = renderCard('off');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(onTurnOn).toHaveBeenCalledTimes(1);
  });

  it('offers to turn them off when they are on', () => {
    const { onTurnOff } = renderCard('on');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(onTurnOff).toHaveBeenCalledTimes(1);
  });

  it('explains instead of offering a button when the device cannot subscribe', () => {
    for (const status of ['needs_install', 'denied', 'unsupported', 'loading'] as const) {
      renderCard(status);
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
    renderCard('needs_install');
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
  });

  it('shows an error in place of the description and disables while pending', () => {
    renderCard('off', { pending: true, errorMessage: 'Notifications were not allowed.' });
    expect(screen.getByText('Notifications were not allowed.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Turning on…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
