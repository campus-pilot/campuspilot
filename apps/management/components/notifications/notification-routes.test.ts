import assert from 'node:assert/strict';
import test from 'node:test';

import { noticeHref, staffNotificationRoute } from './notification-routes';

const item = (type: string, data: Record<string, unknown>) => ({ id: 'ntf_1', type, data, createdAt: new Date(), readAt: null }) as never;

test('a published staff notice opens on its notice page', () => {
  assert.equal(noticeHref('sch 1', 'sess_1', 'ntc/1'), '/school/sch%201/sessions/sess_1/notices/ntc%2F1');
  assert.equal(
    staffNotificationRoute('sch_1', item('notice.published_staff', { noticeId: 'ntc_1', sessionId: 'sess_1', noticeTitle: 'Staff meeting' })),
    '/school/sch_1/sessions/sess_1/notices/ntc_1',
  );
});

test("a notice's WhatsApp failure alert opens on that notice, where its delivery log is", () => {
  const alert = { batchKind: 'notice', failedType: 'notice.published', failedCount: 2, sessionId: 'sess_1' };
  assert.equal(
    staffNotificationRoute('sch_1', item('notification.whatsapp_batch_failed', { ...alert, noticeId: 'ntc_1' })),
    '/school/sch_1/sessions/sess_1/notices/ntc_1',
  );
  assert.equal(staffNotificationRoute('sch_1', item('notification.whatsapp_batch_failed', alert)), null);
});

test('the student copy of a notice has no staff route', () => {
  assert.equal(staffNotificationRoute('sch_1', item('notice.published', { noticeId: 'ntc_1' })), null);
});
