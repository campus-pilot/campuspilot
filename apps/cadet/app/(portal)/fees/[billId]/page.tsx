import type { Metadata } from 'next';
import { BillScreen } from '@/components/fees/bill-screen';

export const metadata: Metadata = { title: 'Bill' };

export default async function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  return <BillScreen billId={decodeURIComponent(billId)} />;
}
