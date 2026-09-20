import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';
import { SchoolSettings } from '@/components/school-settings';

export default async function SchoolSettingsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_DETAILS,
        resource: { kind: 'school', schoolId },
      }}
      fallback={
        <PermissionDenied description="You do not have the required permission to view school settings." />
      }
    >
      <SchoolSettings schoolId={schoolId} />
    </RequirePermissions>
  );
}
