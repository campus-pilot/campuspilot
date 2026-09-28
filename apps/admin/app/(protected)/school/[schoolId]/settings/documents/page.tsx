import type { Metadata } from 'next';
import { AdmissionDocumentSettings } from '@/components/admission-document-settings';

export const metadata: Metadata = { title: 'Admission Documents | CampusPilot Admin' };

export default async function AdmissionDocumentsSettingsPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <AdmissionDocumentSettings schoolId={schoolId} />;
}
