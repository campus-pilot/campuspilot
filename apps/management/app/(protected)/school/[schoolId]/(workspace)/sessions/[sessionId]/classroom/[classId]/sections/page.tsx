import { ClassSections } from '@/components/class-sections';

export default async function ClassSectionsPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, classId } = await params;
  return <ClassSections schoolId={schoolId} classId={classId} />;
}
