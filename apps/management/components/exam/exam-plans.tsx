'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { confirmNavigation } from '@/lib/navigation-guard';
import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  examPlanDtoSchema,
  type ExamContextDto,
  type ExamPlanDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  ExamButton,
  ExamPager,
  ExamSelect,
  LoadingExam,
  Notice,
  ReadError,
  useExamCache,
} from './exam-common';
import {
  examHref,
  nextTransition,
  planHref,
  planLabels,
  planNames,
  schoolPermission,
  type ExamScope,
} from './exam-model';
import { ExamCommand } from './exam-command';
import { ExamPlanForm } from './exam-plan-form';

export function ExamPlans({
  scope,
  context,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
}) {
  const form = useForm({
    defaultValues: {
      classId: '',
      status: '' as '' | ExamPlanDto['status'],
      page: 1,
      creating: false,
      editingPlan: null as ExamPlanDto | null,
    },
    validators: {
      onChange: z.object({
        classId: z.string(),
        status: z.enum(['', 'draft', 'approved', 'active', 'completed']),
        page: z.number().int().positive(),
        creating: z.boolean(),
        editingPlan: examPlanDtoSchema.nullable(),
      }),
    },
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="flex flex-col gap-4">
          {(active || values.creating) && (
            <RequirePermissions
              permissions={schoolPermission(
                scope.schoolId,
                SCHOOL_ACTIONS.CREATE_EXAM_PLAN,
              )}
            >
              {values.creating ? (
                <ExamPlanForm
                  scope={scope}
                  context={context}
                  active={active}
                  onClose={() => form.setFieldValue('creating', false)}
                />
              ) : (
                <ExamButton
                  className="self-start"
                  onClick={() => {
                    if (!confirmNavigation()) return;
                    form.setFieldValue('editingPlan', null);
                    form.setFieldValue('creating', true);
                  }}
                >
                  Create plan
                </ExamButton>
              )}
            </RequirePermissions>
          )}
          {values.editingPlan && (
            <RequirePermissions
              permissions={schoolPermission(
                scope.schoolId,
                SCHOOL_ACTIONS.UPDATE_EXAM_PLAN,
              )}
            >
              <PlanEditorPanel
                key={values.editingPlan.id}
                scope={scope}
                context={context}
                initial={values.editingPlan}
                active={active}
                onClose={() => form.setFieldValue('editingPlan', null)}
              />
            </RequirePermissions>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <ExamSelect
              label="Class"
              value={values.classId}
              onChange={(value) => {
                form.setFieldValue('classId', value);
                form.setFieldValue('page', 1);
              }}
            >
              <option value="">All classes</option>
              {context.classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </ExamSelect>
            <ExamSelect
              label="Plan state"
              value={values.status}
              onChange={(value) => {
                form.setFieldValue('status', value as typeof values.status);
                form.setFieldValue('page', 1);
              }}
            >
              <option value="">All states</option>
              {Object.entries(planLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </ExamSelect>
          </div>
          <PlanPage
            scope={scope}
            context={context}
            active={active}
            page={values.page}
            classId={values.classId}
            status={values.status}
            onPage={(page) => form.setFieldValue('page', page)}
            editingPlanId={values.editingPlan?.id}
            onEdit={(plan) => {
              if (!confirmNavigation()) return;
              form.setFieldValue('creating', false);
              form.setFieldValue('editingPlan', plan);
            }}
          />
        </div>
      )}
    </form.Subscribe>
  );
}
function PlanPage({
  scope,
  context,
  active,
  page,
  classId,
  status,
  onPage,
  onEdit,
  editingPlanId,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
  page: number;
  classId: string;
  status: '' | ExamPlanDto['status'];
  onPage: (page: number) => void;
  onEdit: (plan: ExamPlanDto) => void;
  editingPlanId?: string;
}) {
  const query = useQuery(
    orpc.school.listExamPlans.queryOptions({
      placeholderData: keepPreviousData,
      input: {
        ...scope,
        page,
        limit: 20,
        filters: { classId: classId || undefined, status: status || undefined },
        orderBy: { field: 'classId', direction: 'asc' },
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
        <Notice>No assessment plans match this selection.</Notice>
      )}
      {query.data!.items.map((plan) => (
        <PlanCard
          key={plan.id}
          scope={scope}
          plan={plan}
          context={context}
          active={
            active &&
            !query.isError &&
            !query.isPlaceholderData &&
            plan.id !== editingPlanId
          }
          onEdit={onEdit}
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
function PlanCard({
  scope,
  context,
  plan,
  active,
  onEdit,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  plan: ExamPlanDto;
  active: boolean;
  onEdit: (plan: ExamPlanDto) => void;
}) {
  const names = planNames(context, plan);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
      <h3 className="break-words text-lg font-semibold">
        {names.className} · {names.subjectName}
      </h3>
      <Badge className="w-fit" variant="outline">
        {planLabels[plan.status]}
      </Badge>
      <p className="break-words text-sm">
        {plan.totalMarks} marks ·{' '}
        {Object.entries(plan.modeConfig)
          .map(
            ([slug, mode]) =>
              `${names.modeNames[slug] ?? slug}: ${mode.maxMarks} (${mode.percentage}%)`,
          )
          .join(' · ')}
      </p>
      {plan.totalWorkingDays !== null && (
        <p className="text-sm">{plan.totalWorkingDays} working days</p>
      )}
      <RequirePermissions
        permissions={schoolPermission(
          scope.schoolId,
          SCHOOL_ACTIONS.READ_EXAM_RESULTS,
        )}
      >
        <ExamButton asChild>
          <Link
            href={planHref({
              ...scope,
              classId: plan.classId,
              examPlanId: plan.id,
            })}
          >
            View results
          </Link>
        </ExamButton>
      </RequirePermissions>
      <PlanGovernance
        scope={scope}
        context={context}
        plan={plan}
        active={active}
        onEdit={onEdit}
      />
    </article>
  );
}
export function PlanGovernance({
  scope,
  context,
  plan,
  active,
  onEdit,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  plan: ExamPlanDto;
  active: boolean;
  onEdit?: (plan: ExamPlanDto) => void;
}) {
  const queries = useExamCache();
  const router = useRouter();
  const form = useForm({
    defaultValues: { editing: false },
    validators: { onChange: z.object({ editing: z.boolean() }) },
  });
  const planScope = {
    schoolId: scope.schoolId,
    sessionId: scope.sessionId,
    classId: plan.classId,
    examPlanId: plan.id,
  };
  const next = nextTransition[plan.status];
  const names = planNames(context, plan);
  const editable = ['draft', 'approved'].includes(plan.status);
  const refresh = async () => {
    await Promise.all([
      queries.plans(scope),
      queries.results(planScope),
      queries.cache.invalidateQueries({
        queryKey: orpc.school.getExamPlan.key({ input: planScope }),
      }),
      queries.cache.invalidateQueries({
        queryKey: orpc.school.getSession.key({
          input: { schoolId: scope.schoolId, sessionId: scope.sessionId },
        }),
      }),
    ]);
  };
  return (
    <form.Subscribe selector={(state) => state.values.editing}>
      {(editing) => (
        <div className="flex flex-col gap-3">
          {editing ? (
            <RequirePermissions
              permissions={schoolPermission(
                scope.schoolId,
                SCHOOL_ACTIONS.UPDATE_EXAM_PLAN,
              )}
            >
              <ExamPlanForm
                scope={scope}
                context={context}
                plan={plan}
                active={active && editable}
                onClose={() => form.setFieldValue('editing', false)}
              />
            </RequirePermissions>
          ) : (
            active && (
              <>
                <ExamCommand
                  permissions={schoolPermission(
                    scope.schoolId,
                    SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN,
                  )}
                  label={next.label}
                  explanation={`${names.className} · ${names.subjectName}. Total ${plan.totalMarks} marks; ${Object.entries(
                    plan.modeConfig,
                  )
                    .map(
                      ([slug, mode]) =>
                        `${names.modeNames[slug] ?? slug}: ${mode.maxMarks} marks (${mode.percentage}%)`,
                    )
                    .join(', ')}. ${next.explanation}`}
                  onFailure={refresh}
                  run={async () => {
                    const saved = await client.school.transitionExamPlan({
                      ...planScope,
                      status: next.status,
                    });
                    queries.cache.setQueryData(
                      orpc.school.getExamPlan.queryKey({ input: planScope }),
                      saved,
                    );
                    await refresh();
                  }}
                />
                {editable && (
                  <>
                    <RequirePermissions
                      permissions={schoolPermission(
                        scope.schoolId,
                        SCHOOL_ACTIONS.UPDATE_EXAM_PLAN,
                      )}
                    >
                      <ExamButton
                        variant="outline"
                        onClick={() => {
                          if (onEdit) onEdit(plan);
                          else form.setFieldValue('editing', true);
                        }}
                      >
                        Edit plan
                      </ExamButton>
                    </RequirePermissions>
                    <ExamCommand
                      permissions={schoolPermission(
                        scope.schoolId,
                        SCHOOL_ACTIONS.DELETE_EXAM_PLAN,
                      )}
                      label="Delete plan"
                      explanation={`Remove ${names.className} · ${names.subjectName} from ${context.exam.name}?`}
                      destructive
                      onFailure={refresh}
                      run={async () => {
                        await client.school.deleteExamPlan(planScope);
                        queries.cache.removeQueries({
                          queryKey: orpc.school.getExamPlan.key({
                            input: planScope,
                          }),
                        });
                        queries.cache.removeQueries({
                          queryKey: orpc.school.getExamResult.key({
                            input: planScope,
                          }),
                        });
                        await queries.plans(scope);
                        router.push(examHref(scope, scope.examSlug));
                      }}
                    />
                  </>
                )}
              </>
            )
          )}
        </div>
      )}
    </form.Subscribe>
  );
}

/** A plan editor has an entity lifecycle independent of the filtered list. Refetches update guards while retaining the mounted form. */
function PlanEditorPanel({
  scope,
  context,
  initial,
  active,
  onClose,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  initial: ExamPlanDto;
  active: boolean;
  onClose: () => void;
}) {
  const planScope = {
    schoolId: scope.schoolId,
    sessionId: scope.sessionId,
    classId: initial.classId,
    examPlanId: initial.id,
  };
  const query = useQuery(
    orpc.school.getExamPlan.queryOptions({ input: planScope }),
  );
  const belongs = query.data?.examSlug === scope.examSlug;
  const plan = belongs ? query.data! : initial;
  return (
    <div className="flex flex-col gap-3">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data && !belongs && (
        <Notice error>
          This plan does not belong to the requested exam. Entry is closed.
        </Notice>
      )}
      <ExamPlanForm
        scope={scope}
        context={context}
        plan={plan}
        active={
          active &&
          belongs &&
          !query.isError &&
          !query.isPending &&
          !query.isFetching &&
          ['draft', 'approved'].includes(plan.status)
        }
        onClose={onClose}
      />
    </div>
  );
}
