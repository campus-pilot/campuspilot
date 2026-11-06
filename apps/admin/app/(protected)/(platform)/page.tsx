import type { Metadata } from 'next';
import { PlatformOverview } from '@/components/platform-overview';

export const metadata: Metadata = {
  title: 'Home | CampusPilot Admin',
};

export default function HomePage() {
  return <PlatformOverview />;
}
