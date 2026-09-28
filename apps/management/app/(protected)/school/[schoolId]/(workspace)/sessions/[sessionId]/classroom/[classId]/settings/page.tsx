import { ClassSettings } from '@/components/class-settings';

export default async function ClassSettingsPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string; classId: string }>;
}) {
  const { schoolId, sessionId, classId } = await params;
  return (
    <ClassSettings
      schoolId={schoolId}
      sessionId={sessionId}
      classId={classId}
    />
  );
}
