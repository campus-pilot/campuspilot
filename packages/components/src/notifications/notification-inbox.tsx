import type { ReactNode } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@campuspilot/ui/components/empty';

import type { NotificationLinkProps } from './notification-bell';
import type { NotificationListItem } from './notification-renderers';
import { NotificationRow } from './notification-row';

export type NotificationInboxFilter = 'all' | 'unread';

/** Turns a listed row into an app route, or null when it links nowhere. */
export type NotificationRouteBuilder = (item: NotificationListItem) => string | null;

export type NotificationInboxProps = {
  items: NotificationListItem[];
  status: 'pending' | 'error' | 'success';
  filter: NotificationInboxFilter;
  onFilterChange: (filter: NotificationInboxFilter) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onRetry: () => void;
  routeFor: NotificationRouteBuilder;
  renderLink: (props: NotificationLinkProps) => ReactNode;
};

const FILTER_LABELS: Record<NotificationInboxFilter, string> = { all: 'All', unread: 'Unread' };

function InboxToolbar({ filter, onFilterChange, onMarkAllRead }: Pick<NotificationInboxProps, 'filter' | 'onFilterChange' | 'onMarkAllRead'>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1" role="group" aria-label="Show">
        {(Object.keys(FILTER_LABELS) as NotificationInboxFilter[]).map((value) => (
          <Button
            key={value}
            type="button"
            variant={filter === value ? 'secondary' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => onFilterChange(value)}
          >
            {FILTER_LABELS[value]}
          </Button>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={onMarkAllRead}>
        Mark all as read
      </Button>
    </div>
  );
}

function InboxEmpty({ filter }: { filter: NotificationInboxFilter }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</EmptyTitle>
        <EmptyDescription>
          {filter === 'unread' ? 'You are all caught up.' : 'Updates will appear here when something needs your attention.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function InboxError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border p-4">
      <p className="text-sm text-destructive">Notifications could not be loaded.</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function InboxBody(props: NotificationInboxProps) {
  if (props.status === 'pending') return <p className="text-sm text-muted-foreground">Loading notifications…</p>;
  if (props.status === 'error') return <InboxError onRetry={props.onRetry} />;
  if (props.items.length === 0) return <InboxEmpty filter={props.filter} />;
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
      {props.items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          href={props.routeFor(item)}
          renderLink={props.renderLink}
          onMarkRead={props.onMarkRead}
          onDismiss={props.onDismiss}
        />
      ))}
    </ul>
  );
}

/**
 * The notification inbox list (D-28): All/Unread filter, mark all read, rows
 * from the per-type registry and "Load more" keyset paging. Presentational:
 * the app's container loads pages and performs the mutations.
 */
export function NotificationInbox(props: NotificationInboxProps) {
  return (
    <section className="flex flex-col gap-3" aria-label="Notifications">
      <InboxToolbar filter={props.filter} onFilterChange={props.onFilterChange} onMarkAllRead={props.onMarkAllRead} />
      <InboxBody {...props} />
      {props.status === 'success' && props.hasMore ? (
        <Button type="button" variant="outline" className="self-center" disabled={props.isLoadingMore} onClick={props.onLoadMore}>
          {props.isLoadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </section>
  );
}
