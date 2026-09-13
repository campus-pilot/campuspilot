import type { Metadata } from 'next';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';

export const metadata: Metadata = {
  title: 'School Dashboard | CampusPilot Admin',
};

export default function SchoolDashboardPage() {
  return <AdminPageSkeleton />;
}
