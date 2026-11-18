import type { Metadata } from 'next';
import { SchoolRequestsTable } from '@/components/school-requests/school-requests-table';

export const metadata: Metadata = {
  title: 'School Requests | CampusPilot Admin',
};

export default function SchoolRequestsPage() {
  return <SchoolRequestsTable />;
}
