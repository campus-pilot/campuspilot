import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { SchoolUsageTabs } from '@/components/assistant-settings/usage-tabs';
import { FeaturePage } from '@/components/feature-unavailable';
import { PermissionDenied } from '@/components/permission-denied';
import { RequirePermissions } from '@/components/require-permissions';

/**
 * Settings › Usage. Its only tab today is AI usage, so the page needs the
 * assistant feature and permission to read its usage.
 */
export default async function UsageSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return (
    <FeaturePage feature="assistant">
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.READ_ASSISTANT_USAGE, resource: { kind: 'school', schoolId } }}
        fallback={<PermissionDenied description="You do not have permission to see the school's usage." />}
      >
        <SchoolUsageTabs schoolId={schoolId} />
      </RequirePermissions>
    </FeaturePage>
  );
}
