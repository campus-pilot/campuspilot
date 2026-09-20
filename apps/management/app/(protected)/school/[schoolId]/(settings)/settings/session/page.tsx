import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';
import { SessionSettings } from '@/components/session-settings';

export default async function SessionSettingsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.LIST_SESSIONS,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have the required permission to view academic sessions." />
      }
    >
      <SessionSettings schoolId={schoolId} />
    </RequirePermissions>
  );
}
