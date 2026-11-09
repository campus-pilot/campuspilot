'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { DeliveryForecastSummary, type DeliveryForecast } from '@campuspilot/components/notifications';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { client, orpc } from '@/lib/orpc';
import { ExamButton, Issues, LoadingExam, ReadError } from './exam-common';
import { errorMessage, type ExamScope } from './exam-model';

/** One student of an examination, as the exam routes address them. */
export type ExamStudentScope = ExamScope & { classId: string; studentId: string };

type ConfirmProps = {
  title: string;
  description: string;
  confirmLabel: string;
  preview: UseQueryResult<DeliveryForecast>;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

/**
 * Confirmation with the forecast of what the send will do (D-26). The
 * forecast is read when the dialog opens; the server takes its own snapshot
 * when the button is pressed and returns it.
 */
function ConfirmSendDialog({ title, description, confirmLabel, preview, onConfirm, onClose }: ConfirmProps) {
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      try {
        await onConfirm();
        onClose();
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
      }
    },
  });
  return (
    <form.Subscribe selector={(state) => ({ pending: state.isSubmitting, errors: state.errors })}>
      {({ pending, errors }) => (
        <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(); }}>
              {preview.isPending ? <LoadingExam /> : preview.isError ? <ReadError error={preview.error} retry={preview.refetch} /> : <DeliveryForecastSummary forecast={preview.data} />}
              <Issues errors={errors} />
              <DialogFooter>
                <ExamButton variant="outline" disabled={pending} onClick={onClose}>Cancel</ExamButton>
                <ExamButton type="submit" disabled={pending || !preview.data}>{pending ? 'Sending…' : confirmLabel}</ExamButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  );
}

/** Forecasts are read fresh each time a dialog opens and never retried on refusal. */
const FORECAST_QUERY = { staleTime: 0, gcTime: 0, retry: false } as const;

/**
 * What releasing to the Cadet Portal will notify (D-43), shown in the
 * release confirmation: the forecast on a first release, otherwise that
 * nobody is notified again. Informational only: the release does not wait
 * for it, and the server decides again inside the release.
 */
export function ReleaseNotificationPreview({ scope }: { scope: ExamScope }) {
  const preview = useQuery(orpc.school.previewExamCadetRelease.queryOptions({ input: scope, ...FORECAST_QUERY }));
  if (preview.isPending) return <LoadingExam />;
  if (preview.isError) return <ReadError error={preview.error} retry={preview.refetch} />;
  if (preview.data.kind === 'already_notified')
    return (
      <p className="text-sm text-muted-foreground">
        Students were notified when these results were first released on{' '}
        {preview.data.notifiedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}. Releasing again notifies nobody; use Send result on a student page for a correction.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Every registered student of this examination is notified once, now.</p>
      <DeliveryForecastSummary forecast={preview.data.forecast} />
    </div>
  );
}

/** Sends one student's result, for any started examination (D-10). */
export function SendStudentResultDialog({ scope, onClose }: { scope: ExamStudentScope; onClose: () => void }) {
  const preview = useQuery(orpc.school.previewStudentResultNotification.queryOptions({ input: scope, ...FORECAST_QUERY }));
  // One key per opened dialog: a retried request sends once, a new dialog sends again.
  const keyForm = useForm({ defaultValues: { idempotencyKey: crypto.randomUUID() } });
  return (
    <ConfirmSendDialog
      title="Send result"
      description="The student gets this examination's results now, independently of releasing results to the Cadet Portal."
      confirmLabel="Send result"
      preview={preview}
      onClose={onClose}
      onConfirm={async () => {
        await client.school.sendStudentResultNotification({ ...scope, idempotencyKey: keyForm.state.values.idempotencyKey });
        toast.success('Result sent.');
      }}
    />
  );
}
