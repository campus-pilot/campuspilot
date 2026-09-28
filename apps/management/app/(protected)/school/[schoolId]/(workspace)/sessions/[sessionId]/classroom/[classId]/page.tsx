import { redirect } from 'next/navigation';

export default async function ClassroomIndexPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, sessionId, classId } = await params;
  redirect(
    `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(classId)}/students`,
  );
}
