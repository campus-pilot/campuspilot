import { ClassTeachers } from '@/components/class-teachers';

export default async function ClassTeachersPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, classId } = await params;
  return <ClassTeachers schoolId={schoolId} classId={classId} />;
}
