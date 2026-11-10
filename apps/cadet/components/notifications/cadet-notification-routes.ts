import {
  notificationLinkFactKeys,
  type AdmissionNotificationType,
  type NotificationLinkFacts,
  type NotificationListItem,
} from '@campuspilot/components/notifications';

import { billHref, examResultHref, FEES_HREF, noticeHref, timetableHref } from '@/lib/route-param';

type CadetRouteBuilder<T extends AdmissionNotificationType> = (facts: NotificationLinkFacts<T>) => string | null;

/**
 * Cadet Portal route builders (D-21, D-44), exhaustive over the student
 * audience. They take only a type's link facts (identifiers), so the same
 * builder serves an inbox row and a web push click (`/notifications/open`).
 * A bill opens its bill on the Fees screen; a payment opens the Fees ledger
 * (the portal has no receipt page); a result opens that exam's result for
 * the enrollment and class named in the notification; a notice opens that
 * notice.
 */
export const cadetNotificationRoutes: { [T in AdmissionNotificationType]: CadetRouteBuilder<T> } = {
  'bill.issued': ({ billId }) => billHref(billId),
  'payment.received': () => FEES_HREF,
  'exam.results_published': ({ studentId, classId, examSlug }) => examResultHref({ studentId, classId, examSlug }),
  'notice.published': ({ noticeId }) => noticeHref(noticeId),
  'exam.timetable_published': ({ sessionId, examSlug }) => timetableHref({ sessionId, examSlug }),
};

function isAdmissionType(type: string): type is AdmissionNotificationType {
  return Object.hasOwn(cadetNotificationRoutes, type);
}

/** The route of a listed row; null when it links nowhere. */
export function cadetNotificationRoute(item: NotificationListItem): string | null {
  if (!isAdmissionType(item.type)) return null;
  const build = cadetNotificationRoutes[item.type] as CadetRouteBuilder<AdmissionNotificationType>;
  return build(item.data as never);
}

/** The Cadet Portal inbox page. */
export const CADET_NOTIFICATIONS_HREF = '/notifications';

/**
 * The route a push click opens, from the `type` and link facts in the
 * `/notifications/open` query (written by the server's web push renderer).
 * Anything unknown, incomplete or without a page of its own opens the inbox.
 */
export function cadetRouteFromLink(params: URLSearchParams): string {
  const type = params.get('type');
  if (!type || !isAdmissionType(type)) return CADET_NOTIFICATIONS_HREF;
  const facts: Record<string, string> = {};
  for (const key of notificationLinkFactKeys[type] as readonly string[]) {
    const value = params.get(key);
    if (!value) return CADET_NOTIFICATIONS_HREF;
    facts[key] = value;
  }
  const build = cadetNotificationRoutes[type] as CadetRouteBuilder<AdmissionNotificationType>;
  return build(facts as never) ?? CADET_NOTIFICATIONS_HREF;
}
