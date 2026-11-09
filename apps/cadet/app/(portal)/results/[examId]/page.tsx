import type { Metadata } from 'next';
import { ResultDetailScreen } from '@/components/results/result-detail-screen';

export const metadata: Metadata = { title: 'Result' };

export default async function ResultPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ResultDetailScreen examId={decodeURIComponent(examId)} />;
}
