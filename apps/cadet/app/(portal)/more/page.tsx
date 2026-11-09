import type { Metadata } from 'next';
import { MoreScreen } from '@/components/more/more-screen';

export const metadata: Metadata = { title: 'More' };

export default function MorePage() {
  return <MoreScreen />;
}
