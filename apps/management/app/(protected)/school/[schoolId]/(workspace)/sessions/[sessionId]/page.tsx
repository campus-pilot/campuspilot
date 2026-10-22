import { SchoolDashboard } from '@/components/dashboard/school-dashboard';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;
  return <SchoolDashboard schoolId={schoolId} sessionId={sessionId} />;
}
