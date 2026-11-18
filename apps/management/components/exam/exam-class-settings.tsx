'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@campuspilot/ui/components/button';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
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
import {
  classSelectionFormOptions,
  fieldError,
  participatingClassIds,
  selectionIssue,
} from './exam-class-model';
import { errorCode, errorMessage, examResultsHref, schoolPermission, type ExamScope } from './exam-model';

/**
 * The classes are chosen when the plan is created, and the plan is created
 * from the examination's Results page (its "No plans yet" state), so a
 * settings page with no plan and no classes links there. Opening that page
 * needs `READ_EXAM_PLANS`; creating the plan needs `CREATE_EXAM_PLAN`.
 */
function CreateExamPlanLink({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={[
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.CREATE_EXAM_PLAN),
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAM_PLANS),
      ]}
    >
      <Button asChild size="sm" variant="outline">
        <Link href={examResultsHref(scope)}>Create exam plan</Link>
      </Button>
    </RequirePermissions>
  );
}

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
  // The server also accepts updateExamClasses with no plans (an examination
  // whose only participation rows came from the migration backfill of
  // timetable columns), but here the classes are chosen by creating the plan,
  // so Edit classes is hidden until a plan exists.
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
      {active && overview.planCount === 0 && context.classes.length === 0 && (
        <CreateExamPlanLink scope={scope} />
      )}
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
 * Loads the review and renders a fresh form per `configurationVersion`. The
 * server's refusal of a save is held here, outside the keyed form, until the
 * next save attempt or until the dialog closes: a stale-review refusal
 * (CONFLICT) refetches the review, which remounts the form with the new
 * baseline and would drop a message held inside it, and keeping any refusal
 * out of the form's error map keeps Save classes available for a retry (see
 * `classSelectionFormOptions`).
 */
function ClassesPreview({ scope, onClose }: { scope: ExamScope; onClose: () => void }) {
  const query = useQuery(orpc.school.getExamPlanPreview.queryOptions({ input: scope }));
  const refusal = useForm({
    defaultValues: { message: null as string | null },
    validators: { onChange: z.object({ message: z.string().nullable() }) },
  });
  if (query.isPending) return <LoadingExam />;
  if (!query.data) return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <refusal.Subscribe selector={(state) => state.values.message}>
        {(message) => message && <Notice error>{message}</Notice>}
      </refusal.Subscribe>
      <ClassesForm
        key={query.data.configurationVersion}
        scope={scope}
        preview={query.data}
        busy={query.isFetching}
        onClose={onClose}
        onRefusal={(message) => refusal.setFieldValue('message', message)}
      />
    </div>
  );
}

function ClassesForm({
  scope,
  preview,
  busy,
  onClose,
  onRefusal,
}: {
  scope: ExamScope;
  preview: ExamPlanPreviewDto;
  busy: boolean;
  onClose: () => void;
  /** Shows (or, with null, clears) the server's refusal outside this keyed form. */
  onRefusal: (message: string | null) => void;
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
  const form = useForm(
    classSelectionFormOptions({
      classIds: baseline,
      save: async (classIds) => {
        const result = await client.school.updateExamClasses({
          ...scope,
          configurationVersion: preview.configurationVersion,
          classIds,
        });
        toast.success(
          `Classes updated: ${result.addedClassIds.length} added, ${result.removedClassIds.length} removed.`,
        );
        onClose();
        await refresh();
      },
      onAttempt: () => onRefusal(null),
      onRefused: async (error) => {
        // A stale review reloads into a fresh form (new key) with the current
        // classes; any other refusal (results, timetable, question papers)
        // keeps this form and its selection, so the same save can be retried.
        onRefusal(
          errorCode(error) === 'CONFLICT'
            ? `${errorMessage(error)} The list now shows the current classes taking part.`
            : errorMessage(error),
        );
        await refresh();
      },
    }),
  );
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
