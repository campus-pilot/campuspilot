import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { Info } from 'lucide-react';

import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_SKIP_REASON_LABELS,
  DELIVERY_STATUS_LABELS,
  type DeliveryChannel,
  type DeliverySkipReason,
  type DeliveryStatus,
} from './delivery-labels';
import type { AdmissionNotificationType } from './notification-renderers';
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

/** Exhaustive over the student types: a new one fails the build until it has a label. */
const ADMISSION_TYPE_LABELS: Record<AdmissionNotificationType, string> = {
  'bill.issued': 'Bill',
  'payment.received': 'Payment receipt',
  'exam.results_published': 'Results',
  'notice.published': 'Notice',
};
/** Looked up by the row's stored type, which may be one this release retired. */
const TYPE_LABELS: Record<string, string> = ADMISSION_TYPE_LABELS;

function deliveryDetail(delivery: DeliveryLogDelivery) {
  if (delivery.interrupted) return 'Sending was interrupted; it may or may not have arrived.';
  if (delivery.status === 'owed' && delivery.nextAttemptAt && delivery.attempts > 0) {
    return `Will retry ${formatNotificationTime(delivery.nextAttemptAt)}.`;
  }
  if (delivery.subscriptionGone) return 'This device no longer receives notifications.';
  if (delivery.status === 'skipped' && delivery.skipReason) return DELIVERY_SKIP_REASON_LABELS[delivery.skipReason];
  if (delivery.status === 'failed') return delivery.errorMessage ?? 'Sending failed.';
  return null;
}

/**
 * The provider's error code of a failed copy, for support: behind an info
 * button's tooltip (and its accessible name) rather than in the line, so
 * staff read the human message, not `outcome_unknown` or `wa_131026`.
 */
function ErrorCodeHint({ code }: { code: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground" aria-label={`Error code ${code}`}>
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Error code: {code}</TooltipContent>
    </Tooltip>
  );
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
      {failed && delivery.errorCode && !delivery.subscriptionGone ? <ErrorCodeHint code={delivery.errorCode} /> : null}
      {canResend && delivery.resendable ? (
        <Button type="button" variant="outline" size="sm" disabled={resending} onClick={() => onResend(delivery.id)}>
          {resending ? 'Resending…' : 'Resend'}
        </Button>
      ) : null}
      {failed && delivery.resent ? <span className="text-muted-foreground">Resent</span> : null}
    </li>
  );
}

const countOf = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What the log does not list yet. A bulk action's notifications are
 * prepared one student at a time after the action returns, so right after
 * it the list is shorter than the audience: this line says how many are
 * still to come (the caller keeps reading the log until none are) and how
 * many could not be prepared at all. Renders nothing when the list is
 * complete.
 */
export function DeliveryLogPreparation({ pendingCount, failedCount }: { pendingCount: number; failedCount: number }) {
  if (pendingCount === 0 && failedCount === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {pendingCount > 0 ? (
        <p role="status" className="text-muted-foreground">
          {countOf(pendingCount, 'more notification is', 'more notifications are')} being prepared. This list updates by itself.
        </p>
      ) : null}
      {failedCount > 0 ? (
        <p role="alert" className="text-destructive">
          {countOf(failedCount, 'notification', 'notifications')} could not be prepared and may be missing from this list.
        </p>
      ) : null}
    </div>
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
