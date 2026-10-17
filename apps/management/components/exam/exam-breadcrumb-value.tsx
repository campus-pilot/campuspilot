'use client';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { schoolPermission, type ExamScope } from './exam-model';

export function ExamBreadcrumbValue({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS)}
      fallback={<>Examination</>}
    >
      <ExamName scope={scope} />
    </RequirePermissions>
  );
}
function ExamName({ scope }: { scope: ExamScope }) {
  const query = useQuery(orpc.school.getExam.queryOptions({ input: scope }));
  return <>{query.data?.name ?? 'Examination'}</>;
}

export function ExamClassBreadcrumbValue({
  scope,
}: {
  scope: ExamScope & { classId: string };
}) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
      )}
      fallback={<>Class</>}
    >
      <ClassName scope={scope} />
    </RequirePermissions>
  );
}
function ClassName({ scope }: { scope: ExamScope & { classId: string } }) {
  const query = useQuery(
    orpc.school.listExamClasses.queryOptions({
      input: { ...scope, filters: { classId: scope.classId } },
    }),
  );
  return <>{query.data?.items[0]?.label ?? 'Class'}</>;
}
export function ExamStudentBreadcrumbValue({
  scope,
}: {
  scope: ExamScope & { classId: string; studentId: string };
}) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      )}
      fallback={<>Student</>}
    >
      <StudentName scope={scope} />
    </RequirePermissions>
  );
}
function StudentName({
  scope,
}: {
  scope: ExamScope & { classId: string; studentId: string };
}) {
  const query = useQuery(
    orpc.school.getStudentExam.queryOptions({ input: scope }),
  );
  return <>{query.data?.student.name ?? 'Student'}</>;
}
