import type { Metadata } from 'next';
import { BillNotFound, BillScreen } from '@/components/fees/bill-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Bill' };

export default async function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const billId = decodeRouteParam((await params).billId);
  return billId === null ? <BillNotFound /> : <BillScreen billId={billId} />;
}
