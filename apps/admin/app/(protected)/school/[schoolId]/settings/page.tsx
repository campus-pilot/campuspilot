import type { Metadata } from 'next';
import { SchoolSettings } from '@/components/school-settings';

export const metadata: Metadata = {
  title: 'School Settings | CampusPilot Admin',
};

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolSettings schoolId={schoolId} />;
}
