import type { Metadata } from 'next';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';

export const metadata: Metadata = {
  title: 'Demo Requests | CampusPilot Admin',
};

export default function DemoRequestsPage() {
  return <AdminPageSkeleton />;
}
