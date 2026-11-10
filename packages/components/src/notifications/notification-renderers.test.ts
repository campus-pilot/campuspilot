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
    expect(
      presentNotification({
        type: 'notification.whatsapp_batch_failed',
        data: { batchKind: 'notice', failedType: 'notice.published', failedCount: 2, sessionId: 's', noticeId: 'n', noticeTitle: 'Sports Day' },
      }).title,
    ).toBe('2 WhatsApp messages of the notice "Sports Day" failed');
  });

  it('shows a notice by its title, for students and for staff', () => {
    expect(
      presentNotification({ type: 'notice.published', data: { noticeId: 'n', sessionId: 's', noticeTitle: 'Sports Day', admissionId: 'a', studentName: 'Asha' } }),
    ).toMatchObject({ title: 'Sports Day', description: 'New notice from your school.' });
    expect(presentNotification({ type: 'notice.published_staff', data: { noticeId: 'n', sessionId: 's', noticeTitle: 'Staff meeting' } })).toMatchObject({
      title: 'Staff meeting',
      description: 'New staff notice.',
    });
  });

  it('shows a failed WhatsApp message by its explanation, not its raw error code', () => {
    const failed = (extra: { errorCode?: string; errorMessage?: string }) =>
      presentNotification({ type: 'notification.whatsapp_failed', data: { admissionId: 'a', studentName: 'Asha', failedType: 'bill.issued', ...extra } }).description;
    expect(failed({ errorCode: 'outcome_unknown', errorMessage: 'WhatsApp did not confirm this message.' })).toBe('WhatsApp did not confirm this message.');
    expect(failed({ errorCode: 'wa_131026' })).toBe('Sending failed.');
    expect(failed({})).toBe('Sending failed.');
  });

  it('tells the publisher the in-app copies apart from WhatsApp', () => {
    expect(
      presentNotification({
        type: 'exam.results_publish_finished',
        data: { sessionId: 's', examSlug: 'final', examName: 'Final', recipientCount: 3, sentCount: 0, failedCount: 0, skippedCount: 3, inAppCount: 3 },
      }).description,
    ).toBe('3 of 3 students have them in their Cadet Portal inbox. WhatsApp: 0 sent, 0 failed, 3 skipped.');
  });
});
