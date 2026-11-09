import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';

import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_SKIP_REASON_LABELS,
  DELIVERY_STATUS_LABELS,
  type DeliveryChannel,
  type DeliverySkipReason,
  type DeliveryStatus,
} from './delivery-labels';
import { formatNotificationTime } from './notification-row';

/** One remote copy as the delivery log API returns it. */
export type DeliveryLogDelivery = {
  id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  skipReason: DeliverySkipReason | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  interrupted: boolean;
  resendOfDeliveryId: string | null;
  resent: boolean;
  /** A failed device notification whose device no longer receives notifications (not resendable). */
  subscriptionGone: boolean;
  /** Staff may resend it (the server decides: failed, not resent, device still subscribed). */
  resendable: boolean;
  /** When an owed copy is due to be (re)tried. */
  nextAttemptAt: Date | string | null;
};

/** One student notification with its copies. */
export type DeliveryLogItem = {
  notificationId: string;
  type: string;
  studentName: string | null;
  reference: string | null;
  createdAt: Date | string;
  deliveries: DeliveryLogDelivery[];
};

const TYPE_LABELS: Record<string, string> = {
  'bill.issued': 'Bill',
  'payment.received': 'Payment receipt',
  'exam.results_published': 'Results',
};

function deliveryDetail(delivery: DeliveryLogDelivery) {
  if (delivery.interrupted) return 'Sending was interrupted; it may or may not have arrived.';
  if (delivery.status === 'owed' && delivery.nextAttemptAt && delivery.attempts > 0) {
    return `Will retry ${formatNotificationTime(delivery.nextAttemptAt)}.`;
  }
  if (delivery.subscriptionGone) return 'This device no longer receives notifications.';
  if (delivery.status === 'skipped' && delivery.skipReason) return DELIVERY_SKIP_REASON_LABELS[delivery.skipReason];
  if (delivery.status === 'failed') return [delivery.errorCode, delivery.errorMessage].filter(Boolean).join(' · ') || null;
  return null;
}

function DeliveryLine({ delivery, canResend, resending, onResend }: { delivery: DeliveryLogDelivery; canResend: boolean; resending: boolean; onResend: (deliveryId: string) => void }) {
  const detail = deliveryDetail(delivery);
  const failed = delivery.status === 'failed';
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="min-w-28 text-muted-foreground">
        {DELIVERY_CHANNEL_LABELS[delivery.channel]}
        {delivery.resendOfDeliveryId ? ' (resend)' : ''}
      </span>
      <Badge variant={failed ? 'destructive' : 'outline'}>{DELIVERY_STATUS_LABELS[delivery.status]}</Badge>
      {detail ? <span className="text-muted-foreground">{detail}</span> : null}
      {canResend && delivery.resendable ? (
        <Button type="button" variant="outline" size="sm" disabled={resending} onClick={() => onResend(delivery.id)}>
          {resending ? 'Resending…' : 'Resend'}
        </Button>
      ) : null}
      {failed && delivery.resent ? <span className="text-muted-foreground">Resent</span> : null}
    </li>
  );
}

/**
 * The staff delivery log (presentational): each student notification with
 * the status of its device-notification and WhatsApp copies and why a copy
 * was skipped or failed. Failed copies offer "Resend" when `canResend`.
 */
export function NotificationDeliveryLog({
  items,
  canResend,
  resendingDeliveryId,
  onResend,
  emptyMessage = 'No notifications yet.',
}: {
  items: DeliveryLogItem[];
  canResend: boolean;
  resendingDeliveryId: string | null;
  onResend: (deliveryId: string) => void;
  emptyMessage?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {items.map((item) => (
        <li key={item.notificationId} className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {TYPE_LABELS[item.type] ?? 'Notification'}
              {item.reference ? ` · ${item.reference}` : ''}
              {item.studentName ? ` · ${item.studentName}` : ''}
            </span>
            <time className="text-xs text-muted-foreground" dateTime={new Date(item.createdAt).toISOString()}>
              {formatNotificationTime(item.createdAt)}
            </time>
          </div>
          {item.deliveries.length === 0 ? (
            <p className="text-xs text-muted-foreground">In-app only.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {item.deliveries.map((delivery) => (
                <DeliveryLine key={delivery.id} delivery={delivery} canResend={canResend} resending={resendingDeliveryId === delivery.id} onResend={onResend} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
