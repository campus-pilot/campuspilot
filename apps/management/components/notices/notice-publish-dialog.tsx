'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import type { NoticePublishPreview } from '@campuspilot/api/routers/school/notice/notice-delivery.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { DocumentButton, DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { NOTICE_CADET_CLASS_SCOPE_OPTIONS } from '@campuspilot/components/notices';
import { DeliveryForecastSummary } from '@campuspilot/components/notifications';
import { readSchoolFeatureDisabled } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { QueryRefreshNote } from '@campuspilot/components/query-refresh-note';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import {
  PUBLISH_REVIEW_CHANGE_MESSAGES,
  cadetAudienceUnpublishable,
  editNoticeHref,
  isNoticeConflict,
  noticeErrorMessage,
  noticePrintSizeDescription,
  publishReviewChange,
  publishReviewOf,
  staffRecipientLine,
  whatsappPdfLine,
  type PublishReview,
} from './notice-model';
import { savedNoticePreviewQueryOptions } from './notice-queries';

type ReadyPreview = Extract<NoticePublishPreview, { kind: 'ready' }>;

/** The forecast is read fresh each time the dialog opens and never retried on refusal (as for result sends). */
const FORECAST_QUERY = { staleTime: 0, gcTime: 0, retry: false } as const;

function StaffRecipients({ preview }: { preview: ReadyPreview }) {
  if (!preview.toStaff) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Staff</h3>
      <p className="text-sm">{staffRecipientLine(preview.staffRecipientCount)}</p>
    </section>
  );
}

/**
 * Students addressed, with what each remote channel will send and why the
 * rest is skipped. Selected classes are named (publishing is irreversible,
 * so the dialog restates exactly who it goes to), and the PDF is mentioned
 * only when the forecast says WhatsApp will send something.
 */
function CadetRecipients({ notice, preview }: { notice: NoticeDto; preview: ReadyPreview }) {
  if (preview.cadetScope === 'none' || !preview.cadetForecast) return null;
  const pdfLine = whatsappPdfLine(preview.cadetForecast);
  const classNames = notice.classes.flatMap((entry) => (entry.classId ? [entry.name] : []));
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Students · {NOTICE_CADET_CLASS_SCOPE_OPTIONS[preview.cadetScope].label}</h3>
      {preview.cadetScope === 'selected_classes' ? <p className="text-sm [overflow-wrap:anywhere]">{classNames.join(', ')}</p> : null}
      <DeliveryForecastSummary forecast={preview.cadetForecast} />
      {pdfLine ? <p className="text-xs text-muted-foreground">{pdfLine}</p> : null}
    </section>
  );
}

function PublishForecast({ notice, preview }: { notice: NoticeDto; preview: NoticePublishPreview }) {
  if (preview.kind === 'already_published') {
    return <DocumentNotice>This notice was already published on {preview.publishedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}. Nobody is notified again.</DocumentNotice>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Who receives it</p>
      <StaffRecipients preview={preview} />
      <CadetRecipients notice={notice} preview={preview} />
      <p className="text-xs text-muted-foreground">Print size: {noticePrintSizeDescription(preview.pageSize)}</p>
    </div>
  );
}

/**
 * Why the forecast could not be made. A school that lacks the feature the
 * publication needs is not worth a retry: for a draft addressed to students
 * without the Cadet Portal the dialog repeats what the editor says and
 * links to the audience (when the caller may edit); any other failure is
 * shown with Retry.
 */
function ForecastUnavailable({ notice, error, retry }: { notice: NoticeDto; error: unknown; retry: () => unknown }) {
  const feature = readSchoolFeatureDisabled(error);
  if (feature === 'cadet') {
    return (
      <DocumentNotice error>
        {cadetAudienceUnpublishable({ status: 'draft', cadetScope: notice.cadetScope }, 'disabled') ?? noticeErrorMessage(error, 'The Cadet Portal is not enabled for this school.')}
        {notice.viewer.canEdit ? <DocumentButton asChild variant="outline" className="ml-3"><Link href={editNoticeHref(notice, notice.id)}>Edit audience</Link></DocumentButton> : null}
      </DocumentNotice>
    );
  }
  // Any other feature the school lacks (notices itself): the server's sentence says which; retrying cannot help.
  if (feature) return <DocumentNotice error>{noticeErrorMessage(error, 'This school cannot publish notices.')}</DocumentNotice>;
  return (
    <DocumentNotice error>
      {noticeErrorMessage(error, 'Unable to check who will receive this notice.')}
      <DocumentButton variant="outline" className="ml-3" onClick={() => void retry()}>Retry</DocumentButton>
    </DocumentNotice>
  );
}

/**
 * The forecast, the publication and whether the review is still current.
 *
 * `reviewed` is what the publisher read: the version and the school Notice
 * template revision of the preview that was on the page when Publish was
 * pressed (the cached render of `SavedNoticePreview`), held for the life of
 * the dialog. It does not follow the page, which may refetch underneath.
 * Publishing sends both; the server refuses with CONFLICT when the draft
 * was saved again or would now be printed inside another template. If the
 * forecast was already made for something else, the page's notice and
 * preview are refreshed behind the dialog and publishing stays blocked
 * until the dialog is closed and opened again on what is now stored, so
 * nobody publishes a page they have not read. With no preview on the page
 * (still rendering, or failed) there is nothing to confirm yet: `reviewed`
 * is null, no forecast is asked for and Publish stays disabled.
 */
function usePublishNotice(notice: NoticeDto, onClose: () => void) {
  const cache = useQueryClient();
  const [reviewed] = useState<PublishReview | null>(() => publishReviewOf(cache.getQueryData(savedNoticePreviewQueryOptions(notice).queryKey)));
  const scope = { schoolId: notice.schoolId, noticeId: notice.id };
  const refreshNotice = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: orpc.school.getNotice.queryKey({ input: scope }) }),
      cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
    ]);
  const forecast = useQuery({
    queryKey: orpc.school.previewNoticePublish.queryKey({ input: scope }),
    queryFn: async () => {
      const preview = await client.school.previewNoticePublish(scope);
      // A forecast for something else than was reviewed: bring the page up to date (an event of this request, not an effect).
      if (preview.kind === 'ready' && reviewed && publishReviewChange(reviewed, preview)) void refreshNotice();
      return preview;
    },
    enabled: reviewed !== null,
    ...FORECAST_QUERY,
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!reviewed) throw new Error('Read the notice preview before publishing.');
      return client.school.publishNotice({ ...scope, expectedVersion: reviewed.version, expectedTemplateRevisionId: reviewed.templateRevisionId });
    },
    onSuccess: async (published) => {
      cache.setQueryData(orpc.school.getNotice.queryKey({ input: scope }), published);
      toast.success('Notice published.');
      onClose();
      await Promise.all([
        cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() }),
        cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
      ]);
    },
    // A refusal usually means the notice or its template changed underneath: show the current one.
    onError: () => refreshNotice(),
  });
  const forecastChange = reviewed && forecast.data?.kind === 'ready' ? publishReviewChange(reviewed, forecast.data) : null;
  /** Why the review is no longer current, as the publisher is told it; null while it is. The server's own CONFLICT wording says which of the two changed. */
  const changed = forecastChange ? PUBLISH_REVIEW_CHANGE_MESSAGES[forecastChange] : isNoticeConflict(publish.error) ? `${noticeErrorMessage(publish.error, PUBLISH_REVIEW_CHANGE_MESSAGES.notice)} Close this dialog first.` : null;
  return { reviewed, forecast, publish, changed };
}

/** What the dialog shows under its description: one state at a time, the most decisive first. */
function PublishDialogBody({ notice, state }: { notice: NoticeDto; state: ReturnType<typeof usePublishNotice> }) {
  const { reviewed, forecast, publish, changed } = state;
  if (!reviewed) {
    return <DocumentNotice>The preview of this notice has not loaded yet, so there is nothing to confirm. Close this dialog and read the notice as it will be published first.</DocumentNotice>;
  }
  if (changed) return <DocumentNotice error>{changed}</DocumentNotice>;
  // A forecast already shown stays when a refetch fails; the failure replaces it only when it means the publication cannot happen.
  const resolved = resolveQueryBoundary(forecast, { replaces: (error) => readSchoolFeatureDisabled(error) !== null });
  if (resolved.kind === 'pending') return <p className="text-sm text-muted-foreground" role="status">Checking who will receive it…</p>;
  if (resolved.kind === 'failed') return <ForecastUnavailable notice={notice} error={resolved.error} retry={forecast.refetch} />;
  return (
    <>
      <QueryRefreshNote error={resolved.refetchError} onRetry={() => void forecast.refetch()} />
      <PublishForecast notice={notice} preview={resolved.data} />
      {publish.isError ? <p className="text-sm text-destructive" role="alert">{noticeErrorMessage(publish.error, 'Unable to publish this notice.')}</p> : null}
    </>
  );
}

/**
 * The publish confirmation. It names who will receive the notice and
 * through which channels (the server's forecast, read when the dialog
 * opens), and that publishing is final. Publish stays disabled until the
 * forecast has loaded, so nobody confirms without seeing the recipients,
 * while there is no reviewed preview, and once the notice or the school's
 * Notice template is found to have changed since the preview was read; the
 * server decides again when the button is pressed.
 */
export function NoticePublishDialog({ notice, onClose }: { notice: NoticeDto; onClose: () => void }) {
  const state = usePublishNotice(notice, onClose);
  const { forecast, publish, changed } = state;
  return (
    <ConfirmationDialog
      open
      title="Publish this notice?"
      description={`"${notice.title}" becomes visible to its audience and they are notified now. Publishing cannot be undone: a published notice cannot be edited, withdrawn or deleted.`}
      confirmLabel={publish.isPending ? 'Publishing…' : 'Publish notice'}
      confirmVariant="default"
      confirmDisabled={forecast.data?.kind !== 'ready' || changed !== null || readSchoolFeatureDisabled(forecast.error) !== null}
      pending={publish.isPending}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onConfirm={() => publish.mutate()}
    >
      <PublishDialogBody notice={notice} state={state} />
    </ConfirmationDialog>
  );
}
