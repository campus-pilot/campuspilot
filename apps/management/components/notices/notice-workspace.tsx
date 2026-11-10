'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import { DocumentButton, DocumentNotice, DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { NoticeStatusBadge, noticeAudienceLabel } from '@campuspilot/components/notices';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';

import { orpc } from '@/lib/orpc';
import { NotificationDeliveryLogSection } from '../notifications/notification-delivery-log';
import { FeatureUnavailable } from '../feature-unavailable';
import { useSchoolFeature } from '../require-feature';
import { NoticeActions } from './notice-actions';
import { NoticeEditor } from './notice-editor';
import {
  NOTICE_BODY_MODE_LABELS,
  cadetAudienceAvailability,
  cadetAudienceUnpublishable,
  draftNotice,
  noticeBoundaryState,
  noticeErrorMessage,
  noticeLoadFailure,
  noticesHref,
  publishedRecipientSummary,
  savedNoticePreviewInput,
  type NoticeSessionScope,
} from './notice-model';

type NoticeScope = NoticeSessionScope & { noticeId: string };

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** One notice. A draft of another author reads as not found, exactly like a deleted notice. */
function useNotice({ schoolId, noticeId }: NoticeScope) {
  return useQuery(orpc.school.getNotice.queryOptions({ input: { schoolId, noticeId }, retry: false }));
}

/**
 * The breadcrumb label of a notice route: its title while the notice is
 * shown by the page (the same resolution, `noticeBoundaryState`). A notice
 * that is gone or not visible, or that belongs to another session than the
 * route's, reads "Notice", also when an older title is still cached; a
 * refetch that merely failed keeps the title.
 */
export function NoticeBreadcrumbValue({ schoolId, sessionId, noticeId }: NoticeScope) {
  const notice = useQuery(orpc.school.getNotice.queryOptions({ input: { schoolId, noticeId }, retry: false }));
  const state = noticeBoundaryState(notice, { schoolId, sessionId });
  return <span className="inline-block max-w-[12rem] truncate align-bottom">{state.kind === 'ready' ? state.notice.title : 'Notice'}</span>;
}

function AllNoticesLink({ scope }: { scope: NoticeSessionScope }) {
  return <DocumentButton asChild variant="ghost" className="ml-1"><Link href={noticesHref(scope)}>All notices</Link></DocumentButton>;
}

/** A notice that does not exist here: deleted, another author's draft, or a notice of another session. Retrying cannot help. */
function NoticeNotFound({ scope }: { scope: NoticeSessionScope }) {
  return (
    <DocumentNotice>
      This notice was not found. It may have been deleted, or it is a draft that only its author, the principal and managers can open.
      <AllNoticesLink scope={scope} />
    </DocumentNotice>
  );
}

/**
 * Why the notice is not shown, said as what happened (`noticeLoadFailure`):
 * not found (no retry), the feature switched off (the same state as the
 * page gate), or a failure worth retrying.
 */
function NoticeUnavailable({ scope, error, retry }: { scope: NoticeSessionScope; error: unknown; retry: () => unknown }) {
  const failure = noticeLoadFailure(error);
  if (failure.kind === 'feature_disabled') return <FeatureUnavailable feature={failure.feature} />;
  if (failure.kind === 'not_found') return <NoticeNotFound scope={scope} />;
  return (
    <DocumentNotice error>
      {failure.message}
      <DocumentButton variant="outline" className="ml-3" onClick={() => void retry()}>Retry</DocumentButton>
      <AllNoticesLink scope={scope} />
    </DocumentNotice>
  );
}

/**
 * Loading, unavailable, or the loaded notice handed to `children`, as
 * `noticeBoundaryState` resolves the read: a notice already on screen (and
 * an editor with typed text under it) stays when a background refetch
 * fails; only "not found" or "feature switched off" replaces it. A notice
 * of another session than the route's is not found here.
 */
function NoticeBoundary({ scope, notice, children }: { scope: NoticeSessionScope; notice: UseQueryResult<NoticeDto>; children: (notice: NoticeDto) => ReactNode }) {
  const state = noticeBoundaryState(notice, scope);
  if (state.kind === 'pending') return <div role="status" aria-label="Loading notice" className="mx-auto h-60 w-full max-w-7xl animate-pulse rounded-xl bg-muted" />;
  if (state.kind === 'unavailable') return <section className="mx-auto w-full max-w-7xl"><NoticeUnavailable scope={scope} error={state.error} retry={notice.refetch} /></section>;
  if (state.kind === 'elsewhere') return <section className="mx-auto w-full max-w-7xl"><NoticeNotFound scope={scope} /></section>;
  return children(state.notice);
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

/**
 * Audience, author and publication as separate facts; nothing is inferred
 * from the status. The classes are the notice's own record (`classes`): a
 * published notice names the classes it was published to, also after one
 * was renamed or deleted.
 */
function NoticeFacts({ notice }: { notice: NoticeDto }) {
  const notified = publishedRecipientSummary(notice);
  return (
    <dl className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="For">{noticeAudienceLabel(notice, notice.classes.map((entry) => entry.name))}</Fact>
      <Fact label="Written by">{notice.createdByName ?? 'Former staff member'} · {dateTimeFormat.format(notice.createdAt)}</Fact>
      <Fact label="Published">{notice.publishedAt ? `${notice.publishedByName ?? 'Former staff member'} · ${dateTimeFormat.format(notice.publishedAt)}` : 'Not published'}</Fact>
      <Fact label={notified ? 'Delivery' : 'Format'}>{notified ?? NOTICE_BODY_MODE_LABELS[notice.bodyMode]}</Fact>
    </dl>
  );
}

/**
 * The saved notice exactly as the server renders it: a draft with today's
 * date and the school's current Notice template, a published notice as
 * published. This render is what a publisher reviews: the publish dialog
 * reads the version and template revision of the same cached result
 * (`savedNoticePreviewInput`). A render already shown stays when a refetch
 * fails; the error replaces it only when there is nothing to show.
 */
function SavedNoticePreview({ notice }: { notice: NoticeDto }) {
  const preview = useQuery(orpc.school.previewNotice.queryOptions({ input: savedNoticePreviewInput(notice), retry: false }));
  const state = resolveQueryBoundary(preview);
  if (state.kind === 'failed') {
    return <DocumentNotice error>{noticeErrorMessage(state.error, 'Unable to render this notice.')}<DocumentButton variant="outline" className="ml-3" onClick={() => void preview.refetch()}>Retry</DocumentButton></DocumentNotice>;
  }
  return <DocumentPreview fitPageWidth html={state.kind === 'ready' ? state.data.html : undefined} label={notice.status === 'published' ? 'Published notice' : 'Draft preview'} placeholder="Rendering the notice…" />;
}

/** Said on a draft that cannot be published as addressed (students, in a school known not to have the Cadet Portal). */
function UnpublishableAudienceNotice({ scope, notice }: { scope: NoticeSessionScope; notice: NoticeDto }) {
  const cadet = useSchoolFeature(scope.schoolId, 'cadet');
  const reason = cadetAudienceUnpublishable(notice, cadet.status === 'pending' ? 'pending' : cadetAudienceAvailability(cadet));
  return reason ? <DocumentNotice>{reason}</DocumentNotice> : null;
}

function NoticeDetail({ scope, notice }: { scope: NoticeSessionScope; notice: NoticeDto }) {
  const draft = draftNotice(notice);
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <NoticeHeader notice={notice} />
      {draft ? <DocumentNotice>{draft}</DocumentNotice> : null}
      <UnpublishableAudienceNotice scope={scope} notice={notice} />
      <NoticeFacts notice={notice} />
      <SavedNoticePreview key={`${notice.status}-${notice.version}`} notice={notice} />
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
 * Edits a draft. The editor works from the draft as it was when it opened
 * (see `useNoticeEditor`), so a background refetch never replaces what the
 * author is typing; `reloads` remounts it on the stored notice when the
 * author asks for the latest version after a conflict. It waits for the
 * first read of the school's features, then passes on what is known about
 * addressing students: available, off, or unknown.
 */
export function EditNotice({ scope }: { scope: NoticeScope }) {
  const notice = useNotice(scope);
  const cadet = useSchoolFeature(scope.schoolId, 'cadet');
  const [reloads, setReloads] = useState(0);
  return (
    <NoticeBoundary scope={scope} notice={notice}>
      {(data) => {
        if (data.status !== 'draft' || !data.viewer.canEdit) return <NotEditable scope={scope} notice={data} />;
        if (cadet.status === 'pending') return null;
        return (
          <NoticeEditor
            key={`${data.id}:${reloads}`}
            scope={scope}
            baseline={data}
            cadetAudience={cadetAudienceAvailability(cadet)}
            onRetryFeatures={cadet.retry}
            onReload={() => void notice.refetch().then(() => setReloads((count) => count + 1))}
          />
        );
      }}
    </NoticeBoundary>
  );
}

/** Writes a new notice; waits for the school's features like {@link EditNotice}. */
export function NewNotice({ scope }: { scope: NoticeSessionScope }) {
  const cadet = useSchoolFeature(scope.schoolId, 'cadet');
  if (cadet.status === 'pending') return null;
  return <NoticeEditor scope={scope} baseline={null} cadetAudience={cadetAudienceAvailability(cadet)} onRetryFeatures={cadet.retry} />;
}
