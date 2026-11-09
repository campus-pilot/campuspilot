import type {
  NotificationListItem,
  NotificationPayloads,
  StaffNotificationType,
} from '@campuspilot/components/notifications';

import { schoolHref, schoolSessionHref } from '../school-route';

type StaffRouteBuilder<T extends StaffNotificationType> = (schoolId: string, data: NotificationPayloads[T]) => string | null;

/**
 * Management route builders (D-21): every staff notification type turns its
 * facts into a route at render time, so routes can move without touching
 * stored rows. Exhaustive over the staff audience.
 */
export const staffNotificationRoutes: { [T in StaffNotificationType]: StaffRouteBuilder<T> } = {
  'exam.results_publish_finished': (schoolId, data) =>
    schoolSessionHref(schoolId, data.sessionId, `/exam/${encodeURIComponent(data.examSlug)}`),
  'notification.whatsapp_failed': (schoolId, data) =>
    schoolHref(schoolId, `/admission/${encodeURIComponent(data.admissionId)}`),
  'billing.run_posted': (schoolId, data) =>
    schoolSessionHref(schoolId, data.sessionId, `/billing/runs/${encodeURIComponent(data.billRunId)}`),
};

function isStaffType(type: string): type is StaffNotificationType {
  return Object.hasOwn(staffNotificationRoutes, type);
}

/** The route of a listed row; null for a type that is not a staff type. */
export function staffNotificationRoute(schoolId: string, item: NotificationListItem): string | null {
  if (!isStaffType(item.type)) return null;
  const build = staffNotificationRoutes[item.type] as StaffRouteBuilder<StaffNotificationType>;
  return build(schoolId, item.data as never);
}

/** The management inbox page. */
export function notificationsHref(schoolId: string) {
  return schoolHref(schoolId, '/notifications');
}
