import { AdmissionDocuments } from '@/components/admission-documents';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';

export default async function AdmissionDocumentsPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ADMISSION_SETTINGS, resource: { kind: 'school', schoolId } }}><AdmissionDocuments schoolId={schoolId} admissionId={admissionId} /></RequirePermissions>;
}
