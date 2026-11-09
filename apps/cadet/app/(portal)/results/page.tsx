import type { Metadata } from 'next';
import { ResultsScreen } from '@/components/results/results-screen';

export const metadata: Metadata = { title: 'Results' };

export default function ResultsPage() {
  return <ResultsScreen />;
}
