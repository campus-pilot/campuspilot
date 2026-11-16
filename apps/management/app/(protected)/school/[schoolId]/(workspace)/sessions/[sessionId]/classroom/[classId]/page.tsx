import { ClassroomLanding } from '@/components/classroom-landing';

export default async function ClassroomIndexPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, sessionId, classId } = await params;
  return <ClassroomLanding scope={{ schoolId, sessionId, classId }} />;
}
