import type { ReactNode } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ClassroomWorkspace } from '@/components/classroom-workspace';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';

export default async function ClassroomLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, sessionId, classId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_CLASS,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have permission to open this classroom." />
      }
    >
      <ClassroomWorkspace
        schoolId={schoolId}
        sessionId={sessionId}
        classId={classId}
      >
        {children}
      </ClassroomWorkspace>
    </RequirePermissions>
  );
}
