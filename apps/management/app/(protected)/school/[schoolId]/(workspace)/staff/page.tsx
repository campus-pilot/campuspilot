import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';
import { StaffTable } from '@/components/staff-table';

export default async function StaffPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.LIST_MEMBERS,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have the required permission to view school staff." />
      }
    >
      <StaffTable schoolId={schoolId} />
    </RequirePermissions>
  );
}
