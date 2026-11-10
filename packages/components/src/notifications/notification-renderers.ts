import type {
  NotificationPayloads,
  NotificationType,
} from '@campuspilot/db/notifications/catalogue';
import {
  BellRing,
  ClipboardCheck,
  CreditCard,
  MessageCircleWarning,
  ReceiptText,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

import { formatMinorIndian } from '../finance/finance-model';

/** What a row shows for one notification, built from its facts at render time. */
export type NotificationPresentation = {
  icon: LucideIcon;
  title: string;
  description?: string;
};

/** Renders one type's facts. Facts added later are optional, so renderers tolerate their absence. */
export type NotificationRenderer<T extends NotificationType> = (data: NotificationPayloads[T]) => NotificationPresentation;

/**
 * The per-type row registry (D-22, D-28): every catalogue type's wording, in
 * one exhaustive record, so a new type fails the build until it is given
 * text. Each type has a single audience, so one registry serves both the
 * management and the Cadet inbox; links are not built here but by each
 * app's route builder.
 */
export const notificationRenderers: { [T in NotificationType]: NotificationRenderer<T> } = {
  'bill.issued': (data) => ({
    icon: ReceiptText,
    title: `New bill ${data.billNumber}`,
    description: `${formatMinorIndian(data.totalAmountMinor, data.currency)} issued on ${data.issueDate}.`,
  }),
  'payment.received': (data) => ({
    icon: WalletCards,
    title: `Payment received: ${formatMinorIndian(data.amountMinor, data.currency)}`,
    description: `Receipt ${data.receiptNumber}.`,
  }),
  'exam.results_published': (data) => ({
    icon: ClipboardCheck,
    title: `${data.examName} results are out`,
  }),
  'exam.results_publish_finished': (data) => ({
    icon: ClipboardCheck,
    title: `${data.examName} results sent`,
    description: [
      data.inAppCount === undefined ? null : `${data.inAppCount} of ${data.recipientCount} students have them in their Cadet Portal inbox.`,
      `WhatsApp: ${data.sentCount} sent, ${data.failedCount} failed, ${data.skippedCount} skipped.`,
    ].filter(Boolean).join(' '),
  }),
  'notification.whatsapp_failed': (data) => ({
    icon: MessageCircleWarning,
    title: `WhatsApp message to ${data.studentName} failed`,
    // The staff explanation, as in the delivery log; the error code stays in the log's details.
    description: data.errorMessage ?? 'Sending failed.',
  }),
  'notification.whatsapp_batch_failed': (data) => {
    const messages = `${data.failedCount} WhatsApp ${data.failedCount === 1 ? 'message' : 'messages'}`;
    const batch = data.batchKind === 'billing_run'
      ? (data.periodKey ? `billing run ${data.periodKey}` : 'a billing run')
      : `${data.examName ?? 'the examination'} results`;
    return {
      icon: MessageCircleWarning,
      title: `${messages} of ${batch} failed`,
      description: 'Open the delivery log to see who missed it and resend.',
    };
  },
  'billing.run_posted': (data) => ({
    icon: CreditCard,
    title: `Billing run ${data.periodKey} posted`,
    description: `${data.billCount} ${data.billCount === 1 ? 'bill' : 'bills'} issued.`,
  }),
};

/** A row as the inbox list receives it (the API DTO, with dates as values). */
export type NotificationListItem = {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  createdAt: Date | string;
  readAt: Date | string | null;
};

/**
 * Presents one listed row. The single cast of the notification UI: the API
 * guarantees `data` is the facts of `type` (validated when emitted).
 */
export function presentNotification(item: Pick<NotificationListItem, 'type' | 'data'>): NotificationPresentation {
  const render = notificationRenderers[item.type] as NotificationRenderer<NotificationType> | undefined;
  if (!render) return { icon: BellRing, title: 'Notification' };
  return render(item.data as never);
}

/** Catalogue types re-exported for app route builders (apps do not depend on `@campuspilot/db`). */
export type {
  AdmissionNotificationType,
  NotificationLinkFacts,
  NotificationPayloads,
  NotificationType,
  StaffNotificationType,
} from '@campuspilot/db/notifications/catalogue';
export { isNotificationType, notificationLinkFactKeys } from '@campuspilot/db/notifications/catalogue';
