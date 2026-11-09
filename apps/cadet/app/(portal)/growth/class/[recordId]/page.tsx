import type { Metadata } from 'next';
import { GrowthClassNotFound, GrowthScreen } from '@/components/growth/growth-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Growth' };

/** Growth for one of the student's class records, chosen in the class picker. */
export default async function ClassGrowthPage({ params }: { params: Promise<{ recordId: string }> }) {
  const recordId = decodeRouteParam((await params).recordId);
  return recordId === null ? <GrowthClassNotFound /> : <GrowthScreen recordId={recordId} />;
}
