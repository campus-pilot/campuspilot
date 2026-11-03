import { redirect } from 'next/navigation';

export default async function AdmissionResultsPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  redirect(`/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admissionId)}/details`);
}
