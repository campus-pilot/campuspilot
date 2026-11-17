'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Users } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  examClassSelectionSchema,
  type ExamContextDto,
  type ExamOverviewDto,
  type ExamPlanPreviewDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { ExamClassSelection } from '@campuspilot/components/exam/exam-class-selection';
import { sameClassSelection } from '@campuspilot/components/exam/exam-class-selection-model';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  ExamButton,
  Issues,
  LoadingExam,
  Notice,
  ReadError,
  useExamCache,
} from './exam-common';
import { fieldError, participatingClassIds, selectionIssue } from './exam-class-model';
import { errorCode, errorMessage, schoolPermission, type ExamScope } from './exam-model';

/**
 * Settings section listing the classes taking part in the examination, with
 * Edit classes (exam plan update permission) while the plan exists, the
 * session is active and the examination has not ended or been released.
 */
export function ExamClassesSection({
  scope,
  active,
  overview,
  context,
}: {
  scope: ExamScope;
  active: boolean;
  overview: ExamOverviewDto;
  context: ExamContextDto;
}) {
  const ui = useForm({
    defaultValues: { editing: false },
    validators: { onChange: z.object({ editing: z.boolean() }) },
  });
  const editable =
    active &&
    overview.planCount > 0 &&
    overview.status !== 'completed' &&
    overview.cadetReleasedAt === null;
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-sm font-medium">Classes taking part</h3>
        <p className="text-sm text-muted-foreground">
          {context.classes.length
            ? context.classes.map((entry) => entry.label).join(', ')
            : 'No classes yet. Create the exam plan to choose them.'}
        </p>
      </div>
      {editable && (
        <RequirePermissions
          permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.UPDATE_EXAM_PLAN)}
        >
          <ExamButton variant="outline" onClick={() => ui.setFieldValue('editing', true)}>
            <Users aria-hidden />
            Edit classes
          </ExamButton>
          <ui.Subscribe selector={(state) => state.values.editing}>
            {(editing) => (
              <Dialog open={editing} onOpenChange={(open) => ui.setFieldValue('editing', open)}>
                <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Classes taking part</DialogTitle>
                    <DialogDescription>
                      Added classes get their plans from class settings. A
                      removed class leaves the plans, timetable, results and
                      documents of this examination.
                    </DialogDescription>
                  </DialogHeader>
                  {editing && (
                    <ClassesPreview scope={scope} onClose={() => ui.setFieldValue('editing', false)} />
                  )}
                </DialogContent>
              </Dialog>
            )}
          </ui.Subscribe>
        </RequirePermissions>
      )}
    </section>
  );
}

/**
 * Loads the review and renders a fresh form per `configurationVersion`. A
 * stale-review refusal (CONFLICT) refetches the review, which remounts the form
 * with the new baseline and would drop an error held inside it, so that
 * explanation is held here, outside the keyed form, until the next save
 * attempt or until the dialog closes.
 */
function ClassesPreview({ scope, onClose }: { scope: ExamScope; onClose: () => void }) {
  const query = useQuery(orpc.school.getExamPlanPreview.queryOptions({ input: scope }));
  const stale = useForm({
    defaultValues: { message: null as string | null },
    validators: { onChange: z.object({ message: z.string().nullable() }) },
  });
  if (query.isPending) return <LoadingExam />;
  if (!query.data) return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <stale.Subscribe selector={(state) => state.values.message}>
        {(message) => message && <Notice error>{message}</Notice>}
      </stale.Subscribe>
      <ClassesForm
        key={query.data.configurationVersion}
        scope={scope}
        preview={query.data}
        busy={query.isFetching}
        onClose={onClose}
        onStale={(message) => stale.setFieldValue('message', message)}
      />
    </div>
  );
}

const classesSchema = z.object({ classIds: examClassSelectionSchema });

function ClassesForm({
  scope,
  preview,
  busy,
  onClose,
  onStale,
}: {
  scope: ExamScope;
  preview: ExamPlanPreviewDto;
  busy: boolean;
  onClose: () => void;
  /** Shows (or, with null, clears) the stale-review explanation outside this keyed form. */
  onStale: (message: string | null) => void;
}) {
  const queries = useExamCache();
  const baseline = participatingClassIds(preview);
  const refresh = () =>
    Promise.all([
      queries.plans(scope),
      ...[orpc.school.getExamContext, orpc.school.getExamTimetable].map((procedure) =>
        queries.cache.invalidateQueries({ queryKey: procedure.key({ input: scope }) }),
      ),
    ]);
  const form = useForm({
    defaultValues: { classIds: baseline },
    validators: { onChange: classesSchema, onSubmit: classesSchema },
    onSubmit: async ({ value }) => {
      onStale(null);
      try {
        const result = await client.school.updateExamClasses({
          ...scope,
          configurationVersion: preview.configurationVersion,
          classIds: value.classIds,
        });
        toast.success(
          `Classes updated: ${result.addedClassIds.length} added, ${result.removedClassIds.length} removed.`,
        );
        onClose();
        await refresh();
      } catch (error) {
        // A stale review reloads into a fresh form (new key), so its reason is
        // shown above the form by the parent; any other refusal (results,
        // timetable, question papers) stays with this form's selection.
        if (errorCode(error) === 'CONFLICT')
          onStale(`${errorMessage(error)} The list now shows the current classes taking part.`);
        else form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
        await refresh();
      }
    },
  });
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="classIds">
        {(field) => (
          <ExamClassSelection
            classes={preview.classes}
            selected={field.state.value}
            baseline={baseline}
            disabled={busy}
            error={fieldError(field.state.meta.errors)}
            onChange={(classIds) => field.handleChange(classIds)}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) => ({
          classIds: state.values.classIds,
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ classIds, canSubmit, isSubmitting, errors }) => {
          const issue = selectionIssue(
            preview,
            classIds.filter((classId) => !baseline.includes(classId)),
          );
          const unchanged = sameClassSelection(classIds, baseline);
          return (
            <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover py-3">
              {issue && (
                <Notice error>
                  {issue} Fix it in class settings or leave the class out.
                </Notice>
              )}
              <Issues errors={errors} />
              <div className="flex flex-wrap justify-end gap-3">
                <ExamButton type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
                  Cancel
                </ExamButton>
                <ExamButton
                  type="submit"
                  disabled={busy || unchanged || issue !== null || !canSubmit || isSubmitting}
                >
                  {isSubmitting ? 'Saving…' : 'Save classes'}
                </ExamButton>
              </div>
            </div>
          );
        }}
      </form.Subscribe>
    </form>
  );
}
