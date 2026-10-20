import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const { schoolId, sessionId } = await params;
  redirect(
    `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/documents/history`,
  );
}
