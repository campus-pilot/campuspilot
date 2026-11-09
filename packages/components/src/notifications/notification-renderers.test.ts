import { describe, expect, it } from 'vitest';

import { presentNotification } from './notification-renderers';

describe('notification renderers', () => {
  it('words a grouped WhatsApp failure by its batch', () => {
    expect(
      presentNotification({
        type: 'notification.whatsapp_batch_failed',
        data: { batchKind: 'billing_run', failedType: 'bill.issued', failedCount: 3, sessionId: 's', billRunId: 'r', periodKey: 'monthly:2026-10' },
      }).title,
    ).toBe('3 WhatsApp messages of billing run monthly:2026-10 failed');
    expect(
      presentNotification({
        type: 'notification.whatsapp_batch_failed',
        data: { batchKind: 'result_publication', failedType: 'exam.results_published', failedCount: 1, sessionId: 's', examSlug: 'final', examName: 'Final Examination' },
      }).title,
    ).toBe('1 WhatsApp message of Final Examination results failed');
  });
});
