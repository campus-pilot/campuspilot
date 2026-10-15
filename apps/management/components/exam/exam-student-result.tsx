'use client';
import { toPlanScope, toResultScope } from './exam-model';
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
  ExamButton,
  ExamFrame,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import {
  examHref,
  errorCode,
  planHref,
  planLabels,
  planNames,
  schoolPermission,
  type StudentRouteScope,
} from './exam-model';
import { StudentIdentity } from './exam-result-roster';
import { ExamStudentResultForm } from './exam-student-result-form';
import { ResultReviewActions } from './exam-result-review-actions';

export function ExamStudentResult({ scope }: { scope: StudentRouteScope }) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      ].map((action) => schoolPermission(scope.schoolId, action))}
      fallback={<Notice>Student result access is unavailable.</Notice>}
    >
      <ExamSession
        scope={{ schoolId: scope.schoolId, sessionId: scope.sessionId }}
      >
        {(active) => <StudentWorkspace scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function StudentWorkspace({
  scope,
  active,
}: {
  scope: StudentRouteScope;
  active: boolean;
}) {
  const plan = useQuery(
    orpc.school.getExamPlan.queryOptions({ input: toPlanScope(scope) }),
  );
  const context = useQuery(
    orpc.school.getExamContext.queryOptions({
      input: {
        schoolId: scope.schoolId,
        sessionId: scope.sessionId,
        examSlug: scope.examSlug,
      },
    }),
  );
  if (plan.isPending || context.isPending) return <LoadingExam />;
  if ((plan.isError && !plan.data) || (context.isError && !context.data))
    return (
      <ExamFrame
        title="Assessment unavailable"
        description="The plan could not be loaded."
        back={{ href: planHref(scope), label: 'Result roster' }}
      >
        <ReadError
          error={plan.error ?? context.error}
          retry={() => Promise.all([plan.refetch(), context.refetch()])}
        />
      </ExamFrame>
    );
  if (plan.data!.examSlug !== scope.examSlug)
    return (
      <ExamFrame
        title="Plan not found in this exam"
        description="Check the requested exam and plan."
        back={{ href: examHref(scope, scope.examSlug), label: 'Exam plans' }}
      >
        <Notice error>This plan does not belong to the requested exam.</Notice>
      </ExamFrame>
    );
  const names = planNames(context.data!, plan.data!);
  return (
    <ExamFrame
      title={`${context.data!.exam.name} · ${names.subjectName}`}
      description={`${names.className} · ${planLabels[plan.data!.status]}`}
      back={{ href: planHref(scope), label: 'Result roster' }}
    >
      {(plan.isError || context.isError) && (
        <ReadError
          error={plan.error ?? context.error}
          retry={() => Promise.all([plan.refetch(), context.refetch()])}
        />
      )}
      <StudentData
        scope={scope}
        plan={plan.data!}
        context={context.data!}
        active={active && !plan.isError && !context.isError}
      />
    </ExamFrame>
  );
}
function StudentData({
  scope,
  plan,
  context,
  active,
}: {
  scope: StudentRouteScope;
  plan: ExamPlanDto;
  context: ExamContextDto;
  active: boolean;
}) {
  const result = useQuery(
    orpc.school.getExamResult.queryOptions({
      input: toResultScope(scope),
      retry: false,
    }),
  );
  if (result.isPending) return <LoadingExam />;
  const missing = result.isError && errorCode(result.error) === 'NOT_FOUND';
  if (result.isError && !missing && !result.data)
    return <ReadError error={result.error} retry={result.refetch} />;
  return (
    <>
      {result.isError && !missing && (
        <ReadError error={result.error} retry={result.refetch} />
      )}
      <StudentResultPanel
        scope={scope}
        plan={plan}
        context={context}
        active={active && (!result.isError || missing)}
        result={missing ? null : (result.data ?? null)}
      />
    </>
  );
}
function StudentResultPanel({
  scope,
  plan,
  context,
  result,
  active,
}: {
  scope: StudentRouteScope;
  plan: ExamPlanDto;
  context: ExamContextDto;
  result: ExamResultDto | null;
  active: boolean;
}) {
  const form = useForm({
    defaultValues: { editing: false, baseline: null as ExamResultDto | null },
    validators: {
      onChange: z.object({
        editing: z.boolean(),
        baseline: z.custom<ExamResultDto | null>(),
      }),
    },
  });
  const names = planNames(context, plan);
  const writePermissions = [
    schoolPermission(scope.schoolId, SCHOOL_ACTIONS.WRITE_EXAM_RESULTS),
    ...(result?.approved
      ? [schoolPermission(scope.schoolId, SCHOOL_ACTIONS.REVISE_EXAM_RESULTS)]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <StudentIdentity scope={scope} />
      {(!active || plan.status !== 'active') && (
        <Notice>
          {!active
            ? 'Session is read-only.'
            : plan.status === 'completed'
              ? 'Completed plan · Results are read-only.'
              : 'Marks entry is closed for this plan.'}
        </Notice>
      )}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <>
            {values.editing ? (
              <ExamStudentResultForm
                scope={scope}
                plan={plan}
                context={context}
                initial={values.baseline}
                current={result}
                active={active && plan.status === 'active'}
                onClose={() => form.setFieldValue('editing', false)}
              />
            ) : (
              <>
                {result ? (
                  <ResultSummary
                    plan={plan}
                    result={result}
                    modeNames={names.modeNames}
                    areaNames={Object.fromEntries(
                      Object.entries(context.coScholasticAreas).map(
                        ([key, area]) => [key, area.name],
                      ),
                    )}
                  />
                ) : (
                  <MissingStudent scope={scope} />
                )}
                {active && plan.status === 'active' && (
                  <RequirePermissions permissions={writePermissions}>
                    <CurrentEnrollment scope={scope}>
                      {(registered) =>
                        registered ? (
                          <ExamButton
                            onClick={() => {
                              form.setFieldValue('baseline', result);
                              form.setFieldValue('editing', true);
                            }}
                          >
                            {result?.approved
                              ? 'Correct approved result'
                              : result
                                ? 'Edit marks'
                                : 'Enter marks'}
                          </ExamButton>
                        ) : (
                          <Notice>
                            This student is not in the current registered
                            roster. Saved historical results remain available
                            for preview and review.
                          </Notice>
                        )
                      }
                    </CurrentEnrollment>
                  </RequirePermissions>
                )}
                {result && (
                  <ResultReviewActions
                    scope={scope}
                    plan={plan}
                    result={result}
                    active={active}
                  />
                )}
              </>
            )}
          </>
        )}
      </form.Subscribe>
    </div>
  );
}
/** A missing saved row is only “Not entered” after enrollment in the requested plan roster is established. */
function MissingStudent({ scope }: { scope: StudentRouteScope }) {
  return (
    <CurrentEnrollment scope={scope}>
      {(registered) => (
        <Notice error={!registered}>
          {registered
            ? 'Result not entered'
            : 'No saved result or registered student was found for this plan. Check the route or return to the roster.'}
        </Notice>
      )}
    </CurrentEnrollment>
  );
}
function CurrentEnrollment({
  scope,
  children,
}: {
  scope: StudentRouteScope;
  children: (registered: boolean) => React.ReactNode;
}) {
  const query = useQuery({
    queryKey: [
      ...orpc.school.listExamRoster.key({
        input: {
          schoolId: scope.schoolId,
          sessionId: scope.sessionId,
          classId: scope.classId,
          examPlanId: scope.examPlanId,
        },
      }),
      'enrollment',
      scope.studentId,
    ],
    queryFn: async () => {
      for (let page = 1; ; page++) {
        const response = await client.school.listExamRoster({
          schoolId: scope.schoolId,
          sessionId: scope.sessionId,
          classId: scope.classId,
          examPlanId: scope.examPlanId,
          page,
          limit: 20,
        });
        if (response.items.some((row) => row.studentId === scope.studentId))
          return true;
        if (page >= response.pagination.totalPages) return false;
      }
    },
  });
  if (query.isPending) return <Notice>Checking registered enrollment…</Notice>;
  if (query.isError)
    return <ReadError error={query.error} retry={query.refetch} />;
  return children(query.data);
}
