import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionTable } from '@/components/admission-table';
import { RequirePermissions } from '@/components/require-permissions';

export default async function AdmissionPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <RequirePermissions permissions={[
    { action: SCHOOL_ACTIONS.LIST_ADMISSIONS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SESSIONS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
  ]} fallback={<p className="text-sm text-muted-foreground">You do not have access to admissions.</p>}><AdmissionTable schoolId={schoolId} /></RequirePermissions>;
}
