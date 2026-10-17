'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { ExamPlanReviewTable } from '@campuspilot/components/exam/exam-plan-review-table';
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
                        Generated from class settings. Start the examination
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
  const blocked =
    preview.planCount === 0 ||
    preview.existingPlanCount > 0 ||
    preview.classes.some((schoolClass) =>
      schoolClass.subjects.some((subject) => subject.issue !== null),
    );
  const form = useForm({
    defaultValues: {},
    validators: { onSubmit: z.object({}) },
    onSubmit: async () => {
      if (!active || blocked) return;
      try {
        const result = await client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
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
      <ExamPlanReviewTable classes={preview.classes} />
      {blocked && (
        <Notice error>
          {preview.existingPlanCount
            ? 'An exam plan already exists. Return to the saved plans.'
            : 'Configure subjects and valid assessment modes in class settings before creating this plan.'}
        </Notice>
      )}
      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ canSubmit, isSubmitting, errors }) => (
          <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-background py-3">
            <Issues errors={errors} />
            <p className="text-sm text-muted-foreground">
              {preview.planCount} subject plans · {preview.totalMarks} marks per
              subject. Classes without subjects are skipped.
            </p>
            <div className="flex flex-wrap gap-3">
              <ExamButton
                type="submit"
                disabled={!active || blocked || !canSubmit || isSubmitting}
              >
                {isSubmitting ? 'Creating plan…' : 'Create exam plan'}
              </ExamButton>
              <ExamButton
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={onCancel}
              >
                Cancel
              </ExamButton>
            </div>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
