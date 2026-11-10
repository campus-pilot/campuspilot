'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import type { NoticePublishPreview } from '@campuspilot/api/routers/school/notice/notice-delivery.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { DocumentButton, DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { NOTICE_CADET_CLASS_SCOPE_OPTIONS } from '@campuspilot/components/notices';
import { DeliveryForecastSummary } from '@campuspilot/components/notifications';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import { isNoticeConflict, noticeErrorMessage, publishReviewIsCurrent, staffRecipientLine, whatsappPdfLine } from './notice-model';

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
      <h3 className="text-sm font-medium">Cadets · {NOTICE_CADET_CLASS_SCOPE_OPTIONS[preview.cadetScope].label}</h3>
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
    </div>
  );
}

/** Said when the notice on the page is no longer the one the confirmation was opened for. */
function ChangedSinceReview() {
  return (
    <DocumentNotice error>
      This notice changed since you opened it. Close this dialog and review it again before publishing.
    </DocumentNotice>
  );
}

/**
 * The forecast, the publication and whether the review is still current.
 *
 * `reviewedVersion` is the version of the notice that was on the page when
 * Publish was pressed, held for the life of the dialog (it does not follow
 * the `notice` prop, which updates when the page refetches). Publishing
 * sends it as `expectedVersion`. If the forecast was made for another
 * version, or the server answers CONFLICT, someone saved in between: the
 * page's notice and preview are refreshed behind the dialog and publishing
 * stays blocked until the dialog is closed and opened again on what is now
 * stored, so nobody publishes text or an audience they have not read.
 */
function usePublishNotice(notice: NoticeDto, onClose: () => void) {
  const cache = useQueryClient();
  const [reviewedVersion] = useState(notice.version);
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
      // A forecast for another version: bring the page up to date (an event of this request, not an effect).
      if (preview.kind === 'ready' && !publishReviewIsCurrent(reviewedVersion, preview.version)) void refreshNotice();
      return preview;
    },
    ...FORECAST_QUERY,
  });
  const publish = useMutation({
    mutationFn: () => client.school.publishNotice({ ...scope, expectedVersion: reviewedVersion }),
    onSuccess: async (published) => {
      cache.setQueryData(orpc.school.getNotice.queryKey({ input: scope }), published);
      toast.success('Notice published.');
      onClose();
      await Promise.all([
        cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() }),
        cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
      ]);
    },
    // A refusal usually means the notice changed underneath (edited, published or deleted by someone else): show the current one.
    onError: () => refreshNotice(),
  });
  const forecastVersion = forecast.data?.kind === 'ready' ? forecast.data.version : null;
  const changed = !publishReviewIsCurrent(reviewedVersion, forecastVersion) || isNoticeConflict(publish.error);
  return { forecast, publish, changed };
}

/**
 * The publish confirmation. It names who will receive the notice and
 * through which channels (the server's forecast, read when the dialog
 * opens), and that publishing is final. Publish stays disabled until the
 * forecast has loaded, so nobody confirms without seeing the recipients,
 * and once the notice is found to have changed since it was opened; the
 * server decides again when the button is pressed.
 */
export function NoticePublishDialog({ notice, onClose }: { notice: NoticeDto; onClose: () => void }) {
  const { forecast, publish, changed } = usePublishNotice(notice, onClose);
  return (
    <ConfirmationDialog
      open
      title="Publish this notice?"
      description={`"${notice.title}" becomes visible to its audience and they are notified now. Publishing cannot be undone: a published notice cannot be edited, withdrawn or deleted.`}
      confirmLabel={publish.isPending ? 'Publishing…' : 'Publish notice'}
      confirmVariant="default"
      confirmDisabled={forecast.data?.kind !== 'ready' || changed}
      pending={publish.isPending}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onConfirm={() => publish.mutate()}
    >
      {forecast.isPending ? <p className="text-sm text-muted-foreground" role="status">Checking who will receive it…</p> : null}
      {forecast.isError ? <DocumentNotice error>{noticeErrorMessage(forecast.error, 'Unable to check who will receive this notice.')}<DocumentButton variant="outline" className="ml-3" onClick={() => void forecast.refetch()}>Retry</DocumentButton></DocumentNotice> : null}
      {changed ? <ChangedSinceReview /> : forecast.data ? <PublishForecast notice={notice} preview={forecast.data} /> : null}
      {publish.isError && !changed ? <p className="text-sm text-destructive" role="alert">{noticeErrorMessage(publish.error, 'Unable to publish this notice.')}</p> : null}
    </ConfirmationDialog>
  );
}
