import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';
import { SessionDetail } from '@/components/session/session-detail';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_SESSION,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have the required permission to view this academic session." />
      }
    >
      <SessionDetail schoolId={schoolId} sessionId={sessionId} />
    </RequirePermissions>
  );
}
