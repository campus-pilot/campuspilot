import type { Metadata } from 'next';
import { FeesScreen } from '@/components/fees/fees-screen';

export const metadata: Metadata = { title: 'Fees' };

export default function FeesPage() {
  return <FeesScreen />;
}
