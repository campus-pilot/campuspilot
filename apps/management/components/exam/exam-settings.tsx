'use client';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useSchoolFeature } from '@/components/require-feature';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { LoadingExam, Notice, ReadError } from './exam-common';
import { ExamActions } from './exam-lifecycle';
import { ExamClassesSection } from './exam-class-settings';
import { schoolPermission, type ExamScope } from './exam-model';
import { NotificationDeliveryLogSection } from '@/components/notifications/notification-delivery-log';

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
  // Attendance and result notifications belong to student management; without it they are neither read nor shown.
  const studentManagementFeature = useSchoolFeature(scope.schoolId, 'studentManagement');
  const studentManagement = studentManagementFeature.enabled;
  const settings = useQuery({
    ...orpc.school.getExamAssessmentSettings.queryOptions({ input: scope }),
    enabled: studentManagement,
  });
  if (studentManagementFeature.status === 'pending' || session.isPending || overview.isPending || context.isPending || (studentManagement && settings.isPending))
    return placement === 'navbar' ? null : <LoadingExam />;
  if (!session.data || !overview.data || !context.data || (studentManagement && !settings.data))
    return placement === 'navbar' ? null : <ReadError
      error={session.error ?? overview.error ?? context.error ?? settings.error}
      retry={() => Promise.all([session.refetch(), overview.refetch(), context.refetch(), ...(studentManagement ? [settings.refetch()] : [])])} />;
  const controls = <ExamActions scope={scope}
    active={session.data.isActive && !session.isError && !overview.isError && !context.isError && !(studentManagement && settings.isError)}
    overview={overview.data} attendanceEnabled={context.data.attendanceTracking.enabled}
    studentManagement={studentManagement}
    totalWorkingDays={settings.data?.totalWorkingDays ?? null} placement={placement} />;
  return placement === 'navbar' ? controls : (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Settings</h2>
      {!session.data.isActive && <Notice>Historical session · Read-only</Notice>}
      <ExamClassesSection scope={scope}
        active={session.data.isActive && !session.isError && !overview.isError && !context.isError}
        overview={overview.data} context={context.data} />
      {controls}
      {studentManagement ? (
        <NotificationDeliveryLogSection
          schoolId={scope.schoolId}
          scope={{ kind: 'exam', sessionId: scope.sessionId, examSlug: scope.examSlug }}
          title="Result notifications"
        />
      ) : null}
    </div>
  );
}
