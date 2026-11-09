import type { Metadata } from 'next';
import { ResultsClassNotFound, ResultsScreen } from '@/components/results/results-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Results' };

/** One of the student's class records, e.g. an earlier class linked from Growth. */
export default async function ClassResultsPage({ params }: { params: Promise<{ recordId: string }> }) {
  const recordId = decodeRouteParam((await params).recordId);
  return recordId === null ? <ResultsClassNotFound /> : <ResultsScreen recordId={recordId} />;
}
