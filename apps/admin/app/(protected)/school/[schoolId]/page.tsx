import type { Metadata } from 'next';
import { SchoolOverview } from '@/components/school-overview';

export const metadata: Metadata = {
  title: 'School Dashboard | CampusPilot Admin',
};

export default async function SchoolDashboardPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolOverview schoolId={schoolId} />;
}
