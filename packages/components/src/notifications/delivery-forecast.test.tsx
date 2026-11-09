// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DeliveryForecastSummary } from './delivery-forecast';

afterEach(() => cleanup());

describe('DeliveryForecastSummary', () => {
  it('shows students, copies to send per channel and skip reasons with counts', () => {
    render(
      <DeliveryForecastSummary
        forecast={{
          recipientCount: 3,
          channels: {
            whatsapp: { owed: 1, skipped: { no_consent: 2 } },
            web_push: { owed: 0, skipped: { no_subscription: 3, demo_school: 0 } },
          },
        }}
      />,
    );
    expect(screen.getByText('3 students will get an in-app notification.')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('1 to send')).toBeTruthy();
    expect(screen.getByText('No WhatsApp consent')).toBeTruthy();
    expect(screen.getByText('Device notifications not turned on')).toBeTruthy();
    // A zero count is not listed as a reason.
    expect(screen.queryByText('Demo school (never sent)')).toBeNull();
  });
});
