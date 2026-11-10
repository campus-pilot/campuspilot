'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import type { NoticePublishPreview } from '@campuspilot/api/routers/school/notice/notice-delivery.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { DocumentButton, DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { NOTICE_CADET_CLASS_SCOPE_OPTIONS } from '@campuspilot/components/notices';
import { DeliveryForecastSummary } from '@campuspilot/components/notifications';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import { noticeErrorMessage, staffRecipientLine } from './notice-model';

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

/** Students addressed, with what each remote channel will send and why the rest is skipped. */
function CadetRecipients({ preview }: { preview: ReadyPreview }) {
  if (preview.cadetScope === 'none' || !preview.cadetForecast) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Cadets · {NOTICE_CADET_CLASS_SCOPE_OPTIONS[preview.cadetScope].label}</h3>
      <DeliveryForecastSummary forecast={preview.cadetForecast} />
      <p className="text-xs text-muted-foreground">WhatsApp messages carry the notice as a PDF.</p>
    </section>
  );
}

function PublishForecast({ preview }: { preview: NoticePublishPreview }) {
  if (preview.kind === 'already_published') {
    return <DocumentNotice>This notice was already published on {preview.publishedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}. Nobody is notified again.</DocumentNotice>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Who receives it</p>
      <StaffRecipients preview={preview} />
      <CadetRecipients preview={preview} />
    </div>
  );
}

function usePublishNotice(notice: NoticeDto, onClose: () => void) {
  const cache = useQueryClient();
  const scope = { schoolId: notice.schoolId, noticeId: notice.id };
  const forecast = useQuery(orpc.school.previewNoticePublish.queryOptions({ input: scope, ...FORECAST_QUERY }));
  const publish = useMutation({
    mutationFn: () => client.school.publishNotice(scope),
    onSuccess: async (published) => {
      cache.setQueryData(orpc.school.getNotice.queryKey({ input: scope }), published);
      toast.success('Notice published.');
      onClose();
      await Promise.all([
        cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() }),
        cache.invalidateQueries({ queryKey: orpc.school.previewNotice.key() }),
      ]);
    },
    // A refusal usually means the notice changed underneath (published or deleted by someone else): show the current one.
    onError: () => cache.invalidateQueries({ queryKey: orpc.school.getNotice.queryKey({ input: scope }) }),
  });
  return { forecast, publish };
}

/**
 * The publish confirmation. It names who will receive the notice and
 * through which channels (the server's forecast, read when the dialog
 * opens), and that publishing is final. Publish stays disabled until the
 * forecast has loaded, so nobody confirms without seeing the recipients;
 * the server decides again when the button is pressed.
 */
export function NoticePublishDialog({ notice, onClose }: { notice: NoticeDto; onClose: () => void }) {
  const { forecast, publish } = usePublishNotice(notice, onClose);
  return (
    <ConfirmationDialog
      open
      title="Publish this notice?"
      description={`"${notice.title}" becomes visible to its audience and they are notified now. Publishing cannot be undone: a published notice cannot be edited, withdrawn or deleted.`}
      confirmLabel={publish.isPending ? 'Publishing…' : 'Publish notice'}
      confirmVariant="default"
      confirmDisabled={forecast.data?.kind !== 'ready'}
      pending={publish.isPending}
      onOpenChange={(open) => { if (!open) onClose(); }}
      onConfirm={() => publish.mutate()}
    >
      {forecast.isPending ? <p className="text-sm text-muted-foreground" role="status">Checking who will receive it…</p> : null}
      {forecast.isError ? <DocumentNotice error>{noticeErrorMessage(forecast.error, 'Unable to check who will receive this notice.')}<DocumentButton variant="outline" className="ml-3" onClick={() => void forecast.refetch()}>Retry</DocumentButton></DocumentNotice> : null}
      {forecast.data ? <PublishForecast preview={forecast.data} /> : null}
      {publish.isError ? <p className="text-sm text-destructive" role="alert">{noticeErrorMessage(publish.error, 'Unable to publish this notice.')}</p> : null}
    </ConfirmationDialog>
  );
}
