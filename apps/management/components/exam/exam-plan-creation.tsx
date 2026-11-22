'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { ExamClassSelection } from '@campuspilot/components/exam/exam-class-selection';
import {
  NO_PLAN_SELECTION_CHANGES,
  applyPlanSelectionChanges,
  changesAfterSubjectAdded,
  planSelectionChanges,
  type PlanSelectionChanges,
  type SubjectChoice,
} from '@campuspilot/components/exam/exam-class-selection-model';
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
import {
  classSelectionFormOptions,
  createPlanBase,
  fieldError,
  selectedPlanCount,
  selectionIssue,
  subjectsForClasses,
  type ClassSelectionValues,
} from './exam-class-model';
import { ExamAddClassButton, ExamAddClassDialog } from './exam-add-class';
import { ExamAddSubjectButton, ExamAddSubjectDialog } from './exam-add-subject';

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
                        Choose the classes taking part and, per class, the
                        subjects that get a plan. Subjects missing here can be
                        added for this examination only or to the classroom,
                        and a missing class can be added to the school. Start
                        the examination when you are ready to enter results.
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
/**
 * What the review keeps outside its keyed form: the person's changes to
 * carry, the class whose Add subject dialog is open and whether the Add
 * classroom dialog is open (both dialogs outlive the remount their save causes).
 */
type CarryValues = { changes: PlanSelectionChanges; addingTo: string | null; addingClass: boolean };
const carrySchema = z.object({ changes: z.custom<PlanSelectionChanges>(), addingTo: z.string().nullable(), addingClass: z.boolean() });

/**
 * Loads the review and renders a fresh form per `configurationVersion`. The
 * server's refusal is held here, outside the keyed form, until the next
 * attempt or until the dialog closes: a changed configuration remounts the
 * form, and keeping the refusal out of the form's error map keeps Create exam
 * plan available for a retry (see `classSelectionFormOptions`).
 *
 * The person's changes are held here too (`carry`): adding a subject changes
 * the review, which remounts the form, and the new form starts from the new
 * review's defaults with those changes applied (`applyPlanSelectionChanges`).
 * A class that gets its first subject is selected. A class added with Add
 * classroom has no subjects yet, so it joins the review unselected.
 */
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
  const refusal = useForm({
    defaultValues: { message: null as string | null },
    validators: { onChange: z.object({ message: z.string().nullable() }) },
  });
  const carry = useForm({
    defaultValues: { changes: NO_PLAN_SELECTION_CHANGES, addingTo: null, addingClass: false } as CarryValues,
    validators: { onChange: carrySchema },
  });
  if (query.isPending) return <LoadingExam />;
  if (!query.data || query.isError)
    return <ReadError error={query.error} retry={query.refetch} />;
  const preview = query.data;
  const base = createPlanBase(preview);
  const remember = (value: ClassSelectionValues) => carry.setFieldValue('changes', planSelectionChanges(base, value));
  const added = (classId: string, subjectSlug: string) =>
    carry.setFieldValue('changes', changesAfterSubjectAdded(preview.classes, carry.state.values.changes, classId, subjectSlug));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <refusal.Subscribe selector={(state) => state.values.message}>
        {(message) => message && <Notice error>{message}</Notice>}
      </refusal.Subscribe>
      <GenerationForm
        key={preview.configurationVersion}
        scope={scope}
        preview={preview}
        initial={applyPlanSelectionChanges(preview.classes, base, carry.state.values.changes)}
        active={active && !query.isFetching}
        onCancel={onCancel}
        onRefusal={(message) => refusal.setFieldValue('message', message)}
        onSelectionChange={remember}
        onAddSubject={(classId) => carry.setFieldValue('addingTo', classId)}
        onAddClass={() => carry.setFieldValue('addingClass', true)}
      />
      <carry.Subscribe selector={(state) => state.values.addingTo}>
        {(addingTo) => {
          const schoolClass = preview.classes.find((entry) => entry.classId === addingTo);
          return schoolClass ? (
            <ExamAddSubjectDialog
              scope={scope}
              schoolClass={schoolClass}
              onAdded={(subjectSlug) => added(schoolClass.classId, subjectSlug)}
              onClose={() => carry.setFieldValue('addingTo', null)}
            />
          ) : null;
        }}
      </carry.Subscribe>
      <carry.Subscribe selector={(state) => state.values.addingClass}>
        {(addingClass) =>
          addingClass ? <ExamAddClassDialog scope={scope} onClose={() => carry.setFieldValue('addingClass', false)} /> : null
        }
      </carry.Subscribe>
    </div>
  );
}

/**
 * The review form. A fresh review starts with no class selected and every
 * subject of every class chosen; Select all / Deselect all choose classes,
 * and each class's breakdown chooses its subjects. The API still treats a
 * request without `classIds` as every class with subjects; this dialog
 * always sends the classes and their subjects.
 */
function GenerationForm({
  scope,
  preview,
  initial,
  active,
  onCancel,
  onRefusal,
  onSelectionChange,
  onAddSubject,
  onAddClass,
}: {
  scope: ExamScope;
  preview: ExamPlanPreviewDto;
  initial: { classIds: string[]; subjects: SubjectChoice };
  active: boolean;
  onCancel: () => void;
  /** Shows (or, with null, clears) the server's refusal outside this keyed form. */
  onRefusal: (message: string | null) => void;
  onSelectionChange: (value: ClassSelectionValues) => void;
  onAddSubject: (classId: string) => void;
  onAddClass: () => void;
}) {
  const queries = useExamCache();
  const exists = preview.existingPlanCount > 0;
  const form = useForm(
    classSelectionFormOptions({
      ...initial,
      save: async ({ classIds, subjects }) => {
        if (!active || exists || selectionIssue(preview, classIds, subjects)) return;
        const result = await client.school.generateExamPlan({
          ...scope,
          configurationVersion: preview.configurationVersion,
          classIds,
          subjects: subjectsForClasses(classIds, subjects),
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
      },
      onAttempt: () => onRefusal(null),
      onRefused: async (error) => {
        onRefusal(errorMessage(error));
        // Refresh source data without resubmitting. A changed configuration gets
        // a new keyed review; existing plans are never overwritten on retry.
        toast.error(errorMessage(error));
        await Promise.all([
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamPlanPreview.key({ input: scope }),
          }),
          queries.plans(scope),
        ]);
      },
      onSelectionChange,
    }),
  );
  const editable = active && !exists;
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="subjects">
        {(subjectsField) => (
          <form.Field name="classIds">
            {(field) => (
              <ExamClassSelection
                classes={preview.classes}
                selected={field.state.value}
                disabled={!editable}
                error={fieldError(field.state.meta.errors)}
                onChange={(classIds) => field.handleChange(classIds)}
                subjects={{
                  chosen: subjectsField.state.value,
                  onChange: (subjects) => subjectsField.handleChange(subjects),
                }}
                renderAddSubject={
                  editable
                    ? (schoolClass) => (
                        <ExamAddSubjectButton
                          scope={scope}
                          label={schoolClass.label}
                          onAdd={() => onAddSubject(schoolClass.classId)}
                        />
                      )
                    : undefined
                }
                actions={editable ? <ExamAddClassButton scope={scope} onAdd={onAddClass} /> : undefined}
              />
            )}
          </form.Field>
        )}
      </form.Field>
      {exists ? (
        <Notice error>An exam plan already exists. Return to the saved plans.</Notice>
      ) : preview.planCount === 0 ? (
        <Notice error>
          No class has subjects with valid assessment modes yet. Add a subject
          to a class here or in class settings, or add a classroom, before
          creating this plan.
        </Notice>
      ) : null}
      <form.Subscribe
        selector={(state) => ({
          classIds: state.values.classIds,
          subjects: state.values.subjects,
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
          errors: state.errors,
        })}
      >
        {({ classIds, subjects, canSubmit, isSubmitting, errors }) => (
          <GenerationFooter
            preview={preview}
            classIds={classIds}
            subjects={subjects}
            errors={errors}
            submitting={isSubmitting}
            submittable={editable && canSubmit}
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
  subjects,
  errors,
  submitting,
  submittable,
  onCancel,
}: {
  preview: ExamPlanPreviewDto;
  classIds: string[];
  subjects: SubjectChoice;
  errors: readonly unknown[];
  submitting: boolean;
  submittable: boolean;
  onCancel: () => void;
}) {
  const issue = selectionIssue(preview, classIds, subjects);
  return (
    <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-popover py-3">
      {issue && (
        <Notice error>
          {issue} Fix it in class settings or leave it out.
        </Notice>
      )}
      <Issues errors={errors} />
      <p className="text-sm text-muted-foreground">
        {selectedPlanCount(preview, classIds, subjects)} subject plans ·{' '}
        {preview.totalMarks} marks per subject. Classes and subjects left out
        take no part in this examination.
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
