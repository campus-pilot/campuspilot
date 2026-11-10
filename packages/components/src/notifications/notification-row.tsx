import type { ReactNode } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Check, X } from 'lucide-react';

import type { NotificationLinkProps } from './notification-bell';
import { presentNotification, type NotificationListItem } from './notification-renderers';

/** `9 Nov, 14:05` in the viewer's locale and time zone. */
export function formatNotificationTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function RowText({ item }: { item: NotificationListItem }) {
  const presentation = presentNotification(item);
  const Icon = presentation.icon;
  const unread = item.readAt === null;
  return (
    <>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={unread ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{presentation.title}</span>
        {presentation.description ? <span className="text-xs text-muted-foreground">{presentation.description}</span> : null}
        <time className="text-[0.6875rem] text-muted-foreground" dateTime={new Date(item.createdAt).toISOString()}>
          {formatNotificationTime(item.createdAt)}
        </time>
      </span>
    </>
  );
}

function RowAction({ item, onMarkRead, onDismiss }: {
  item: NotificationListItem;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (item.readAt === null) {
    return (
      <Button type="button" variant="ghost" size="icon" aria-label="Mark as read" onClick={() => onMarkRead(item.id)}>
        <Check aria-hidden />
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
      <X aria-hidden />
    </Button>
  );
}

/**
 * One inbox row: wording from the per-type registry, an unread marker, and a
 * mark-read (unread) or dismiss (read) action. When the app's route builder
 * gives a link, the text opens it and marks the row read.
 */
export function NotificationRow({ item, href, renderLink, onMarkRead, onDismiss }: {
  item: NotificationListItem;
  href: string | null;
  renderLink: (props: NotificationLinkProps) => ReactNode;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const unread = item.readAt === null;
  const text = <RowText item={item} />;
  const textClassName = 'flex min-w-0 flex-1 items-start gap-3';
  return (
    <li className={`flex items-start gap-2 px-3 py-2.5 ${unread ? 'bg-muted/40' : ''}`} data-unread={unread || undefined}>
      <span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} />
      {href
        ? renderLink({
            href,
            className: `${textClassName} rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30`,
            onClick: unread ? () => onMarkRead(item.id) : undefined,
            children: text,
          })
        : <span className={textClassName}>{text}</span>}
      <RowAction item={item} onMarkRead={onMarkRead} onDismiss={onDismiss} />
    </li>
  );
}
