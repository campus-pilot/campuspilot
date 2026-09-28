import { ClassSubjects } from '@/components/class-subjects';

export default async function ClassSubjectsPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, classId } = await params;
  return <ClassSubjects schoolId={schoolId} classId={classId} />;
}
