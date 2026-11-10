'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { DownloadIcon, FileQuestionIcon } from 'lucide-react';
import type { CadetNoticeDto } from '@campuspilot/api/routers/cadet/cadet.dto';
import { CadetNoticeDocument, CadetNoticeText } from '@campuspilot/components/cadet-portal';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { QueryRefreshNote } from '@campuspilot/components/query-refresh-note';
import { Button } from '@campuspilot/ui/components/button';

import { client, orpc } from '@/lib/orpc';
import { EmptyState, ScreenError, ScreenLoading } from '../screen';
import { noticeGone, noticeMissing, noticesSwitchedOff, publishedLabel } from './notices-model';
import { NoticesUnavailable } from './notices-unavailable';

export const NoticeNotFound = () => (
  <EmptyState icon={FileQuestionIcon} title="Notice not found" description="This notice does not exist or was not sent to you." />
);

/**
 * Opens the notice's PDF (the sheet the school published; the same file
 * staff download and WhatsApp carries) through a five-minute URL issued on
 * the tap, so no long-lived link to the file ever exists in the page.
 */
export function DownloadNoticeButton({ noticeId }: { noticeId: string }) {
  const download = useMutation({
    mutationFn: () => client.getNoticeDownload({ noticeId }),
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

/**
 * Title, publication date and the PDF. The download sits here, above the
 * notice, so it is in reach without scrolling past a long notice or a
 * page-high document frame. Long titles wrap instead of widening the screen.
 */
function NoticeHeading({ notice }: { notice: CadetNoticeDto }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notice</p>
      <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{notice.title}</h1>
      <p className="text-sm text-muted-foreground">{publishedLabel(notice.publishedAt)}</p>
      <DownloadNoticeButton noticeId={notice.noticeId} />
    </div>
  );
}

/**
 * The printed page of a published notice is fixed at publication and can be
 * megabytes (the letterhead logo), so once loaded it is kept for as long as
 * the portal stays open: it is not downloaded again each time the student
 * switches back to the tab or app (the portal's default for other reads).
 */
const PRINTED_PAGE_QUERY = { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/**
 * A designed notice as its printed page. The page (megabytes of markup with
 * the school's letterhead) is a separate read from the notice itself, asked
 * for only here; a plain-text notice never loads it. While it loads, and if
 * it cannot be loaded, the notice's wording is shown as text, so the notice
 * is always readable.
 */
function NoticePrintedPage({ notice }: { notice: CadetNoticeDto }) {
  const page = useQuery({ ...orpc.getNoticeDocument.queryOptions({ input: { noticeId: notice.noticeId } }), ...PRINTED_PAGE_QUERY });
  if (page.data) return <CadetNoticeDocument html={page.data.html} />;
  return (
    <div className="flex flex-col gap-3">
      {page.isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          The printed page could not be loaded, so the notice is shown as text.{' '}
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => void page.refetch()}>
            Try again
          </button>
        </p>
      ) : null}
      <CadetNoticeText text={notice.text} />
    </div>
  );
}

/**
 * The notice in the form that reads best on a phone, decided by how it was
 * written (`bodyMode`): text for a notice written as text, the printed page
 * for a designed one (see the shared components for why).
 */
export function NoticeBody({ notice }: { notice: CadetNoticeDto }) {
  return notice.bodyMode === 'plain' ? <CadetNoticeText text={notice.text} /> : <NoticePrintedPage notice={notice} />;
}

/**
 * One notice. The server resolves the id only among the notices addressed
 * to the signed-in student, so another student's, a staff-only or an
 * unpublished notice reads as not found; a school without notices gets the
 * calm unavailable state rather than an error.
 */
export function NoticeScreen({ noticeId }: { noticeId: string }) {
  const notice = useQuery(orpc.getNotice.queryOptions({ input: { noticeId } }));
  // A notice already on screen stays when a refetch fails; only "not found"
  // or "notices switched off" replaces it (`resolveQueryBoundary`).
  const state = resolveQueryBoundary(notice, { replaces: noticeGone });
  if (state.kind === 'pending') return <ScreenLoading blocks={2} />;
  if (state.kind === 'failed') {
    if (noticesSwitchedOff(state.error)) return <NoticesUnavailable />;
    if (noticeMissing(state.error)) return <NoticeNotFound />;
    return <ScreenError title="Could not load this notice" error={state.error} onRetry={() => void notice.refetch()} />;
  }
  return (
    <>
      <QueryRefreshNote error={state.refetchError} onRetry={() => void notice.refetch()} />
      <NoticeHeading notice={state.data} />
      <NoticeBody notice={state.data} />
    </>
  );
}
