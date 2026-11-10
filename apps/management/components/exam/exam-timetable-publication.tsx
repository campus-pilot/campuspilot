'use client';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { timetableDtoSchema } from '@campuspilot/api/routers/school/exam/exam.dto';
import type { timetablePublishPreviewSchema } from '@campuspilot/api/routers/school/exam/exam-result-notification.dto';
import { client, orpc } from '@/lib/orpc';
import { Issues, Notice, useExamCache } from './exam-common';
import { errorMessage, type ExamScope } from './exam-model';

type Timetable = z.infer<typeof timetableDtoSchema>;

/**
 * Says who can see the timetable now. A draft is visible only to staff; a
 * published timetable is also shown to students in the Cadet Portal (where the
 * school has it). Exam-ended wording lives with the actions, not here.
 */
export function TimetableStatusNote({ timetable }: { timetable: Timetable }) {
  return (
    <Notice>
      {timetable.publishedAt
        ? `Published on ${timetable.publishedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}. It is frozen; withdraw it to a draft to change it.`
        : 'Draft. Only staff can see this timetable until it is published.'}
    </Notice>
  );
}

/** Whom publishing would notify, from the server's preview. */
function publishDescription(preview: z.infer<typeof timetablePublishPreviewSchema> | undefined) {
  if (!preview) return 'Checking whom this will notify…';
  const staff = `${preview.staffRecipientCount} staff ${preview.staffRecipientCount === 1 ? 'member' : 'members'}`;
  if (!preview.cadetForecast) return `Publishing notifies ${staff}. The Cadet Portal is not enabled for this school, so students are not notified.`;
  const students = `${preview.cadetForecast.recipientCount} ${preview.cadetForecast.recipientCount === 1 ? 'student' : 'students'}`;
  return `Publishing notifies ${staff} and ${students} (in the Cadet Portal, and by push or WhatsApp where set up). The timetable is frozen until you withdraw it.`;
}

/** Publishes the draft after the staff member has seen whom it notifies. */
export function PublishTimetableDialog({
  scope,
  examName,
  open,
  onOpenChange,
}: {
  scope: ExamScope;
  examName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queries = useExamCache();
  const preview = useQuery({ ...orpc.school.previewExamTimetablePublish.queryOptions({ input: scope }), enabled: open, gcTime: 0 });
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      try {
        const published = await client.school.publishExamTimetable(scope);
        queries.cache.setQueryData(orpc.school.getExamTimetable.queryKey({ input: scope }), published);
        onOpenChange(false);
        toast.success('Timetable published.');
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
        await queries.cache.invalidateQueries({ queryKey: orpc.school.getExamTimetable.key({ input: scope }) });
      }
    },
  });
  return (
    <form.Subscribe selector={(state) => ({ pending: state.isSubmitting, errors: state.errors })}>
      {({ pending, errors }) => (
        <ConfirmationDialog
          open={open}
          title="Publish timetable"
          description={`Publish the ${examName} timetable? ${publishDescription(preview.data)}`}
          confirmLabel={pending ? 'Publishing…' : 'Publish timetable'}
          confirmVariant="default"
          confirmDisabled={!preview.data}
          pending={pending}
          onOpenChange={(next) => {
            form.reset();
            onOpenChange(next);
          }}
          onConfirm={() => {
            if (!pending) void form.handleSubmit();
          }}
        >
          {preview.isError && <Notice error>{errorMessage(preview.error)}</Notice>}
          <Issues errors={errors} />
        </ConfirmationDialog>
      )}
    </form.Subscribe>
  );
}

/** Returns a published timetable to a draft; nobody is notified. */
export function WithdrawTimetableDialog({
  scope,
  examName,
  open,
  onOpenChange,
}: {
  scope: ExamScope;
  examName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queries = useExamCache();
  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      try {
        const draft = await client.school.withdrawExamTimetable(scope);
        queries.cache.setQueryData(orpc.school.getExamTimetable.queryKey({ input: scope }), draft);
        onOpenChange(false);
        toast.success('Timetable withdrawn to a draft.');
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
        await queries.cache.invalidateQueries({ queryKey: orpc.school.getExamTimetable.key({ input: scope }) });
      }
    },
  });
  return (
    <form.Subscribe selector={(state) => ({ pending: state.isSubmitting, errors: state.errors })}>
      {({ pending, errors }) => (
        <ConfirmationDialog
          open={open}
          title="Withdraw timetable"
          description={`Withdraw the ${examName} timetable to a draft? Students stop seeing it and nobody is notified. Publishing it again notifies everyone again.`}
          confirmLabel={pending ? 'Withdrawing…' : 'Withdraw to draft'}
          confirmVariant="default"
          pending={pending}
          onOpenChange={(next) => {
            form.reset();
            onOpenChange(next);
          }}
          onConfirm={() => {
            if (!pending) void form.handleSubmit();
          }}
        >
          <Issues errors={errors} />
        </ConfirmationDialog>
      )}
    </form.Subscribe>
  );
}
