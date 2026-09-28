import type { Metadata } from 'next';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionDocumentSettings } from '@/components/admission-document-settings';
import { RequirePermissions } from '@/components/require-permissions';

export const metadata: Metadata = { title: 'Admission Documents | CampusPilot' };

export default async function AdmissionDocumentsSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ADMISSION_SETTINGS, resource: { kind: 'school', schoolId } }} fallback={<p className="text-sm text-muted-foreground">You do not have access to admission document settings.</p>}><AdmissionDocumentSettings schoolId={schoolId} /></RequirePermissions>;
}
