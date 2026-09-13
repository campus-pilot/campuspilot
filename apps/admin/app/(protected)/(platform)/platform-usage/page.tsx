import type { Metadata } from 'next';
import { AdminPageSkeleton } from '@campuspilot/components/admin-page-skeleton';

export const metadata: Metadata = {
  title: 'Platform Usage | CampusPilot Admin',
};

export default function PlatformUsagePage() {
  return <AdminPageSkeleton />;
}
