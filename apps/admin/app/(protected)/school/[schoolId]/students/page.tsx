import type { Metadata } from 'next';
import { SchoolStudentOverview } from '@/components/school-student-overview';

export const metadata: Metadata = {
  title: 'Students | CampusPilot Admin',
};

export default async function StudentsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolStudentOverview schoolId={schoolId} />;
}
