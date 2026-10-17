'use client';
import { TimetablePreview } from '@campuspilot/components/exam/timetable-preview';
import { toast } from '@campuspilot/ui/lib/toast';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  ExamButton,
  LoadingExam,
  Notice,
  ReadError,
  useExamCache,
} from './exam-common';
import { errorMessage, schoolPermission, type ExamScope } from './exam-model';
import { ExamCommand } from './exam-command';

import { TimetableEditor } from './exam-timetable-editor';

type Config = z.infer<typeof saveExamTimetableInputSchema>['config'];

export function ExamTimetableNavbarAction({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
        SCHOOL_ACTIONS.READ_SESSION,
        SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE,
      ].map((action) => schoolPermission(scope.schoolId, action))}
    >
      <TimetableNavbarData scope={scope} />
    </RequirePermissions>
  );
}

function TimetableNavbarData({ scope }: { scope: ExamScope }) {
  const session = useQuery(
    orpc.school.getSession.queryOptions({ input: scope }),
  );
  const context = useQuery(
    orpc.school.getExamContext.queryOptions({ input: scope }),
  );
  const overview = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  if (
    !session.data ||
    !context.data ||
    !overview.data ||
    session.isError ||
    context.isError ||
    overview.isError ||
    !overview.data.planCount
  )
    return null;
  return (
    <TimetableActions
      scope={scope}
      context={context.data}
      active={session.data.isActive}
      placement="navbar"
    />
  );
}

export function ExamTimetable({
  scope,
  context,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
}) {
  const query = useQuery(
    orpc.school.getExamTimetable.queryOptions({ input: scope }),
  );
  if (query.isPending) return <LoadingExam />;
  if (query.isError && query.data === undefined)
    return <ReadError error={query.error} retry={query.refetch} />;
  const actions = (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
      )}
      fallback={
        <Notice>
          Plan status is unavailable. Timetable editing is closed.
        </Notice>
      }
    >
      <TimetableActions
        scope={scope}
        context={context}
        active={active && !query.isError}
      />
    </RequirePermissions>
  );
  return (
    <div className="flex flex-col gap-4">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data == null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No timetable yet</EmptyTitle>
          </EmptyHeader>
          {actions}
        </Empty>
      ) : (
        <>
          {actions}
          <TimetablePreview
            config={query.data.config}
            classes={context.classes}
          />
        </>
      )}
    </div>
  );
}
function TimetableActions({
  scope,
  context,
  active,
  placement = 'page',
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
  placement?: 'page' | 'navbar';
}) {
  const completed = useQuery(
    orpc.school.listExamPlans.queryOptions({
      input: { ...scope, page: 1, limit: 1, filters: { status: 'completed' } },
    }),
  );
  const timetable = useQuery(
    orpc.school.getExamTimetable.queryOptions({ input: scope }),
  );
  const queries = useExamCache();
  const form = useForm({
    defaultValues: {
      editing: false,
      baseline: null as Config | null,
      version: '',
      editorKey: 0,
      error: '',
    },
    validators: {
      onChange: z.object({
        editing: z.boolean(),
        baseline: saveExamTimetableInputSchema.shape.config.nullable(),
        version: z.string(),
        editorKey: z.number(),
        error: z.string(),
      }),
    },
  });
  const editable =
    active &&
    !completed.isPending &&
    !completed.isFetching &&
    !completed.isError &&
    completed.data.pagination.totalItems === 0 &&
    !timetable.isError;
  const open = async () => {
    const result = await timetable.refetch();
    if (result.isError) {
      form.setFieldValue('error', errorMessage(result.error));
      if (placement === 'navbar') toast.error(errorMessage(result.error));
      return;
    }
    form.setFieldValue('error', '');
    form.setFieldValue(
      'baseline',
      result.data?.config ?? {
        columns: context.classes.map((item) => item.id),
        rows: [],
      },
    );
    form.setFieldValue('version', result.data?.updatedAt?.toISOString() ?? '');
    form.setFieldValue('editorKey', form.getFieldValue('editorKey') + 1);
    form.setFieldValue('editing', true);
  };
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <>
          {placement === 'page' && completed.isError && (
            <ReadError error={completed.error} retry={completed.refetch} />
          )}
          {placement === 'page' &&
            !editable &&
            !completed.isPending &&
            !completed.isFetching && (
              <Notice>
                {completed.data?.pagination.totalItems
                  ? 'The examination is completed. Reopen result entry to edit the timetable.'
                  : 'Timetable is read-only.'}
              </Notice>
            )}
          <RequirePermissions
            permissions={schoolPermission(
              scope.schoolId,
              SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE,
            )}
          >
            {values.editing && values.baseline ? (
              <TimetableEditor
                key={values.editorKey}
                scope={scope}
                context={context}
                initial={values.baseline}
                editable={editable}
                newer={
                  values.version !==
                  (timetable.data?.updatedAt?.toISOString() ?? '')
                }
                onReload={open}
                onClose={() => form.setFieldValue('editing', false)}
              />
            ) : editable ? (
              <ExamButton
                size={
                  placement === 'page' && !timetable.data ? 'sm' : 'default'
                }
                onClick={() => {
                  void open();
                }}
              >
                {timetable.data ? 'Edit timetable' : 'Create timetable'}
              </ExamButton>
            ) : null}
          </RequirePermissions>
          {placement === 'page' && values.error && (
            <Notice error>{values.error}</Notice>
          )}
          {placement === 'page' &&
            editable &&
            timetable.data &&
            !values.editing && (
              <ExamCommand
                permissions={schoolPermission(
                  scope.schoolId,
                  SCHOOL_ACTIONS.DELETE_EXAM_TIMETABLE,
                )}
                label="Delete shared timetable"
                destructive
                explanation={`Delete the entire ${context.exam.name} timetable, including every class and slot?`}
                run={async () => {
                  await client.school.deleteExamTimetable(scope);
                  queries.cache.setQueryData(
                    orpc.school.getExamTimetable.queryKey({ input: scope }),
                    null,
                  );
                }}
                onFailure={async () => {
                  await timetable.refetch();
                }}
              />
            )}
        </>
      )}
    </form.Subscribe>
  );
}
