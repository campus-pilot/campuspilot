'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  countUnreadInPages,
  markPagesRead,
  NotificationBell,
  NotificationInbox,
  removeFromPages,
  type NotificationInboxFilter,
  type NotificationLinkProps,
  type NotificationPages,
} from '@campuspilot/components/notifications';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { client, orpc } from '@/lib/orpc';
import { CADET_NOTIFICATIONS_HREF, cadetNotificationRoute } from './cadet-notification-routes';

/**
 * How often the unread count is polled (D-28: polling, no websocket in v1).
 * TanStack Query does not poll while the tab is hidden.
 */
export const UNREAD_NOTIFICATION_POLL_MS = 30_000;

function NotificationLink({ href, className, ariaLabel, onClick, children }: NotificationLinkProps) {
  return (
    <Link href={href} className={className} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </Link>
  );
}

function unreadCountOptions() {
  return orpc.getUnreadNotificationCount.queryOptions({ refetchInterval: UNREAD_NOTIFICATION_POLL_MS });
}

/** Bell with the student's unread count, linking to the inbox. */
export function CadetNotificationBell() {
  const unread = useQuery(unreadCountOptions());
  return (
    <NotificationBell unreadCount={unread.data?.count ?? 0} href={CADET_NOTIFICATIONS_HREF} renderLink={NotificationLink} />
  );
}

type Change = { kind: 'read'; ids: string[] } | { kind: 'all' } | { kind: 'dismiss'; ids: string[] };

/**
 * Inbox data and optimistic mutations. Mark read lowers the badge and
 * patches every cached page at once; a failure restores both, and every
 * change ends with a refetch of the list and the count.
 */
function useCadetInbox(filter: NotificationInboxFilter) {
  const queryClient = useQueryClient();
  const listKey = orpc.listNotifications.key();
  const countKey = unreadCountOptions().queryKey;
  const list = useInfiniteQuery(
    orpc.listNotifications.infiniteOptions({
      input: (cursor: string | undefined) => ({ filter, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const change = useMutation({
    mutationFn: (request: Change) => {
      if (request.kind === 'read') return client.markNotificationsRead({ ids: request.ids });
      if (request.kind === 'dismiss') return client.dismissNotifications({ ids: request.ids });
      return client.markAllNotificationsRead({});
    },
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      await queryClient.cancelQueries({ queryKey: countKey });
      const lists = queryClient.getQueriesData<NotificationPages>({ queryKey: listKey });
      const count = queryClient.getQueryData(countKey);
      const now = new Date();
      if (request.kind === 'dismiss') {
        queryClient.setQueriesData<NotificationPages>({ queryKey: listKey }, (data) => removeFromPages(data, request.ids));
      } else {
        const lowered = request.kind === 'all' ? (count?.count ?? 0) : countUnreadInPages(list.data, request.ids);
        queryClient.setQueriesData<NotificationPages>({ queryKey: listKey }, (data) =>
          markPagesRead(data, request.kind === 'all' ? 'all' : request.ids, now),
        );
        if (count) queryClient.setQueryData(countKey, { count: Math.max(0, count.count - lowered) });
      }
      return { lists, count };
    },
    onError: (_error, _request, context) => {
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data);
      if (context?.count) queryClient.setQueryData(countKey, context.count);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: countKey }),
      ]);
    },
  });
  return { list, change };
}

/** The student's inbox (who they are comes from the session). */
export function CadetNotificationInbox() {
  const [filter, setFilter] = useState<NotificationInboxFilter>('all');
  const { list, change } = useCadetInbox(filter);
  return (
    <NotificationInbox
      items={list.data?.pages.flatMap((page) => page.items) ?? []}
      status={list.status}
      filter={filter}
      onFilterChange={setFilter}
      hasMore={list.hasNextPage}
      isLoadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      onMarkRead={(id) => change.mutate({ kind: 'read', ids: [id] })}
      onMarkAllRead={() => change.mutate({ kind: 'all' })}
      onDismiss={(id) => change.mutate({ kind: 'dismiss', ids: [id] })}
      onRetry={() => void list.refetch()}
      routeFor={cadetNotificationRoute}
      renderLink={NotificationLink}
    />
  );
}
