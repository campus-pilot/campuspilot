import { notFound } from 'next/navigation';
import { BillDetailScreen } from '@/components/concept/fees-screen';
import { bills } from '@/components/concept/mock-data';

export default async function ConceptBillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const bill = bills.find((candidate) => candidate.id === billId);
  if (!bill) notFound();
  return <BillDetailScreen bill={bill} />;
}
