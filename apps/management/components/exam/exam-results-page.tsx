'use client';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { redirect } from 'next/navigation';
import { FeaturePage } from '@/components/feature-unavailable';
import { useSchoolFeature } from '@/components/require-feature';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { ExamSession, LoadingExam, ReadError, Notice } from './exam-common';
import { ExamClasses } from './exam-classes';
import { ExamPlanCreation } from './exam-plan-creation';
import { ExamTimetable } from './exam-timetable';
import { examHref, schoolPermission, type ExamScope } from './exam-model';

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
/** Replaces the Results address with the exam's root, which redirects to the school's default section. */
function ExamRootRedirect({ scope }: { scope: ExamScope }): null {
  redirect(examHref(scope, scope.examSlug));
}

function ResultsData({ scope, active }: { scope: ExamScope; active: boolean }) {
  const query = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  const studentManagement = useSchoolFeature(scope.schoolId, 'studentManagement');
  if (query.isPending) return <LoadingExam />;
  if (!query.data)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data.planCount > 0 ? (
        studentManagement.status === 'ready' && !studentManagement.enabled ? (
          // No results here: the exam's root opens what the school has (its
          // papers or lifecycle), also for the exam's breadcrumb, which links here.
          <ExamRootRedirect scope={scope} />
        ) : (
          // The classes' students and results belong to student management;
          // plan creation (below) does not, so this route stays for every school.
          <FeaturePage feature="studentManagement">
            <ExamClasses scope={scope} />
          </FeaturePage>
        )
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
