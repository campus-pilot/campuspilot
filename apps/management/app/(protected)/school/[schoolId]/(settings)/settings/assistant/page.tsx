import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AssistantRoleAccess } from '@/components/assistant-settings/assistant-role-access';
import { FeaturePage } from '@/components/feature-unavailable';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';

/** Which roles may use the AI assistant; only for schools with the assistant. */
export default async function AssistantSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return (
    <FeaturePage feature="assistant">
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.READ_ASSISTANT_ACCESS, resource: { kind: 'school', schoolId } }}
        fallback={<PermissionDenied description="You do not have permission to see who can use the AI assistant." />}
      >
        <AssistantRoleAccess schoolId={schoolId} />
      </RequirePermissions>
    </FeaturePage>
  );
}
