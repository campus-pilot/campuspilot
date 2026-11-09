import {
  notificationLinkFactKeys,
  type AdmissionNotificationType,
  type NotificationLinkFacts,
  type NotificationListItem,
} from '@campuspilot/components/notifications';

type CadetRouteBuilder<T extends AdmissionNotificationType> = (facts: NotificationLinkFacts<T>) => string | null;

/**
 * Cadet Portal route builders (D-21), exhaustive over the student audience.
 * They take only a type's link facts (identifiers), so the same builder
 * serves an inbox row and a web push click (`/notifications/open`).
 * The portal has no bill, receipt or results pages yet (plan Phases 5–6,
 * D-18), so every type links nowhere for now and is read in the inbox
 * itself; when a page exists, only its builder changes.
 */
export const cadetNotificationRoutes: { [T in AdmissionNotificationType]: CadetRouteBuilder<T> } = {
  'bill.issued': () => null,
  'payment.received': () => null,
  'exam.results_published': () => null,
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
