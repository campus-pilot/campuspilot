'use client';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { ExamSession, LoadingExam, ReadError, Notice } from './exam-common';
import { ExamClasses } from './exam-classes';
import { ExamPlanCreation } from './exam-plan-creation';
import { ExamTimetable } from './exam-timetable';
import { schoolPermission, type ExamScope } from './exam-model';

export function ExamResultsPage({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
      )}
    >
      <ExamSession scope={scope}>
        {(active) => <ResultsData scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function ResultsData({ scope, active }: { scope: ExamScope; active: boolean }) {
  const query = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  if (query.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data.planCount > 0 ? (
        <ExamClasses scope={scope} />
      ) : (
        <ExamPlanCreation
          scope={scope}
          active={active && !query.isError && !query.isFetching}
        />
      )}
    </div>
  );
}
export function ExamTimetablePage({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
      )}
    >
      <ExamSession scope={scope}>
        {(active) => <TimetableData scope={scope} active={active} />}
      </ExamSession>
    </RequirePermissions>
  );
}
function TimetableData({
  scope,
  active,
}: {
  scope: ExamScope;
  active: boolean;
}) {
  const context = useQuery(
    orpc.school.getExamContext.queryOptions({ input: scope }),
  );
  const overview = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  if (context.isPending || overview.isPending) return <LoadingExam />;
  if (!context.data || !overview.data)
    return (
      <ReadError
        error={context.error ?? overview.error}
        retry={() => Promise.all([context.refetch(), overview.refetch()])}
      />
    );
  if (!overview.data.planCount)
    return (
      <Notice>Create the examination plan before adding a timetable.</Notice>
    );
  return (
    <ExamTimetable
      scope={scope}
      context={context.data}
      active={active && !context.isError && !overview.isError}
    />
  );
}
