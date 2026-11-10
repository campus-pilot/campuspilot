'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MegaphoneIcon } from 'lucide-react';
import { CadetNoticeList, type CadetNoticeLinkProps } from '@campuspilot/components/cadet-portal';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { QueryRefreshNote } from '@campuspilot/components/query-refresh-note';
import { Button } from '@campuspilot/ui/components/button';

import { orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading } from '../screen';
import { noticeEntries, noticesSwitchedOff } from './notices-model';
import { NoticesUnavailable } from './notices-unavailable';

/** The portal's link for a notice row (the shared list does not route). */
export const renderNoticeLink = ({ href, className, children }: CadetNoticeLinkProps) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

/** Every notice addressed to the student, newest first, 20 at a time. */
function NoticeList() {
  const notices = useInfiniteQuery(
    orpc.listNotices.infiniteOptions({
      input: (cursor: string | undefined) => (cursor ? { cursor } : {}),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.pagination.nextCursor ?? undefined,
    }),
  );
  // A list already shown stays when a refetch fails; only "notices switched off" replaces it.
  const state = resolveQueryBoundary(notices, { replaces: noticesSwitchedOff });
  if (state.kind === 'pending') return <ScreenLoading blocks={1} />;
  if (state.kind === 'failed') {
    return noticesSwitchedOff(state.error) ? (
      <NoticesUnavailable />
    ) : (
      <ScreenError title="Could not load notices" error={state.error} onRetry={() => void notices.refetch()} />
    );
  }
  const items = state.data.pages.flatMap((page) => page.items);
  if (items.length === 0)
    return <EmptyState icon={MegaphoneIcon} title="No notices yet" description="Notices your school publishes for you or your class appear here." />;
  return (
    <>
      <QueryRefreshNote error={state.refetchError} onRetry={() => void notices.refetch()} />
      <CadetNoticeList entries={noticeEntries(items)} renderLink={renderNoticeLink} />
      {notices.hasNextPage ? (
        <Button type="button" variant="outline" disabled={notices.isFetchingNextPage} onClick={() => void notices.fetchNextPage()}>
          {notices.isFetchingNextPage ? 'Loading…' : 'Show older notices'}
        </Button>
      ) : null}
    </>
  );
}

/**
 * The student's notices: what the school published for everyone or for
 * their class. Reached from Home and More (the tab bar keeps its five
 * tabs), and from a notice notification through `/notices/{noticeId}`.
 */
export function NoticesScreen() {
  return (
    <>
      <ScreenHeader title="Notices" description="From your school" />
      <NoticeList />
    </>
  );
}
