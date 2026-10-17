'use client';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { LoadingExam, Notice, ReadError } from './exam-common';
import { ExamActions } from './exam-lifecycle';
import { schoolPermission, type ExamScope } from './exam-model';

export function ExamSettings({ scope, placement = 'settings' }: {
  scope: ExamScope; placement?: 'settings' | 'navbar';
}) {
  return (
    <RequirePermissions permissions={[
      schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAM_PLANS),
      schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS),
      schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_SESSION),
    ]}>
      <SettingsData scope={scope} placement={placement} />
    </RequirePermissions>
  );
}

function SettingsData({ scope, placement }: {
  scope: ExamScope; placement: 'settings' | 'navbar';
}) {
  const session = useQuery(orpc.school.getSession.queryOptions({ input: scope }));
  const overview = useQuery(orpc.school.getExamOverview.queryOptions({ input: scope }));
  const context = useQuery(orpc.school.getExamContext.queryOptions({ input: scope }));
  const settings = useQuery(orpc.school.getExamAssessmentSettings.queryOptions({ input: scope }));
  if (session.isPending || overview.isPending || context.isPending || settings.isPending)
    return placement === 'navbar' ? null : <LoadingExam />;
  if (!session.data || !overview.data || !context.data || !settings.data)
    return placement === 'navbar' ? null : <ReadError
      error={session.error ?? overview.error ?? context.error ?? settings.error}
      retry={() => Promise.all([session.refetch(), overview.refetch(), context.refetch(), settings.refetch()])} />;
  const controls = <ExamActions scope={scope}
    active={session.data.isActive && !session.isError && !overview.isError && !context.isError && !settings.isError}
    overview={overview.data} attendanceEnabled={context.data.attendanceTracking.enabled}
    totalWorkingDays={settings.data.totalWorkingDays} placement={placement} />;
  return placement === 'navbar' ? controls : (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      {!session.data.isActive && <Notice>Historical session · Read-only</Notice>}
      {controls}
    </div>
  );
}
