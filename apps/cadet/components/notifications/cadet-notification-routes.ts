import type {
  AdmissionNotificationType,
  NotificationListItem,
  NotificationPayloads,
} from '@campuspilot/components/notifications';

type CadetRouteBuilder<T extends AdmissionNotificationType> = (data: NotificationPayloads[T]) => string | null;

/**
 * Cadet Portal route builders (D-21), exhaustive over the student audience.
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
