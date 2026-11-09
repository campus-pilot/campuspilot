'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  EXAM_STUDENT_REMARK_MAX_LENGTH,
  type ExamOverviewDto,
  type StudentExamRemarkDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { StudentExamRemarkPreview } from '@campuspilot/components/exam/student-exam-remark-preview';
import { Label } from '@campuspilot/ui/components/label';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { toast } from '@campuspilot/ui/lib/toast';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { DirtyGuard, ExamButton, Issues, ReadError } from './exam-common';
import { errorMessage, isRemarkEditable, schoolPermission } from './exam-model';
import type { StudentExamScope } from './exam-student-workspace';

const remarkSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write a remark, or cancel.')
    .max(EXAM_STUDENT_REMARK_MAX_LENGTH, `Keep the remark under ${EXAM_STUDENT_REMARK_MAX_LENGTH} characters.`),
});

/** The teacher's remark for one student's examination, shown with the results. */
export function StudentExamRemark({
  scope,
  active,
  overview,
}: {
  scope: StudentExamScope;
  active: boolean;
  overview: ExamOverviewDto | undefined;
}) {
  const query = useQuery(orpc.school.getStudentExamRemark.queryOptions({ input: scope }));
  const ui = useForm({
    defaultValues: { editing: false },
    validators: { onChange: z.object({ editing: z.boolean() }) },
  });
  if (query.isPending)
    return <div className="h-24 animate-pulse rounded-lg border bg-muted/40" aria-busy="true" aria-label="Loading teacher remark" />;
  if (query.isError) return <ReadError error={query.error} retry={query.refetch} />;
  const editable = isRemarkEditable(active, overview);
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3" aria-labelledby="exam-remark-heading">
      <h3 id="exam-remark-heading" className="text-sm font-medium">Teacher remark</h3>
      <ui.Subscribe selector={(state) => state.values.editing}>
        {(editing) =>
          editing && editable ? (
            <RemarkEditor
              scope={scope}
              remark={query.data}
              onDone={() => ui.setFieldValue('editing', false)}
            />
          ) : (
            <RemarkPreview
              scope={scope}
              remark={query.data}
              editable={editable}
              released={!!overview?.cadetReleasedAt}
              onEdit={() => ui.setFieldValue('editing', true)}
            />
          )
        }
      </ui.Subscribe>
    </section>
  );
}

function RemarkPreview({
  scope,
  remark,
  editable,
  released,
  onEdit,
}: {
  scope: StudentExamScope;
  remark: StudentExamRemarkDto | null;
  editable: boolean;
  released: boolean;
  onEdit: () => void;
}) {
  return (
    <StudentExamRemarkPreview
      remark={remark}
      released={released}
      actions={
        editable ? (
          <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.WRITE_EXAM_RESULTS)}>
            <div className="flex flex-wrap gap-2">
              <ExamButton variant="outline" onClick={onEdit}>
                {remark ? 'Edit remark' : 'Write remark'}
              </ExamButton>
              {remark && <RemoveRemark scope={scope} />}
            </div>
          </RequirePermissions>
        ) : null
      }
    />
  );
}

/** Saves the draft; a background refetch never replaces it (the default comes from the mount). */
function RemarkEditor({
  scope,
  remark,
  onDone,
}: {
  scope: StudentExamScope;
  remark: StudentExamRemarkDto | null;
  onDone: () => void;
}) {
  const cache = useQueryClient();
  const form = useForm({
    defaultValues: { text: remark?.text ?? '' },
    validators: { onChange: remarkSchema, onSubmit: remarkSchema },
    onSubmit: async ({ value }) => {
      try {
        const saved = await client.school.saveStudentExamRemark({ ...scope, text: value.text });
        cache.setQueryData(orpc.school.getStudentExamRemark.queryKey({ input: scope }), saved);
        form.reset({ text: saved?.text ?? '' });
        toast.success('Remark saved.');
        onDone();
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
      }
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="text">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="exam-remark-text">Remark for the student</Label>
            <Textarea
              id="exam-remark-text"
              value={field.state.value}
              maxLength={EXAM_STUDENT_REMARK_MAX_LENGTH}
              aria-invalid={field.state.meta.errors.length > 0}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <Issues errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          pending: state.isSubmitting,
          canSubmit: state.canSubmit,
          dirty: state.isDirty,
          errors: state.errors,
        })}
      >
        {({ pending, canSubmit, dirty, errors }) => (
          <>
            <DirtyGuard dirty={dirty} description="Your remark edits will be lost. The saved remark stays as it was." />
            <Issues errors={errors} />
            <div className="flex flex-wrap gap-2">
              <ExamButton type="submit" disabled={pending || !canSubmit}>
                {pending ? 'Saving…' : 'Save remark'}
              </ExamButton>
              <ExamButton variant="outline" disabled={pending} onClick={onDone}>
                Cancel
              </ExamButton>
            </div>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Removal is confirmed with the app dialog. */
function RemoveRemark({ scope }: { scope: StudentExamScope }) {
  const cache = useQueryClient();
  const form = useForm({
    defaultValues: { confirming: false },
    validators: { onChange: z.object({ confirming: z.boolean() }) },
    onSubmit: async () => {
      try {
        await client.school.saveStudentExamRemark({ ...scope, text: null });
        cache.setQueryData(orpc.school.getStudentExamRemark.queryKey({ input: scope }), null);
        form.reset();
        toast.success('Remark removed.');
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({ confirming: state.values.confirming, pending: state.isSubmitting, errors: state.errors })}
    >
      {({ confirming, pending, errors }) => (
        <>
          <ExamButton variant="ghost" onClick={() => form.setFieldValue('confirming', true)}>
            Remove
          </ExamButton>
          <ConfirmationDialog
            open={confirming}
            pending={pending}
            title="Remove this remark?"
            description="The student will not see a teacher remark for this examination."
            confirmLabel={pending ? 'Removing…' : 'Remove remark'}
            onOpenChange={(open) => {
              if (!open) form.reset();
            }}
            onConfirm={() => void form.handleSubmit()}
          >
            <Issues errors={errors} />
          </ConfirmationDialog>
        </>
      )}
    </form.Subscribe>
  );
}
