'use client';
import { toast } from '@campuspilot/ui/lib/toast';
import { toPlanScope, toResultScope } from './exam-model';
import { focusInvalidExamField } from '@campuspilot/components/exam/exam-controls';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type {
  ExamContextDto,
  ExamPlanDto,
  ExamResultDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ResultSummary } from '@campuspilot/components/exam/result-summary';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  DirtyGuard,
  ExamButton,
  ExamInput,
  Issues,
  Notice,
  submitExam,
  useExamCache,
} from './exam-common';
import {
  approvalPermission,
  errorCode,
  errorMessage,
  numericText,
  planNames,
  resultDefaults,
  resultFormSchema,
  resultPayload,
  schoolPermission,
  type StudentRouteScope,
} from './exam-model';

/** Form baseline changes only after a deliberate save or reload. Refetches never reset unsaved student values. */
function useExamStudentResultForm({
  scope,
  plan,
  context,
  initial,
  current,
  active,
  onClose,
}: {
  scope: StudentRouteScope;
  plan: ExamPlanDto;
  context: ExamContextDto;
  initial: ExamResultDto | null;
  current: ExamResultDto | null;
  active: boolean;
  onClose: () => void;
}) {
  const queries = useExamCache();
  const names = planNames(context, plan);
  const checks = {
    write: schoolPermission(scope.schoolId, SCHOOL_ACTIONS.WRITE_EXAM_RESULTS),
    revise: schoolPermission(
      scope.schoolId,
      SCHOOL_ACTIONS.REVISE_EXAM_RESULTS,
    ),
    approve: approvalPermission(scope.schoolId, scope.classId),
  };
  const permissions = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: [checks.write, checks.revise, checks.approve] },
    }),
  );
  // Each capability comes from its corresponding independent request; malformed or failed responses fail closed.
  const [canWrite, canRevise, canApprove] =
    !permissions.isPending &&
    !permissions.isError &&
    permissions.data.results.length === 3
      ? permissions.data.results
      : [];
  const writable =
    active && canWrite === true && (!current?.approved || canRevise === true);
  const schema = resultFormSchema(plan, context);
  const ui = useForm({
    defaultValues: {
      preview: false,
      message: '',
      uncertain: false,
      baselineVersion: initial?.updatedAt?.toISOString() ?? '',
    },
    validators: {
      onChange: z.object({
        preview: z.boolean(),
        message: z.string(),
        uncertain: z.boolean(),
        baselineVersion: z.string(),
      }),
    },
  });
  const form = useForm({
    defaultValues: resultDefaults(plan, context, initial),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (!writable || ui.getFieldValue('uncertain')) {
        form.setErrorMap({
          onSubmit: {
            form: 'Saving is closed. Review session, plan, approval, or the last uncertain request.',
            fields: {},
          },
        });
        return;
      }
      try {
        const parsed = schema.parse(value);
        const payload = resultPayload(parsed);
        const saved = await client.school.upsertExamResult({
          ...toResultScope(scope),
          ...payload,
        });
        queries.cache.setQueryData(
          orpc.school.getExamResult.queryKey({ input: toResultScope(scope) }),
          saved,
        );
        form.reset(resultDefaults(plan, context, saved));
        ui.reset({
          preview: false,
          message: saved.approved ? 'Saved and approved.' : 'Saved for review.',
          uncertain: false,
          baselineVersion: saved.updatedAt?.toISOString() ?? '',
        });
        toast.success(
          saved.approved ? 'Saved and approved.' : 'Saved for review.',
        );
        await queries.results(scope);
        if (saved.approved && !canRevise) onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        const code = errorCode(error);
        ui.setFieldValue(
          'uncertain',
          code === undefined || code === 'INTERNAL_SERVER_ERROR',
        );
        await Promise.all([
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamResult.key({
              input: toResultScope(scope),
            }),
          }),
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamPlan.key({
              input: {
                schoolId: scope.schoolId,
                sessionId: scope.sessionId,
                classId: scope.classId,
                examPlanId: scope.examPlanId,
              },
            }),
          }),
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getSession.key({
              input: { schoolId: scope.schoolId, sessionId: scope.sessionId },
            }),
          }),
          queries.cache.invalidateQueries({
            queryKey: orpc.authorization.checkPermissions.key({
              input: {
                permissions: [checks.write, checks.revise, checks.approve],
              },
            }),
          }),
          queries.cache.invalidateQueries({
            queryKey: orpc.authorization.checkPermissions.key({
              input: { permissions: savePermissions },
            }),
          }),
          queries.cache.invalidateQueries({
            queryKey: orpc.authorization.checkPermissions.key({
              input: { permissions: [...savePermissions, checks.approve] },
            }),
          }),
        ]);
      }
    },
  });
  const savePermissions = [
    checks.write,
    ...(current?.approved ? [checks.revise] : []),
  ];
  const reload = async () => {
    if (
      form.state.isDirty &&
      !window.confirm(
        'Discard your local changes and load the latest saved values?',
      )
    )
      return;
    try {
      const saved = await client.school.getExamResult(toResultScope(scope));
      queries.cache.setQueryData(
        orpc.school.getExamResult.queryKey({ input: toResultScope(scope) }),
        saved,
      );
      form.reset(resultDefaults(plan, context, saved));
      ui.reset({
        preview: false,
        message:
          'Latest saved result loaded. Review before making another change.',
        uncertain: false,
        baselineVersion: saved.updatedAt?.toISOString() ?? '',
      });
    } catch (error) {
      if (errorCode(error) === 'NOT_FOUND') {
        queries.cache.removeQueries({
          queryKey: orpc.school.getExamResult.key({
            input: toResultScope(scope),
          }),
        });
        form.reset(resultDefaults(plan, context, null));
        ui.reset({
          preview: false,
          message: 'No saved result exists. Review your entry before saving.',
          uncertain: false,
          baselineVersion: '',
        });
      } else
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
    }
  };
  return {
    form,
    ui,
    schema,
    checks,
    writable,
    canApprove,
    savePermissions,
    reload,
    names,
  };
}

export function ExamStudentResultForm({
  scope,
  plan,
  context,
  initial,
  current,
  active,
  onClose,
}: {
  scope: StudentRouteScope;
  plan: ExamPlanDto;
  context: ExamContextDto;
  initial: ExamResultDto | null;
  current: ExamResultDto | null;
  active: boolean;
  onClose: () => void;
}) {
  const {
    form,
    ui,
    schema,
    checks,
    writable,
    canApprove,
    savePermissions,
    reload,
    names,
  } = useExamStudentResultForm({
    scope,
    plan,
    context,
    initial,
    current,
    active,
    onClose,
  });
  return (
    <form
      className="flex flex-col gap-4 pb-28"
      onSubmit={(event) => submitExam(event, form.handleSubmit)}
    >
      <h2 className="text-lg font-semibold">
        {current?.approved ? 'Correct approved result' : 'Enter marks'}
      </h2>
      <Notice>
        {current === null
          ? 'Not entered'
          : current.approved
            ? 'Saved result: Approved'
            : 'Saved result: Awaiting review'}
      </Notice>
      {!writable && (
        <Notice>
          Entry is currently read-only. Your local values are retained. Approved
          results require school revision access to change.
        </Notice>
      )}
      <ui.Subscribe selector={(state) => state.values}>
        {(state) => (
          <>
            {state.message && <Notice>{state.message}</Notice>}
            {state.baselineVersion !==
              (current?.updatedAt?.toISOString() ?? '') && (
              <Notice>
                The saved result changed while you were editing. Review the
                latest saved values before replacing them.
                <ExamButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void reload();
                  }}
                >
                  Load latest saved values
                </ExamButton>
              </Notice>
            )}
            {state.uncertain && (
              <Notice error>
                The write outcome is uncertain. Re-read the saved result before
                submitting another write.
                <ExamButton
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void reload();
                  }}
                >
                  Read and reconcile saved result
                </ExamButton>
              </Notice>
            )}
          </>
        )}
      </ui.Subscribe>
      <form.Field name="marks" mode="array">
        {(field) => (
          <div className="flex flex-col gap-4">
            {field.state.value.map((mode, index) => (
              <form.Field key={mode.slug} name={`marks[${index}].value`}>
                {(score) => (
                  <ExamInput
                    field={score}
                    label={`${names.modeNames[mode.slug] ?? mode.slug} · out of ${plan.modeConfig[mode.slug]?.maxMarks ?? '—'}`}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={!writable}
                  />
                )}
              </form.Field>
            ))}
            <Issues errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.marks}>
        {(marks) => {
          const valid = marks.every(
            (item) =>
              numericText.safeParse(item.value).success &&
              Number(item.value) >= 0 &&
              Number(item.value) <=
                (plan.modeConfig[item.slug]?.maxMarks ?? -1),
          );
          const total = marks.reduce(
            (sum, item) => sum + Number(item.value),
            0,
          );
          return (
            <p className="text-lg font-semibold">
              {valid
                ? `Total ${total} / ${plan.totalMarks} · ${Number(((total / plan.totalMarks) * 100).toFixed(2))}%`
                : 'Complete all assessment components to see a total.'}
            </p>
          );
        }}
      </form.Subscribe>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Additional assessments and attendance
        </summary>
        <div className="flex flex-col gap-4 pt-3">
          <form.Field name="grades" mode="array">
            {(field) => (
              <div className="flex flex-col gap-4">
                {field.state.value.map((grade, index) => (
                  <form.Field key={grade.slug} name={`grades[${index}].value`}>
                    {(input) => (
                      <ExamInput
                        field={input}
                        label={`${context.coScholasticAreas[grade.slug]?.name ?? `${grade.slug} (historical area)`} · optional grade`}
                        disabled={!writable}
                      />
                    )}
                  </form.Field>
                ))}
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.daysAttended}>
            {(daysAttended) =>
              (context.attendanceTracking.enabled || daysAttended !== '') && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {!context.attendanceTracking.enabled
                      ? 'Attendance tracking is now disabled. Explicitly clear the historical value or restore configuration before saving.'
                      : plan.totalWorkingDays === null
                        ? 'Working days are not configured. An exam administrator must configure them before attendance can be recorded.'
                        : `Attendance out of ${plan.totalWorkingDays} working days.`}
                  </p>
                  <form.Field name="daysAttended">
                    {(field) => (
                      <ExamInput
                        field={field}
                        label="Days attended (optional)"
                        inputMode="numeric"
                        disabled={
                          !writable ||
                          (plan.totalWorkingDays === null &&
                            field.state.value === '')
                        }
                      />
                    )}
                  </form.Field>
                </>
              )
            }
          </form.Subscribe>
        </div>
      </details>
      {canApprove !== true && (
        <Notice>
          Saved results need review by the assigned class teacher or a school
          exam administrator.
        </Notice>
      )}
      {current?.approved && (
        <Notice>
          Save for review clears approval. Save &amp; approve replaces the
          values and keeps the result approved.
        </Notice>
      )}
      <form.Subscribe
        selector={(state) => ({
          values: state.values,
          dirty: state.isDirty,
          errors: state.errors,
          submitting: state.isSubmitting,
          canSubmit: state.canSubmit,
          attempts: state.submissionAttempts,
        })}
      >
        {({ values, dirty, errors, submitting, canSubmit, attempts }) => (
          <>
            <DirtyGuard dirty={dirty} />
            <Issues errors={errors} />
            {attempts > 0 && (
              <Issues errors={schema.safeParse(values).error?.issues ?? []} />
            )}
            <ui.Subscribe selector={(state) => state.values.preview}>
              {(preview) =>
                preview && schema.safeParse(values).success ? (
                  <ResultSummary
                    plan={plan}
                    result={resultPayload(values)}
                    modeNames={names.modeNames}
                    areaNames={Object.fromEntries(
                      Object.entries(context.coScholasticAreas).map(
                        ([key, area]) => [key, area.name],
                      ),
                    )}
                    unsaved
                  />
                ) : null
              }
            </ui.Subscribe>
            <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-wrap gap-3">
                <ExamButton
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={async (event) => {
                    const element = event.currentTarget.form;
                    await form.validate('submit');
                    focusInvalidExamField(element);
                    const parsed = schema.safeParse(form.state.values);
                    if (parsed.success)
                      ui.setFieldValue('preview', !ui.getFieldValue('preview'));
                    else
                      form.setErrorMap({
                        onSubmit: {
                          form: parsed.error.issues
                            .map((issue) => issue.message)
                            .join(' '),
                          fields: {},
                        },
                      });
                  }}
                >
                  Preview
                </ExamButton>
                <ExamButton
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm(
                        'Discard unsaved student marks? Cancel to keep editing.',
                      )
                    )
                      onClose();
                  }}
                >
                  Back to saved preview
                </ExamButton>
              </div>
              <ui.Subscribe selector={(state) => state.values.uncertain}>
                {(uncertain) => (
                  <div className="flex flex-wrap gap-3">
                    <RequirePermissions permissions={savePermissions}>
                      <ExamButton
                        type="submit"
                        disabled={
                          !writable || !canSubmit || submitting || uncertain
                        }
                        onClick={() => form.setFieldValue('approved', false)}
                      >
                        {submitting
                          ? 'Saving…'
                          : current?.approved
                            ? 'Save for review'
                            : 'Save'}
                      </ExamButton>
                    </RequirePermissions>
                    <RequirePermissions
                      permissions={[...savePermissions, checks.approve]}
                    >
                      <ExamButton
                        type="submit"
                        disabled={
                          canApprove !== true ||
                          !writable ||
                          !canSubmit ||
                          submitting ||
                          uncertain
                        }
                        onClick={() => form.setFieldValue('approved', true)}
                      >
                        {submitting ? 'Saving…' : 'Save & approve'}
                      </ExamButton>
                    </RequirePermissions>
                  </div>
                )}
              </ui.Subscribe>
            </div>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}
