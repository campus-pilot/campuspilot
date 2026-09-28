import { AdmissionDetails } from '@/components/admission-details';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';

export default async function AdmissionDetailsPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  return <RequirePermissions permissions={[
    { action: SCHOOL_ACTIONS.LIST_SESSIONS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_STUDENTS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.READ_CLASS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SECTIONS, resource: { kind: 'school', schoolId } },
  ]}><AdmissionDetails schoolId={schoolId} admissionId={admissionId} /></RequirePermissions>;
}
