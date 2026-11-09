'use client';

import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRightIcon, GraduationCapIcon } from 'lucide-react';
import type { CadetExamListItemDto, CadetExamState } from '@campuspilot/api/routers/cadet/cadet.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@campuspilot/ui/components/item';
import { Badge } from '@campuspilot/ui/components/reui/badge';

import { formatDate, formatPercent } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenHeader, ScreenLoading } from '../screen';

export const EXAM_STATE_COPY: Record<CadetExamState, { label: string; variant: 'success-light' | 'warning-light' | 'info-light' | 'outline' }> = {
  released: { label: 'Released', variant: 'success-light' },
  awaiting_release: { label: 'Awaiting release', variant: 'warning-light' },
  in_progress: { label: 'In progress', variant: 'info-light' },
  upcoming: { label: 'Upcoming', variant: 'outline' },
};

/** Released and awaiting exams open (the latter to say results are not out yet); others only show their state. */
export function ExamRow({ exam }: { exam: CadetExamListItemDto }) {
  const { label, variant } = EXAM_STATE_COPY[exam.state];
  const opens = exam.state === 'released' || exam.state === 'awaiting_release';
  const body = (
    <>
      <ItemContent>
        <ItemTitle>{exam.name}</ItemTitle>
        {exam.releasedAt ? <ItemDescription>Released {formatDate(exam.releasedAt)}</ItemDescription> : null}
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1">
        {exam.percentage !== null ? (
          <span className="text-sm font-semibold tabular-nums">
            {formatPercent(exam.percentage)}
            {exam.grade ? ` · ${exam.grade}` : ''}
          </span>
        ) : null}
        <Badge variant={variant} radius="full">
          {label}
        </Badge>
      </ItemActions>
      {opens ? <ChevronRightIcon className="size-4 text-muted-foreground" /> : null}
    </>
  );
  return opens ? (
    <Item asChild className="rounded-none border-b border-b-border last:border-b-0">
      <Link href={`/results/${encodeURIComponent(exam.examId)}`}>{body}</Link>
    </Item>
  ) : (
    <Item className="rounded-none border-b border-b-border opacity-70 last:border-b-0">{body}</Item>
  );
}

function BackToCurrent() {
  return (
    <Button asChild variant="outline" className="self-start">
      <Link href="/results">Back to current class</Link>
    </Button>
  );
}

/** A class id in the URL that is not one of the student's (or cannot be decoded). */
export function ResultsClassNotFound() {
  return (
    <>
      <EmptyState icon={GraduationCapIcon} title="Class not found" description="This class is not one of yours." />
      <BackToCurrent />
    </>
  );
}

/**
 * Exams of one class, 20 at a time, with "Show more" when the class has more.
 * `recordId` (from `/results/class/{recordId}`, e.g. linked from Growth) shows
 * that class; without it the server's current class.
 */
export function ResultsScreen({ recordId }: { recordId?: string }) {
  const exams = useInfiniteQuery(
    orpc.listExams.infiniteOptions({
      input: (cursor: string | undefined) => ({
        ...(cursor ? { cursor } : {}),
        ...(recordId ? { filters: { recordId } } : {}),
      }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.pagination.nextCursor ?? undefined,
    }),
  );
  if (exams.isPending) return <ScreenLoading blocks={2} />;
  if (exams.isError) {
    if ((exams.error as { code?: string }).code === 'NOT_FOUND') return <ResultsClassNotFound />;
    return <ScreenError error={exams.error} onRetry={() => void exams.refetch()} />;
  }
  const record = exams.data.pages[0]!.record;
  const items = exams.data.pages.flatMap((page) => page.items);
  return (
    <>
      <ScreenHeader
        title={recordId && record ? `Results for ${record.classLabel}` : 'Results'}
        description={record ? `${[record.classLabel, record.sectionLabel].filter(Boolean).join(' ')} · ${record.sessionLabel}` : null}
      />
      {recordId ? <BackToCurrent /> : null}
      {items.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title="No examinations yet"
          description="Your examinations appear here once the school schedules them."
        />
      ) : (
        <ItemGroup className="gap-0 rounded-lg border">
          {items.map((exam) => (
            <ExamRow key={exam.examId} exam={exam} />
          ))}
        </ItemGroup>
      )}
      {exams.hasNextPage ? (
        <Button type="button" variant="outline" disabled={exams.isFetchingNextPage} onClick={() => void exams.fetchNextPage()}>
          {exams.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Results appear here only after your school releases them to the Cadet Portal. For an earlier class, choose it in
        Growth and open its results.
      </p>
    </>
  );
}
