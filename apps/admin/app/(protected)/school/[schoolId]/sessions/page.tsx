import { SessionManagement } from '@/components/session/session-management';

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SessionManagement schoolId={schoolId} />;
}
