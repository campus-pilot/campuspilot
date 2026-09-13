import type { Metadata } from 'next';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';

export const metadata: Metadata = {
  title: 'Home | CampusPilot Admin',
};

export default function HomePage() {
  return <AdminPageSkeleton />;
}
