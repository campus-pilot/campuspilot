import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ClassroomList } from '@/components/classroom-list';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';

export default async function ClassroomPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.LIST_CLASSES,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have permission to view classrooms in this school." />
      }
    >
      <ClassroomList schoolId={schoolId} sessionId={sessionId} />
    </RequirePermissions>
  );
}
