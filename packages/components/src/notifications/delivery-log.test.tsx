// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationDeliveryLog, type DeliveryLogDelivery } from './delivery-log';
import { whatsappReadiness } from './whatsapp-readiness';

afterEach(() => cleanup());

const delivery = (overrides: Partial<DeliveryLogDelivery>): DeliveryLogDelivery => ({
  id: 'ndl_1', channel: 'whatsapp', status: 'sent', skipReason: null, errorCode: null, errorMessage: null,
  attempts: 1, interrupted: false, resendOfDeliveryId: null, resent: false, subscriptionGone: false, resendable: false, nextAttemptAt: null, ...overrides,
});

describe('NotificationDeliveryLog', () => {
  it('shows status and reasons per channel and offers Resend only for failed, not yet resent copies', () => {
    const onResend = vi.fn();
    render(
      <NotificationDeliveryLog
        canResend
        resendingDeliveryId={null}
        onResend={onResend}
        items={[{
          notificationId: 'ntf_1', type: 'payment.received', studentName: 'Meera', reference: 'RCP/2026-27/000001', createdAt: '2026-11-09T10:00:00Z',
          deliveries: [
            delivery({ id: 'ndl_failed', status: 'failed', errorCode: 'wa_131026', resendable: true }),
            delivery({ id: 'ndl_push', channel: 'web_push', status: 'skipped', skipReason: 'no_subscription' }),
          ],
        }]}
      />,
    );
    expect(screen.getByText('Payment receipt · RCP/2026-27/000001 · Meera')).toBeTruthy();
    expect(screen.getByText('wa_131026')).toBeTruthy();
    expect(screen.getByText('Device notifications not turned on')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(onResend).toHaveBeenCalledWith('ndl_failed');
  });

  it('never offers Resend for a device that no longer receives notifications, and shows a pending retry', () => {
    const items = [{
      notificationId: 'ntf_2', type: 'bill.issued', studentName: null, reference: null, createdAt: '2026-11-09T10:00:00Z',
      deliveries: [
        delivery({ id: 'ndl_gone', channel: 'web_push', status: 'failed', errorCode: 'subscription_gone', subscriptionGone: true }),
        delivery({ id: 'ndl_retry', status: 'owed', attempts: 1, nextAttemptAt: '2026-11-10T10:00:00Z' }),
      ],
    }];
    render(<NotificationDeliveryLog canResend resendingDeliveryId={null} onResend={vi.fn()} items={items} />);
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
    expect(screen.getByText('This device no longer receives notifications.')).toBeTruthy();
    expect(screen.getByText(/^Will retry /)).toBeTruthy();
  });

  it('hides Resend without permission and after a resend', () => {
    const items = [{ notificationId: 'ntf_1', type: 'bill.issued', studentName: null, reference: null, createdAt: '2026-11-09T10:00:00Z', deliveries: [delivery({ status: 'failed', resent: true })] }];
    render(<NotificationDeliveryLog canResend resendingDeliveryId={null} onResend={vi.fn()} items={items} />);
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
    expect(screen.getByText('Resent')).toBeTruthy();
  });
});

describe('whatsappReadiness', () => {
  it('reports the first failing fact', () => {
    expect(whatsappReadiness({ whatsappNo: null, whatsappVerified: false, whatsappConsent: false })).toBe('no_number');
    expect(whatsappReadiness({ whatsappNo: '+919876543210', whatsappVerified: false, whatsappConsent: false })).toBe('not_verified');
    expect(whatsappReadiness({ whatsappNo: '+919876543210', whatsappVerified: true, whatsappConsent: false })).toBe('no_consent');
    expect(whatsappReadiness({ whatsappNo: '+919876543210', whatsappVerified: true, whatsappConsent: true })).toBe('ready');
  });
});
