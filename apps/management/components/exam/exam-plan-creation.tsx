'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  examClassSelectionSchema,
  type ExamPlanPreviewDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { ExamClassSelection } from '@campuspilot/components/exam/exam-class-selection';
import { allSelectableClassIds } from '@campuspilot/components/exam/exam-class-selection-model';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { errorMessage, schoolPermission, type ExamScope } from './exam-model';
import { fieldError, selectedPlanCount, selectionIssue } from './exam-class-model';

export function ExamPlanCreation({
  scope,
  active,
}: {
  scope: ExamScope;
  active: boolean;
}) {
  const form = useForm({
    defaultValues: { reviewing: false },
    validators: { onChange: z.object({ reviewing: z.boolean() }) },
  });
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
      <h2 className="text-base font-medium">No plans yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Create the plan from your classes, subjects and assessment modes. You
        can add a timetable afterwards.
      </p>
      {active && (
        <RequirePermissions
          permissions={schoolPermission(
            scope.schoolId,
            SCHOOL_ACTIONS.CREATE_EXAM_PLAN,
          )}
        >
          <form.Subscribe selector={(state) => state.values.reviewing}>
            {(reviewing) => (
              <>
                <ExamButton
                  onClick={() => form.setFieldValue('reviewing', true)}
                >
                  Create plan
                </ExamButton>
                <Dialog
                  open={reviewing}
                  onOpenChange={(open) => form.setFieldValue('reviewing', open)}
                >
                  <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Review exam plan</DialogTitle>
                      <DialogDescription>
                        Choose the classes taking part. Their plans are
                        generated from class settings. Start the examination
                        when you are ready to enter results.
                      </DialogDescription>
                    </DialogHeader>
                    {reviewing && (
                      <GenerationPreview
                        scope={scope}
                        active={active}
                        onCancel={() => form.setFieldValue('reviewing', false)}
                      />
                    )}
                  </DialogContent>
                </Dialog>
              </>
            )}
          </form.Subscribe>
        </RequirePermissions>
      )}
    </div>
  );
}
function GenerationPreview({
  scope,
  active,
  onCancel,
}: {
  scope: ExamScope;
  active: boolean;
  onCancel: () => void;
}) {
  const query = useQuery(
    orpc.school.getExamPlanPreview.queryOptions({ input: scope }),
  );
  if (query.isPending) return <LoadingExam />;
  if (!query.data || query.isError)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <GenerationForm
      key={query.data.configurationVersion}
      scope={scope}
      preview={query.data}
      active={active && !query.isFetching}
      onCancel={onCancel}
    />
  );
}
/** Every class that can take part starts selected, which creates the same plans as generating for the whole school. */
const generationSchema = z.object({ classIds: examClassSelectionSchema });

function GenerationForm({
  scope,
  preview,
  active,
  onCancel,
}: {
  scope: ExamScope;
  preview: ExamPlanPreviewDto;
  active: boolean;
  onCancel: () => void;
}) {
  const queries = useExamCache();
  const exists = preview.existingPlanCount > 0;
  const form = useForm({
    defaultValues: { classIds: allSelectableClassIds(preview.classes) },
    validators: { onChange: generationSchema, onSubmit: generationSchema },
    onSubmit: async ({ value }) => {
      if (!active || exists || selectionIssue(preview, value.classIds)) return;
      try {
        const result = await client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
          classIds: value.classIds,
        });
        toast.success(
          `Exam plan created for ${result.createdCount} class subjects.`,
        );
        onCancel();
        await Promise.all([
          queries.plans(scope),
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamContext.key({ input: scope }),
          }),
        ]);
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        // Refresh source data without resubmitting. A changed configuration gets
        // a new keyed review; existing plans are never overwritten on retry.
        toast.error(errorMessage(error));
        await Promise.all([
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamPlanPreview.key({ input: scope }),
          }),
          queries.plans(scope),
        ]);
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
            disabled={!active || exists}
            error={fieldError(field.state.meta.errors)}
            onChange={(classIds) => field.handleChange(classIds)}
          />
        )}
      </form.Field>
      {exists ? (
        <Notice error>An exam plan already exists. Return to the saved plans.</Notice>
      ) : preview.planCount === 0 ? (
        <Notice error>
          Configure subjects and valid assessment modes in class settings
          before creating this plan.
        </Notice>
      ) : null}
      <form.Subscribe
        selector={(state) => ({
          classIds: state.values.classIds,
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ classIds, canSubmit, isSubmitting, errors }) => (
          <GenerationFooter
            preview={preview}
            classIds={classIds}
            errors={errors}
            submitting={isSubmitting}
            submittable={active && !exists && canSubmit}
            onCancel={onCancel}
          />
        )}
      </form.Subscribe>
    </form>
  );
}

function GenerationFooter({
  preview,
  classIds,
  errors,
  submitting,
  submittable,
  onCancel,
}: {
  preview: ExamPlanPreviewDto;
  classIds: string[];
  errors: readonly unknown[];
  submitting: boolean;
  submittable: boolean;
  onCancel: () => void;
}) {
  const issue = selectionIssue(preview, classIds);
  return (
    <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover py-3">
      {issue && (
        <Notice error>
          {issue} Fix it in class settings or leave the class out.
        </Notice>
      )}
      <Issues errors={errors} />
      <p className="text-sm text-muted-foreground">
        {selectedPlanCount(preview, classIds)} subject plans ·{' '}
        {preview.totalMarks} marks per subject. Classes left out take no part
        in this examination.
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <ExamButton
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </ExamButton>
        <ExamButton
          type="submit"
          disabled={!submittable || issue !== null || submitting}
        >
          {submitting ? 'Creating plan…' : 'Create exam plan'}
        </ExamButton>
      </div>
    </div>
  );
}
