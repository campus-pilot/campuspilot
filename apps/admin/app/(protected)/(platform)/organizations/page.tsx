import type { Metadata } from 'next';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';

export const metadata: Metadata = {
  title: 'Organizations | CampusPilot Admin',
};

export default function OrganizationsPage() {
  return <AdminPageSkeleton />;
}
