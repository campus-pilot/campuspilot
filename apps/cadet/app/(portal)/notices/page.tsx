import type { Metadata } from 'next';
import { NoticesScreen } from '@/components/notices/notices-screen';

export const metadata: Metadata = { title: 'Notices' };

export default function NoticesPage() {
  return <NoticesScreen />;
}
