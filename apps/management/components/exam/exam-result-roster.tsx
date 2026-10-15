'use client';
import { toPlanScope, toResultScope } from './exam-model';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import type {
  ExamContextDto,
  ExamPlanDto,
  ExamResultDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  ExamFrame,
  ExamPager,
  ExamSelect,
  ExamSession,
  LoadingExam,
  Notice,
  ReadError,
} from './exam-common';
import {
  examHref,
  planLabels,
  planNames,
  schoolPermission,
  studentHref,
  type PlanRouteScope,
} from './exam-model';
import { PlanGovernance } from './exam-plans';

export function ExamResultRoster({ scope }: { scope: PlanRouteScope }) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      ].map((action) => schoolPermission(scope.schoolId, action))}
      fallback={<Notice>Plan and result access is unavailable.</Notice>}
    >
      <ExamSession
        scope={{ schoolId: scope.schoolId, sessionId: scope.sessionId }}
      >
        {(active) => <RosterWorkspace scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function RosterWorkspace({
  scope,
  active,
}: {
  scope: PlanRouteScope;
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
        back={{ href: examHref(scope, scope.examSlug), label: 'Exam plans' }}
      >
        <ReadError
          error={plan.error ?? context.error}
          retry={() => Promise.all([plan.refetch(), context.refetch()])}
        />
      </ExamFrame>
    );
  if (plan.data!.examSlug !== scope.examSlug)
    return (
      <Notice error>
        This plan does not belong to the requested exam. Return to the exam
        plans.
      </Notice>
    );
  const names = planNames(context.data!, plan.data!);
  return (
    <ExamFrame
      title={`${context.data!.exam.name} · ${names.subjectName}`}
      description={`${names.className} · ${planLabels[plan.data!.status]}`}
      back={{ href: examHref(scope, scope.examSlug), label: 'Exam plans' }}
    >
      {(plan.isError || context.isError) && (
        <ReadError
          error={plan.error ?? context.error}
          retry={() => Promise.all([plan.refetch(), context.refetch()])}
        />
      )}
      {plan.data!.status !== 'active' && (
        <Notice>
          {plan.data!.status === 'completed'
            ? 'Completed plan · All results are read-only.'
            : 'Marks entry is closed. The plan must be approved and opened first.'}
        </Notice>
      )}
      <PlanGovernance
        scope={scope}
        context={context.data!}
        plan={plan.data!}
        active={active && !plan.isError && !context.isError}
      />
      <RosterBrowser scope={scope} plan={plan.data!} context={context.data!} />
    </ExamFrame>
  );
}
function RosterBrowser({
  scope,
  plan,
  context,
}: {
  scope: PlanRouteScope;
  plan: ExamPlanDto;
  context: ExamContextDto;
}) {
  const form = useForm({
    defaultValues: {
      view: 'roster' as 'roster' | 'saved',
      page: 1,
      approval: '',
      sort: 'name' as 'name' | 'admissionNo' | 'rollNo',
    },
    validators: {
      onChange: z.object({
        view: z.enum(['roster', 'saved']),
        page: z.number().int().positive(),
        approval: z.enum(['', 'false', 'true']),
        sort: z.enum(['name', 'admissionNo', 'rollNo']),
      }),
    },
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="flex flex-col gap-4">
          <ExamSelect
            label="Students"
            value={values.view}
            onChange={(value) => {
              form.setFieldValue('view', value as typeof values.view);
              form.setFieldValue('page', 1);
            }}
          >
            <option value="roster">Current registered roster</option>
            <option value="saved">
              Saved results, including historical rows
            </option>
          </ExamSelect>
          {values.view === 'roster' ? (
            <>
              <ExamSelect
                label="Roster order"
                value={values.sort}
                onChange={(value) => {
                  form.setFieldValue('sort', value as typeof values.sort);
                  form.setFieldValue('page', 1);
                }}
              >
                <option value="name">Name</option>
                <option value="admissionNo">Admission number</option>
                <option value="rollNo">Roll number</option>
              </ExamSelect>
              <RosterPage
                scope={scope}
                plan={plan}
                page={values.page}
                sort={values.sort}
                onPage={(page) => form.setFieldValue('page', page)}
              />
            </>
          ) : (
            <>
              <ExamSelect
                label="Saved result status"
                value={values.approval}
                onChange={(value) => {
                  form.setFieldValue('approval', value);
                  form.setFieldValue('page', 1);
                }}
              >
                <option value="">All saved results</option>
                <option value="false">Awaiting review</option>
                <option value="true">Approved</option>
              </ExamSelect>
              <SavedPage
                scope={scope}
                plan={plan}
                page={values.page}
                approval={values.approval}
                onPage={(page) => form.setFieldValue('page', page)}
              />
            </>
          )}
        </div>
      )}
    </form.Subscribe>
  );
}
function RosterPage({
  scope,
  plan,
  page,
  sort,
  onPage,
}: {
  scope: PlanRouteScope;
  plan: ExamPlanDto;
  page: number;
  sort: 'name' | 'admissionNo' | 'rollNo';
  onPage: (page: number) => void;
}) {
  const query = useQuery(
    orpc.school.listExamRoster.queryOptions({
      placeholderData: keepPreviousData,
      input: {
        ...toPlanScope(scope),
        page,
        limit: 20,
        orderBy: { field: sort, direction: 'asc' },
      },
    }),
  );
  if (query.isPending) return <LoadingExam />;
  if (query.isError && !query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.isFetching && <Notice>Refreshing this list…</Notice>}
      {!query.data!.items.length && (
        <Notice>
          No registered students in this class/session. Historical saved results
          may still be available in the saved-results view.
        </Notice>
      )}
      {query.data!.items.map((row) => (
        <ResultCard
          key={row.studentId}
          scope={{ ...scope, studentId: row.studentId }}
          plan={plan}
          result={row.result}
          identity={
            <>
              <strong className="break-words">{row.name}</strong>
              <p className="break-words text-sm text-muted-foreground">
                Roll {row.rollNo ?? '—'} · Admission {row.admissionNo}
              </p>
            </>
          }
        />
      ))}
      <ExamPager
        page={query.data!.pagination.currentPage}
        disabled={query.isFetching}
        pages={query.data!.pagination.totalPages}
        total={query.data!.pagination.totalItems}
        onPage={onPage}
      />
    </>
  );
}
function SavedPage({
  scope,
  plan,
  page,
  approval,
  onPage,
}: {
  scope: PlanRouteScope;
  plan: ExamPlanDto;
  page: number;
  approval: string;
  onPage: (page: number) => void;
}) {
  const query = useQuery(
    orpc.school.listExamResults.queryOptions({
      placeholderData: keepPreviousData,
      input: {
        ...toPlanScope(scope),
        page,
        limit: 20,
        filters: {
          approved: approval === '' ? undefined : approval === 'true',
        },
        orderBy: { field: 'studentId', direction: 'asc' },
      },
    }),
  );
  if (query.isPending) return <LoadingExam />;
  if (query.isError && !query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <>
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.isFetching && <Notice>Refreshing this list…</Notice>}
      {!query.data!.items.length && (
        <Notice>No saved results match this selection.</Notice>
      )}
      {query.data!.items.map((result) => (
        <ResultCard
          key={result.studentId}
          scope={{ ...scope, studentId: result.studentId }}
          plan={plan}
          result={result}
          identity={
            <StudentIdentity
              scope={{ ...scope, studentId: result.studentId }}
            />
          }
        />
      ))}
      <ExamPager
        page={query.data!.pagination.currentPage}
        disabled={query.isFetching}
        pages={query.data!.pagination.totalPages}
        total={query.data!.pagination.totalItems}
        onPage={onPage}
      />
    </>
  );
}
function ResultCard({
  scope,
  plan,
  result,
  identity,
}: {
  scope: PlanRouteScope & { studentId: string };
  plan: ExamPlanDto;
  result: ExamResultDto | null;
  identity: React.ReactNode;
}) {
  const total = result
    ? Object.keys(plan.modeConfig).reduce(
        (sum, key) => sum + (result.marks[key] ?? 0),
        0,
      )
    : null;
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border p-4">
      {identity}
      <p className="text-sm">
        {result === null
          ? '○ Not entered'
          : result.approved
            ? '✓ Approved'
            : '◷ Awaiting review'}{' '}
        · {total === null ? '—' : `${total} / ${plan.totalMarks}`}
      </p>
      <Link
        className="flex min-h-11 items-center font-medium"
        href={studentHref(scope)}
      >
        View student result →
      </Link>
    </article>
  );
}
export function StudentIdentity({
  scope,
}: {
  scope: PlanRouteScope & { studentId: string };
}) {
  const cache = useQueryClient();
  const pages = cache.getQueriesData<{
    items: {
      studentId: string;
      name: string;
      admissionNo: string;
      rollNo: number | null;
    }[];
  }>({
    queryKey: orpc.school.listExamRoster.key({ input: toPlanScope(scope) }),
  });
  const known = pages
    .flatMap(([, data]) => data?.items ?? [])
    .find((row) => row.studentId === scope.studentId);
  if (known)
    return (
      <>
        <strong className="break-words">{known.name}</strong>
        <p className="break-words text-sm text-muted-foreground">
          Roll {known.rollNo ?? '—'} · Admission {known.admissionNo}
        </p>
      </>
    );
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_STUDENT,
      )}
      fallback={<p className="break-all text-sm">Student {scope.studentId}</p>}
    >
      <IdentityData scope={scope} />
    </RequirePermissions>
  );
}
function IdentityData({
  scope,
}: {
  scope: PlanRouteScope & { studentId: string };
}) {
  const query = useQuery(
    orpc.school.getStudent.queryOptions({
      input: {
        schoolId: scope.schoolId,
        sessionId: scope.sessionId,
        studentId: scope.studentId,
      },
    }),
  );
  if (query.isPending)
    return <p className="text-sm">Loading student identity…</p>;
  if (query.isError)
    return (
      <>
        <p className="break-all text-sm">Student {scope.studentId}</p>
        <ReadError error={query.error} retry={query.refetch} />
      </>
    );
  return (
    <>
      <strong className="break-words">{query.data.admission.name}</strong>
      <p className="break-words text-sm text-muted-foreground">
        Roll {query.data.rollNo ?? '—'} · Admission{' '}
        {query.data.admission.admissionNo}
      </p>
    </>
  );
}
