import { redirect } from 'next/navigation';

export default async function AdmissionIndexPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  redirect(`/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admissionId)}/details`);
}
