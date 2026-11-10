'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CalendarDaysIcon, ChevronRightIcon } from 'lucide-react';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { QueryRefreshNote } from '@campuspilot/components/query-refresh-note';
import { Button } from '@campuspilot/ui/components/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@campuspilot/ui/components/item';

import { formatDate } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { timetableHref } from '@/lib/route-param';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading } from '../screen';

/** Every published examination timetable the student can open, newest first, 20 at a time. */
function TimetableList() {
  const timetables = useInfiniteQuery(
    orpc.listTimetables.infiniteOptions({
      input: (cursor: string | undefined) => (cursor ? { cursor } : {}),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.pagination.nextCursor ?? undefined,
    }),
  );
  const state = resolveQueryBoundary(timetables, { replaces: () => false });
  if (state.kind === 'pending') return <ScreenLoading blocks={1} />;
  if (state.kind === 'failed') return <ScreenError title="Could not load timetables" error={state.error} onRetry={() => void timetables.refetch()} />;
  const items = state.data.pages.flatMap((page) => page.items);
  if (items.length === 0)
    return <EmptyState icon={CalendarDaysIcon} title="No timetables yet" description="Examination timetables your school publishes appear here." />;
  return (
    <>
      <QueryRefreshNote error={state.refetchError} onRetry={() => void timetables.refetch()} />
      <ItemGroup className="gap-0 rounded-lg border">
        {items.map((item) => (
          <Item key={`${item.sessionId}:${item.examSlug}`} asChild>
            <Link href={timetableHref(item)}>
              <ItemContent>
                <ItemTitle>{item.examName}</ItemTitle>
                <ItemDescription>Published {formatDate(item.publishedAt)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
      {timetables.hasNextPage ? (
        <Button type="button" variant="outline" disabled={timetables.isFetchingNextPage} onClick={() => void timetables.fetchNextPage()}>
          {timetables.isFetchingNextPage ? 'Loading…' : 'Show older timetables'}
        </Button>
      ) : null}
    </>
  );
}

/** The examination timetables the school published, reached from More and from a timetable notification. */
export function TimetablesScreen() {
  return (
    <>
      <ScreenHeader title="Timetables" description="Examination schedules from your school" />
      <TimetableList />
    </>
  );
}
