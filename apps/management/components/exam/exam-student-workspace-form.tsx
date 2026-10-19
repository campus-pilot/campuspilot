'use client';
import { useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronDown } from 'lucide-react';
import type { StudentExamWorkspaceDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  SCHOOL_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import { ExamDiscardDialog } from '@campuspilot/components/exam/exam-discard-dialog';
import {
  focusInvalidExamField,
  type TextFieldApi,
} from '@campuspilot/components/exam/exam-controls';
import { ButtonGroup } from '@campuspilot/ui/components/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { toast } from '@campuspilot/ui/lib/toast';
import {
  DirtyGuard,
  ExamButton,
  ExamInput,
  ExamSelect,
  Issues,
  Notice,
  ReadError,
} from './exam-common';
import {
  approvalPermission,
  errorMessage,
  isExamSaveUncertain,
  schoolPermission,
} from './exam-model';
import {
  studentExamDefaults,
  studentExamPayload,
  studentExamSchema,
} from './exam-student-workspace-model';
import type { StudentExamScope } from './exam-student-workspace';

type StudentExamFormProps = {
  scope: StudentExamScope;
  initial: StudentExamWorkspaceDto;
  latest: StudentExamWorkspaceDto;
  active: boolean;
  onDone: () => void;
};
/** Refetches update capability checks, but only a deliberate save/discard changes
 * the editing baseline. The form owns all marks, optional fields and submission.
 */
function useStudentExamForm({
  scope,
  initial,
  latest,
  active,
  onDone,
}: StudentExamFormProps) {
  const baseline = useRef(initial).current;
  const cache = useQueryClient();
  const session = useQuery(
    orpc.school.getSession.queryOptions({
      input: { schoolId: scope.schoolId, sessionId: scope.sessionId },
    }),
  );
  /** Grades store labels, not configuration keys. Highest thresholds appear first;
   * duplicate labels remain a single choice, and historical values stay explicit.
   */
  const gradeLabels = [
    ...new Set(
      Object.values(session.data?.sessionConfig?.gradingScale ?? {})
        .sort((a, b) => b.minScore - a.minScore)
        .map((grade) => grade.label),
    ),
  ];
  const checks = [
    schoolPermission(scope.schoolId, SCHOOL_ACTIONS.WRITE_EXAM_RESULTS),
    schoolPermission(scope.schoolId, SCHOOL_ACTIONS.REVISE_EXAM_RESULTS),
    approvalPermission(scope.schoolId, scope.classId),
  ];
  const permissions = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: checks },
    }),
  );
  const [canWrite, canRevise, canApprove] =
    !permissions.isError && permissions.data?.results.length === 3
      ? (permissions.data?.results ?? [])
      : [];
  const hasApproved =
    latest.assessment?.approved ||
    latest.subjects.some(({ result }) => result?.approved);
  const writable =
    active && canWrite === true && (!hasApproved || canRevise === true);
  const schema = studentExamSchema(baseline);
  const ui = useForm({
    defaultValues: { uncertain: false, discarding: false },
    validators: {
      onChange: z.object({
        uncertain: z.boolean(),
        discarding: z.boolean(),
      }),
    },
  });
  const form = useForm({
    defaultValues: studentExamDefaults(baseline),
    validators: { onSubmit: schema, onChange: schema },
    onSubmit: async ({ value }) => {
      if (!writable || ui.state.values.uncertain) return;
      try {
        const saved = await client.school.saveStudentExam({
          ...scope,
          ...studentExamPayload(value),
        });
        cache.setQueryData(
          orpc.school.getStudentExam.queryOptions({ input: scope }).queryKey,
          saved,
        );
        form.reset(studentExamDefaults(saved));
        toast.success(
          value.approved
            ? 'Results saved and approved.'
            : 'Results saved for review.',
        );
        onDone();
        await cache.invalidateQueries({ queryKey: orpc.school.key() });
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        // A lost response can follow a committed transaction. Require an explicit
        // saved-data reload before another attempt, avoiding accidental overwrite.
        if (isExamSaveUncertain(error)) ui.setFieldValue('uncertain', true);
        await cache.invalidateQueries({
          queryKey: orpc.school.getStudentExam.key({ input: scope }),
        });
      }
    },
  });
  const reloadSaved = async () => {
    try {
      await cache.fetchQuery({
        ...orpc.school.getStudentExam.queryOptions({ input: scope }),
        staleTime: 0,
      });
      onDone();
    } catch (error) {
      form.setErrorMap({ onSubmit: { form: errorMessage(error), fields: {} } });
    }
  };
  const writeChecks = [checks[0]!, ...(hasApproved ? [checks[1]!] : [])];
  return {
    baseline,
    reloadSaved,
    form,
    ui,
    writable,
    canApprove,
    checks,
    writeChecks,
    onDone,
    session,
    gradeLabels,
  };
}
export function StudentExamForm(props: StudentExamFormProps) {
  const controller = useStudentExamForm(props);
  const { form, baseline, writable, session, gradeLabels } = controller;
  const formElement = useRef<HTMLFormElement>(null);

  /** Both save paths validate the same draft and set explicit approval intent.
   * Normal form submission (including Enter) always saves for review.
   */
  function submitResults(approved: boolean) {
    form.setFieldValue('approved', approved);
    void form
      .handleSubmit()
      .then(() => focusInvalidExamField(formElement.current));
  }

  return (
    <form
      ref={formElement}
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submitResults(false);
      }}
    >
      <h2 className="text-base font-medium">All subject results</h2>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <>
            <StudentSubjectFields
              form={form}
              baseline={baseline}
              writable={writable && !pending}
            />
            <StudentAssessmentFields
              form={form}
              baseline={baseline}
              writable={writable && !pending}
              session={session}
              gradeLabels={gradeLabels}
            />
          </>
        )}
      </form.Subscribe>
      <StudentExamFormFeedback
        controller={controller}
        onApprove={() => submitResults(true)}
      />
    </form>
  );
}

type StudentExamFormController = ReturnType<typeof useStudentExamForm>;
type StudentFieldProps = Pick<
  StudentExamFormController,
  'form' | 'baseline' | 'writable'
>;

function StudentSubjectFields({ form, baseline, writable }: StudentFieldProps) {
  return (
    <div className="flex flex-col divide-y rounded-xl border">
      {baseline.subjects.map(({ plan }, index) => (
        <StudentSubjectRow
          key={plan.id}
          form={form}
          baseline={baseline}
          plan={plan}
          index={index}
          writable={writable}
        />
      ))}
    </div>
  );
}

function StudentSubjectRow({
  form,
  baseline,
  writable,
  plan,
  index,
}: StudentFieldProps & {
  plan: StudentExamWorkspaceDto['subjects'][number]['plan'];
  index: number;
}) {
  const names = baseline.context.classes[0]!.subjects;
  return (
    <section className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:gap-6">
      <div className="w-full shrink-0 sm:w-44">
        <h3 className="font-medium">
          {names[plan.subjectSlug]?.name ?? plan.subjectSlug}
        </h3>
        <p className="text-xs text-muted-foreground">
          Maximum {plan.totalMarks} marks
        </p>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(plan.modeConfig).map(([slug, mode], modeIndex) => (
          <form.Field
            key={slug}
            name={`subjects[${index}].marks[${modeIndex}].value`}
          >
            {(field) => (
              <ExamInput
                field={field}
                label={`${names[plan.subjectSlug]?.examModes[slug]?.name ?? slug} / ${mode.maxMarks} (${mode.percentage}%)`}
                inputMode="decimal"
                disabled={!writable}
              />
            )}
          </form.Field>
        ))}
      </div>
    </section>
  );
}

function StudentAssessmentFields({
  form,
  baseline,
  writable,
  session,
  gradeLabels,
}: StudentFieldProps &
  Pick<StudentExamFormController, 'session' | 'gradeLabels'>) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-3">
      <h2 className="font-medium">Attendance &amp; activities</h2>
      {session.isError && (
        <ReadError error={session.error} retry={session.refetch} />
      )}
      {!session.isPending &&
        !session.isError &&
        gradeLabels.length === 0 &&
        Object.keys(baseline.context.coScholasticAreas).length > 0 && (
          <p className="text-sm text-muted-foreground">
            No grading scale is configured in this session. Configure it in
            session settings to choose activity grades.
          </p>
        )}
      {Object.keys(baseline.context.coScholasticAreas).length === 0 &&
        !baseline.context.attendanceTracking.enabled && (
          <p className="text-sm text-muted-foreground">
            No additional assessments are enabled in session settings.
          </p>
        )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {studentExamDefaults(baseline).grades.map((grade, index) => (
          <form.Field key={grade.slug} name={`grades[${index}].value`}>
            {(field) => (
              <ActivityGradeSelect
                field={field}
                label={`${baseline.context.coScholasticAreas[grade.slug]?.name ?? `${grade.slug} (historical)`} · grade (optional)`}
                gradeLabels={gradeLabels}
                disabled={!writable || session.isPending || session.isError}
              />
            )}
          </form.Field>
        ))}
      </div>
      {(baseline.context.attendanceTracking.enabled ||
        baseline.assessment?.daysAttended != null) && (
        <div className="flex max-w-sm flex-col gap-2">
          <form.Field name="daysAttended">
            {(field) => (
              <ExamInput
                field={field}
                label={
                  baseline.totalWorkingDays === null
                    ? 'Days attended (optional)'
                    : `Days attended / ${baseline.totalWorkingDays}`
                }
                inputMode="numeric"
                disabled={
                  !writable ||
                  (baseline.totalWorkingDays === null &&
                    field.state.value === '')
                }
              />
            )}
          </form.Field>
          {baseline.totalWorkingDays === null && (
            <p className="text-sm text-muted-foreground">
              Ask the exam coordinator, principal or manager to set exam working
              days before recording attendance.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StudentExamFormFeedback({
  controller,
  onApprove,
}: {
  controller: StudentExamFormController;
  onApprove: () => void;
}) {
  const {
    form,
    ui,
    writable,
    canApprove,
    checks,
    writeChecks,
    onDone,
    reloadSaved,
  } = controller;
  return (
    <form.Subscribe
      selector={({ isDirty, isSubmitting, canSubmit, errors }) => ({
        isDirty,
        isSubmitting,
        canSubmit,
        errors,
      })}
    >
      {({ isDirty, isSubmitting, canSubmit, errors }) => (
        <>
          <DirtyGuard dirty={isDirty} />
          <Issues errors={errors} />
          <ui.Subscribe selector={(state) => state.values}>
            {({ uncertain, discarding }) => (
              <>
                {uncertain && (
                  <Notice error>
                    The save could not be confirmed. Reload saved results before
                    trying again.
                  </Notice>
                )}
                {!canApprove && (
                  <p className="text-sm text-muted-foreground">
                    Approval requires the assigned class teacher or an exam
                    administrator.
                  </p>
                )}
                <StudentExamFormActions
                  writeChecks={writeChecks}
                  approveCheck={checks[2]!}
                  disabled={
                    !writable || !canSubmit || isSubmitting || uncertain
                  }
                  isSubmitting={isSubmitting}
                  canApprove={canApprove === true}
                  uncertain={uncertain}
                  onApprove={onApprove}
                  onCancel={() => {
                    if (isDirty) ui.setFieldValue('discarding', true);
                    else if (uncertain) void reloadSaved();
                    else onDone();
                  }}
                />
                <ExamDiscardDialog
                  open={discarding}
                  onOpenChange={(open) => ui.setFieldValue('discarding', open)}
                  onDiscard={() => {
                    if (uncertain) void reloadSaved();
                    else onDone();
                  }}
                />
              </>
            )}
          </ui.Subscribe>
        </>
      )}
    </form.Subscribe>
  );
}

function StudentExamFormActions({
  writeChecks,
  approveCheck,
  disabled,
  isSubmitting,
  canApprove,
  uncertain,
  onApprove,
  onCancel,
}: {
  writeChecks: PermissionCheck[];
  approveCheck: PermissionCheck;
  disabled: boolean;
  isSubmitting: boolean;
  canApprove: boolean;
  uncertain: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sticky bottom-0 border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <ButtonGroup aria-label="Result actions">
        <RequirePermissions permissions={writeChecks}>
          <ExamButton type="submit" variant="outline" disabled={disabled}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </ExamButton>
        </RequirePermissions>
        <StudentExamApprovalMenu
          permissions={[...writeChecks, approveCheck]}
          disabled={disabled || !canApprove}
          onApprove={onApprove}
        />
        <ExamButton
          variant="outline"
          disabled={isSubmitting}
          onClick={onCancel}
        >
          {uncertain ? 'Reload saved results' : 'Cancel'}
        </ExamButton>
      </ButtonGroup>
    </div>
  );
}

function StudentExamApprovalMenu({
  permissions,
  disabled,
  onApprove,
}: {
  permissions: PermissionCheck[];
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <RequirePermissions permissions={permissions}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ExamButton
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label="More save options"
          >
            <ChevronDown aria-hidden />
          </ExamButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={disabled} onSelect={onApprove}>
              Save &amp; approve
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </RequirePermissions>
  );
}

function ActivityGradeSelect({
  field,
  label,
  gradeLabels,
  disabled,
}: {
  field: TextFieldApi;
  label: string;
  gradeLabels: string[];
  disabled: boolean;
}) {
  const historical =
    field.state.value !== '' && !gradeLabels.includes(field.state.value);
  return (
    <ExamSelect
      label={label}
      value={field.state.value}
      name={field.name}
      errors={field.state.meta.errors}
      disabled={disabled || (!gradeLabels.length && !historical)}
      onChange={field.handleChange}
      options={[
        { value: '', label: 'No grade' },
        ...(historical
          ? [
              {
                value: field.state.value,
                label: `${field.state.value} (not in current scale)`,
              },
            ]
          : []),
        ...gradeLabels.map((grade) => ({ value: grade, label: grade })),
      ]}
    />
  );
}
