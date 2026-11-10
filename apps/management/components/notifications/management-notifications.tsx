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
import { notificationsHref, staffNotificationRoute } from './notification-routes';

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

function unreadCountOptions(schoolId: string) {
  return orpc.school.getUnreadNotificationCount.queryOptions({
    input: { schoolId },
    refetchInterval: UNREAD_NOTIFICATION_POLL_MS,
  });
}

/** The app-shell bell: polls the staff member's unread count in this school. */
export function ManagementNotificationBell({ schoolId }: { schoolId: string }) {
  const unread = useQuery(unreadCountOptions(schoolId));
  return (
    <NotificationBell
      unreadCount={unread.data?.count ?? 0}
      href={notificationsHref(schoolId)}
      renderLink={NotificationLink}
    />
  );
}

type Change = { kind: 'read'; ids: string[] } | { kind: 'all' } | { kind: 'dismiss'; ids: string[] };

/**
 * Inbox data and optimistic mutations for one school. Mark read lowers the
 * badge and patches every cached page at once; a failure restores both, and
 * every change ends with a refetch of the list and the count.
 */
function useManagementInbox(schoolId: string, filter: NotificationInboxFilter) {
  const queryClient = useQueryClient();
  const listKey = orpc.school.listNotifications.key();
  const countKey = unreadCountOptions(schoolId).queryKey;
  const list = useInfiniteQuery(
    orpc.school.listNotifications.infiniteOptions({
      input: (cursor: string | undefined) => ({ schoolId, filter, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const change = useMutation({
    mutationFn: (request: Change) => {
      if (request.kind === 'read') return client.school.markNotificationsRead({ schoolId, ids: request.ids });
      if (request.kind === 'dismiss') return client.school.dismissNotifications({ schoolId, ids: request.ids });
      return client.school.markAllNotificationsRead({ schoolId });
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

/** The staff inbox page body. */
export function ManagementNotificationInbox({ schoolId }: { schoolId: string }) {
  const [filter, setFilter] = useState<NotificationInboxFilter>('all');
  const { list, change } = useManagementInbox(schoolId, filter);
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
      routeFor={(item) => staffNotificationRoute(schoolId, item)}
      renderLink={NotificationLink}
    />
  );
}
