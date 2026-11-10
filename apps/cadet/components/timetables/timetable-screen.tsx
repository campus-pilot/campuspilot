'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { DownloadIcon, FileQuestionIcon } from 'lucide-react';
import type { CadetTimetableDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { PublishedTimetable } from '@campuspilot/components/exam/published-timetable';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { QueryRefreshNote } from '@campuspilot/components/query-refresh-note';
import { Button } from '@campuspilot/ui/components/button';

import { formatCalendarDate, formatDate } from '@/lib/format';
import { client, orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenLoading } from '../screen';

type TimetableKey = { sessionId: string; examSlug: string };

/** A NOT_FOUND answer: no such timetable, or it is a draft again (withdrawn). */
const timetableMissing = (error: unknown) => (error as { code?: unknown } | null)?.code === 'NOT_FOUND';

export const TimetableNotFound = () => (
  <EmptyState icon={FileQuestionIcon} title="Timetable not available" description="This timetable does not exist or is not published at the moment." />
);

/**
 * Opens the timetable's PDF (all classes, as the school's Timetable template
 * lays it out) through a five-minute URL issued on the tap.
 */
function DownloadTimetableButton({ timetable }: { timetable: TimetableKey }) {
  const download = useMutation({
    mutationFn: () => client.getTimetableDownload(timetable),
    onSuccess: ({ url }) => {
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener noreferrer';
      link.click();
    },
  });
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" size="sm" disabled={download.isPending} onClick={() => download.mutate()}>
        <DownloadIcon data-icon="inline-start" /> {download.isPending ? 'Preparing the PDF…' : 'Download PDF'}
      </Button>
      {download.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The PDF could not be prepared. Please try again.
        </p>
      ) : null}
    </div>
  );
}

function TimetableHeading({ timetable }: { timetable: CadetTimetableDto }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Examination timetable</p>
      <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{timetable.examName}</h1>
      <p className="text-sm text-muted-foreground">Published {formatDate(timetable.publishedAt)}</p>
      <DownloadTimetableButton timetable={timetable} />
    </div>
  );
}

/**
 * One published timetable with every class's schedule. The server answers
 * NOT_FOUND for a draft or a session the student is not enrolled in, which
 * also replaces a timetable already on screen once it is withdrawn.
 */
export function TimetableScreen({ sessionId, examSlug }: TimetableKey) {
  const timetable = useQuery(orpc.getTimetable.queryOptions({ input: { sessionId, examSlug } }));
  const state = resolveQueryBoundary(timetable, { replaces: timetableMissing });
  if (state.kind === 'pending') return <ScreenLoading blocks={2} />;
  if (state.kind === 'failed') {
    return timetableMissing(state.error) ? (
      <TimetableNotFound />
    ) : (
      <ScreenError title="Could not load this timetable" error={state.error} onRetry={() => void timetable.refetch()} />
    );
  }
  return (
    <>
      <QueryRefreshNote error={state.refetchError} onRetry={() => void timetable.refetch()} />
      <TimetableHeading timetable={state.data} />
      <PublishedTimetable timetable={state.data} formatDate={formatCalendarDate} />
    </>
  );
}
