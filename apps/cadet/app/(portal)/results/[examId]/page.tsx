import type { Metadata } from 'next';
import { ResultDetailScreen, ResultNotFound } from '@/components/results/result-detail-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Result' };

export default async function ResultPage({ params }: { params: Promise<{ examId: string }> }) {
  const examId = decodeRouteParam((await params).examId);
  return examId === null ? <ResultNotFound /> : <ResultDetailScreen examId={examId} />;
}
