'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import { DocumentButton, DocumentNotice, DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { NoticeStatusBadge, noticeAudienceLabel } from '@campuspilot/components/notices';

import { orpc } from '@/lib/orpc';
import { NotificationDeliveryLogSection } from '../notifications/notification-delivery-log';
import { useSchoolFeature } from '../require-feature';
import { NoticeActions } from './notice-actions';
import { NoticeEditor } from './notice-editor';
import { NOTICE_BODY_MODE_LABELS, draftNotice, noticeErrorMessage, noticesHref, publishedRecipientSummary, type NoticeSessionScope } from './notice-model';

type NoticeScope = NoticeSessionScope & { noticeId: string };

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** One notice. A draft of another author reads as not found, exactly like a deleted notice. */
function useNotice({ schoolId, noticeId }: NoticeScope) {
  return useQuery(orpc.school.getNotice.queryOptions({ input: { schoolId, noticeId }, retry: false }));
}

/** The breadcrumb label of a notice route: its title once known. */
export function NoticeBreadcrumbValue({ schoolId, noticeId }: { schoolId: string; noticeId: string }) {
  const notice = useQuery(orpc.school.getNotice.queryOptions({ input: { schoolId, noticeId }, retry: false }));
  return <span className="inline-block max-w-[12rem] truncate align-bottom">{notice.data?.title ?? 'Notice'}</span>;
}

function NoticeUnavailable({ scope, error, retry }: { scope: NoticeSessionScope; error: unknown; retry: () => unknown }) {
  return (
    <DocumentNotice error>
      {noticeErrorMessage(error, 'Unable to load this notice.')} A draft can be opened only by its author, the principal and managers.
      <DocumentButton variant="outline" className="ml-3" onClick={() => void retry()}>Retry</DocumentButton>
      <DocumentButton asChild variant="ghost" className="ml-1"><Link href={noticesHref(scope)}>All notices</Link></DocumentButton>
    </DocumentNotice>
  );
}

/** Loading, unavailable, or the loaded notice handed to `children`. */
function NoticeBoundary({ scope, notice, children }: { scope: NoticeSessionScope; notice: UseQueryResult<NoticeDto>; children: (notice: NoticeDto) => ReactNode }) {
  if (notice.isPending) return <div role="status" aria-label="Loading notice" className="mx-auto h-60 w-full max-w-7xl animate-pulse rounded-xl bg-muted" />;
  if (notice.isError) return <section className="mx-auto w-full max-w-7xl"><NoticeUnavailable scope={scope} error={notice.error} retry={notice.refetch} /></section>;
  return children(notice.data);
}

function NoticeHeader({ notice }: { notice: NoticeDto }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Megaphone className="size-5" aria-hidden /></span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notice</p>
          <h1 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{notice.title}</h1>
          <NoticeStatusBadge status={notice.status} />
        </div>
      </div>
      <NoticeActions notice={notice} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Class names for the audience line; without permission to list classes it shows the count. */
function useClassLabels(scope: NoticeSessionScope, enabled: boolean): ReadonlyMap<string, string> {
  const classes = useQuery(orpc.school.listClasses.queryOptions({ input: scope, enabled, retry: false }));
  return new Map((classes.data ?? []).map(({ id, label }) => [id, label]));
}

/** Audience, author and publication as separate facts; nothing is inferred from the status. */
function NoticeFacts({ scope, notice }: { scope: NoticeSessionScope; notice: NoticeDto }) {
  const classLabels = useClassLabels(scope, notice.cadetScope === 'selected_classes');
  const notified = publishedRecipientSummary(notice);
  return (
    <dl className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="For">{noticeAudienceLabel(notice, classLabels)}</Fact>
      <Fact label="Written by">{notice.createdByName ?? 'Former staff member'} · {dateTimeFormat.format(notice.createdAt)}</Fact>
      <Fact label="Published">{notice.publishedAt ? `${notice.publishedByName ?? 'Former staff member'} · ${dateTimeFormat.format(notice.publishedAt)}` : 'Not published'}</Fact>
      <Fact label={notified ? 'Delivery' : 'Format'}>{notified ?? NOTICE_BODY_MODE_LABELS[notice.bodyMode]}</Fact>
    </dl>
  );
}

/** The saved notice exactly as the server renders it: a draft with today's date, a published notice as published. */
function SavedNoticePreview({ notice }: { notice: NoticeDto }) {
  const preview = useQuery(orpc.school.previewNotice.queryOptions({ input: { schoolId: notice.schoolId, source: { kind: 'saved', noticeId: notice.id } }, retry: false }));
  if (preview.isError) {
    return <DocumentNotice error>{noticeErrorMessage(preview.error, 'Unable to render this notice.')}<DocumentButton variant="outline" className="ml-3" onClick={() => void preview.refetch()}>Retry</DocumentButton></DocumentNotice>;
  }
  return <DocumentPreview fitPageWidth html={preview.data?.html} label={notice.status === 'published' ? 'Published notice' : 'Draft preview'} placeholder="Rendering the notice…" />;
}

function NoticeDetail({ scope, notice }: { scope: NoticeSessionScope; notice: NoticeDto }) {
  const draft = draftNotice(notice);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <NoticeHeader notice={notice} />
      {draft ? <DocumentNotice>{draft}</DocumentNotice> : null}
      <NoticeFacts scope={scope} notice={notice} />
      <SavedNoticePreview key={`${notice.status}-${notice.updatedAt.getTime()}`} notice={notice} />
      {notice.status === 'published' ? <NotificationDeliveryLogSection schoolId={scope.schoolId} scope={{ kind: 'notice', noticeId: notice.id }} /> : null}
    </section>
  );
}

/**
 * The notice page: header with lifecycle actions, the audience and
 * publication facts, the rendered notice and, once published, its delivery
 * log (for staff who may read the notification log).
 */
export function NoticeWorkspace({ scope }: { scope: NoticeScope }) {
  const notice = useNotice(scope);
  return <NoticeBoundary scope={scope} notice={notice}>{(data) => <NoticeDetail scope={scope} notice={data} />}</NoticeBoundary>;
}

function NotEditable({ scope, notice }: { scope: NoticeSessionScope; notice: NoticeDto }) {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <NoticeHeader notice={notice} />
      <DocumentNotice>
        {notice.status === 'published' ? 'A published notice can no longer be edited.' : 'Only the author of this draft, the principal and managers can edit it.'}
        <DocumentButton asChild variant="ghost" className="ml-1"><Link href={noticesHref(scope)}>All notices</Link></DocumentButton>
      </DocumentNotice>
    </section>
  );
}

/**
 * Edits a draft. The editor is keyed by the notice only and takes the draft
 * as first loaded, so a background refetch never replaces what the author
 * is typing. It waits for the school's features, because the audience
 * choices depend on the Cadet Portal.
 */
export function EditNotice({ scope }: { scope: NoticeScope }) {
  const notice = useNotice(scope);
  const cadet = useSchoolFeature(scope.schoolId, 'cadet');
  return (
    <NoticeBoundary scope={scope} notice={notice}>
      {(data) => {
        if (data.status !== 'draft' || !data.viewer.canEdit) return <NotEditable scope={scope} notice={data} />;
        if (cadet.status === 'pending') return null;
        return <NoticeEditor key={data.id} scope={scope} baseline={data} cadetsAvailable={cadet.enabled} />;
      }}
    </NoticeBoundary>
  );
}

/** Writes a new notice; waits for the school's features like {@link EditNotice}. */
export function NewNotice({ scope }: { scope: NoticeSessionScope }) {
  const cadet = useSchoolFeature(scope.schoolId, 'cadet');
  if (cadet.status === 'pending') return null;
  return <NoticeEditor scope={scope} baseline={null} cadetsAvailable={cadet.enabled} />;
}
