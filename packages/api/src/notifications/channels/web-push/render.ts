import {
  notificationCatalogue,
  pickNotificationLinkFacts,
  type AdmissionNotificationType,
  type NotificationPayloads,
  type NotificationType,
} from '@campuspilot/db/notifications/catalogue';

import { formatIsoDate, formatMinorAmount, formatPeriodKey } from '../format';

/**
 * What the Cadet Portal's service worker receives (`apps/cadet/public/sw.js`).
 * Kept small (push payloads are limited to about 4 KB) and free of anything
 * not already shown in the inbox. `url` is a same-origin path; `tag` lets a
 * repeated push of the same notification replace the shown one.
 */
export type WebPushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type PushText = { title: string; body: string };
type PushTextRenderer<T extends AdmissionNotificationType> = (data: NotificationPayloads[T]) => PushText;

/**
 * Web push wording per student type (D-22): exhaustive, so a new student
 * type fails the build until it has push text. Every title names the
 * student, because one device can hold several siblings' subscriptions.
 */
export const webPushRenderers: { [T in AdmissionNotificationType]: PushTextRenderer<T> } = {
  'bill.issued': (data) => ({
    title: `New bill for ${data.studentName}`,
    body: `${formatMinorAmount(data.totalAmountMinor, data.currency)} ${data.periodKey ? `for ${formatPeriodKey(data.periodKey)}` : `issued on ${formatIsoDate(data.issueDate)}`} (bill ${data.billNumber}).`,
  }),
  'payment.received': (data) => ({
    title: `Payment received for ${data.studentName}`,
    body: `${formatMinorAmount(data.amountMinor, data.currency)} received (receipt ${data.receiptNumber}).`,
  }),
  'exam.results_published': (data) => ({
    title: `${data.examName} results for ${data.studentName}`,
    body: 'The results are now available in the Cadet Portal.',
  }),
  'notice.published': (data) => ({
    title: `New notice for ${data.studentName}`,
    body: data.noticeTitle,
  }),
};

/** The Cadet Portal page that turns a push click into the item's route. */
export const CADET_PUSH_OPEN_PATH = '/notifications/open';

function isPushRenderable(type: NotificationType): type is AdmissionNotificationType {
  return notificationCatalogue[type].audience === 'admission' && Object.hasOwn(webPushRenderers, type);
}

/**
 * Builds the push message of a notification. Its link carries the type and
 * the type's link facts (identifiers only); the portal's route builders turn
 * them into a route. Null for a type that has no push wording (staff types).
 */
export function renderWebPushMessage(notificationId: string, type: NotificationType, data: Record<string, unknown>): WebPushMessage | null {
  if (!isPushRenderable(type)) return null;
  const render = webPushRenderers[type] as PushTextRenderer<AdmissionNotificationType>;
  const text = render(data as never);
  const query = new URLSearchParams({ type, ...pickNotificationLinkFacts(type, data) });
  return { ...text, url: `${CADET_PUSH_OPEN_PATH}?${query.toString()}`, tag: notificationId };
}
